import { expect } from "chai";
import hre, { network } from "hardhat";
import { formatBytes32String, formatEther } from "ethers/lib/utils";
import AuraClaimZapV1 from "./AuraClaimZapV1.json";

import {
    Account,
    Booster,
    BaseRewardPool__factory,
    ERC20__factory,
    ExtraRewardStashV3__factory,
    MockERC20__factory,
    BaseRewardPool4626__factory,
} from "../../types";
import {
    assertBNClose,
    BN,
    impersonateAccount,
    increaseTime,
    ONE_DAY,
    ONE_HOUR,
    ONE_WEEK,
    simpleToExactAmount,
    ZERO,
    ZERO_ADDRESS,
} from "../../test-utils";
import {
    Phase2Deployed,
    Phase4Deployed,
    Phase6Deployed,
    Phase7Deployed,
    PoolsSnapshot,
} from "../../scripts/deploySystem";
import { Contract, ethers, Signer } from "ethers";
import { waitForTx } from "../../tasks/utils";
import { config } from "../../tasks/deploy/mainnet-config";

const debug = false;
const sta3BalV2Pid = 12;

const testAccounts = {
    swapper: "0x0000000000000000000000000000000000000002",
    alice: "0x0000000000000000000000000000000000000003",
    eoa: "0x0000000000000000000000000000000000000004",
    staker: "0x0000000000000000000000000000000000000006",
    wethAuraDepositor: "0x905c1cA2ac32eE0799E4Aa31927f1166A93F3b17",
};

