import { assertBNClosePercent } from "./../../test-utils/assertions";
import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4, SystemDeployed } from "../../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    Booster,
    BoosterOwner,
    ERC20__factory,
    BaseRewardPool__factory,
    MockFeeDistributor__factory,
    MockERC20__factory,
    MockERC20,
} from "../../types/generated";
import { Signer } from "ethers";
import { getTimestamp, increaseTime, increaseTimeTo } from "../../test-utils/time";
import { simpleToExactAmount } from "../../test-utils/math";
import { DEAD_ADDRESS, ONE_WEEK, ZERO_ADDRESS } from "../../test-utils/constants";
import { deployContract } from "../../tasks/utils";
import { PoolInfo } from "../../types";

const debug = false;

describe("Booster", () => {
    let accounts: Signer[];
    let booster: Booster;
    let boosterOwner: BoosterOwner;
    let mocks: DeployMocksResult;
    let pool: PoolInfo;
    let contracts: SystemDeployed;
    let daoSigner: Signer;

    let deployer: Signer;
    let deployerAddress: string;

    let alice: Signer;
    let aliceAddress: string;

    const setup = async () => {
        mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], daoSigner);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        const phase2 = await deployPhase2(
            hre,
            deployer,
            phase1,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.connect(daoSigner).setProtectPool(false);
        await phase3.boosterOwner.connect(daoSigner).setFeeInfo(mocks.lptoken.address, mocks.feeDistribution.address);
        await phase3.boosterOwner.connect(daoSigner).setFeeInfo(mocks.crv.address, mocks.feeDistribution.address);
        contracts = await deployPhase4(hre, deployer, phase3, mocks.addresses);

        ({ booster, boosterOwner } = contracts);

        pool = await booster.poolInfo(0);

        // transfer LP tokens to accounts
        const balance = await mocks.lptoken.balanceOf(deployerAddress);
        for (const account of accounts) {
            const accountAddress = await account.getAddress();
            const share = balance.div(accounts.length);
            const tx = await mocks.lptoken.transfer(accountAddress, share);
            await tx.wait();
        }

        alice = accounts[1];
        aliceAddress = await alice.getAddress();
    };

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();
        daoSigner = accounts[6];
    });

    describe("managing system revenue fees", async () => {
        before(async () => {
            await setup();
        });
        it("has the correct initial config", async () => {
            const lockFee = await booster.lockIncentive();
            expect(lockFee).eq(550);
            const stakerFee = await booster.stakerIncentive();
            expect(stakerFee).eq(1100);
            const callerFee = await booster.earmarkIncentive();
            expect(callerFee).eq(50);
            const platformFee = await booster.platformFee();
            expect(platformFee).eq(0);

            const feeManager = await booster.feeManager();
            expect(feeManager).eq(await daoSigner.getAddress());
        });
        it("doesn't allow just anyone to change fees", async () => {
            await expect(booster.connect(accounts[5]).setFees(1, 2, 3, 4)).to.be.revertedWith("!auth");
        });
        it("allows feeManager to set the fees", async () => {
            const tx = await booster.connect(daoSigner).setFees(500, 300, 25, 0);
            await expect(tx).to.emit(booster, "FeesUpdated").withArgs(500, 300, 25, 0);
        });
        it("enforces 40% upper bound", async () => {
            await expect(booster.connect(daoSigner).setFees(2500, 1500, 50, 0)).to.be.revertedWith(">MaxFees");

            const tx = await booster.connect(daoSigner).setFees(1500, 900, 50, 0);
            await expect(tx).to.emit(booster, "FeesUpdated").withArgs(1500, 900, 50, 0);
        });
        it("enforces bounds on each fee type", async () => {
            // lockFees 300-1500
            await expect(booster.connect(daoSigner).setFees(200, 500, 50, 0)).to.be.revertedWith("!lockFees");
            // stakerFees 300-1500
            await expect(booster.connect(daoSigner).setFees(500, 200, 50, 0)).to.be.revertedWith("!stakerFees");
            // callerFees 10-100
            await expect(booster.connect(daoSigner).setFees(500, 500, 2, 0)).to.be.revertedWith("!callerFees");
            await expect(booster.connect(daoSigner).setFees(500, 500, 110, 0)).to.be.revertedWith("!callerFees");
            // platform 0-200
            await expect(booster.connect(daoSigner).setFees(500, 500, 50, 250)).to.be.revertedWith("!platform");
        });
        it("distributes the fees to the correct places", async () => {
            await booster.connect(daoSigner).setFees(1500, 900, 50, 50);

            // bals before
            const balsBefore = await Promise.all([
                await mocks.crv.balanceOf((await booster.poolInfo(0)).crvRewards), // reward pool
                await mocks.crv.balanceOf(await booster.lockRewards()), // cvxCrv
                await mocks.crv.balanceOf(await booster.stakerRewards()), // auraStakingProxy
                await mocks.crv.balanceOf(aliceAddress), // alice
                await mocks.crv.balanceOf(await booster.treasury()), // platform
            ]);

            // collect the rewards
            await booster.connect(daoSigner).setTreasury(DEAD_ADDRESS);
            await booster.connect(alice).earmarkRewards(0);

            // bals after
            const balsAfter = await Promise.all([
                await mocks.crv.balanceOf((await booster.poolInfo(0)).crvRewards), // reward pool
                await mocks.crv.balanceOf(await booster.lockRewards()), // cvxCrv
                await mocks.crv.balanceOf(await booster.stakerRewards()), // auraStakingProxy
                await mocks.crv.balanceOf(aliceAddress), // alice
                await mocks.crv.balanceOf(await booster.treasury()), // platform
            ]);
            expect(balsAfter[0]).eq(balsBefore[0].add(simpleToExactAmount(1).div(10000).mul(7500)));
            expect(balsAfter[1]).eq(balsBefore[1].add(simpleToExactAmount(1).div(10000).mul(1500)));
            expect(balsAfter[2]).eq(balsBefore[2].add(simpleToExactAmount(1).div(10000).mul(900)));
            expect(balsAfter[3]).eq(balsBefore[3].add(simpleToExactAmount(1).div(10000).mul(50)));
            expect(balsAfter[4]).eq(balsBefore[4].add(simpleToExactAmount(1).div(10000).mul(50)));
        });
    });
    describe("managing fee distributors to cvxCRV", async () => {
        before(async () => {
            await setup();
        });

        it("has both native token and distro in the initial config", async () => {
            const nativeDistro = await booster.feeTokens(mocks.crv.address);
            expect(nativeDistro.distro).eq(mocks.feeDistribution.address);
            expect(nativeDistro.rewards).eq(contracts.cvxCrvRewards.address);
            expect(nativeDistro.active).eq(true);
            const feeDistro = await booster.feeTokens(mocks.lptoken.address);
            expect(feeDistro.distro).eq(mocks.feeDistribution.address);
            expect(feeDistro.rewards).eq(await contracts.cvxCrvRewards.extraRewards(0));
            expect(feeDistro.active).eq(true);
        });
        describe("setting fee info", () => {
            it("sets directly to cvxCrv if the reward token is crv", async () => {
                const feeDistro = await new MockFeeDistributor__factory(deployer).deploy(
                    [mocks.crv.address],
                    [simpleToExactAmount(1)],
                );
                await boosterOwner.connect(daoSigner).setFeeInfo(mocks.crv.address, feeDistro.address);

                const storage = await booster.feeTokens(mocks.crv.address);
                expect(storage.distro).eq(feeDistro.address);
                expect(storage.rewards).eq(contracts.cvxCrvRewards.address);

                await boosterOwner.connect(daoSigner).setFeeInfo(mocks.crv.address, mocks.feeDistribution.address);
            });
            it("creates a token rewards otherwise", async () => {
                const newMockToken = await new MockERC20__factory(deployer).deploy(
                    "mk2",
                    "mk2",
                    18,
                    deployerAddress,
                    1000,
                );
                const feeDistro = await new MockFeeDistributor__factory(deployer).deploy(
                    [newMockToken.address],
                    [simpleToExactAmount(1)],
                );
                await boosterOwner.connect(daoSigner).setFeeInfo(newMockToken.address, feeDistro.address);

                const storage = await booster.feeTokens(newMockToken.address);
                expect(storage.distro).eq(feeDistro.address);
                expect(storage.rewards).eq(await contracts.cvxCrvRewards.extraRewards(1));
                expect(storage.rewards).not.eq(contracts.cvxCrvRewards.address);
            });
        });
        describe("setting fee info fails if", () => {
            it("not called by owner", async () => {
                await expect(booster.connect(accounts[5]).setFeeInfo(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(
                    "!auth",
                );
                await expect(
                    boosterOwner.connect(accounts[5]).setFeeInfo(ZERO_ADDRESS, ZERO_ADDRESS),
                ).to.be.revertedWith("!owner");
            });
            it("either input is null", async () => {
                await expect(
                    boosterOwner.connect(daoSigner).setFeeInfo(mocks.crv.address, ZERO_ADDRESS),
                ).to.be.revertedWith("!addresses");
                await expect(
                    boosterOwner.connect(daoSigner).setFeeInfo(ZERO_ADDRESS, mocks.feeDistribution.address),
                ).to.be.revertedWith("!addresses");
            });
            it("gauge token is added", async () => {
                await expect(
                    boosterOwner.connect(daoSigner).setFeeInfo(mocks.gauges[0].address, mocks.feeDistribution.address),
                ).to.be.revertedWith("!token");
            });
            it("too many rewards", async () => {
                const maxExtraRewards = 10;
                const lockRewards = await booster.lockRewards();
                expect(lockRewards).to.eq(contracts.cvxCrvRewards.address);
                let len = await contracts.cvxCrvRewards.extraRewardsLength();

                for (let i = len.toNumber(); i <= maxExtraRewards; i++) {
                    const lptoken = await deployContract<MockERC20>(
                        hre,
                        new MockERC20__factory(deployer),
                        `MockLPToken${i}`,
                        ["mockLPToken", "mockLPToken", 18, deployerAddress, 10000000],
                        {},
                        debug,
                    );
                    if (i == maxExtraRewards) {
                        await expect(
                            boosterOwner.connect(daoSigner).setFeeInfo(lptoken.address, mocks.feeDistribution.address),
                        ).to.be.revertedWith("too many reward");
                    } else {
                        await boosterOwner
                            .connect(daoSigner)
                            .setFeeInfo(lptoken.address, mocks.feeDistribution.address);
                        len = await contracts.cvxCrvRewards.extraRewardsLength();
                    }
                }
            });
        });
        describe("updating fee info", () => {
            it("fails if not owner", async () => {
                await expect(booster.connect(accounts[5]).updateFeeInfo(ZERO_ADDRESS, false)).to.be.revertedWith(
                    "!auth",
                );
                await expect(boosterOwner.connect(accounts[5]).updateFeeInfo(ZERO_ADDRESS, false)).to.be.revertedWith(
                    "!owner",
                );
            });
            it("fails if distro does not exist", async () => {
                await expect(boosterOwner.connect(daoSigner).updateFeeInfo(ZERO_ADDRESS, false)).to.be.revertedWith(
                    "Fee doesn't exist",
                );
            });
            it("sets the active status on a distro", async () => {
                const addr = mocks.crv.address;
                let tx = await boosterOwner.connect(daoSigner).updateFeeInfo(addr, false);
                await expect(tx).to.emit(booster, "FeeInfoChanged").withArgs(addr, false);
                expect((await booster.feeTokens(addr)).active).eq(false);

                tx = await boosterOwner.connect(daoSigner).updateFeeInfo(addr, true);
                await expect(tx).to.emit(booster, "FeeInfoChanged").withArgs(addr, true);
                expect((await booster.feeTokens(addr)).active).eq(true);
            });
        });
        describe("earmarking fees", () => {
            it("allows for crv to be earmarked to cvxCrv rewards", async () => {
                const balBefore = await mocks.crv.balanceOf(contracts.cvxCrvRewards.address);
                await booster.earmarkFees(mocks.crv.address);
                const balAfter = await mocks.crv.balanceOf(contracts.cvxCrvRewards.address);

                expect(balAfter).eq(balBefore.add(simpleToExactAmount(1)));
            });
            it("sends 100% of the rewards to the reward contract", async () => {
                const feeDistro = await booster.feeTokens(mocks.lptoken.address);
                const token = MockERC20__factory.connect(mocks.lptoken.address, alice);

                const balBefore = await token.balanceOf(feeDistro.rewards);
                await booster.earmarkFees(mocks.lptoken.address);
                const balAfter = await token.balanceOf(feeDistro.rewards);

                expect(balAfter).eq(balBefore.add(simpleToExactAmount(1)));
            });
            it("fails if the distro is inactive", async () => {
                await boosterOwner.connect(daoSigner).updateFeeInfo(mocks.crv.address, false);
                await expect(booster.earmarkFees(mocks.crv.address)).to.be.revertedWith("Inactive distro");
            });
            it("fails if the distro does not exist", async () => {
                await expect(booster.earmarkFees(ZERO_ADDRESS)).to.be.revertedWith("Inactive distro");
            });
        });
    });
    describe("performing core functions", async () => {
        before(async () => {
            await setup();
        });

        it("@method Booster.deposit", async () => {
            const stake = false;
            const amount = ethers.utils.parseEther("10");
            let tx = await mocks.lptoken.connect(alice).approve(booster.address, amount);
            await tx.wait();

            tx = await booster.connect(alice).deposit(0, amount, stake);
            await tx.wait();

            const depositToken = ERC20__factory.connect(pool.token, deployer);
            const balance = await depositToken.balanceOf(aliceAddress);

            expect(balance).to.equal(amount);
        });

        it("@method BaseRewardPool.stake", async () => {
            const depositToken = ERC20__factory.connect(pool.token, alice);
            const balance = await depositToken.balanceOf(aliceAddress);
            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, alice);

            let tx = await depositToken.approve(crvRewards.address, balance);
            await tx.wait();

            tx = await crvRewards.stake(balance);
            await tx.wait();

            const stakedBalance = await crvRewards.balanceOf(aliceAddress);

            expect(stakedBalance).to.equal(balance);
        });

        it("@method Booster.earmarkRewards", async () => {
            await increaseTime(60 * 60 * 24);

            const deployerBalanceBefore = await mocks.crv.balanceOf(deployerAddress);

            const tx = await booster.earmarkRewards(0);
            await tx.wait();

            const rate = await mocks.crvMinter.rate();

            const stakerRewards = await booster.stakerRewards();
            const lockRewards = await booster.lockRewards();

            const deployerBalanceAfter = await mocks.crv.balanceOf(deployerAddress);
            const deployerBalanceDelta = deployerBalanceAfter.sub(deployerBalanceBefore);

            const rewardPoolBalance = await mocks.crv.balanceOf(pool.crvRewards);
            const stakerRewardsBalance = await mocks.crv.balanceOf(stakerRewards);
            const lockRewardsBalance = await mocks.crv.balanceOf(lockRewards);

            const totalCrvBalance = rewardPoolBalance
                .add(deployerBalanceDelta)
                .add(stakerRewardsBalance)
                .add(lockRewardsBalance);

            expect(totalCrvBalance).to.equal(rate);
        });

        it("@method BaseRewardPool.getReward", async () => {
            const claimExtras = false;

            await increaseTime(60 * 60 * 24);

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, alice);
            const tx = await crvRewards["getReward(address,bool)"](aliceAddress, claimExtras);
            await tx.wait();

            const crvBalance = await mocks.crv.balanceOf(aliceAddress);

            const balance = await crvRewards.balanceOf(aliceAddress);
            const rewardPerToken = await crvRewards.rewardPerToken();
            const expectedRewards = rewardPerToken.mul(balance).div(simpleToExactAmount(1));

            expect(expectedRewards).to.equal(crvBalance);
        });

        it("@method BaseRewardPool.processIdleRewards()", async () => {
            await mocks.crvMinter.setRate(1000);
            await booster.earmarkRewards(0);
            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, alice);
            const queuedRewards = await crvRewards.queuedRewards();
            expect(queuedRewards).gt(0);

            const periodFinish = await crvRewards.periodFinish();
            await increaseTimeTo(periodFinish);

            await crvRewards.processIdleRewards();
            const queuedRewardsAfter = await crvRewards.queuedRewards();
            expect(queuedRewardsAfter).eq(0);
        });
    });
    describe("processing L2 fees", async () => {
        let bridgeDelegate: Signer;
        let bridgeDelegateAddress: string;
        before(async () => {
            await setup();
            bridgeDelegate = accounts[8];
            bridgeDelegateAddress = await bridgeDelegate.getAddress();
        });

        it("only lets feeManager change bridgeDelegate address", async () => {
            const feeManager = await booster.feeManager();
            expect(feeManager).eq(await daoSigner.getAddress());

            expect(await booster.bridgeDelegate()).eq(ZERO_ADDRESS);
            await expect(booster.connect(accounts[9]).setBridgeDelegate(DEAD_ADDRESS)).to.be.revertedWith("!auth");

            await booster.connect(daoSigner).setBridgeDelegate(bridgeDelegateAddress);
            expect(await booster.bridgeDelegate()).eq(bridgeDelegateAddress);
        });
        it("allows bridgedelegate to process aura", async () => {
            await expect(booster.distributeL2Fees(simpleToExactAmount(1))).to.be.revertedWith("!auth");

            await mocks.crv.transfer(bridgeDelegateAddress, simpleToExactAmount(400000));

            const crvBalBefore = await mocks.crv.balanceOf(bridgeDelegateAddress);
            const cvxBalBefore = await contracts.cvx.balanceOf(bridgeDelegateAddress);

            await mocks.crv.connect(bridgeDelegate).approve(booster.address, simpleToExactAmount(400000));
            await booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(16.5));

            const crvBalAfter = await mocks.crv.balanceOf(bridgeDelegateAddress);
            const cvxBalAfter = await contracts.cvx.balanceOf(bridgeDelegateAddress);

            expect(crvBalBefore.sub(crvBalAfter)).eq(simpleToExactAmount(16.5));
            assertBNClosePercent(cvxBalAfter.sub(cvxBalBefore), simpleToExactAmount(325.65), "0.001");

            const currentTime = await getTimestamp();
            const currentEpoch = currentTime.div(ONE_WEEK);
            expect(await booster.l2FeesHistory(currentEpoch)).eq(simpleToExactAmount(100));
        });
        it("only allows 70k per week of farming", async () => {
            await expect(
                booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(11540)),
            ).to.be.revertedWith("Too many L2 Fees");
            await booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(11100));
            await expect(booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(500))).to.be.revertedWith(
                "Too many L2 Fees",
            );

            await increaseTime(ONE_WEEK);

            await expect(
                booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(11551)),
            ).to.be.revertedWith("Too many L2 Fees");
            await booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(11550));
            await expect(booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(1))).to.be.revertedWith(
                "Too many L2 Fees",
            );

            await increaseTime(ONE_WEEK);

            await booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(250));
            await booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(700));
            await booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(1276));
            await booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(3423));
            await booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(4324));
            await expect(
                booster.connect(bridgeDelegate).distributeL2Fees(simpleToExactAmount(4324)),
            ).to.be.revertedWith("Too many L2 Fees");
        });
    });
});
