import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";

import { DEAD_ADDRESS, impersonateAccount, simpleToExactAmount, ZERO_ADDRESS } from "../../test-utils";
import { Account } from "../../types";
import {
    L1PoolManagerProxy,
    L2PoolManagerProxy,
    MockCurveGauge__factory,
    MockERC20__factory,
    MockGaugeCheckpointer,
    MockGaugeCheckpointer__factory,
    MockStakelessGauge__factory,
} from "../../types/generated";
import { ERRORS, OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import {
    CanonicalPhaseDeployed,
    SidechainDeployed,
    SideChainTestSetup,
    sidechainTestSetup,
} from "./sidechainTestSetup";

describe("L2PoolManagerProxy", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;
    let keeper: Account;

    let gaugeCheckPointer: MockGaugeCheckpointer;
    // Testing contract
    let l1PoolManagerProxy: L1PoolManagerProxy;
    let l2PoolManagerProxy: L2PoolManagerProxy;
    let testSetup: SideChainTestSetup;
    let sidechain: SidechainDeployed;
    let canonical: CanonicalPhaseDeployed;

    let idSnapShot: number;

    const NATIVE_FEE = simpleToExactAmount("3");
    const L1_CHAIN_ID = 111;
    const L2_CHAIN_ID = 222;
    const L2_BALANCER_GAUGE_TYPE = "Sidechain";
    const minDstGas = 5_500_000;
    const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, minDstGas]);

    /* -- Declare shared functions -- */
    const setup = async () => {
        if (idSnapShot) {
            await hre.ethers.provider.send("evm_revert", [idSnapShot]);
            idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
            return;
        }
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());
        keeper = await impersonateAccount(await accounts[7].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID);
        sidechain = testSetup.l2.sidechain;
        canonical = testSetup.l1.canonical;
        l1PoolManagerProxy = canonical.l1PoolManagerProxy;
        l2PoolManagerProxy = sidechain.l2PoolManagerProxy;

        dao = await impersonateAccount(testSetup.l1.multisigs.daoMultisig);
        await l1PoolManagerProxy.connect(dao.signer).updateAuthorizedKeepers(dao.address, true);
        await l1PoolManagerProxy.connect(dao.signer).updateAuthorizedKeepers(keeper.address, true);

        gaugeCheckPointer = MockGaugeCheckpointer__factory.connect(
            testSetup.l1.mocks.addresses.gaugeCheckpointer,
            deployer.signer,
        );

        const minDstGas = 5_500_000;
        await l1PoolManagerProxy.connect(dao.signer).setMinDstGas(L2_CHAIN_ID, 0, minDstGas);

        idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
    };

    const deploySidechainGauge = async (name: string, weight = 0) => {
        const lptoken = await new MockERC20__factory(deployer.signer).deploy(
            `mk-lp-${name}`,
            `mk`,
            18,
            deployer.address,
            10000000,
        );
        const sidechainGauge = await new MockCurveGauge__factory(deployer.signer).deploy(
            `l2-${name}`,
            `l2-${name}`,
            lptoken.address,
            [],
        );
        const rootGauge = await new MockStakelessGauge__factory(deployer.signer).deploy(sidechainGauge.address);
        await testSetup.l1.mocks.voting.vote_for_gauge_weights(rootGauge.address, weight);
        await gaugeCheckPointer.addGauges(L2_BALANCER_GAUGE_TYPE, [rootGauge.address]);

        return { rootGauge, sidechainGauge, lptoken };
    };
    before("init contract", async () => {
        await setup();
    });
    after(async () => {
        await hre.ethers.provider.send("evm_revert", [idSnapShot]);
    });
    describe("behaviors", async () => {
        describe("should behave like Ownable ", async () => {
            const ctx: Partial<OwnableBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.owner = dao;
                    ctx.anotherAccount = alice;
                    ctx.ownable = l2PoolManagerProxy;
                    return ctx as OwnableBehaviourContext;
                };
            });
            shouldBehaveLikeOwnable(() => ctx as OwnableBehaviourContext);
        });
    });
    describe("constructor", async () => {
        before("init contract", async () => {
            await setup();
        });

        it("should properly store valid arguments", async () => {
            expect(await l2PoolManagerProxy.poolManager(), "poolManager").to.eq(sidechain.poolManager.address);
            expect(await l2PoolManagerProxy.lzEndpoint(), "lzEndpoint").to.eq(testSetup.l2.mocks.addresses.lzEndpoint);
            expect(await l2PoolManagerProxy.owner(), "owner").to.eq(dao.address);
        });
    });
    describe("configuration ", async () => {
        it("DAO - sets setTrustedRemoteAddress on l1PoolManagerProxy", async () => {
            const expectedTrustedRemote = (
                l2PoolManagerProxy.address + l1PoolManagerProxy.address.slice(2)
            ).toLowerCase();
            //   When  config is set.
            await l1PoolManagerProxy
                .connect(dao.signer)
                .setTrustedRemoteAddress(L2_CHAIN_ID, l2PoolManagerProxy.address);
            // No events
            const trustedRemote = await l1PoolManagerProxy.trustedRemoteLookup(L2_CHAIN_ID);
            expect(trustedRemote, "trustedRemote").to.be.eq(expectedTrustedRemote);
        });
        it("DAO - sets setGaugeTypes on l1PoolManagerProxy", async () => {
            //   When  config is set.
            await l1PoolManagerProxy.connect(dao.signer).setGaugeType(L2_CHAIN_ID, L2_BALANCER_GAUGE_TYPE);
            // No events
            const gaugeType = await l1PoolManagerProxy.gaugeTypes(L2_CHAIN_ID);
            expect(gaugeType, "gaugeType").to.be.eq(L2_BALANCER_GAUGE_TYPE);
        });
        it("DAO - sets setTrustedRemoteAddress on l2PoolManagerProxy", async () => {
            const expectedTrustedRemote = (
                l1PoolManagerProxy.address + l2PoolManagerProxy.address.slice(2)
            ).toLowerCase();
            //   When  config is set.
            await l2PoolManagerProxy
                .connect(dao.signer)
                .setTrustedRemoteAddress(L1_CHAIN_ID, l1PoolManagerProxy.address);
            // No events
            const trustedRemote = await l2PoolManagerProxy.trustedRemoteLookup(L1_CHAIN_ID);
            expect(trustedRemote, "trustedRemote").to.be.eq(expectedTrustedRemote);
        });
        it("DAO - setPoolManager on l2PoolManagerProxy", async () => {
            await l2PoolManagerProxy.connect(dao.signer).setPoolManager(DEAD_ADDRESS);
            expect(await l2PoolManagerProxy.poolManager(), "poolManager").to.be.eq(DEAD_ADDRESS);

            const tx = await l2PoolManagerProxy.connect(dao.signer).setPoolManager(sidechain.poolManager.address);
            await expect(tx).to.emit(l2PoolManagerProxy, "PoolManagerUpdated").withArgs(sidechain.poolManager.address);
            expect(await l2PoolManagerProxy.poolManager(), "poolManager").to.be.eq(sidechain.poolManager.address);
        });
        it("DAO - updates sidechain poolManager ", async () => {
            expect(await sidechain.poolManager.operator(), "operator DAO").to.be.eq(dao.address);

            await sidechain.poolManager.connect(dao.signer).setOperator(l2PoolManagerProxy.address);

            expect(await sidechain.poolManager.operator(), "operator l2PoolManagerProxy").to.be.eq(
                l2PoolManagerProxy.address,
            );
        });
        it("DAO - setPoolManagerOperator on l2PoolManagerProxy", async () => {
            await l2PoolManagerProxy.connect(dao.signer).setPoolManagerOperator(l2PoolManagerProxy.address);

            expect(await sidechain.poolManager.operator(), "poolManager operator").to.be.eq(l2PoolManagerProxy.address);
        });
    });
    describe("addPool", async () => {
        it("from mainnet to sidechain add pool", async () => {
            const { rootGauge, sidechainGauge } = await deploySidechainGauge("mock", 1);

            // Removes protection so anyone can add pools
            await l1PoolManagerProxy.connect(dao.signer).setProtectPool(false);

            const tx = await l1PoolManagerProxy
                .connect(deployer.signer)
                .addPool(rootGauge.address, L2_CHAIN_ID, ZERO_ADDRESS, adapterParams, {
                    value: NATIVE_FEE,
                    gasLimit: minDstGas,
                });
            await expect(tx)
                .to.emit(l1PoolManagerProxy, "AddSidechainPool")
                .withArgs(L2_CHAIN_ID, rootGauge.address, sidechainGauge.address);
            await expect(tx).to.emit(sidechain.booster, "PoolAdded");
        });
        it("DAO - directly on sidechain", async () => {
            const { sidechainGauge } = await deploySidechainGauge("mockL2", 1);
            const tx = await l2PoolManagerProxy.connect(dao.signer).addPool(sidechainGauge.address);
            await expect(tx).to.emit(sidechain.booster, "PoolAdded");
        });
    });
    describe("edge cases", () => {
        describe("configurations", async () => {
            it("fails to initialize if caller is not owner", async () => {
                await expect(
                    l2PoolManagerProxy.connect(deployer.signer).initialize(DEAD_ADDRESS, DEAD_ADDRESS),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("fails to setPoolManager if caller is not owner", async () => {
                await expect(
                    l2PoolManagerProxy.connect(deployer.signer).setPoolManager(DEAD_ADDRESS),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("fails setPoolManager, caller is not owner", async () => {
                await expect(
                    l2PoolManagerProxy.connect(deployer.signer).setPoolManager(DEAD_ADDRESS),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("fails setPoolManagerOperator, caller is not owner", async () => {
                await expect(
                    l2PoolManagerProxy.connect(deployer.signer).setPoolManagerOperator(DEAD_ADDRESS),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("fails setPoolManagerOperator, ZERO_ADDRESS", async () => {
                await expect(
                    l2PoolManagerProxy.connect(dao.signer).setPoolManagerOperator(ZERO_ADDRESS),
                    "!_operator",
                ).to.be.revertedWith("!_operator");
            });
            it("fails addPool, caller is not owner", async () => {
                await expect(
                    l2PoolManagerProxy.connect(deployer.signer).addPool(DEAD_ADDRESS),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("fails shutdownSystem, caller is not owner", async () => {
                await expect(
                    l2PoolManagerProxy.connect(deployer.signer).shutdownSystem(),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("fails shutdownPool, caller is not owner", async () => {
                await expect(
                    l2PoolManagerProxy.connect(deployer.signer).shutdownPool(0),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
        });
        describe("add pool", async () => {
            it("fails if pool is already added", async () => {
                const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 20_000_000]);
                const { rootGauge, sidechainGauge } = await deploySidechainGauge("mock02", 2);

                let tx = await l1PoolManagerProxy
                    .connect(dao.signer)
                    .addPool(rootGauge.address, L2_CHAIN_ID, ZERO_ADDRESS, adapterParams, {
                        value: NATIVE_FEE,
                        gasLimit: minDstGas,
                    });

                await expect(tx).to.emit(sidechain.booster, "PoolAdded");

                tx = await l1PoolManagerProxy
                    .connect(dao.signer)
                    .addPool(rootGauge.address, L2_CHAIN_ID, ZERO_ADDRESS, adapterParams, {
                        value: NATIVE_FEE,
                        gasLimit: minDstGas,
                    });
                await expect(tx)
                    .to.emit(l1PoolManagerProxy, "AddSidechainPool")
                    .withArgs(L2_CHAIN_ID, rootGauge.address, sidechainGauge.address);
                await expect(tx).to.emit(sidechain.l2PoolManagerProxy, "MessageFailed");
                await expect(tx).to.not.emit(sidechain.booster, "PoolAdded");
            });
        });
    });
    describe("shutdownPool system", () => {
        it("shutdownSystem reverts if not called by operator", async () => {
            const failedTx = l2PoolManagerProxy.connect(alice.signer).shutdownSystem();
            await expect(failedTx).to.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("shutdownPool reverts if not called by operator", async () => {
            const failedTx = l2PoolManagerProxy.connect(alice.signer).shutdownPool(0);
            await expect(failedTx).to.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("shutdownPool pid 0", async () => {
            const pid = 0;
            expect((await sidechain.booster.poolInfo(pid)).shutdown).to.equal(false);
            await l2PoolManagerProxy.connect(dao.signer).shutdownPool(pid);
            expect((await sidechain.booster.poolInfo(pid)).shutdown).to.equal(true);
        });
        it("shutdownSystem the full system", async () => {
            await l2PoolManagerProxy.connect(dao.signer).shutdownSystem();
            expect(await l2PoolManagerProxy.isShutdown()).to.equal(true);
        });
        it("reverts if already shutdown and try to add pool", async () => {
            const { sidechainGauge } = await deploySidechainGauge("mockRevert", 1);
            await expect(
                l2PoolManagerProxy.connect(dao.signer)["addPool(address)"](sidechainGauge.address),
            ).to.revertedWith("shutdown");
        });
    });
});