describe("Full Migration", () => {
    let protocolDao: Account;
    let deployer: Signer;
    let boosterV2: Booster;

    let phase2: Phase2Deployed;
    let phase4: Phase4Deployed;
    let phase6: Phase6Deployed;
    let phase7: Phase7Deployed;

    let staker: Account;

    let wethAuraDepositor: Account;
    const wethAuraPid = 20;

    const poolsSnapshotV2: PoolsSnapshot[] = [];

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 16178083,
                    },
                },
            ],
        });

        const signers = await hre.ethers.getSigners();
        deployer = signers[0];

        protocolDao = await impersonateAccount(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(protocolDao.signer);
        phase4 = await config.getPhase4(protocolDao.signer);

        wethAuraDepositor = await impersonateAccount(testAccounts.wethAuraDepositor);
        staker = await impersonateAccount(testAccounts.staker);
    });

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    const getLpToken = async (recipient: string, amount = simpleToExactAmount(10)) => {
        const lpWhaleSigner = await impersonateAccount("0xb49d12163334f13c2a1619b6b73659fe6e849e30");
        const lp = MockERC20__factory.connect(config.addresses.staBAL3, lpWhaleSigner.signer);
        const tx = await lp.transfer(recipient, amount);
        await waitForTx(tx, debug);
    };

    const getCrv = async (recipient: string, amount = simpleToExactAmount(250)) => {
        const crvWhale = await impersonateAccount("0xceacc82ddcdb00bfe19a9d3458db3e6b8aef542b");
        const crv = MockERC20__factory.connect(config.addresses.token, crvWhale.signer);
        const tx = await crv.transfer(recipient, amount);
        await waitForTx(tx, debug);
    };

    const getCrvBpt = async (recipient: string, amount = simpleToExactAmount(250)) => {
        const tokenWhaleSigner = await impersonateAccount(config.addresses.tokenWhale);
        const crvBpt = MockERC20__factory.connect(config.addresses.tokenBpt, tokenWhaleSigner.signer);
        const tx = await crvBpt.transfer(recipient, amount);
        await waitForTx(tx, debug);
    };

    /* ---------------------------------------------------------------------
     * Deployment/Protocol DAO
     * --------------------------------------------------------------------- */

    describe("Deploy Phase 6", () => {
        it("deploy phase6", async () => {
            phase6 = await config.getPhase6(deployer);
            boosterV2 = phase6.booster;
        });
    });

    describe("Deploy Phase 7: (re-add pools)", () => {
        it("re-deploy pools", async () => {
            let { poolManager } = phase6;
            const { booster } = phase6;

            poolManager = poolManager.connect(protocolDao.signer);

            const gauges = [
                "0x7C777eEA1dC264e71E567Fcc9B6DdaA9064Eff51",
                "0x27Fd581E9D0b2690C2f808cd40f7fe667714b575",
                "0x57AB3b673878C3fEaB7f8FF434C40Ab004408c4c",
                "0x610f1569045041Af6212be048Bc43e8DC6a07b55",
                "0x9703C0144e8b68280b97d9e30aC6f979Dd6A38d7",
                "0x47c56A900295df5224EC5e6751dC31eb900321D5",
                "0x46804462f147fF96e9CAFB20cA35A3B2600656DF",
                "0xb32Ae42524d38be7E7eD9E02b5F9330fCEf07f3F",
                "0xAf3c3dab54ca15068D09C67D128344916e177cA9",
                "0x34f33CDaED8ba0E1CEECE80e5f4a73bcf234cfac",
                "0x6Eb7CdCd15417ABF120FfE404B9b88141Ca952B7",
                "0xF60B8DAF6825c9fBE5eC073D623B9d47cDa592E8",
                "0x3F0FB52648Eb3981EA598716b7320081d1c8Ba1a",
                "0xb0FB3e031224bd449974AB02cae369E81db58Fa6",
                "0x75cAceBb5b4a73a530EdcdFdE7cFfbfea44c026E",
                "0xc2c2304E163e1aB53De2eEB08820a0B592bec20B",
                "0x605eA53472A496c3d483869Fe8F355c12E861e19",
                "0xe2b680A8d02fbf48C7D9465398C4225d7b7A7f87",
                "0x4E3c048BE671852277Ad6ce29Fd5207aA12fabff",
                "0x3F29e69955E5202759208DD0C5E0BA55ff934814",
                "0x79eF6103A513951a3b25743DB509E267685726B7",
                "0x91A75880b07d36672f5C8DFE0F2334f086e29D47",
                "0x2e79D6f631177F8E7f08Fbd5110e893e1b1D790A",
                "0x4ca6AC0509E6381Ca7CD872a6cdC0Fbf00600Fa1",
                "0x39a9E78c3b9b5B47f1f6632BD74890E2430215Cf",
                "0xDD4Db3ff8A37FE418dB6FF34fC316655528B6bbC",
                "0x9AB7B0C7b154f626451c9e8a68dC04f58fb6e5Ce",
                "0xE5f24cD43f77fadF4dB33Dab44EB25774159AC66",
                "0xcD4722B7c24C29e0413BDCd9e51404B4539D14aE",
                "0x1249c510e066731FF14422500466A7102603da9e",
                "0x5F4d57fd9Ca75625e4B7520c71c02948A48595d0",
                "0xCB664132622f29943f67FA56CCfD1e24CC8B4995",
                "0x651361a042e0573295dd7f6A84dBD1DA56DAc9D5",
                "0x942CB1Ed80D3FF8028B3DD726e0E2A9671bc6202",
            ];

            for (const gauge of gauges) {
                const i = await booster.poolLength();
                await poolManager["addPool(address)"](gauge);
                const newPoolInfo = await booster.poolInfo(i);
                poolsSnapshotV2.push({
                    gauge: newPoolInfo.gauge,
                    lptoken: newPoolInfo.lptoken,
                    shutdown: false,
                    pid: i.toNumber(),
                });
            }
        });
        it("deploy phase7", async () => {
            phase7 = await config.getPhase7(deployer);
        });
    });

    /* ---------------------------------------------------------------------
     * Functional tests
     * --------------------------------------------------------------------- */

    describe("Config checks", () => {
        it("Booster has correct config", async () => {
            const { booster } = phase2;

            expect(await boosterV2.crv()).eq(await booster.crv());
            expect(await boosterV2.voteOwnership()).eq(await booster.voteOwnership());
            expect(await boosterV2.voteParameter()).eq(await booster.voteParameter());

            // Fees are different from existing booster as we have updated
            // to remove caps so we can remove the crvDepositorWrapperWithFee
            expect(await boosterV2.lockIncentive()).eq(2050);
            expect(await boosterV2.stakerIncentive()).eq(400);
            expect(await boosterV2.earmarkIncentive()).eq(50);
            expect(await boosterV2.platformFee()).eq(0);
            expect(await boosterV2.MaxFees()).eq(4000);
            expect(await boosterV2.FEE_DENOMINATOR()).eq(await booster.FEE_DENOMINATOR());

            expect(await boosterV2.owner()).eq(phase6.boosterOwner.address);
            expect(await boosterV2.feeManager()).eq(await booster.feeManager());
            expect(await boosterV2.poolManager()).eq(phase6.poolManagerProxy.address);
            expect(await boosterV2.staker()).eq(await booster.staker());
            expect(await boosterV2.minter()).eq(await booster.minter());
            expect(await boosterV2.rewardFactory()).eq(phase6.factories.rewardFactory.address);
            expect(await boosterV2.stashFactory()).eq(phase6.factories.stashFactory.address);
            expect(await boosterV2.tokenFactory()).eq(phase6.factories.tokenFactory.address);
            // expect(await boosterV2.rewardArbitrator()).eq(await booster.rewardArbitrator());
            expect(await boosterV2.voteDelegate()).eq(await booster.voteDelegate());
            expect(await boosterV2.treasury()).eq(config.multisigs.treasuryMultisig);
            expect(await boosterV2.stakerRewards()).eq(await booster.stakerRewards());
            expect(await boosterV2.lockRewards()).eq(phase6.cvxCrvRewards.address);

            let v1BalFeeInfo = await booster.feeTokens(config.addresses.token);
            let v2BalFeeInfo = await boosterV2.feeTokens(config.addresses.token);
            expect(v1BalFeeInfo.distro).eq(v2BalFeeInfo.distro);

            v1BalFeeInfo = await booster.feeTokens(config.addresses.feeToken);
            v2BalFeeInfo = await boosterV2.feeTokens(config.addresses.feeToken);
            expect(v1BalFeeInfo.distro).eq(v2BalFeeInfo.distro);

            expect(await boosterV2.isShutdown()).eq(false);
        });

        it("Booster Owner has correct config", async () => {
            const { booster, boosterOwner, poolManagerSecondaryProxy, factories } = phase6;
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
            const { factories, booster } = phase6;
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
                protocolDao.signer,
            );
            expect(await rewardsStashV3.crv()).eq(addresses.token);

            expect(await tokenFactory.operator()).eq(booster.address);
            expect(await tokenFactory.namePostfix()).eq(" Aura Deposit");
            expect(await tokenFactory.symbolPrefix()).eq("aura");
        });
        it("poolManagerProxy has correct config", async () => {
            const { booster, poolManagerProxy, poolManagerSecondaryProxy } = phase6;
            expect(await poolManagerProxy.pools()).eq(booster.address);
            expect(await poolManagerProxy.owner()).eq(ZERO_ADDRESS);
            expect(await poolManagerProxy.operator()).eq(poolManagerSecondaryProxy.address);
        });
        it("poolManagerSecondaryProxy has correct config", async () => {
            const { booster, poolManagerProxy, poolManagerSecondaryProxy, poolManager } = phase6;
            const { multisigs, addresses } = config;
            expect(await poolManagerSecondaryProxy.gaugeController()).eq(addresses.gaugeController);
            expect(await poolManagerSecondaryProxy.pools()).eq(poolManagerProxy.address);
            expect(await poolManagerSecondaryProxy.booster()).eq(booster.address);
            expect(await poolManagerSecondaryProxy.owner()).eq(multisigs.daoMultisig);
            expect(await poolManagerSecondaryProxy.operator()).eq(poolManager.address);
            expect(await poolManagerSecondaryProxy.isShutdown()).eq(false);
            expect(await poolManagerSecondaryProxy.usedMap(phase2.cvx.address)).eq(true);
            expect(await poolManagerSecondaryProxy.usedMap(addresses.token)).eq(true);
        });
        it("poolManager has correct config", async () => {
            const { poolManagerSecondaryProxy, poolManager } = phase6;
            const { multisigs, addresses } = config;
            expect(await poolManager.pools()).eq(poolManagerSecondaryProxy.address);
            expect(await poolManager.gaugeController()).eq(addresses.gaugeController);
            expect(await poolManager.operator()).eq(multisigs.daoMultisig);
            expect(await poolManager.protectAddPool()).eq(true);
        });
        it("has correct config for claimZap", async () => {
            const { cvx, cvxCrv, crvDepositorWrapper, cvxLocker } = phase2;
            const { claimZap, cvxCrvRewards } = phase6;
            const { addresses } = config;

            expect(await claimZap.crv()).eq(addresses.token);
            expect(await claimZap.cvx()).eq(cvx.address);
            expect(await claimZap.cvxCrv()).eq(cvxCrv.address);
            expect(await claimZap.crvDepositWrapper()).eq(crvDepositorWrapper.address);
            expect(await claimZap.cvxCrvRewards()).eq(cvxCrvRewards.address);
            expect(await claimZap.locker()).eq(cvxLocker.address);
        });
        it("has correct config for masterChefRewardHook", async () => {
            expect(await phase2.chef.isAddedPool(phase7.siphonToken.address)).eq(true);

            const stashAddress = await phase7.masterChefRewardHook.stash();
            const stash = ExtraRewardStashV3__factory.connect(stashAddress, protocolDao.signer);
            expect(await stash.rewardHook()).eq(phase7.masterChefRewardHook.address);
        });
        it("has correct config for feeCollector", async () => {
            const { voterProxy } = phase2;
            const { feeCollector, booster } = phase6;
            const { addresses } = config;

            expect(await feeCollector.booster()).eq(booster.address);
            expect(await feeCollector.voterProxy()).eq(voterProxy.address);
            expect(await feeCollector.feeDistro()).eq(addresses.feeDistribution);
        });
        it("extraRewardsStash has correct config", async () => {
            const poolId = 31;

            const { voterProxy } = phase2;
            const { booster, factories } = phase6;
            const poolInfo = await booster.poolInfo(poolId);
            console.log("Gauge:", poolInfo.gauge);
            expect(poolInfo.stash).not.eq(ZERO_ADDRESS);

            const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer);
            expect(await stash.hasCurveRewards()).eq(false);
            await phase6.booster.earmarkRewards(poolId);
            expect(await stash.hasCurveRewards()).eq(true);

            expect(await stash.pid()).eq(poolId);
            expect(await stash.operator()).eq(booster.address);
            expect(await stash.staker()).eq(voterProxy.address);
            expect(await stash.gauge()).eq(poolInfo.gauge);
            expect(await stash.rewardFactory()).eq(factories.rewardFactory.address);
        });
        it("crv can not be added as extra reward on stash", async () => {
            const { booster, boosterOwner } = phase6;
            const poolInfo = await booster.poolInfo(3);
            await boosterOwner.connect(protocolDao.signer).setStashExtraReward(poolInfo.stash, config.addresses.token);
            const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer);
            const tokenInfo = await stash.tokenInfo(config.addresses.token);
            expect(tokenInfo.token).eq(ZERO_ADDRESS);
        });
        it("allows boosterOwner owner to be changed", async () => {
            const newOwner = await impersonateAccount(config.multisigs.vestingMultisig);
            let owner = await phase6.boosterOwner.owner();
            expect(owner).eq(protocolDao.address);

            await phase6.boosterOwner.connect(protocolDao.signer).transferOwnership(newOwner.address);
            owner = await phase6.boosterOwner.owner();
            expect(owner).eq(protocolDao.address);
            let pendingOwner = await phase6.boosterOwner.pendingowner();
            expect(pendingOwner).eq(newOwner.address);

            await expect(phase6.boosterOwner.connect(protocolDao.signer).acceptOwnership()).to.be.revertedWith(
                "!pendingowner",
            );

            await phase6.boosterOwner.connect(newOwner.signer).acceptOwnership();
            owner = await phase6.boosterOwner.owner();
            expect(owner).eq(newOwner.address);
            pendingOwner = await phase6.boosterOwner.pendingowner();
            expect(pendingOwner).eq(ZERO_ADDRESS);

            await phase6.boosterOwner.connect(newOwner.signer).transferOwnership(protocolDao.address);
            await phase6.boosterOwner.connect(protocolDao.signer).acceptOwnership();
        });
        it("allows boosterOwner to call all fns on booster", async () => {
            const { booster, boosterOwner } = phase6;

            await boosterOwner.connect(protocolDao.signer).setFeeManager(config.multisigs.treasuryMultisig);
            expect(await booster.feeManager()).eq(config.multisigs.treasuryMultisig);
            await boosterOwner.connect(protocolDao.signer).setFeeManager(protocolDao.address);

            await boosterOwner.connect(protocolDao.signer).setFactories(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS);
            expect(await booster.stashFactory()).eq(ZERO_ADDRESS);
            expect(await booster.tokenFactory()).not.eq(ZERO_ADDRESS);
            expect(await booster.rewardFactory()).not.eq(ZERO_ADDRESS);

            await boosterOwner.connect(protocolDao.signer).setArbitrator(ZERO_ADDRESS);
            expect(await booster.rewardArbitrator()).eq(ZERO_ADDRESS);

            await boosterOwner.connect(protocolDao.signer).setVoteDelegate(ZERO_ADDRESS);
            expect(await booster.voteDelegate()).eq(ZERO_ADDRESS);
            await boosterOwner.connect(protocolDao.signer).setVoteDelegate(protocolDao.address);

            await boosterOwner.connect(protocolDao.signer).updateFeeInfo(config.addresses.token, false);
            expect((await booster.feeTokens(config.addresses.token)).active).eq(false);
            // reset
            await boosterOwner.connect(protocolDao.signer).updateFeeInfo(config.addresses.token, true);
        });
    });

    describe("Post shutdown: withdraw", () => {
        it("Can withdraw and unwrap some LP tokens", async () => {
            const poolInfo = await phase2.booster.poolInfo(wethAuraPid);
            const lpToken = ERC20__factory.connect(poolInfo.lptoken, wethAuraDepositor.signer);
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, wethAuraDepositor.signer);

            const tokenBalance = await crvRewards.balanceOf(wethAuraDepositor.address);

            const balBefore = await lpToken.balanceOf(wethAuraDepositor.address);
            const claim = true;
            await crvRewards.connect(wethAuraDepositor.signer).withdrawAndUnwrap(tokenBalance.div(6), !claim);
            const balAfter = await lpToken.balanceOf(wethAuraDepositor.address);

            const balance = balAfter.sub(balBefore);
            console.log("tokenBalance:", formatEther(tokenBalance));
            console.log("LP tokens transferred:", formatEther(balance));
            expect(balance).gt(ZERO);
            // expect(balance).eq(tokenBalance.sub(tokenBalance.div(6)));
        });
        it("Can withdraw some LP tokens", async () => {
            const poolInfo = await phase2.booster.poolInfo(wethAuraPid);
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, wethAuraDepositor.signer);

            const tokenBalanceBefore = await crvRewards.balanceOf(wethAuraDepositor.address);

            const claim = true;
            const amount = tokenBalanceBefore.div(6);
            await crvRewards.connect(wethAuraDepositor.signer).withdraw(amount, !claim);
            const tokenBalanceAfter = await crvRewards.balanceOf(wethAuraDepositor.address);

            // const balance = balAfter.sub(balBefore);
            const balance = tokenBalanceBefore.sub(tokenBalanceAfter);
            console.log("tokenBalance:", formatEther(tokenBalanceBefore));
            console.log("LP tokens transferred:", formatEther(balance));
            expect(balance).gt(ZERO);
            expect(balance).eq(amount);
        });
        it("Can withdraw all LP tokens", async () => {
            const poolInfo = await phase2.booster.poolInfo(wethAuraPid);
            const lpToken = ERC20__factory.connect(poolInfo.lptoken, wethAuraDepositor.signer);
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, wethAuraDepositor.signer);

            const tokenBalance = await crvRewards.balanceOf(wethAuraDepositor.address);

            const balBefore = await lpToken.balanceOf(wethAuraDepositor.address);
            const claim = true;
            await crvRewards.connect(wethAuraDepositor.signer).withdrawAllAndUnwrap(!claim);
            const balAfter = await lpToken.balanceOf(wethAuraDepositor.address);

            const balance = balAfter.sub(balBefore);
            console.log("LP tokens transferred:", formatEther(balance));
            expect(balance).gt(ZERO);
            expect(balance).eq(tokenBalance);
        });
        it("Cannot claim AURA rewards", async () => {
            const poolInfo = await phase2.booster.poolInfo(wethAuraPid);
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, wethAuraDepositor.signer);
            const earned = await crvRewards.earned(wethAuraDepositor.address);
            expect(earned).gt(0);
            console.log("AURA earned:", formatEther(earned));

            const auraBefore = await phase2.cvx.balanceOf(wethAuraDepositor.address);
            await crvRewards["getReward()"]();
            const auraAfter = await phase2.cvx.balanceOf(wethAuraDepositor.address);

            const auraMinted = auraAfter.sub(auraBefore);
            console.log("AURA minted:", formatEther(auraMinted));
            expect(auraMinted).eq(ZERO);
        });
        it("Cannot claim AURA claiming extra rewards", async () => {
            const poolInfo = await phase2.booster.poolInfo(wethAuraPid);
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, wethAuraDepositor.signer);
            const earned = await crvRewards.earned(wethAuraDepositor.address);
            console.log("AURA earned:", formatEther(earned));

            const auraBefore = await phase2.cvx.balanceOf(wethAuraDepositor.address);
            await crvRewards["getReward(address,bool)"](wethAuraDepositor.address, false);
            const auraAfter = await phase2.cvx.balanceOf(wethAuraDepositor.address);

            const auraMinted = auraAfter.sub(auraBefore);
            console.log("AURA minted:", formatEther(auraMinted));
            expect(auraMinted).eq(ZERO);
        });
        it("Cannot claim AURA not claiming extra rewards", async () => {
            const poolInfo = await phase2.booster.poolInfo(wethAuraPid);
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, wethAuraDepositor.signer);
            const earned = await crvRewards.earned(wethAuraDepositor.address);
            console.log("AURA earned:", formatEther(earned));
            const extraRewardsLength = await crvRewards.extraRewardsLength();
            console.log("AURA extraRewardsLength:", formatEther(extraRewardsLength));

            const auraBefore = await phase2.cvx.balanceOf(wethAuraDepositor.address);
            await crvRewards["getReward(address,bool)"](wethAuraDepositor.address, true);
            const auraAfter = await phase2.cvx.balanceOf(wethAuraDepositor.address);

            const auraMinted = auraAfter.sub(auraBefore);
            console.log("AURA minted:", formatEther(auraMinted));
            expect(auraMinted).eq(ZERO);
        });
        it("Cannot deposit LP tokens", async () => {
            const poolInfo = await phase2.booster.poolInfo(wethAuraPid);
            const lpToken = ERC20__factory.connect(poolInfo.lptoken, wethAuraDepositor.signer);
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, wethAuraDepositor.signer);
            const amount = await lpToken.balanceOf(wethAuraDepositor.address);
            const crvRewardsBefore = await crvRewards.balanceOf(wethAuraDepositor.address);
            console.log("crvRewards Before:", formatEther(crvRewardsBefore));

            await lpToken.approve(phase2.booster.address, amount);
            const stake = true;
            await expect(
                phase2.booster.connect(wethAuraDepositor.signer).deposit(wethAuraPid, amount, stake),
                "deposit",
            ).to.be.revertedWith("shutdown");
        });
    });

    describe("booster & deposits", () => {
        it("allow deposit into pool via Booster", async () => {
            await getLpToken(staker.address, simpleToExactAmount(10));

            const poolInfo = await boosterV2.poolInfo(sta3BalV2Pid);
            expect(poolInfo.lptoken.toLowerCase()).eq(config.addresses.staBAL3.toLowerCase());

            const lptoken = ERC20__factory.connect(poolInfo.lptoken, deployer);
            const lptokenBalance = await lptoken.balanceOf(staker.address);
            const depositToken = ERC20__factory.connect(poolInfo.token, deployer);
            const depositTokenBalanceBefore = await depositToken.balanceOf(staker.address);

            expect(lptokenBalance).gt(0);

            const stake = false;
            await lptoken.connect(staker.signer).approve(boosterV2.address, ethers.constants.MaxUint256);
            await boosterV2.connect(staker.signer).deposit(sta3BalV2Pid, lptokenBalance, stake);

            const depositTokenBalanceAfter = await depositToken.balanceOf(staker.address);
            expect(depositTokenBalanceAfter.sub(depositTokenBalanceBefore)).eq(lptokenBalance);
        });
        it("allows auraBPT deposits directly into the reward pool", async () => {
            const poolInfo = await boosterV2.poolInfo(sta3BalV2Pid);
            const rewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, staker.signer);
            const depositToken = ERC20__factory.connect(poolInfo.token, staker.signer);
            const balance = await depositToken.balanceOf(staker.address);
            const rewardBalanceBefore = await rewards.balanceOf(staker.address);
            await depositToken.approve(rewards.address, balance);

            const tx = await rewards.stake(balance);
            const resp = await tx.wait();
            const transferEvent = resp.events.find(
                event => event.address.toLowerCase() === rewards.address.toLowerCase() && event.event === "Transfer",
            );
            expect(transferEvent.args.to).eq(staker.address);
            expect(transferEvent.args.from).eq("0x0000000000000000000000000000000000000000");

            const rewardBalanceAfter = await rewards.balanceOf(staker.address);
            expect(rewardBalanceAfter.sub(rewardBalanceBefore)).eq(balance);
        });
        it("allows BPT deposits directly into the reward pool", async () => {
            await getLpToken(staker.address, simpleToExactAmount(10));
            const poolInfo = await boosterV2.poolInfo(sta3BalV2Pid);

            const lpToken = ERC20__factory.connect(poolInfo.lptoken, staker.signer);
            const baseRewardPool = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, staker.signer);

            const lpTokenBalance = await lpToken.balanceOf(staker.address);

            const rewardBalanceBefore = await baseRewardPool.balanceOf(staker.address);

            await lpToken.approve(baseRewardPool.address, lpTokenBalance);
            await baseRewardPool.deposit(lpTokenBalance, staker.address);
            const rewardBalanceAfter = await baseRewardPool.balanceOf(staker.address);

            expect(rewardBalanceAfter.sub(rewardBalanceBefore)).eq(lpTokenBalance);
        });
        it("allows withdrawals directly from the pool 4626", async () => {
            const amount = simpleToExactAmount(1);
            const poolInfo = await boosterV2.poolInfo(sta3BalV2Pid);

            const rewards = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, staker.signer);
            const lptoken = ERC20__factory.connect(poolInfo.lptoken, staker.signer);
            const balanceBefore = await lptoken.balanceOf(staker.address);

            const tx = await rewards["withdraw(uint256,address,address)"](amount, staker.address, staker.address);
            const resp = await tx.wait();
            const transferEvent = resp.events.find(
                event => event.address.toLowerCase() === rewards.address.toLowerCase() && event.event === "Transfer",
            );
            expect(transferEvent.args.from).eq(staker.address);
            expect(transferEvent.args.to).eq("0x0000000000000000000000000000000000000000");

            const balanceAfter = await lptoken.balanceOf(staker.address);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
        });
        it("allows withdrawals directly from the pool normal", async () => {
            const amount = simpleToExactAmount(1);
            const poolInfo = await boosterV2.poolInfo(sta3BalV2Pid);

            const rewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, staker.signer);
            const depositToken = ERC20__factory.connect(poolInfo.token, staker.signer);
            const balanceBefore = await depositToken.balanceOf(staker.address);

            await rewards.withdraw(amount, false);

            const balanceAfter = await depositToken.balanceOf(staker.address);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
        });
        it("allows earmarking of fees ($BAL)", async () => {
            await getCrv(staker.address, simpleToExactAmount(10));
            const feeInfo = await boosterV2.feeTokens(config.addresses.token);
            const crv = MockERC20__factory.connect(config.addresses.token, deployer);
            await crv.connect(staker.signer).transfer(feeInfo.distro, simpleToExactAmount(10));

            const feeToken = ERC20__factory.connect(config.addresses.token, deployer);
            const balanceBefore = await feeToken.balanceOf(feeInfo.rewards);
            await increaseTime(ONE_WEEK);

            await boosterV2.earmarkFees(config.addresses.token);
            const balanceAfter = await feeToken.balanceOf(feeInfo.rewards);
            expect(balanceAfter).gt(balanceBefore);
        });
        it("allows earmarking of fees ($bb-a-USD)", async () => {
            const feeInfo = await boosterV2.feeTokens(config.addresses.feeToken);

            const tokenWhaleSigner = await impersonateAccount(config.addresses.balancerVault);
            const bbausd = MockERC20__factory.connect(config.addresses.feeToken, tokenWhaleSigner.signer);
            const tx = await bbausd.transfer(feeInfo.distro, simpleToExactAmount(100));
            await waitForTx(tx, debug);

            const feeToken = ERC20__factory.connect(config.addresses.feeToken, deployer);
            const balanceBefore = await feeToken.balanceOf(feeInfo.rewards);
            await increaseTime(ONE_WEEK);

            await boosterV2.earmarkFees(config.addresses.feeToken);
            const balanceAfter = await feeToken.balanceOf(feeInfo.rewards);
            expect(balanceAfter).gt(balanceBefore);
        });
        it("allows earmarking of rewards", async () => {
            const poolInfo = await boosterV2.poolInfo(sta3BalV2Pid);
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, deployer);
            const crv = MockERC20__factory.connect(config.addresses.token, deployer);
            const balanceBefore = await crv.balanceOf(crvRewards.address);

            await increaseTime(ONE_HOUR);
            await boosterV2.earmarkRewards(sta3BalV2Pid);

            const balanceAfter = await crv.balanceOf(crvRewards.address);
            expect(balanceAfter).gt(balanceBefore);
        });
        it("pays out a premium to the caller", async () => {
            const crv = ERC20__factory.connect(config.addresses.token, deployer);
            const balanceBefore = await crv.balanceOf(staker.address);
            await increaseTime(ONE_HOUR);
            await boosterV2.connect(staker.signer).earmarkRewards(sta3BalV2Pid);
            const balanceAfter = await crv.balanceOf(staker.address);
            expect(balanceAfter).gt(balanceBefore);
        });
        it("allows users to earn $BAl and $AURA", async () => {
            const crv = ERC20__factory.connect(config.addresses.token, deployer);
            const poolInfo = await boosterV2.poolInfo(sta3BalV2Pid);
            const rewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, deployer);
            const cvxBalanceBefore = await phase2.cvx.balanceOf(staker.address);
            const crvBalanceBefore = await crv.balanceOf(staker.address);
            const earned = await rewards.earned(staker.address);
            await rewards["getReward(address,bool)"](staker.address, true);
            const cvxBalanceAfter = await phase2.cvx.balanceOf(staker.address);
            const crvBalanceAfter = await crv.balanceOf(staker.address);

            const crvBalance = crvBalanceAfter.sub(crvBalanceBefore);
            const cvxBalance = cvxBalanceAfter.sub(cvxBalanceBefore);

            expect(crvBalance).gte(earned);
            expect(cvxBalance).gt(0);
        });
        it("allows conversion of rewards via AuraStakingProxy", async () => {
            const crv = MockERC20__factory.connect(config.addresses.token, deployer);
            const crvBalance = await crv.balanceOf(phase2.cvxStakingProxy.address);
            expect(crvBalance).gt(0);

            const keeps = await phase2.cvxStakingProxy.keeper();
            const keeper = await impersonateAccount(keeps);

            const callerCvxCrvBalanceBefore = await phase2.cvxCrv.balanceOf(keeper.address);
            const cvxLockerCvxCrvBalanceBefore = await phase2.cvxCrv.balanceOf(phase2.cvxLocker.address);

            await phase2.cvxStakingProxy.connect(keeper.signer)["distribute()"]();
            const callerCvxCrvBalanceAfter = await phase2.cvxCrv.balanceOf(keeper.address);
            const cvxLockerCvxCrvBalanceAfter = await phase2.cvxCrv.balanceOf(phase2.cvxLocker.address);

            expect(callerCvxCrvBalanceAfter).gt(callerCvxCrvBalanceBefore);
            expect(cvxLockerCvxCrvBalanceAfter).gt(cvxLockerCvxCrvBalanceBefore);
        });
        it("allows claim rewards via claim Zapper v1 on shutdown pools", async () => {
            const stakerAddress = "0x285b7EEa81a5B66B62e7276a24c1e0F83F7409c1";
            const staker = await impersonateAccount(stakerAddress);

            const crv = ERC20__factory.connect(config.addresses.token, deployer);
            const crvBalanceBefore = await crv.balanceOf(stakerAddress);
            const cvxBalanceBefore = await phase4.cvx.balanceOf(stakerAddress);
            // claim rewards from claim zap
            const option = 1 + 8;
            const expectedRewards = await phase4.cvxCrvRewards.earned(stakerAddress);
            console.log("🚀 ~ file: FullMigration.spec.ts:889 ~ it ~ expectedRewards", expectedRewards.toString());
            const claimZapV1 = new ethers.Contract(
                "0x623B83755a39B12161A63748f3f595A530917Ab2",
                AuraClaimZapV1.abi,
                staker.signer,
            );

            await claimZapV1.claimRewards([], [], [], [], 0, 0, 0, option);

            const crvBalanceAfter = await crv.balanceOf(stakerAddress);
            const cvxBalanceAfter = await phase4.cvx.balanceOf(stakerAddress);

            expect(crvBalanceBefore.add(expectedRewards), "crv balance increase").to.be.eq(crvBalanceAfter);
            //  no new cvx mints from shutdown pools
            expect(cvxBalanceBefore, "cvx balance does not change").to.be.eq(cvxBalanceAfter);
        });
    });

    describe("Pool Migrator", () => {
        // Given that all system is shutdown
        // Booster V1 information
        const pidYFIWETH = 12;
        const pidWETHAURA = 0;
        const stakerAddress = "0x285b7EEa81a5B66B62e7276a24c1e0F83F7409c1";
        let staker: Account;

        const expectPoolMigration = async (
            user: Account,
            fromPids: Array<number>,
            toPids: Array<number>,
            amounts: Array<BN>,
        ) => {
            const migratedAmounts: Array<BN> = [];
            const fromCrvRewardsBefore: Array<BN> = [];
            const toCrvRewardsBefore: Array<BN> = [];
            // Given a user with balance on "from" pid.

            for (let i = 0; i < fromPids.length; i++) {
                const fromPid = fromPids[i];
                const toPid = toPids[i];

                const fromPool = await phase2.booster.poolInfo(fromPid);
                const toPool = await phase6.booster.poolInfo(toPid);
                const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool.crvRewards, deployer);
                const balance = await fromCrvRewards.balanceOf(user.address);
                migratedAmounts.push(amounts[i] === ethers.constants.MaxUint256 ? balance : amounts[i]);
                fromCrvRewardsBefore.push(balance);
                expect(balance, "crv rewards balance").to.be.gt(0);

                const toCrvRewards = BaseRewardPool4626__factory.connect(toPool.crvRewards, user.signer);
                toCrvRewardsBefore.push(await toCrvRewards.balanceOf(user.address));

                await fromCrvRewards.connect(user.signer).approve(phase6.poolMigrator.address, fromCrvRewardsBefore[i]);
            }

            // When it migrates

            await phase6.poolMigrator.connect(user.signer).migrate(fromPids, toPids, amounts);

            for (let i = 0; i < fromPids.length; i++) {
                const fromPool = await phase2.booster.poolInfo(fromPids[i]);
                const toPool = await phase6.booster.poolInfo(toPids[i]);
                const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool.crvRewards, deployer);
                const toCrvRewards = BaseRewardPool4626__factory.connect(toPool.crvRewards, user.signer);

                // Then previous lp position must be zero and new position must hold all its previous liquidity
                const fromCrvRewardsAfter = await fromCrvRewards.balanceOf(user.address);
                const toCrvRewardsAfter = await toCrvRewards.balanceOf(user.address);

                expect(fromCrvRewardsAfter, "from crvRewards balance").to.be.eq(
                    fromCrvRewardsBefore[i].sub(migratedAmounts[i]),
                );
                expect(toCrvRewardsAfter, "to crvRewards balance").to.be.eq(
                    toCrvRewardsBefore[i].add(migratedAmounts[i]),
                );
            }
            console.log("Migration successful");
            console.table(
                fromPids.map((_, i) => [fromPids[i], toPids[i], ethers.utils.formatUnits(migratedAmounts[i])]),
            );
        };
        before("before", async () => {
            staker = await impersonateAccount(stakerAddress);
        });
        it("fails if gauges do not match", async () => {
            const fromPid = pidYFIWETH;
            const toPid = pidWETHAURA;
            const amounts = [ethers.constants.MaxUint256];
            const user = await impersonateAccount(stakerAddress);

            await expect(expectPoolMigration(user, [fromPid], [toPid], amounts)).to.be.reverted;
        });
        it("migrates partial positions", async () => {
            const fromPool = await phase2.booster.poolInfo(pidYFIWETH);
            const fromPid = pidYFIWETH;
            const toPid = poolsSnapshotV2.find(p => p.gauge === fromPool.gauge).pid;

            const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool.crvRewards, deployer);
            const balance = await fromCrvRewards.balanceOf(staker.address);
            const amounts = [balance.div(3)];

            await expectPoolMigration(staker, [fromPid], [toPid], amounts);
        });
        it("migrates multiple pools", async () => {
            const fromPid0 = pidYFIWETH;
            const fromPool0 = await phase2.booster.poolInfo(fromPid0);
            const toPid0 = poolsSnapshotV2.find(p => p.gauge === fromPool0.gauge).pid;

            const fromPid1 = 20;
            const toPid1 = 0;

            const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool0.crvRewards, deployer);
            const balance = await fromCrvRewards.balanceOf(staker.address);

            const amounts = [balance.div(2), ethers.constants.MaxUint256];

            await expectPoolMigration(staker, [fromPid0, fromPid1], [toPid0, toPid1], amounts);
        });
        it("migrates full position", async () => {
            const fromPool = await phase2.booster.poolInfo(pidYFIWETH);
            const fromPid = pidYFIWETH;
            const toPid = poolsSnapshotV2.find(p => p.gauge === fromPool.gauge).pid;

            const amounts = [ethers.constants.MaxUint256];

            await expectPoolMigration(staker, [fromPid], [toPid], amounts);
        });
    });

    describe("booster reward multiplier", () => {
        it("only fee manager can set reward multiplier", async () => {
            await expect(boosterV2.setRewardMultiplier(ZERO_ADDRESS, 0)).to.be.revertedWith("!auth");
        });
        it("can set reward multiplier", async () => {
            const poolInfo = await boosterV2.poolInfo(sta3BalV2Pid);

            const multiplierBefore = await boosterV2.getRewardMultipliers(poolInfo.crvRewards);
            expect(multiplierBefore).eq(await boosterV2.REWARD_MULTIPLIER_DENOMINATOR());
            await boosterV2.connect(protocolDao.signer).setRewardMultiplier(poolInfo.crvRewards, 0);
            expect(await boosterV2.getRewardMultipliers(poolInfo.crvRewards)).eq(0);
            await boosterV2.connect(protocolDao.signer).setRewardMultiplier(poolInfo.crvRewards, multiplierBefore);
        });
        it("reward multiplier gets more rewards", async () => {
            await getLpToken(staker.address, simpleToExactAmount(10));

            // deposit into booster
            const poolInfo = await boosterV2.poolInfo(sta3BalV2Pid);
            const lptoken = ERC20__factory.connect(poolInfo.lptoken, deployer);
            const lptokenBalance = await lptoken.balanceOf(staker.address);
            await lptoken.connect(staker.signer).approve(boosterV2.address, ethers.constants.MaxUint256);
            await boosterV2.connect(staker.signer).deposit(sta3BalV2Pid, lptokenBalance, true);

            // wait for the reward period
            await increaseTime(ONE_WEEK);
            await boosterV2.earmarkRewards(sta3BalV2Pid);

            // check rewards
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, staker.signer);

            await crvRewards["getReward()"]();
            const earnedBefore = await crvRewards.earned(staker.address);
            console.log("earned:", earnedBefore.toString());
            expect(earnedBefore).eq(0);

            // Get rewards normally with 1x multiplier
            await increaseTime(ONE_DAY);
            const earned0 = await crvRewards.earned(staker.address);
            console.log("earned:", earned0.toString());
            const auraBefore0 = await phase2.cvx.balanceOf(staker.address);
            await crvRewards["getReward()"]();
            const auraAfter0 = await phase2.cvx.balanceOf(staker.address);
            const auraRewards0 = auraAfter0.sub(auraBefore0);
            console.log("AURA rewards:", auraRewards0.toString());

            // Get rewards boosted with 2x multiplier
            const multiplier = 2;
            const multiplierDenominator = await boosterV2.REWARD_MULTIPLIER_DENOMINATOR();
            await increaseTime(ONE_DAY);
            const earned1 = await crvRewards.earned(staker.address);
            console.log("earned:", earned1.toString());
            const auraBefore1 = await phase2.cvx.balanceOf(staker.address);
            await boosterV2
                .connect(protocolDao.signer)
                .setRewardMultiplier(poolInfo.crvRewards, multiplierDenominator.mul(multiplier));
            await crvRewards["getReward()"]();
            const auraAfter1 = await phase2.cvx.balanceOf(staker.address);
            const auraRewards1 = auraAfter1.sub(auraBefore1);
            console.log("AURA rewards:", auraRewards1.toString());
            // use 1e15 for preceision because the blocks are mined a dif times
            // we make the assumption that if these numbers are within that preceision
            // of each other then the multipliers are working
            const precision = 1e12;
            assertBNClose(auraRewards1.div(precision), auraRewards0.div(precision).mul(multiplier));

            // Get rewards with 0x multiplier
            await increaseTime(ONE_DAY.div(3));
            const earned2 = await crvRewards.earned(staker.address);
            console.log("earned:", earned2.toString());
            const auraBefore2 = await phase2.cvx.balanceOf(staker.address);
            await boosterV2.connect(protocolDao.signer).setRewardMultiplier(poolInfo.crvRewards, 0);
            await crvRewards["getReward()"]();
            const auraAfter2 = await phase2.cvx.balanceOf(staker.address);
            const auraRewards2 = auraAfter2.sub(auraBefore2);
            console.log("AURA rewards:", auraRewards2.toString());
            expect(auraRewards2).eq(0);

            // reset reward multiplier
            await boosterV2.connect(protocolDao.signer).setRewardMultiplier(poolInfo.crvRewards, 10000);
        });
        it("cvxCrv staking multiplier", async () => {
            const rewardBalanceInitial = await phase2.cvxCrvRewards.balanceOf(staker.address);

            await getCrvBpt(staker.address);
            const crvBpt = ERC20__factory.connect(config.addresses.tokenBpt, staker.signer);

            // stake in crvDepositor
            const crvBptBalance = await crvBpt.balanceOf(staker.address);
            await crvBpt.connect(staker.signer).approve(phase2.crvDepositor.address, crvBptBalance);
            await phase2.crvDepositor
                .connect(staker.signer)
                ["deposit(uint256,bool,address)"](crvBptBalance, true, phase6.cvxCrvRewards.address);

            const rewardBalanceBefore = await phase6.cvxCrvRewards.balanceOf(staker.address);
            expect(rewardBalanceBefore.sub(rewardBalanceInitial)).eq(crvBptBalance);

            // distribute rewards from booster
            await phase6.booster.earmarkRewards(sta3BalV2Pid);
            await increaseTime(ONE_HOUR);
            console.log("Earned:", await phase6.cvxCrvRewards.earned(staker.address));
            const bal0Before = await phase2.cvx.balanceOf(staker.address);
            await phase6.cvxCrvRewards.connect(staker.signer)["getReward()"]();
            const bal0After = await phase2.cvx.balanceOf(staker.address);
            const bal0 = bal0After.sub(bal0Before);
            console.log("Bal0:", bal0);

            await phase6.booster.earmarkRewards(sta3BalV2Pid);
            await increaseTime(ONE_HOUR);
            await phase6.booster.connect(protocolDao.signer).setRewardMultiplier(phase6.cvxCrvRewards.address, 20000);
            console.log("Earned:", await phase6.cvxCrvRewards.earned(staker.address));
            const bal1Before = await phase2.cvx.balanceOf(staker.address);
            await phase6.cvxCrvRewards.connect(staker.signer)["getReward()"]();
            const bal1After = await phase2.cvx.balanceOf(staker.address);
            const bal1 = bal1After.sub(bal1Before);
            console.log("Bal1:", bal1);

            expect(bal1.mul(101).div(100)).gt(bal0.mul(2));
            expect(bal1.mul(99).div(100)).lt(bal0.mul(2));

            // reset
            await phase6.booster.connect(protocolDao.signer).setRewardMultiplier(phase6.cvxCrvRewards.address, 10000);
        });
    });

    describe("booster extra CRV sent to treasury", () => {
        it("extra CRV in booster", async () => {
            const amount = simpleToExactAmount(1);

            await getCrv(boosterV2.address, amount);
            const crv = ERC20__factory.connect(config.addresses.token, staker.signer);
            expect(await crv.balanceOf(boosterV2.address)).eq(amount);

            const treasury = await boosterV2.treasury();
            const balBefore = await crv.balanceOf(treasury);
            await boosterV2.earmarkRewards(sta3BalV2Pid);
            const balAfter = await crv.balanceOf(treasury);

            const balance = balAfter.sub(balBefore);
            expect(balance).eq(amount);
        });
        it("extra CRV in voter proxy", async () => {
            const amount = simpleToExactAmount(1);

            await getCrv(phase2.voterProxy.address, amount);
            const crv = ERC20__factory.connect(config.addresses.token, staker.signer);
            expect(await crv.balanceOf(phase2.voterProxy.address)).eq(amount);

            const treasury = await boosterV2.treasury();
            const balBefore = await crv.balanceOf(treasury);
            await boosterV2.earmarkRewards(sta3BalV2Pid);
            const balAfter = await crv.balanceOf(treasury);

            const balance = balAfter.sub(balBefore);
            expect(balance).eq(amount);
        });
    });

    describe("booster distribute L2 fees", () => {
        it("only fee manager can set bridge delegate", async () => {
            await expect(boosterV2.setBridgeDelegate(protocolDao.address)).to.be.revertedWith("!auth");
        });
        it("set bridge delegate", async () => {
            await boosterV2.connect(protocolDao.signer).setBridgeDelegate(protocolDao.address);
            const bd = await boosterV2.bridgeDelegate();
            expect(bd).eq(protocolDao.address);
        });
        it("distribute L2 fees only callable by bridge delegate", async () => {
            await expect(boosterV2.distributeL2Fees(simpleToExactAmount(1))).to.be.revertedWith("!auth");
        });
        it("distribute L2 fees only callable by bridge delegate", async () => {
            const feeAmount = simpleToExactAmount(10);
            await getCrv(protocolDao.address, feeAmount);
            const crv = ERC20__factory.connect(config.addresses.token, protocolDao.signer);
            await crv.approve(boosterV2.address, feeAmount);

            const lockRewards = await boosterV2.lockRewards();
            const stakerRewards = await boosterV2.stakerRewards();
            const bridgeDelegate = await boosterV2.bridgeDelegate();

            // CRV transfered from bridgeDelegate
            const crvBalBefore = await crv.balanceOf(protocolDao.address);
            const lockRewardsCrvBalBefore = await crv.balanceOf(lockRewards);
            const stakerRewardsCrvBalBefore = await crv.balanceOf(stakerRewards);
            const auraBefore = await phase2.cvx.balanceOf(bridgeDelegate);

            // Distribute
            await boosterV2.connect(protocolDao.signer).distributeL2Fees(feeAmount);

            const crvBalAfter = await crv.balanceOf(protocolDao.address);
            const lockRewardsCrvBalAfter = await crv.balanceOf(lockRewards);
            const stakerRewardsCrvBalAfter = await crv.balanceOf(stakerRewards);
            const auraAfter = await phase2.cvx.balanceOf(bridgeDelegate);

            expect(crvBalBefore.sub(crvBalAfter)).eq(feeAmount);

            // Get incentives info
            const lockIncentive = await boosterV2.lockIncentive();
            const stakerIncentive = await boosterV2.stakerIncentive();
            const totalIncentives = lockIncentive.add(stakerIncentive);
            const expectedLockFee = feeAmount.mul(lockIncentive).div(totalIncentives);
            const expectedStakerFee = feeAmount.sub(expectedLockFee);

            // CRV transfered to lockRewards
            const actualLockFee = lockRewardsCrvBalAfter.sub(lockRewardsCrvBalBefore);
            console.log("lock fee:: expected:", expectedLockFee.toString(), "actual:", actualLockFee.toString());
            expect(expectedLockFee).eq(actualLockFee);

            // CRV transfered to stakerRewards
            const actualStakerFee = stakerRewardsCrvBalAfter.sub(stakerRewardsCrvBalBefore);
            console.log("staker fee:: expected:", expectedStakerFee.toString(), "actual:", actualStakerFee.toString());
            expect(expectedStakerFee).eq(actualStakerFee);

            // AURA minted to bridge delegate
            // TODO: more accurate
            expect(auraAfter.sub(auraBefore)).gt(0);
        });
    });

    describe("Set snapshot delegate for VoterProxy", () => {
        let delegate: Contract;
        before(() => {
            const abi = [
                "function setDelegate(bytes32 id, address delegate) external",
                "function delegation(address, bytes32) external view returns (address)",
            ];

            delegate = new ethers.Contract("0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446", abi, deployer);
        });
        it("set delegate", async () => {
            const deployerAddress = await deployer.getAddress();
            const voteDelegate = await impersonateAccount(await phase6.booster.voteDelegate());
            const spaceId = formatBytes32String("aurafinance.eth");
            await phase6.booster.connect(voteDelegate.signer).setDelegate(delegate.address, deployerAddress, spaceId);
            const newDelegate = await delegate.delegation(phase2.voterProxy.address, spaceId);
            expect(newDelegate).eq(deployerAddress);
        });
        it("only callable by vote delegate", async () => {
            const deployerAddress = await deployer.getAddress();
            const spaceId = formatBytes32String("aurafinance.eth");
            await expect(phase6.booster.setDelegate(delegate.address, deployerAddress, spaceId)).to.be.revertedWith(
                "!auth",
            );
        });
        it("reset vote hash", async () => {
            const voteDelegate = await impersonateAccount(await phase6.booster.voteDelegate());
            const hash = "0xe15a5e9882c1fa0a3166b039f4e80e9eef2ae21cb40d51fabc84238342c436c7";
            let valid = await phase2.voterProxy.isValidSignature(hash, []);
            expect(valid).eq("0x1626ba7e");
            await phase6.booster.connect(voteDelegate.signer).setVote(hash);
            valid = await phase2.voterProxy.isValidSignature(hash, []);
            expect(valid).eq("0xffffffff");
        });
    });
});
