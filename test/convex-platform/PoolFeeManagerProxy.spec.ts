import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { Account } from "types";
import { DeployMocksResult } from "../../scripts/deployMocks";
import { deployPhase9 } from "../../scripts/deploySystem";
import { deployContract } from "../../tasks/utils";
import { DEAD_ADDRESS, impersonateAccount, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { deployL1, L1TestSetup } from "../../test/sidechain/sidechainTestSetup";
import {
    Booster,
    MockCurveGauge,
    MockCurveGauge__factory,
    MockERC20__factory,
    PoolFeeManagerProxy,
    PoolManagerV4,
} from "../../types/generated";

describe("PoolFeeManagerProxy", () => {
    let accounts: Signer[];
    let alice: Account;
    let deployer: Account;
    let dao: Account;

    let booster: Booster;
    let poolManager: PoolManagerV4;
    let poolFeeManagerProxy: PoolFeeManagerProxy;
    let mocks: DeployMocksResult;
    let l1: L1TestSetup;
    let idSnapShot: number;

    const deployMockGauge = async (name: string, weight = 0) => {
        const lptoken = await new MockERC20__factory(deployer.signer).deploy(
            `mk-lp-${name}`,
            `mk`,
            18,
            deployer.address,
            10000000,
        );
        const gauge = await new MockCurveGauge__factory(deployer.signer).deploy(
            `mkt-${name}`,
            `mkt-${name}`,
            lptoken.address,
            [],
        );
        await l1.mocks.voting.vote_for_gauge_weights(gauge.address, weight);

        return { gauge, lptoken };
    };

    const setup = async () => {
        if (idSnapShot) {
            await hre.ethers.provider.send("evm_revert", [idSnapShot]);
            idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
            return;
        }
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[5].getAddress());
        l1 = await deployL1(hre, accounts);
        mocks = l1.mocks;
        const phase9 = await deployPhase9(
            hre,
            deployer.signer,
            l1.mocks.addresses,
            { ...l1.phase6, ...l1.phase8 },
            l1.multisigs,
        );
        dao = await impersonateAccount(l1.multisigs.daoMultisig);

        booster = l1.phase6.booster;
        poolManager = l1.phase8.poolManagerV4;
        poolFeeManagerProxy = phase9.poolFeeManagerProxy;
        idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
    };
    before("init contract", async () => {
        await setup();
    });
    after(async () => {
        await hre.ethers.provider.send("evm_revert", [idSnapShot]);
    });
    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            expect(await poolFeeManagerProxy.poolManager(), "poolManager").to.eq(l1.phase8.poolManagerV4.address);
            expect(await poolFeeManagerProxy.booster(), "booster").to.eq(l1.phase6.booster.address);
            expect(await poolFeeManagerProxy.operator(), "operator").to.eq(dao.address);
            expect(await poolFeeManagerProxy.protectAddPool(), "protectAddPool").to.eq(true);
            expect(await poolFeeManagerProxy.defaultRewardMultiplier(), "defaultRewardMultiplier").to.eq(4000);
        });
    });
    describe("configuration", async () => {
        it("DAO - sets PoolManagerV4 operator ", async () => {
            expect(await poolManager.operator()).to.equal(dao.address);

            await poolManager.connect(dao.signer).setOperator(poolFeeManagerProxy.address);

            expect(await poolManager.operator()).to.equal(poolFeeManagerProxy.address);
        });
        it("DAO - sets Booster feeManager", async () => {
            expect(await booster.feeManager(), "feeManager").to.equal(dao.address);

            await l1.phase8.boosterOwnerSecondary.connect(dao.signer).setFeeManager(poolFeeManagerProxy.address);

            expect(await booster.feeManager()).to.equal(poolFeeManagerProxy.address);
        });
        it("sets protectAddPool to true", async () => {
            await poolFeeManagerProxy.connect(dao.signer).setProtectPool(true);
            expect(await poolFeeManagerProxy.protectAddPool()).to.equal(true);
        });
    });

    describe("PoolManagerV4", async () => {
        describe("@method addPool", async () => {
            let badGauge: MockCurveGauge;
            before(async () => {
                const badLptoken = "0x0000000000000000000000000000000000000000";
                badGauge = await deployContract<MockCurveGauge>(
                    hre,
                    new MockCurveGauge__factory(accounts[0]),
                    "MockCurveGauge",
                    ["BadGauge", "badGauge", badLptoken, []],
                    {},
                    false,
                );
            });

            it("addPool called by operator", async () => {
                const { gauge } = await deployMockGauge("mock0", 1);
                const pid = await booster.poolLength();
                const tx = await poolFeeManagerProxy.connect(dao.signer)["addPool(address)"](gauge.address);
                await tx.wait();

                const lptoken = await gauge.lp_token();
                const pool = await booster.poolInfo(pid);
                expect(pool.lptoken).to.equal(lptoken);
            });

            it("reverts if pool weight is 0", async () => {
                const failedTx = poolFeeManagerProxy.connect(dao.signer)["addPool(address)"](badGauge.address);
                await expect(failedTx).to.revertedWith("must have weight");
            });

            it("reverts if lptoken address is 0", async () => {
                const tx = await mocks.voting.vote_for_gauge_weights(badGauge.address, 1);
                await tx.wait();

                const failedTx = poolFeeManagerProxy.connect(dao.signer)["addPool(address)"](badGauge.address);
                await expect(failedTx).to.revertedWith("lp token is 0");
            });

            it("reverts if gauge has already been added", async () => {
                const failedTx = poolFeeManagerProxy.connect(dao.signer)["addPool(address)"](mocks.gauges[0].address);
                await expect(failedTx).to.revertedWith("already registered gauge");
            });
        });

        describe("@method shutdownPool", () => {
            it("reverts if not called by operator", async () => {
                const failedTx = poolFeeManagerProxy.connect(alice.signer).shutdownPool(0);
                await expect(failedTx).to.revertedWith("!auth");
            });

            it("happy path", async () => {
                const tx = await poolFeeManagerProxy.connect(dao.signer).shutdownPool(0);
                await tx.wait();

                const pool = await booster.poolInfo(0);
                expect(pool.shutdown).to.equal(true);
            });
        });

        describe("@method setProtectPool", () => {
            it("protectPool defaults to true", async () => {
                const startValue = await poolFeeManagerProxy.protectAddPool();
                expect(startValue).to.equal(true);
            });

            it("reverts if addPool is protected and caller is not operator", async () => {
                const resp = poolFeeManagerProxy.connect(alice.signer)["addPool(address)"](mocks.gauges[1].address);
                await expect(resp).to.be.revertedWith("!auth");
            });

            it("reverts if setProtectPool caller is not operator", async () => {
                const resp = poolFeeManagerProxy.connect(alice.signer).setProtectPool(false);
                await expect(resp).to.be.revertedWith("!auth");
            });

            it("setProtectPool update protectAddPool", async () => {
                await poolFeeManagerProxy.connect(dao.signer).setProtectPool(false);
                const newValue = await poolFeeManagerProxy.protectAddPool();
                expect(newValue).to.equal(false);
            });

            it("addPool can be called by anyone", async () => {
                const { gauge } = await deployMockGauge("mock1", 1);
                const pid = await booster.poolLength();

                await poolFeeManagerProxy.connect(alice.signer)["addPool(address)"](gauge.address);

                const lptoken = await gauge.lp_token();
                const pool = await booster.poolInfo(pid);
                expect(pool.lptoken).to.equal(lptoken);
            });
        });
    });

    describe("Fee Manager", async () => {
        it("setDefaultRewardMultiplier ", async () => {
            const multiplier = 5000;
            await poolFeeManagerProxy.connect(dao.signer).setDefaultRewardMultiplier(multiplier);
            expect(await poolFeeManagerProxy.defaultRewardMultiplier()).to.equal(multiplier);
        });
        it("set reward multiplier of an existing pool ", async () => {
            const multiplier = 5000;
            const poolInfo = await booster.poolInfo(0);
            await poolFeeManagerProxy.connect(dao.signer).setRewardMultiplier(poolInfo.crvRewards, multiplier);
            expect(await booster.getRewardMultipliers(poolInfo.crvRewards)).to.equal(multiplier);
        });

        it("set booster fees", async () => {
            const tx = await poolFeeManagerProxy.connect(dao.signer).setFees(500, 300, 25, 0);
            await expect(tx).to.emit(booster, "FeesUpdated").withArgs(500, 300, 25, 0);
        });
        it("set booster treasury", async () => {
            await poolFeeManagerProxy.connect(dao.signer).setTreasury(DEAD_ADDRESS);
            expect(await booster.treasury()).to.equal(DEAD_ADDRESS);
        });
        it("set bridge delegate", async () => {
            await poolFeeManagerProxy.connect(dao.signer).setBridgeDelegate(DEAD_ADDRESS);
            expect(await booster.bridgeDelegate()).to.equal(DEAD_ADDRESS);
        });
    });
    describe("edge cases", async () => {
        it("fails if setPoolManagerOperator is not called by operator", async () => {
            await expect(
                poolFeeManagerProxy.connect(deployer.signer).setPoolManagerOperator(ZERO_ADDRESS),
                "not auth",
            ).to.be.revertedWith("!auth");
        });
        it("fails if setProtectPool is not called by operator", async () => {
            await expect(
                poolFeeManagerProxy.connect(deployer.signer).setProtectPool(false),
                "not auth",
            ).to.be.revertedWith("!auth");
        });
        it("fails if setOperator is not called by operator", async () => {
            await expect(
                poolFeeManagerProxy.connect(deployer.signer).setOperator(ZERO_ADDRESS),
                "not auth",
            ).to.be.revertedWith("!auth");
        });
        it("fails if setDefaultRewardMultiplier is not called by operator", async () => {
            await expect(
                poolFeeManagerProxy.connect(deployer.signer).setDefaultRewardMultiplier(5000),
                "not auth",
            ).to.be.revertedWith("!auth");
        });
        it("fails if setFees is not called by operator", async () => {
            await expect(
                poolFeeManagerProxy.connect(deployer.signer).setFees(0, 0, 0, 0),
                "not auth",
            ).to.be.revertedWith("!auth");
        });
        it("fails if setTreasury is not called by operator", async () => {
            await expect(
                poolFeeManagerProxy.connect(deployer.signer).setTreasury(ZERO_ADDRESS),
                "not auth",
            ).to.be.revertedWith("!auth");
        });
        it("fails if setBridgeDelegate is not called by operator", async () => {
            await expect(
                poolFeeManagerProxy.connect(deployer.signer).setBridgeDelegate(ZERO_ADDRESS),
                "not auth",
            ).to.be.revertedWith("!auth");
        });
        it("fails if setRewardMultiplier is not called by operator", async () => {
            await expect(
                poolFeeManagerProxy.connect(deployer.signer).setRewardMultiplier(ZERO_ADDRESS, ZERO),
                "not auth",
            ).to.be.revertedWith("!auth");
        });
        describe("@method shutdownPool", () => {
            it("reverts if not called by operator", async () => {
                const failedTx = poolFeeManagerProxy.connect(alice.signer).shutdownSystem();
                await expect(failedTx).to.revertedWith("!auth");
            });

            it("happy path", async () => {
                expect(await l1.phase6.poolManagerSecondaryProxy.isShutdown()).to.equal(false);

                const tx = await poolFeeManagerProxy.connect(dao.signer).shutdownSystem();
                await tx.wait();

                expect(await l1.phase6.poolManagerSecondaryProxy.isShutdown()).to.equal(true);
            });
        });
    });
    describe("reverts configuration", async () => {
        it("DAO - sets PoolManagerV4 operator ", async () => {
            expect(await poolManager.operator()).to.not.equal(dao.address);

            await poolFeeManagerProxy.connect(dao.signer).setPoolManagerOperator(dao.address);

            expect(await poolManager.operator()).to.equal(dao.address);
        });
        it("DAO - sets Booster feeManager", async () => {
            expect(await booster.feeManager(), "feeManager").to.not.equal(dao.address);

            await l1.phase8.boosterOwnerSecondary.connect(dao.signer).setFeeManager(dao.address);

            expect(await booster.feeManager(), "feeManager").to.equal(dao.address);
        });
    });
});
