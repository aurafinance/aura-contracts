import { network } from "hardhat";
import { expect } from "chai";
import { ExtraRewardStashV3__factory } from "../types/generated";
import { impersonate, ZERO_ADDRESS, BN, ONE_WEEK, assertBNClosePercent, simpleToExactAmount } from "../test-utils";
import { Signer } from "ethers";
import { getTimestamp, latestBlock } from "./../test-utils/time";
import { Phase2Deployed } from "../scripts/deploySystem";
import { config } from "../tasks/deploy/goerli-config";

describe.skip("Full Deployment", () => {
    let deployer: Signer;
    let deployerAddress: string;
    const phase2Timestamp = BN.from(1657282100);
    let phase2: Phase2Deployed;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 7191313,
                    },
                },
            ],
        });
        deployerAddress = "0x30019eB135532bDdF2Da17659101cc000C73c8e4";
        deployer = await impersonate(deployerAddress);
    });

    describe("Phase 2", () => {
        describe("DEPLOY-Phase 2", () => {
            before(async () => {
                // PHASE 2
                phase2 = await config.getPhase2(deployer);
            });
            describe("verifying config", () => {
                it("VotingProxy has correct config", async () => {
                    const { voterProxy, booster, crvDepositor } = phase2;
                    const { multisigs, addresses } = config;

                    expect(await voterProxy.mintr()).eq(addresses.minter);
                    expect(await voterProxy.crv()).eq(addresses.token);
                    expect(await voterProxy.crvBpt()).eq(addresses.tokenBpt);
                    expect(await voterProxy.escrow()).eq(addresses.votingEscrow);
                    expect(await voterProxy.gaugeController()).eq(addresses.gaugeController);
                    expect(await voterProxy.rewardDeposit()).eq(ZERO_ADDRESS);
                    expect(await voterProxy.withdrawer()).eq(ZERO_ADDRESS);
                    expect(await voterProxy.owner()).eq(multisigs.daoMultisig);
                    expect(await voterProxy.operator()).eq(booster.address);
                    expect(await voterProxy.depositor()).eq(crvDepositor.address);
                });
                it("Aura Token has correct config", async () => {
                    const { cvx, minter, booster, voterProxy } = phase2;
                    expect(await cvx.operator()).eq(booster.address);
                    expect(await cvx.vecrvProxy()).eq(voterProxy.address);
                    expect(await cvx.minter()).eq(minter.address);
                    expect(await cvx.totalSupply()).eq(simpleToExactAmount(50000000));
                });
                it("Contracts have correct Aura balance", async () => {
                    const { cvx, initialCvxCrvStaking, chef } = phase2;
                    const { distroList } = config;
                    expect(await cvx.totalSupply()).eq(simpleToExactAmount(50, 24));
                    expect(await cvx.balanceOf(chef.address)).eq(distroList.lpIncentives);
                    expect(await cvx.balanceOf(initialCvxCrvStaking.address)).eq(distroList.cvxCrvBootstrap);
                });
                it("Aura Minter has correct config", async () => {
                    const { minter, cvx } = phase2;
                    const { multisigs } = config;
                    expect(await minter.aura()).eq(cvx.address);
                    expect(await minter.owner()).eq(multisigs.daoMultisig);
                    const time = await getTimestamp();
                    expect(await minter.inflationProtectionTime()).gt(time.add(ONE_WEEK.mul(155)));
                });
                it("Booster has correct config", async () => {
                    const {
                        booster,
                        cvx,
                        voterProxy,
                        cvxStakingProxy,
                        cvxCrvRewards,
                        arbitratorVault,
                        factories,
                        boosterOwner,
                        poolManagerProxy,
                    } = phase2;
                    const { multisigs, addresses } = config;
                    expect(await booster.crv()).eq(addresses.token);
                    expect(await booster.voteOwnership()).eq(ZERO_ADDRESS);
                    expect(await booster.voteParameter()).eq(ZERO_ADDRESS);

                    expect(await booster.lockIncentive()).eq(550);
                    expect(await booster.stakerIncentive()).eq(1100);
                    expect(await booster.earmarkIncentive()).eq(50);
                    expect(await booster.platformFee()).eq(0);
                    expect(await booster.MaxFees()).eq(2500);
                    expect(await booster.FEE_DENOMINATOR()).eq(10000);

                    expect(await booster.owner()).eq(boosterOwner.address);
                    expect(await booster.feeManager()).eq(multisigs.daoMultisig);
                    expect(await booster.poolManager()).eq(poolManagerProxy.address);
                    expect(await booster.staker()).eq(voterProxy.address);
                    expect(await booster.minter()).eq(cvx.address);
                    expect(await booster.rewardFactory()).eq(factories.rewardFactory.address);
                    expect(await booster.stashFactory()).eq(factories.stashFactory.address);
                    expect(await booster.tokenFactory()).eq(factories.tokenFactory.address);
                    expect(await booster.rewardArbitrator()).eq(arbitratorVault.address);
                    expect(await booster.voteDelegate()).eq(multisigs.daoMultisig);
                    expect(await booster.treasury()).eq(ZERO_ADDRESS);
                    expect(await booster.stakerRewards()).eq(cvxStakingProxy.address);
                    expect(await booster.lockRewards()).eq(cvxCrvRewards.address);

                    expect(await booster.isShutdown()).eq(false);
                    expect(await booster.poolLength()).eq(0);
                });
                it("Booster Owner has correct config", async () => {
                    const { booster, boosterOwner, poolManagerSecondaryProxy, factories } = phase2;
                    const { multisigs } = config;

                    expect(await boosterOwner.poolManager()).eq(poolManagerSecondaryProxy.address);
                    expect(await boosterOwner.booster()).eq(booster.address);
                    expect(await boosterOwner.stashFactory()).eq(factories.stashFactory.address);
                    expect(await boosterOwner.rescueStash()).eq(ZERO_ADDRESS);
                    expect(await boosterOwner.owner()).eq(multisigs.daoMultisig);
                    expect(await boosterOwner.pendingowner()).eq(ZERO_ADDRESS);
                    expect(await boosterOwner.isSealed()).eq(true);
                    expect(await boosterOwner.isForceTimerStarted()).eq(false);
                    expect(await boosterOwner.forceTimestamp()).eq(0);
                });
                it("factories have correct config", async () => {
                    const { factories, booster } = phase2;
                    const { addresses } = config;
                    const { rewardFactory, stashFactory, tokenFactory, proxyFactory } = factories;

                    expect(await rewardFactory.operator()).eq(booster.address);
                    expect(await rewardFactory.crv()).eq(addresses.token);

                    expect(await stashFactory.operator()).eq(booster.address);
                    expect(await stashFactory.rewardFactory()).eq(rewardFactory.address);
                    expect(await stashFactory.proxyFactory()).eq(proxyFactory.address);
                    expect(await stashFactory.v1Implementation()).eq(ZERO_ADDRESS);
                    expect(await stashFactory.v2Implementation()).eq(ZERO_ADDRESS);

                    const rewardsStashV3 = ExtraRewardStashV3__factory.connect(
                        await stashFactory.v3Implementation(),
                        deployer,
                    );
                    expect(await rewardsStashV3.crv()).eq(addresses.token);

                    expect(await tokenFactory.operator()).eq(booster.address);
                    expect(await tokenFactory.namePostfix()).eq(" Slipknot rope");
                    expect(await tokenFactory.symbolPrefix()).eq("slk");
                });
                it("arbitrator vault has correct config", async () => {
                    const { arbitratorVault, booster } = phase2;
                    const { multisigs } = config;

                    expect(await arbitratorVault.operator()).eq(multisigs.daoMultisig);
                    expect(await arbitratorVault.depositor()).eq(booster.address);
                });
                it("CvxCrv has correct config", async () => {
                    const { cvxCrv, crvDepositor } = phase2;
                    const { naming } = config;
                    expect(await cvxCrv.operator()).eq(crvDepositor.address);
                    expect(await cvxCrv.name()).eq(naming.cvxCrvName);
                    expect(await cvxCrv.symbol()).eq(naming.cvxCrvSymbol);
                });
                it("CvxCrvRewards has correct config", async () => {
                    const { cvxCrvRewards, cvxCrv, factories, booster } = phase2;
                    const { addresses } = config;
                    expect(await cvxCrvRewards.rewardToken()).eq(addresses.token);
                    expect(await cvxCrvRewards.stakingToken()).eq(cvxCrv.address);
                    expect(await cvxCrvRewards.operator()).eq(booster.address);
                    expect(await cvxCrvRewards.rewardManager()).eq(factories.rewardFactory.address);
                    expect(await cvxCrvRewards.pid()).eq(0);
                    expect(await cvxCrvRewards.extraRewardsLength()).eq(0);
                });
                it("InitialCvxCrvStaking has correct config", async () => {
                    const { initialCvxCrvStaking, cvxLocker, cvx, cvxCrv, penaltyForwarder } = phase2;
                    const { multisigs } = config;
                    expect(await initialCvxCrvStaking.rewardToken()).eq(cvx.address);
                    expect(await initialCvxCrvStaking.stakingToken()).eq(cvxCrv.address);
                    expect(await initialCvxCrvStaking.duration()).eq(ONE_WEEK.mul(2));
                    expect(await initialCvxCrvStaking.rewardManager()).eq(multisigs.treasuryMultisig);
                    expect(await initialCvxCrvStaking.auraLocker()).eq(cvxLocker.address);
                    expect(await initialCvxCrvStaking.penaltyForwarder()).eq(penaltyForwarder.address);
                    expect(await initialCvxCrvStaking.pendingPenalty()).eq(0);

                    expect(await initialCvxCrvStaking.startTime()).gt(phase2Timestamp.add(ONE_WEEK).sub(5400));
                    expect(await initialCvxCrvStaking.startTime()).lt(phase2Timestamp.add(ONE_WEEK).add(5400));
                });
                it("CrvDepositor has correct config", async () => {
                    const { voterProxy, cvxCrv, crvDepositor } = phase2;
                    const { multisigs, addresses } = config;
                    expect(await crvDepositor.crvBpt()).eq(addresses.tokenBpt);
                    expect(await crvDepositor.escrow()).eq(addresses.votingEscrow);
                    expect(await crvDepositor.lockIncentive()).eq(10);
                    expect(await crvDepositor.feeManager()).eq(multisigs.daoMultisig);
                    expect(await crvDepositor.daoOperator()).eq(multisigs.daoMultisig);
                    expect(await crvDepositor.staker()).eq(voterProxy.address);
                    expect(await crvDepositor.minter()).eq(cvxCrv.address);
                    expect(await crvDepositor.incentiveCrv()).eq(0);
                    expect(await crvDepositor.cooldown()).eq(false);
                });
                it("crvDepositorWrapper has correct config", async () => {
                    const { crvDepositorWrapper, crvDepositor } = phase2;
                    const { addresses } = config;
                    expect(await crvDepositorWrapper.crvDeposit()).eq(crvDepositor.address);
                    expect(await crvDepositorWrapper.BALANCER_VAULT()).eq(addresses.balancerVault);
                    expect(await crvDepositorWrapper.BAL()).eq(addresses.token);
                    expect(await crvDepositorWrapper.WETH()).eq(addresses.weth);
                    expect(await crvDepositorWrapper.BAL_ETH_POOL_ID()).eq(addresses.balancerPoolId);
                });
                it("poolManagerProxy has correct config", async () => {
                    const { booster, poolManagerProxy, poolManagerSecondaryProxy } = phase2;
                    expect(await poolManagerProxy.pools()).eq(booster.address);
                    expect(await poolManagerProxy.owner()).eq(ZERO_ADDRESS);
                    expect(await poolManagerProxy.operator()).eq(poolManagerSecondaryProxy.address);
                });
                it("poolManagerSecondaryProxy has correct config", async () => {
                    const { booster, poolManagerProxy, poolManagerSecondaryProxy, poolManager } = phase2;
                    const { multisigs, addresses } = config;
                    expect(await poolManagerSecondaryProxy.gaugeController()).eq(addresses.gaugeController);
                    expect(await poolManagerSecondaryProxy.pools()).eq(poolManagerProxy.address);
                    expect(await poolManagerSecondaryProxy.booster()).eq(booster.address);
                    expect(await poolManagerSecondaryProxy.owner()).eq(multisigs.daoMultisig);
                    expect(await poolManagerSecondaryProxy.operator()).eq(poolManager.address);
                    expect(await poolManagerSecondaryProxy.isShutdown()).eq(false);
                });
                it("poolManager has correct config", async () => {
                    const { poolManagerSecondaryProxy, poolManager } = phase2;
                    const { multisigs, addresses } = config;
                    expect(await poolManager.pools()).eq(poolManagerSecondaryProxy.address);
                    expect(await poolManager.gaugeController()).eq(addresses.gaugeController);
                    expect(await poolManager.operator()).eq(multisigs.daoMultisig);
                    expect(await poolManager.protectAddPool()).eq(true);
                });
                it("Aura Locker has correct config", async () => {
                    const { cvxLocker, cvxCrv, cvxStakingProxy, cvx, cvxCrvRewards } = phase2;
                    const { naming, multisigs } = config;
                    expect(await cvxLocker.rewardTokens(0)).eq(cvxCrv.address);
                    await expect(cvxLocker.rewardTokens(1)).to.be.reverted;
                    expect(await cvxLocker.queuedRewards(cvxCrv.address)).eq(0);
                    expect(await cvxLocker.rewardDistributors(cvxCrv.address, cvxStakingProxy.address)).eq(true);
                    expect(await cvxLocker.lockedSupply()).eq(0);
                    expect(await cvxLocker.stakingToken()).eq(cvx.address);
                    expect(await cvxLocker.cvxCrv()).eq(cvxCrv.address);
                    expect(await cvxLocker.cvxcrvStaking()).eq(cvxCrvRewards.address);
                    expect(await cvxLocker.name()).eq(naming.vlCvxName);
                    expect(await cvxLocker.symbol()).eq(naming.vlCvxSymbol);
                    expect(await cvxLocker.owner()).eq(multisigs.daoMultisig);
                });
                it("Aura staking proxy has correct config", async () => {
                    const { cvxLocker, cvxCrv, cvxStakingProxy, cvx, crvDepositorWrapper } = phase2;
                    const { multisigs, addresses } = config;
                    expect(await cvxStakingProxy.crv()).eq(addresses.token);
                    expect(await cvxStakingProxy.cvx()).eq(cvx.address);
                    expect(await cvxStakingProxy.cvxCrv()).eq(cvxCrv.address);
                    expect(await cvxStakingProxy.keeper()).eq(!addresses.keeper ? ZERO_ADDRESS : addresses.keeper);
                    expect(await cvxStakingProxy.crvDepositorWrapper()).eq(crvDepositorWrapper.address);
                    expect(await cvxStakingProxy.outputBps()).eq(9975);
                    expect(await cvxStakingProxy.rewards()).eq(cvxLocker.address);
                    expect(await cvxStakingProxy.owner()).eq(multisigs.daoMultisig);
                    expect(await cvxStakingProxy.pendingOwner()).eq(ZERO_ADDRESS);
                });
                it("Chef has correct config", async () => {
                    const { cvx, chef } = phase2;
                    const { distroList } = config;
                    expect(await chef.cvx()).eq(cvx.address);
                    const totalBlocks = BN.from(7000).mul(365).mul(4);
                    const cvxPerBlock = distroList.lpIncentives.div(totalBlocks);
                    assertBNClosePercent(await chef.rewardPerBlock(), cvxPerBlock, "0.01");
                    expect(await chef.poolLength()).eq(1);
                    expect((await chef.poolInfo(0)).lpToken.toLowerCase()).eq(
                        "0xac98c986d8318ff08109ae6f4e7043468da9d0a2",
                    );
                    expect(await chef.totalAllocPoint()).eq(1000);
                    const block = await latestBlock();
                    const expectedStart = BN.from(block.number).add(BN.from(6900).mul(7));
                    expect(await chef.startBlock()).gt(expectedStart);
                    expect(await chef.startBlock()).lt(expectedStart.add(700));

                    const expectedEnd = expectedStart.add(BN.from(7000).mul(365).mul(4));
                    expect(await chef.endBlock()).gt(expectedEnd.sub(10000));
                    expect(await chef.endBlock()).lt(expectedEnd.add(10000));
                });
                it("extraRewardsDistributor has correct config", async () => {
                    const { extraRewardsDistributor, cvxLocker } = phase2;
                    expect(await extraRewardsDistributor.auraLocker()).eq(cvxLocker.address);
                    expect(await extraRewardsDistributor.owner()).eq(config.multisigs.daoMultisig);
                });
            });
        });
    });
});
