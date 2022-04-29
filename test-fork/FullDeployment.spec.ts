import { hashMessage } from "@ethersproject/hash";
import hre, { network } from "hardhat";
import { expect } from "chai";
import {
    ICurveVoteEscrow__factory,
    IERC20__factory,
    IInvestmentPool,
    IInvestmentPool__factory,
    MockERC20__factory,
    MockWalletChecker__factory,
    IVault,
    IVault__factory,
    ERC20,
    ERC20__factory,
    IBalancerPool__factory,
    ExtraRewardStashV3__factory,
    BaseRewardPool4626__factory,
    MockVoting__factory,
} from "../types/generated";
import { waitForTx } from "../tasks/utils";
import {
    impersonate,
    impersonateAccount,
    ZERO_ADDRESS,
    BN,
    ONE_YEAR,
    ONE_WEEK,
    ONE_HOUR,
    assertBNClosePercent,
    assertBNClose,
    simpleToExactAmount,
    ONE_DAY,
    ZERO_KEY,
    createTreeWithAccounts,
    getAccountBalanceProof,
} from "../test-utils";
import { Signer } from "ethers";
import { getTimestamp, latestBlock, increaseTime, advanceBlock } from "./../test-utils/time";
import {
    deployPhase2,
    deployPhase3,
    deployPhase4,
    Phase1Deployed,
    Phase2Deployed,
    Phase3Deployed,
    SystemDeployed,
} from "../scripts/deploySystem";
import { Account } from "./../types/common";
import { config } from "../tasks/deploy/mainnet-config";
import { AssetHelpers, SwapKind, WeightedPoolExitKind } from "@balancer-labs/balancer-js";
import { ethers } from "ethers";
import MerkleTree from "merkletreejs";

const debug = false;

describe("Full Deployment", () => {
    let deployer: Signer;
    let deployerAddress: string;

    let phase1: Phase1Deployed;
    let phase2: Phase2Deployed;
    let phase3: Phase3Deployed;
    let phase4: SystemDeployed;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 14654150,
                    },
                },
            ],
        });
        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        // TODO - should have sufficient balances on acc, remove this before final test
        await setupBalances();
        deployer = await impersonate(deployerAddress);
    });

    const getCrv = async (recipient: string, amount = simpleToExactAmount(250)) => {
        await getEth(config.addresses.balancerVault);

        const tokenWhaleSigner = await impersonateAccount(config.addresses.balancerVault);
        const crv = MockERC20__factory.connect(config.addresses.token, tokenWhaleSigner.signer);
        const tx = await crv.transfer(recipient, amount);
        await waitForTx(tx, debug);
    };

    const getCrvBpt = async (recipient: string, amount = simpleToExactAmount(250)) => {
        const tokenWhaleSigner = await impersonateAccount(config.addresses.tokenWhale);
        const crvBpt = MockERC20__factory.connect(config.addresses.tokenBpt, tokenWhaleSigner.signer);
        const tx = await crvBpt.transfer(recipient, amount);
        await waitForTx(tx, debug);
    };

    const getWeth = async (recipient: string, amount = simpleToExactAmount(100)) => {
        const wethWhaleSigner = await impersonateAccount(config.addresses.wethWhale);
        const weth = await MockERC20__factory.connect(config.addresses.weth, wethWhaleSigner.signer);
        const tx = await weth.transfer(recipient, amount);
        await waitForTx(tx, debug);
    };

    const getEth = async (recipient: string) => {
        const ethWhale = await impersonate(config.addresses.weth);
        await ethWhale.sendTransaction({
            to: recipient,
            value: simpleToExactAmount(1),
        });
    };

    const setupBalances = async () => {
        // crvBPT for initialLock && cvxCrv/crvBPT pair
        await getCrvBpt(deployerAddress);
        // weth for LBP creation
        await getWeth(deployerAddress);

        await getEth(deployerAddress);
    };

    describe("Phase 1", () => {
        describe("DEPLOY-Phase 1", () => {
            before(async () => {
                // PHASE 1
                phase1 = await config.getPhase1(deployer);

                // POST-PHASE-1
                // Whitelist the VoterProxy in the Curve system
                const checker = await new MockWalletChecker__factory(deployer).deploy();
                await checker.approveWallet(phase1.voterProxy.address);
                const admin = await impersonate("0x8f42adbba1b16eaae3bb5754915e0d06059add75");
                const ve = ICurveVoteEscrow__factory.connect(config.addresses.votingEscrow, admin);
                await ve.commit_smart_wallet_checker(checker.address);
                await ve.apply_smart_wallet_checker();
            });
            describe("verifying config", () => {
                it("VoterProxy has correct config", async () => {
                    const { voterProxy } = phase1;
                    const { addresses } = config;
                    expect(await voterProxy.mintr()).eq(addresses.minter);
                    expect(await voterProxy.crv()).eq(addresses.token);
                    expect(await voterProxy.crvBpt()).eq(addresses.tokenBpt);
                    expect(await voterProxy.escrow()).eq(addresses.votingEscrow);
                    expect(await voterProxy.gaugeController()).eq(addresses.gaugeController);
                    expect(await voterProxy.rewardDeposit()).eq(ZERO_ADDRESS);
                    expect(await voterProxy.withdrawer()).eq(ZERO_ADDRESS);
                    expect(await voterProxy.owner()).eq(deployerAddress);
                    expect(await voterProxy.operator()).eq(ZERO_ADDRESS);
                    expect(await voterProxy.depositor()).eq(ZERO_ADDRESS);
                });
            });
        });
    });

    describe("Phase 2", () => {
        describe("DEPLOY-Phase 2", () => {
            before(async () => {
                // PHASE 2
                phase2 = await deployPhase2(
                    hre,
                    deployer,
                    phase1,
                    config.distroList,
                    config.multisigs,
                    config.naming,
                    config.addresses,
                    debug,
                );
            });
            describe("verifying config", () => {
                it("VotingProxy has correct config", async () => {
                    const { voterProxy, booster, crvDepositor } = phase2;
                    const { multisigs } = config;
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
                    const { cvx, initialCvxCrvStaking, balLiquidityProvider, drops, vestedEscrows, chef } = phase2;
                    const { addresses, distroList } = config;
                    expect(await cvx.totalSupply()).eq(simpleToExactAmount(50, 24));
                    expect(await cvx.balanceOf(chef.address)).eq(distroList.lpIncentives);
                    expect(await cvx.balanceOf(initialCvxCrvStaking.address)).eq(distroList.cvxCrvBootstrap);
                    expect(await cvx.balanceOf(addresses.balancerVault)).eq(distroList.lbp.tknAmount);
                    expect(await cvx.balanceOf(balLiquidityProvider.address)).eq(distroList.lbp.matching);

                    const dropBalances = await Promise.all(drops.map(a => cvx.balanceOf(a.address)));
                    const aidrdropSum = distroList.airdrops.reduce((p, c) => p.add(c.amount), BN.from(0));
                    expect(dropBalances.reduce((p, c) => p.add(c), BN.from(0))).eq(aidrdropSum);

                    const vestingBalances = await Promise.all(vestedEscrows.map(a => cvx.balanceOf(a.address)));
                    const vestingSum = distroList.vesting
                        .concat(distroList.immutableVesting)
                        .reduce(
                            (p, c) => p.add(c.recipients.reduce((p2, c2) => p2.add(c2.amount), BN.from(0))),
                            BN.from(0),
                        );
                    expect(vestingBalances.reduce((p, c) => p.add(c), BN.from(0))).eq(vestingSum);
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

                    expect(await booster.lockIncentive()).eq(825);
                    expect(await booster.stakerIncentive()).eq(825);
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
                    expect(await tokenFactory.namePostfix()).eq(" Aura Deposit");
                    expect(await tokenFactory.symbolPrefix()).eq("aura");
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
                it("CvxCrvBpt has correct config", async () => {
                    const { cvxCrv, cvxCrvBpt } = phase2;
                    const { addresses } = config;

                    // Token amounts
                    // Weights
                    // Balance = treasuryDAO

                    const balancerVault = IVault__factory.connect(addresses.balancerVault, deployer);
                    const poolTokens = await balancerVault.getPoolTokens(cvxCrvBpt.poolId);
                    const pool = IBalancerPool__factory.connect(cvxCrvBpt.address, deployer);
                    await expect(pool.getNormalizedWeights()).to.be.reverted;
                    if (poolTokens.tokens[0].toLowerCase() == cvxCrv.address.toLowerCase()) {
                        expect(poolTokens.tokens[1]).eq(addresses.tokenBpt);
                        expect(poolTokens.balances[0]).eq(poolTokens.balances[1]);
                        expect(poolTokens.balances[0]).eq(simpleToExactAmount(99.6));
                    } else {
                        expect(poolTokens.tokens[0]).eq(addresses.tokenBpt);
                        expect(poolTokens.tokens[1]).eq(cvxCrv.address);
                        expect(poolTokens.balances[0]).eq(poolTokens.balances[1]);
                        expect(poolTokens.balances[0]).eq(simpleToExactAmount(99.6));
                    }

                    const poolERC20 = IERC20__factory.connect(cvxCrvBpt.address, deployer);
                    expect(await poolERC20.balanceOf(config.multisigs.treasuryMultisig)).eq(
                        (await poolERC20.totalSupply()).sub(simpleToExactAmount(1, 6)),
                    );
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

                    const time = await getTimestamp();
                    expect(await initialCvxCrvStaking.startTime()).gt(time.add(ONE_WEEK).sub(60));
                    expect(await initialCvxCrvStaking.startTime()).lt(time.add(ONE_WEEK));
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
                    expect(await cvxLocker.queuedCvxCrvRewards()).eq(0);
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
                    expect(await cvxStakingProxy.outputBps()).eq(9980);
                    expect(await cvxStakingProxy.rewards()).eq(cvxLocker.address);
                    expect(await cvxStakingProxy.owner()).eq(multisigs.daoMultisig);
                    expect(await cvxStakingProxy.pendingOwner()).eq(ZERO_ADDRESS);
                });
                it("Chef has correct config", async () => {
                    const { cvx, cvxCrvBpt, chef } = phase2;
                    const { distroList } = config;
                    expect(await chef.cvx()).eq(cvx.address);
                    const totalBlocks = BN.from(7000).mul(365).mul(4);
                    const cvxPerBlock = distroList.lpIncentives.div(totalBlocks);
                    assertBNClosePercent(await chef.rewardPerBlock(), cvxPerBlock, "0.01");
                    expect(await chef.poolLength()).eq(1);
                    expect((await chef.poolInfo(0)).lpToken.toLowerCase()).eq(cvxCrvBpt.address.toLowerCase());
                    expect(await chef.totalAllocPoint()).eq(1000);
                    const block = await latestBlock();
                    const expectedStart = BN.from(block.number).add(BN.from(6900).mul(7));
                    expect(await chef.startBlock()).gt(expectedStart);
                    expect(await chef.startBlock()).lt(expectedStart.add(700));

                    const expectedEnd = expectedStart.add(BN.from(7000).mul(365).mul(4));
                    expect(await chef.endBlock()).gt(expectedEnd.sub(10000));
                    expect(await chef.endBlock()).lt(expectedEnd.add(10000));
                });
                it("VestedEscrows have correct config", async () => {
                    const { vestedEscrows } = phase2;
                    const time = await getTimestamp();
                    expect(vestedEscrows.length).eq(5);

                    // [ 0 ] = 16 weeks, 0.041%
                    const escrow0 = vestedEscrows[0];
                    expect(await escrow0.rewardToken()).eq(phase2.cvx.address);
                    expect(await escrow0.admin()).eq(config.multisigs.vestingMultisig);
                    expect(await escrow0.auraLocker()).eq(phase2.cvxLocker.address);
                    expect(await escrow0.startTime()).gt(time.add(ONE_WEEK).sub(60));
                    expect(await escrow0.startTime()).lt(time.add(ONE_WEEK));
                    expect(await escrow0.endTime()).gt(time.add(ONE_WEEK.mul(17)).sub(60));
                    expect(await escrow0.endTime()).lt(time.add(ONE_WEEK.mul(17)));
                    expect(await escrow0.totalTime()).eq(ONE_WEEK.mul(16));
                    expect(await escrow0.initialised()).eq(true);
                    expect(await escrow0.remaining("0xaf3824e8401299B25C4D59a8a035Cf9312a3B454")).eq(
                        simpleToExactAmount(0.025, 24),
                    );
                    // [ 1 ] = 26 weeks, 0.0675% + 1.0165% future team
                    const escrow1 = vestedEscrows[1];
                    expect(await escrow1.rewardToken()).eq(phase2.cvx.address);
                    expect(await escrow1.admin()).eq(config.multisigs.vestingMultisig);
                    expect(await escrow1.auraLocker()).eq(phase2.cvxLocker.address);
                    expect(await escrow1.startTime()).gt(time.add(ONE_WEEK).sub(60));
                    expect(await escrow1.startTime()).lt(time.add(ONE_WEEK));
                    expect(await escrow1.endTime()).gt(time.add(ONE_WEEK.mul(27)).sub(60));
                    expect(await escrow1.endTime()).lt(time.add(ONE_WEEK.mul(27)));
                    expect(await escrow1.totalTime()).eq(ONE_WEEK.mul(26));
                    expect(await escrow1.initialised()).eq(true);
                    expect(await escrow1.remaining(config.multisigs.vestingMultisig)).eq(
                        simpleToExactAmount(1.0165, 24),
                    );
                    // [ 2 ] = 104 weeks, 8.875%
                    const escrow2 = vestedEscrows[2];
                    expect(await escrow2.rewardToken()).eq(phase2.cvx.address);
                    expect(await escrow2.admin()).eq(config.multisigs.vestingMultisig);
                    expect(await escrow2.auraLocker()).eq(phase2.cvxLocker.address);
                    expect(await escrow2.startTime()).gt(time.add(ONE_WEEK).sub(60));
                    expect(await escrow2.startTime()).lt(time.add(ONE_WEEK));
                    expect(await escrow2.endTime()).gt(time.add(ONE_WEEK.mul(105)).sub(60));
                    expect(await escrow2.endTime()).lt(time.add(ONE_WEEK.mul(105)));
                    expect(await escrow2.totalTime()).eq(ONE_WEEK.mul(104));
                    expect(await escrow2.initialised()).eq(true);
                    expect(await escrow2.remaining("0x680b07BD5f18aB1d7dE5DdBBc64907E370697EA5")).eq(
                        simpleToExactAmount(3.5, 24),
                    );
                    // [ 3 ] = 104 weeks, 2%
                    const escrow3 = vestedEscrows[3];
                    expect(await escrow3.rewardToken()).eq(phase2.cvx.address);
                    expect(await escrow3.admin()).eq(ZERO_ADDRESS);
                    expect(await escrow3.auraLocker()).eq(phase2.cvxLocker.address);
                    expect(await escrow3.startTime()).gt(time.add(ONE_WEEK).sub(60));
                    expect(await escrow3.startTime()).lt(time.add(ONE_WEEK));
                    expect(await escrow3.endTime()).gt(time.add(ONE_WEEK.mul(105)).sub(60));
                    expect(await escrow3.endTime()).lt(time.add(ONE_WEEK.mul(105)));
                    expect(await escrow3.totalTime()).eq(ONE_WEEK.mul(104));
                    expect(await escrow3.initialised()).eq(true);
                    expect(await escrow3.remaining(config.addresses.treasury)).eq(simpleToExactAmount(2, 24));
                    // [ 4 ] = 208 weeks, 17.5%
                    const escrow4 = vestedEscrows[4];
                    expect(await escrow4.rewardToken()).eq(phase2.cvx.address);
                    expect(await escrow4.admin()).eq(ZERO_ADDRESS);
                    expect(await escrow4.auraLocker()).eq(phase2.cvxLocker.address);
                    expect(await escrow4.startTime()).gt(time.add(ONE_WEEK).sub(60));
                    expect(await escrow4.startTime()).lt(time.add(ONE_WEEK));
                    expect(await escrow4.endTime()).gt(time.add(ONE_WEEK.mul(209)).sub(60));
                    expect(await escrow4.endTime()).lt(time.add(ONE_WEEK.mul(209)));
                    expect(await escrow4.totalTime()).eq(ONE_WEEK.mul(208));
                    expect(await escrow4.initialised()).eq(true);
                    expect(await escrow4.remaining(config.multisigs.treasuryMultisig)).eq(
                        simpleToExactAmount(17.5, 24),
                    );
                });
                it("Drops have correct config", async () => {
                    const { drops } = phase2;
                    const { multisigs } = config;

                    const time = await getTimestamp();
                    expect(drops.length).eq(2);

                    // [ 0 ] = 2.5m, 4 weeks
                    const drop = drops[0];
                    expect(await drop.dao()).eq(multisigs.treasuryMultisig);
                    expect(await drop.merkleRoot()).eq(ZERO_KEY);
                    expect(await drop.aura()).eq(phase2.cvx.address);
                    expect(await drop.auraLocker()).eq(phase2.cvxLocker.address);
                    expect(await drop.penaltyForwarder()).eq(phase2.penaltyForwarder.address);
                    expect(await drop.pendingPenalty()).eq(0);
                    expect(await drop.startTime()).gt(time.add(ONE_WEEK).sub(60));
                    expect(await drop.startTime()).lt(time.add(ONE_WEEK));
                    expect(await drop.expiryTime()).gt(time.add(ONE_WEEK.mul(5)).sub(60));
                    expect(await drop.expiryTime()).lt(time.add(ONE_WEEK.mul(5)));
                    expect(await phase2.cvx.balanceOf(drop.address)).eq(simpleToExactAmount(2.5, 24));
                    // [ 1 ] = 1m, 26 weeks
                    const drop1 = drops[1];
                    expect(await drop1.dao()).eq(multisigs.treasuryMultisig);
                    expect(await drop1.merkleRoot()).eq(ZERO_KEY);
                    expect(await drop1.aura()).eq(phase2.cvx.address);
                    expect(await drop1.auraLocker()).eq(phase2.cvxLocker.address);
                    expect(await drop1.penaltyForwarder()).eq(phase2.penaltyForwarder.address);
                    expect(await drop1.pendingPenalty()).eq(0);
                    expect(await drop1.startTime()).gt(time.add(ONE_WEEK.mul(26)).sub(60));
                    expect(await drop1.startTime()).lt(time.add(ONE_WEEK.mul(26)));
                    expect(await drop1.expiryTime()).gt(time.add(ONE_WEEK.mul(52)).sub(60));
                    expect(await drop1.expiryTime()).lt(time.add(ONE_WEEK.mul(52)));
                    expect(await phase2.cvx.balanceOf(drop1.address)).eq(simpleToExactAmount(1, 24));
                });
                it("LbpBPT has correct config", async () => {
                    const { cvx, lbpBpt } = phase2;

                    // Token amounts
                    // Weights
                    // Swap = false
                    // Balance = treasuryDAO

                    const balancerVault = IVault__factory.connect(config.addresses.balancerVault, deployer);
                    const balances = await balancerVault.getPoolTokens(lbpBpt.poolId);
                    const pool = IBalancerPool__factory.connect(lbpBpt.address, deployer);
                    const weights = await pool.getNormalizedWeights();
                    if (balances.tokens[0].toLowerCase() == cvx.address.toLowerCase()) {
                        expect(balances.balances[0]).eq(simpleToExactAmount(2.2, 24));
                        expect(balances.balances[1]).eq(simpleToExactAmount(66));
                        assertBNClosePercent(weights[0], simpleToExactAmount(99, 16), "0.0001");
                        assertBNClosePercent(weights[1], simpleToExactAmount(1, 16), "0.0001");
                    } else {
                        expect(balances.balances[1]).eq(simpleToExactAmount(2.2, 24));
                        expect(balances.balances[0]).eq(simpleToExactAmount(66));
                        assertBNClosePercent(weights[1], simpleToExactAmount(99, 16), "0.0001");
                        assertBNClosePercent(weights[0], simpleToExactAmount(1, 16), "0.0001");
                    }
                    const swapEnabled = await pool.getSwapEnabled();
                    expect(swapEnabled).eq(false);

                    const poolERC20 = IERC20__factory.connect(lbpBpt.address, deployer);
                    expect(await poolERC20.balanceOf(config.multisigs.treasuryMultisig)).eq(
                        (await poolERC20.totalSupply()).sub(simpleToExactAmount(1, 6)),
                    );
                });
                it("balLiquidityProvider has correct config", async () => {
                    const { balLiquidityProvider, cvx } = phase2;
                    const { multisigs, addresses } = config;

                    expect(await balLiquidityProvider.startToken()).eq(cvx.address);
                    expect(await balLiquidityProvider.pairToken()).eq(addresses.weth);
                    expect(await balLiquidityProvider.minPairAmount()).eq(simpleToExactAmount(375));
                    expect(await balLiquidityProvider.dao()).eq(multisigs.treasuryMultisig);
                    expect(await balLiquidityProvider.bVault()).eq(addresses.balancerVault);
                    expect(await cvx.balanceOf(balLiquidityProvider.address)).eq(simpleToExactAmount(2.8, 24));
                });
                it("penaltyForwarder has correct config", async () => {
                    const { penaltyForwarder, extraRewardsDistributor, cvx } = phase2;

                    expect(await penaltyForwarder.distributor()).eq(extraRewardsDistributor.address);
                    expect(await penaltyForwarder.token()).eq(cvx.address);
                    expect(await penaltyForwarder.distributionDelay()).eq(ONE_WEEK.mul(7).div(2));
                    assertBNClose(await penaltyForwarder.lastDistribution(), await getTimestamp(), 100);
                });
                it("extraRewardsDistributor has correct config", async () => {
                    const { extraRewardsDistributor, cvxLocker } = phase2;
                    expect(await extraRewardsDistributor.auraLocker()).eq(cvxLocker.address);
                });
            });
        });

        describe("POST-Phase 2", () => {
            let lbp: IInvestmentPool;
            let treasurySigner: Account;
            let currentTime: BN;
            before(async () => {
                treasurySigner = await impersonateAccount(config.multisigs.treasuryMultisig);
                lbp = IInvestmentPool__factory.connect(phase2.lbpBpt.address, treasurySigner.signer);
                currentTime = BN.from(
                    (await hre.ethers.provider.getBlock(await hre.ethers.provider.getBlockNumber())).timestamp,
                );
            });
            it("allows treasuryDAO to update weights gradually", async () => {
                const balHelper = new AssetHelpers(config.addresses.weth);
                const [, weights] = balHelper.sortTokens(
                    [phase2.cvx.address, config.addresses.weth],
                    [simpleToExactAmount(10, 16), simpleToExactAmount(90, 16)],
                );
                const tx = await lbp.updateWeightsGradually(
                    currentTime.add(3600),
                    currentTime.add(ONE_DAY.mul(4)),
                    weights as BN[],
                );
                await waitForTx(tx, debug);
            });
            it("allows treasuryDAO to set swaps", async () => {
                const tx = await lbp.setSwapEnabled(true);
                await waitForTx(tx, debug);
            });
        });

        describe("TEST-Phase 2", () => {
            let treasurySigner: Account;
            let daoSigner: Account;
            let balancerVault: IVault;
            before(async () => {
                treasurySigner = await impersonateAccount(config.multisigs.treasuryMultisig);
                daoSigner = await impersonateAccount(config.multisigs.daoMultisig);
                balancerVault = IVault__factory.connect(config.addresses.balancerVault, treasurySigner.signer);
            });

            it("doesn't allow dao to set more than 10k votes on gaugeController", async () => {
                const { booster } = phase2;
                const { addresses } = config;
                await expect(
                    booster
                        .connect(daoSigner.signer)
                        .voteGaugeWeight([addresses.gauges[0], addresses.gauges[1]], [5001, 5000]),
                ).to.be.revertedWith("Used too much power");
            });
            it("allows dao to vote on gauge weights", async () => {
                const { booster, voterProxy } = phase2;
                const { addresses } = config;
                await booster
                    .connect(daoSigner.signer)
                    .voteGaugeWeight([addresses.gauges[0], addresses.gauges[1]], [5000, 5000]);
                const gaugeController = MockVoting__factory.connect(addresses.gaugeController, deployer);
                expect((await gaugeController.vote_user_slopes(voterProxy.address, addresses.gauges[0])).power).eq(
                    5000,
                );
                expect(await gaugeController.vote_user_power(voterProxy.address)).eq(10000);
                expect(await gaugeController.last_user_vote(voterProxy.address, addresses.gauges[1])).gt(0);
                expect(await gaugeController.last_user_vote(voterProxy.address, addresses.gauges[2])).eq(0);
            });
            it("doesn't allow dao to set votes again so quickly on gaugeController", async () => {
                const { booster } = phase2;
                const { addresses } = config;
                await expect(
                    booster
                        .connect(daoSigner.signer)
                        .voteGaugeWeight([addresses.gauges[0], addresses.gauges[1]], [5001, 5000]),
                ).to.be.revertedWith("Cannot vote so often");
            });
            it("allows dao to setVotes for Snapshot", async () => {
                const eip1271MagicValue = "0x1626ba7e";
                const msg = "message";
                const hash = hashMessage(msg);
                const daoMultisig = await impersonateAccount(config.multisigs.daoMultisig);

                const tx = await phase2.booster.connect(daoMultisig.signer).setVote(hash, true);
                await expect(tx).to.emit(phase2.voterProxy, "VoteSet").withArgs(hash, true);

                const isValid = await phase2.voterProxy.isValidSignature(hash, "0x00");
                expect(isValid).to.equal(eip1271MagicValue);
            });
            it("doesn't allow pools to be added or rewards earmarked", async () => {
                const { poolManager, booster } = phase2;
                const { addresses } = config;

                await expect(poolManager["addPool(address)"](addresses.gauges[0])).to.be.revertedWith("!auth");

                await expect(booster.earmarkRewards(0)).to.be.reverted;
            });
            it("doesn't add feeInfo to Booster", async () => {
                const { booster } = phase2;
                const { addresses } = config;

                const balFee = await booster.feeTokens(addresses.token);
                expect(balFee.distro).eq(ZERO_ADDRESS);
                expect(balFee.rewards).eq(ZERO_ADDRESS);
                expect(balFee.active).eq(false);

                await expect(booster.earmarkFees(addresses.token)).to.be.revertedWith("Inactive distro");
            });

            const swapEthForAura = async (sender: Account, amount = simpleToExactAmount(100), limit = 0) => {
                const currentTime = BN.from(
                    (await hre.ethers.provider.getBlock(await hre.ethers.provider.getBlockNumber())).timestamp,
                );
                const tx = await balancerVault.connect(sender.signer).swap(
                    {
                        poolId: phase2.lbpBpt.poolId,
                        kind: SwapKind.GivenIn,
                        assetIn: config.addresses.weth,
                        assetOut: phase2.cvx.address,
                        amount: amount,
                        userData: "0x",
                    },
                    {
                        sender: sender.address,
                        fromInternalBalance: false,
                        recipient: sender.address,
                        toInternalBalance: false,
                    },
                    limit,
                    currentTime.add(60 * 15),
                );
                await waitForTx(tx, debug);
            };
            // T = 0 -> 4.5
            it("executes some swaps", async () => {
                const swapperAddress = "0xdecadE000000000000000000000000000000042f";
                const swapper = await impersonateAccount(swapperAddress);
                await getEth(swapperAddress);
                await getWeth(swapperAddress, simpleToExactAmount(500));

                const weth = await MockERC20__factory.connect(config.addresses.weth, swapper.signer);
                const tx = await weth.approve(balancerVault.address, simpleToExactAmount(500));
                await waitForTx(tx, debug);

                await increaseTime(ONE_HOUR.mul(2));
                await swapEthForAura(swapper, simpleToExactAmount(20));

                await increaseTime(ONE_HOUR.mul(2));
                await swapEthForAura(swapper, simpleToExactAmount(20));

                await increaseTime(ONE_HOUR.mul(2));
                await swapEthForAura(swapper, simpleToExactAmount(20));

                await increaseTime(ONE_HOUR.mul(2));
                await swapEthForAura(swapper, simpleToExactAmount(20));

                await increaseTime(ONE_HOUR.mul(2));
                await swapEthForAura(swapper, simpleToExactAmount(20));

                await increaseTime(ONE_HOUR.mul(6));
                await swapEthForAura(swapper, simpleToExactAmount(50));

                await increaseTime(ONE_HOUR.mul(6));
                await swapEthForAura(swapper, simpleToExactAmount(50));

                await increaseTime(ONE_HOUR.mul(6));
                await swapEthForAura(swapper, simpleToExactAmount(50));

                await increaseTime(ONE_HOUR.mul(6));
                await swapEthForAura(swapper, simpleToExactAmount(50));

                await increaseTime(ONE_HOUR.mul(24));
                await swapEthForAura(swapper, simpleToExactAmount(100));

                await increaseTime(ONE_HOUR.mul(24));
                await swapEthForAura(swapper, simpleToExactAmount(100));
            });
            it("allows AURA holders to stake in vlAURA", async () => {
                const { cvxLocker, cvx } = phase2;

                const swapperAddress = "0xdecadE000000000000000000000000000000042f";
                const swapper = await impersonateAccount(swapperAddress);

                await cvx.connect(swapper.signer).approve(cvxLocker.address, simpleToExactAmount(100000));
                await cvxLocker.connect(swapper.signer).lock(swapperAddress, simpleToExactAmount(100000));

                const lock = await cvxLocker.lockedBalances(swapperAddress);
                expect(lock.total).eq(simpleToExactAmount(100000));
                expect(lock.unlockable).eq(0);
                expect(lock.locked).eq(simpleToExactAmount(100000));
                expect(lock.lockData[0].amount).eq(simpleToExactAmount(100000));
                const balance = await cvxLocker.balanceOf(swapperAddress);
                expect(balance).eq(0);
            });
        });
    });

    describe("Phase 3", () => {
        describe("PRE-Phase 3", () => {
            let treasurySigner: Account;
            let balancerVault: IVault;
            let weth: ERC20;
            let aura: ERC20;
            let bpt: ERC20;
            before(async () => {
                treasurySigner = await impersonateAccount(config.multisigs.treasuryMultisig);
                balancerVault = IVault__factory.connect(config.addresses.balancerVault, treasurySigner.signer);
                weth = MockERC20__factory.connect(config.addresses.weth, treasurySigner.signer);
                aura = phase2.cvx.connect(treasurySigner.signer);
                bpt = MockERC20__factory.connect(phase2.lbpBpt.address, treasurySigner.signer);
            });
            it("allows treasuryDAO to withdraw LBP units", async () => {
                const wethBalBefore = await weth.balanceOf(treasurySigner.address);
                const auraBalBefore = await aura.balanceOf(treasurySigner.address);
                const lpBalBefore = await bpt.balanceOf(treasurySigner.address);

                const balances = await balancerVault.getPoolTokens(phase2.lbpBpt.poolId);

                const tx = await balancerVault.exitPool(
                    phase2.lbpBpt.poolId,
                    treasurySigner.address,
                    treasurySigner.address,
                    {
                        assets: balances.tokens,
                        minAmountsOut: [0, 0],
                        userData: hre.ethers.utils.defaultAbiCoder.encode(
                            ["uint256", "uint256"],
                            [WeightedPoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, lpBalBefore],
                        ),
                        toInternalBalance: false,
                    },
                );
                await waitForTx(tx, debug);

                const wethBalAfter = await weth.balanceOf(treasurySigner.address);
                const auraBalAfter = await aura.balanceOf(treasurySigner.address);
                const lpBalAfter = await bpt.balanceOf(treasurySigner.address);

                expect(wethBalAfter).gte(wethBalBefore.add(simpleToExactAmount(500)));
                expect(auraBalAfter).gte(auraBalBefore.add(simpleToExactAmount(200000)));
                expect(lpBalAfter).eq(0);
            });
            it("treasuryDAO sends weth to liq provider", async () => {
                const wethBal = await weth.balanceOf(treasurySigner.address);
                const tx = await weth.transfer(phase2.balLiquidityProvider.address, wethBal);
                await waitForTx(tx, debug);
            });
            it("treasuryDAO sends aura to liq provider", async () => {
                const auraBal = await aura.balanceOf(treasurySigner.address);
                const tx = await aura.transfer(phase2.balLiquidityProvider.address, auraBal);
                await waitForTx(tx, debug);
            });
        });
        describe("DEPLOY-Phase 3", () => {
            before(async () => {
                // PHASE 3
                phase3 = await deployPhase3(hre, deployer, phase2, config.multisigs, config.addresses, debug);
                await increaseTime(ONE_HOUR.mul(96));
            });
            describe("verifying config", () => {
                it("creates the 8020 pool successfully", async () => {
                    const { pool8020Bpt, cvx, balLiquidityProvider } = phase3;

                    const treasurySigner = await impersonateAccount(config.multisigs.treasuryMultisig);
                    const balancerVault = IVault__factory.connect(
                        config.addresses.balancerVault,
                        treasurySigner.signer,
                    );

                    // Token amounts (non on balLiquidityProvider)
                    expect(await cvx.balanceOf(balLiquidityProvider.address)).eq(0);
                    expect(
                        await IERC20__factory.connect(config.addresses.weth, deployer).balanceOf(
                            balLiquidityProvider.address,
                        ),
                    ).eq(0);

                    // Weights
                    const poolTokens = await balancerVault.getPoolTokens(pool8020Bpt.poolId);
                    const pool = IBalancerPool__factory.connect(pool8020Bpt.address, deployer);
                    const weights = await pool.getNormalizedWeights();
                    if (poolTokens.tokens[0].toLowerCase() == cvx.address.toLowerCase()) {
                        expect(poolTokens.tokens[1]).eq(config.addresses.weth);
                        assertBNClosePercent(weights[0], simpleToExactAmount(80, 16), "0.0001");
                        assertBNClosePercent(weights[1], simpleToExactAmount(20, 16), "0.0001");
                    } else {
                        expect(poolTokens.tokens[1]).eq(cvx.address);
                        assertBNClosePercent(weights[0], simpleToExactAmount(20, 16), "0.0001");
                        assertBNClosePercent(weights[1], simpleToExactAmount(80, 16), "0.0001");
                    }

                    // Balance = treasuryDAO
                    const poolERC20 = IERC20__factory.connect(pool8020Bpt.address, deployer);
                    expect(await poolERC20.balanceOf(config.multisigs.treasuryMultisig)).eq(
                        (await poolERC20.totalSupply()).sub(simpleToExactAmount(1, 6)),
                    );
                });
            });
        });
        describe("POST-Phase 3", () => {
            it("allows initial auraBAL rewards to be initialised", async () => {
                const tx = await phase3.initialCvxCrvStaking.initialiseRewards();
                await waitForTx(tx, debug);
            });
        });
        describe("TEST-Phase 3", () => {
            let alice: Account;
            let crv: ERC20;
            let crvBpt: ERC20;
            before(async () => {
                alice = await impersonateAccount("0xdecadE000000000000000000000000000000042f");
                crv = MockERC20__factory.connect(config.addresses.token, alice.signer);
                crvBpt = MockERC20__factory.connect(config.addresses.tokenBpt, alice.signer);

                await getCrv(alice.address, simpleToExactAmount(500));
                await getCrvBpt(alice.address, simpleToExactAmount(500));
            });
            describe("minting cvxCrv etc", () => {
                it("allows users to wrap crvBpt to cvxCrv", async () => {
                    let tx = await crvBpt.approve(phase3.crvDepositor.address, simpleToExactAmount(700));
                    await waitForTx(tx, debug);

                    tx = await phase3.crvDepositor
                        .connect(alice.signer)
                        ["deposit(uint256,bool)"](simpleToExactAmount(500), true);
                    await waitForTx(tx, debug);

                    const balance = await phase3.cvxCrv.balanceOf(alice.address);
                    expect(balance).eq(simpleToExactAmount(500));
                });
                it("allows users to wrap crv via the crvDepositorWrapper", async () => {
                    let tx = await crv.approve(phase3.crvDepositorWrapper.address, simpleToExactAmount(500));
                    await waitForTx(tx, debug);

                    const minOut = await phase3.crvDepositorWrapper.getMinOut(simpleToExactAmount(500), 9900);
                    expect(minOut).gt(simpleToExactAmount(200));

                    tx = await phase3.crvDepositorWrapper
                        .connect(alice.signer)
                        .deposit(simpleToExactAmount(500), minOut, true, ZERO_ADDRESS);
                    await waitForTx(tx, debug);

                    const balance = await phase3.cvxCrv.balanceOf(alice.address);
                    expect(balance).gt(simpleToExactAmount(700));

                    expect(await crv.balanceOf(alice.address)).eq(0);
                    expect(await crvBpt.balanceOf(alice.address)).eq(0);
                });
                it("allows deposits to cvxCrv staking", async () => {
                    await getCrvBpt(alice.address, simpleToExactAmount(200));

                    const rewardsBalBefore = await phase3.initialCvxCrvStaking.balanceOf(alice.address);
                    expect(rewardsBalBefore).eq(0);
                    const cvxCrvSupply = await phase3.cvxCrv.totalSupply();

                    const tx = await phase3.crvDepositor
                        .connect(alice.signer)
                        .depositFor(alice.address, simpleToExactAmount(200), true, phase3.initialCvxCrvStaking.address);
                    await waitForTx(tx, debug);

                    const rewardsBalAfter = await phase3.initialCvxCrvStaking.balanceOf(alice.address);
                    expect(rewardsBalAfter).eq(simpleToExactAmount(200));
                    expect(await crvBpt.balanceOf(alice.address)).eq(0);

                    const cvxCrvSupplyAfter = await phase3.cvxCrv.totalSupply();
                    expect(cvxCrvSupplyAfter.sub(cvxCrvSupply)).eq(simpleToExactAmount(200));
                });
                it("allows users to claim and lock from cvxCrv staking", async () => {
                    const { initialCvxCrvStaking, cvxLocker } = phase3;
                    await increaseTime(ONE_HOUR.mul(4));
                    const earnedBefore = await initialCvxCrvStaking.earned(alice.address);
                    expect(earnedBefore).gt(1000000000);
                    const lockerBalBefore = await cvxLocker.lockedBalances(alice.address);

                    await initialCvxCrvStaking.connect(alice.signer).getReward(true);

                    const earnedAfter = await initialCvxCrvStaking.earned(alice.address);
                    assertBNClose(earnedAfter, BN.from(0), 1000);
                    const lockerBalafter = await cvxLocker.lockedBalances(alice.address);

                    assertBNClosePercent(lockerBalafter.total.sub(lockerBalBefore.total), earnedBefore, "0.01");
                });
                it("allows users to claim directly from cvxCrv staking with penalty", async () => {
                    const { initialCvxCrvStaking, cvx } = phase3;
                    await increaseTime(ONE_HOUR.mul(4));
                    const earnedBefore = await initialCvxCrvStaking.earned(alice.address);
                    expect(earnedBefore).gt(1000000000);
                    const rawBalBefore = await cvx.balanceOf(alice.address);
                    const penaltyBefore = await initialCvxCrvStaking.pendingPenalty();

                    await initialCvxCrvStaking.connect(alice.signer).getReward(false);

                    const earnedAfter = await initialCvxCrvStaking.earned(alice.address);
                    assertBNClose(earnedAfter, BN.from(0), 1000);
                    const rawBalAfter = await cvx.balanceOf(alice.address);
                    assertBNClosePercent(rawBalAfter.sub(rawBalBefore), earnedBefore.div(5).mul(4), "0.01");
                    const penaltyAfter = await initialCvxCrvStaking.pendingPenalty();
                    expect(penaltyAfter.sub(penaltyBefore)).eq(rawBalAfter.sub(rawBalBefore).div(4));
                });
                it("allows anyone to forward the penalty", async () => {
                    const { initialCvxCrvStaking, cvx } = phase3;
                    const pendingPenaltyBefore = await initialCvxCrvStaking.pendingPenalty();
                    const rawBalBefore = await cvx.balanceOf(initialCvxCrvStaking.address);
                    expect(pendingPenaltyBefore).gt(0);

                    await initialCvxCrvStaking.forwardPenalty();

                    const pendingPenaltyAfter = await initialCvxCrvStaking.pendingPenalty();
                    expect(pendingPenaltyAfter).eq(0);

                    const rawBalAfter = await cvx.balanceOf(initialCvxCrvStaking.address);
                    expect(rawBalBefore.sub(rawBalAfter)).eq(pendingPenaltyBefore);
                });
            });
            describe("merkle drops", () => {
                let tree: MerkleTree;
                let treasurySigner: Account;
                const amount = simpleToExactAmount(100);
                const eoaAddress = "0xdECade000000000000000000000000000000A42f";
                const dropperAddress = "0xdecadE000000000000000000000000000000042f";

                before(async () => {
                    tree = createTreeWithAccounts({
                        [dropperAddress]: amount,
                        [deployerAddress]: amount,
                    });

                    treasurySigner = await impersonateAccount(config.multisigs.treasuryMultisig);
                    if ((await phase3.drops[0].merkleRoot()) == ZERO_KEY) {
                        await phase3.drops[0].connect(treasurySigner.signer).setRoot(tree.getHexRoot());
                    }
                });
                it("doesn't allow just anyone to claim a merkle drop", async () => {
                    const { drops } = phase3;

                    const eoa = await impersonateAccount(eoaAddress);
                    await expect(
                        drops[0]
                            .connect(eoa.signer)
                            .claim(getAccountBalanceProof(tree, deployerAddress, amount), amount, true),
                    ).to.be.revertedWith("invalid proof");
                });
                it("allows users to claim merkle drops", async () => {
                    const { drops, cvxLocker } = phase3;

                    const balBefore = (await cvxLocker.lockedBalances(dropperAddress)).locked;
                    const dropper = await impersonateAccount(dropperAddress);
                    await drops[0]
                        .connect(dropper.signer)
                        .claim(getAccountBalanceProof(tree, dropperAddress, amount), amount, true);

                    const balAfter = (await cvxLocker.lockedBalances(dropperAddress)).locked;
                    expect(balAfter.sub(balBefore)).eq(amount);
                });
            });
            describe("vesting", () => {
                it("allows users to claim vesting", async () => {
                    const { vestedEscrows, cvx } = phase3;
                    const escrow = vestedEscrows[2];

                    const user = "0x680b07BD5f18aB1d7dE5DdBBc64907E370697EA5";
                    const userAcc = await impersonateAccount(user);

                    const balBefore = await cvx.balanceOf(user);
                    const availableBefore = await escrow.available(user);
                    const remainingBefore = await escrow.remaining(user);

                    expect(availableBefore).gt(0);
                    assertBNClosePercent(remainingBefore, simpleToExactAmount(3.5, 24), "0.11");

                    await escrow.connect(userAcc.signer).claim(false);

                    const balAfter = await cvx.balanceOf(user);
                    const availableAfter = await escrow.available(user);
                    // const remainingAfter = await escrow.remaining(user);

                    const credited = balAfter.sub(balBefore);
                    expect(credited).gt(0);
                    // expect(remainingBefore.sub(remainingAfter)).eq(credited);
                    assertBNClose(availableAfter, BN.from(0), 10000000);
                });
            });
            describe("chef", () => {
                let treasurySigner: Account;
                let cvxCrvBptToken: ERC20;

                before(async () => {
                    treasurySigner = await impersonateAccount(config.multisigs.treasuryMultisig);
                    cvxCrvBptToken = ERC20__factory.connect(phase3.cvxCrvBpt.address, treasurySigner.signer);
                    // TODO - remove once on mainnet
                    await advanceBlock(BN.from(7000).mul(7));
                    expect(await hre.ethers.provider.getBlockNumber()).gt(await phase3.chef.startBlock());
                });
                it("allows users to deposit BPT for chef rewards", async () => {
                    const balBefore = await cvxCrvBptToken.balanceOf(treasurySigner.address);
                    expect(balBefore).gt(0);

                    await cvxCrvBptToken.approve(phase3.chef.address, balBefore);
                    await phase3.chef.connect(treasurySigner.signer).deposit(0, balBefore);

                    const balAfter = await cvxCrvBptToken.balanceOf(treasurySigner.address);
                    expect(balAfter).eq(0);
                    const chefBal = await cvxCrvBptToken.balanceOf(phase3.chef.address);
                    expect(chefBal).eq(balBefore);

                    const userBalance = await phase3.chef.userInfo(0, treasurySigner.address);
                    expect(userBalance.amount).eq(balBefore);
                });
                it("allows users to claim said rewards", async () => {
                    await increaseTime(ONE_HOUR);

                    const balBefore = await phase3.cvx.balanceOf(treasurySigner.address);
                    await phase3.chef.connect(treasurySigner.signer).claim(0, treasurySigner.address);
                    const balAfter = await phase3.cvx.balanceOf(treasurySigner.address);

                    expect(balAfter.sub(balBefore)).gt(0);

                    const userBalance = await phase3.chef.userInfo(0, treasurySigner.address);
                    expect(userBalance.rewardDebt).eq(balAfter.sub(balBefore));
                });
            });
        });
    });

    describe("Phase 4", () => {
        describe("PRE-Phase 4", () => {
            it("only allows daoMultisig to set protect pool to false", async () => {
                const daoMultisig = await impersonateAccount(config.multisigs.daoMultisig);
                const tx = await phase3.poolManager.connect(daoMultisig.signer).setProtectPool(false);
                await waitForTx(tx, debug);
            });
            it("only allows daoMultisig to set Fee info (bbaUSD)");
            it("only allows daoMultisig to set Fee info (native token)", async () => {
                const daoMultisig = await impersonateAccount(config.multisigs.daoMultisig);
                const tx = await phase3.boosterOwner
                    .connect(daoMultisig.signer)
                    .setFeeInfo(config.addresses.token, config.addresses.feeDistribution);
                await waitForTx(tx, debug);

                const feeInfo = await phase3.booster.feeTokens(config.addresses.token);
                expect(feeInfo.distro).eq(config.addresses.feeDistribution);
                expect(feeInfo.rewards).eq(phase3.cvxCrvRewards.address);
                expect(feeInfo.active).eq(true);
            });
        });
        describe("DEPLOY-Phase 4", () => {
            before(async () => {
                // PHASE 4
                phase4 = await deployPhase4(hre, deployer, phase3, config.addresses, debug);
            });
            describe("verifying config", () => {
                it("has correct config for feeCollector", async () => {
                    const { feeCollector, booster, voterProxy } = phase4;
                    const { addresses } = config;

                    expect(await feeCollector.booster()).eq(booster.address);
                    expect(await feeCollector.voterProxy()).eq(voterProxy.address);
                    expect(await feeCollector.feeDistro()).eq(addresses.feeDistribution);
                });
                it("has correct config for claimZap", async () => {
                    const { claimZap, cvx, cvxCrv, crvDepositorWrapper, cvxLocker, cvxCrvRewards } = phase4;
                    const { addresses } = config;

                    expect(await claimZap.crv()).eq(addresses.token);
                    expect(await claimZap.cvx()).eq(cvx.address);
                    expect(await claimZap.cvxCrv()).eq(cvxCrv.address);
                    expect(await claimZap.crvDepositWrapper()).eq(crvDepositorWrapper.address);
                    expect(await claimZap.cvxCrvRewards()).eq(cvxCrvRewards.address);
                    expect(await claimZap.locker()).eq(cvxLocker.address);
                    expect(await claimZap.owner()).eq(deployerAddress);
                });
                it("adds the pools", async () => {
                    const { booster, voterProxy, factories } = phase4;
                    const { addresses } = config;

                    expect(await booster.poolLength()).gt(0);
                    expect(await booster.poolLength()).eq(addresses.gauges.length);

                    const pool0 = await booster.poolInfo(0);
                    expect(pool0.gauge).eq(addresses.gauges[0]);
                    expect(pool0.stash).not.eq(ZERO_ADDRESS);

                    await booster.earmarkRewards(0);

                    const rewardContract = BaseRewardPool4626__factory.connect(pool0.crvRewards, deployer);

                    await expect(rewardContract.extraRewards(0)).to.be.reverted;

                    const stash = ExtraRewardStashV3__factory.connect(pool0.stash, deployer);
                    expect(await stash.pid()).eq(0);
                    expect(await stash.operator()).eq(booster.address);
                    expect(await stash.staker()).eq(voterProxy.address);
                    expect(await stash.gauge()).eq(pool0.gauge);
                    expect(await stash.rewardFactory()).eq(factories.rewardFactory.address);
                    expect(await stash.hasRedirected()).eq(true);
                    expect(await stash.hasCurveRewards()).eq(false);
                    await expect(stash.tokenList(0)).to.be.reverted;
                });
                // check for a gauge with a stash and make sure it has been added
                it("extraRewardsStash has correct config", async () => {
                    // Pool id 6 (0xcD4722B7c24C29e0413BDCd9e51404B4539D14aE) has a reward token of LDO
                    // Let's check it's being processed correctly and is claimable by users
                    const { booster, factories, voterProxy } = phase4;
                    const poolInfo = await booster.poolInfo(6);
                    expect(poolInfo.gauge).eq("0xcD4722B7c24C29e0413BDCd9e51404B4539D14aE");
                    expect(poolInfo.stash).not.eq(ZERO_ADDRESS);

                    await booster.earmarkRewards(6);

                    const rewardContract = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, deployer);
                    const virtualRewardPool = await rewardContract.extraRewards(0);
                    expect(virtualRewardPool).not.eq(ZERO_ADDRESS);

                    const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer);
                    expect(await stash.pid()).eq(6);
                    expect(await stash.operator()).eq(booster.address);
                    expect(await stash.staker()).eq(voterProxy.address);
                    expect(await stash.gauge()).eq("0xcD4722B7c24C29e0413BDCd9e51404B4539D14aE");
                    expect(await stash.rewardFactory()).eq(factories.rewardFactory.address);
                    expect(await stash.hasRedirected()).eq(true);
                    expect(await stash.hasCurveRewards()).eq(true);
                    const rToken = await stash.tokenList(0);
                    expect(rToken).eq("0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32");
                    const tokenInfo = await stash.tokenInfo(rToken);
                    expect(tokenInfo.token).eq(rToken);
                    expect(tokenInfo.rewardAddress).eq(virtualRewardPool);
                });
                it("extraRewardsStash actually processes reward tokens");
                it("allows NEW rewards to be added to extraRewardsStash and claimed");
            });
        });
        describe("TEST-Phase 4", () => {
            describe("claimZap tests", () => {
                it("set approval for deposits", async () => {
                    const crv = await ERC20__factory.connect(config.addresses.token, deployer);
                    await phase4.claimZap.setApprovals();
                    expect(await crv.allowance(phase4.claimZap.address, phase4.crvDepositorWrapper.address)).gte(
                        ethers.constants.MaxUint256,
                    );
                    expect(await phase4.cvxCrv.allowance(phase4.claimZap.address, phase4.cvxCrvRewards.address)).gte(
                        ethers.constants.MaxUint256,
                    );
                    expect(await phase4.cvx.allowance(phase4.claimZap.address, phase4.cvxLocker.address)).gte(
                        ethers.constants.MaxUint256,
                    );
                });
                it("claim rewards from cvxCrvStaking", async () => {
                    const stakerAddress = "0xdecadE000000000000000000000000000000042f";
                    const staker = await impersonateAccount(stakerAddress);
                    const crv = ERC20__factory.connect(config.addresses.token, deployer);
                    const crvBpt = ERC20__factory.connect(config.addresses.tokenBpt, deployer);
                    const rewardBalanceInitial = await phase4.cvxCrvRewards.balanceOf(stakerAddress);

                    // send crv and crvBpt to staker account
                    await getCrvBpt(stakerAddress);
                    await getCrv(stakerAddress);

                    // stake in crvDepositor
                    const crvBptBalance = await crvBpt.balanceOf(stakerAddress);
                    await crvBpt.connect(staker.signer).approve(phase4.crvDepositor.address, crvBptBalance);
                    await phase4.crvDepositor
                        .connect(staker.signer)
                        ["deposit(uint256,bool,address)"](crvBptBalance, true, phase4.cvxCrvRewards.address);

                    const rewardBalanceBefore = await phase4.cvxCrvRewards.balanceOf(stakerAddress);
                    expect(rewardBalanceBefore.sub(rewardBalanceInitial)).eq(crvBptBalance);

                    // distribute rewards from booster
                    const crvBalance = await crv.balanceOf(stakerAddress);
                    await crv.connect(staker.signer).transfer(phase4.booster.address, crvBalance);
                    await phase4.booster.earmarkRewards(0);
                    await increaseTime(ONE_WEEK.mul("4"));

                    // claim rewards from claim zap
                    const option = 1 + 8;
                    const expectedRewards = await phase4.cvxCrvRewards.earned(stakerAddress);
                    const minBptAmountOut = await phase4.crvDepositorWrapper.getMinOut(expectedRewards, 9500);
                    await crv.connect(staker.signer).approve(phase4.claimZap.address, ethers.constants.MaxUint256);
                    await phase4.claimZap
                        .connect(staker.signer)
                        .claimRewards([], [], [], [], expectedRewards, minBptAmountOut, 0, option);

                    const newRewardBalance = await phase4.cvxCrvRewards.balanceOf(stakerAddress);
                    expect(newRewardBalance).gte(minBptAmountOut.add(rewardBalanceBefore));
                });
            });
            describe("booster & deposits", () => {
                it("allows BPT deposits into pools directly");
                it("allows BPT deposits into pools through the Booster");
                it("allows withdrawals directly from the pool 4626");
                it("allows withdrawals directly from the pool normal");
                it("allows users to deposit into proper cvxCrv staking");
                it("allows earmarking of fees ($BAL)");
                it("allows earmarking of fees ($bb-a-USD)");
                it("allows earmarking of rewards");
                it("pays out a premium to the caller");
                it("allows users to earn $BAl and $AURA");
                it("allows conversion of rewards via AuraStakingProxy");
            });
            describe("admin etc", () => {
                it("does not allow a duplicate pool to be added");
                it("allows a pool to be shut down");
                it("allows the fee rates to be set");
                it("does not allow the system to be shut down");
                it("does not allow a fee info to be added that has a gauge");
                it("allows a fee to be disabled");
            });
            describe("boosterOwner", () => {
                it("does not allow boosterOwner to revert control");
                it("allows boosterOwner owner to be changed");
                it("allows boosterOwner to call all fns on booster");
            });
            describe("crv depositor", () => {
                it("accrues incentives for the caller");
                it("pays out the incentives to teh caller");
            });
            describe("aura locker", () => {
                it("allows users to delegate voting power");
                it("allows users to re-delegate");
                it("allows users to claim rewards");
                it("allows other things too");
            });
        });
    });
    describe("1 month later", () => {
        it("allows any penalty to be forwarded to aura lockers via ExtraRewardDistributor");
    });
    describe("3 months later", () => {
        it("allows users to relock a week before finish");
        it("allows users to unlock from auraLocker");
        it("allows users to be kicked for a fee from auraLocker");
    });
});
