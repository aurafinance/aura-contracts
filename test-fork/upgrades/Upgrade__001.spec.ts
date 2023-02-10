import hre, { network } from "hardhat";
import { expect } from "chai";
import { BigNumber, BigNumberish, ethers, Signer } from "ethers";

import {
    Account,
    BaseRewardPool4626,
    BaseRewardPool4626__factory,
    BoosterOwnerSecondary,
    ERC20,
    ERC20__factory,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    IERC20__factory,
    MockCurveMinter,
    MockCurveMinter__factory,
    MockERC20__factory,
    PoolManagerV4,
    VirtualBalanceRewardPool__factory,
    MockFeeDistributor__factory,
    MockFeeTokenVerifier__factory,
    StashToken__factory,
} from "../../types";
import {
    fullScale,
    impersonate,
    impersonateAccount,
    increaseTime,
    ONE_WEEK,
    simpleToExactAmount,
    ZERO_ADDRESS,
} from "../../test-utils";

import { config } from "../../tasks/deploy/mainnet-config";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { deployContract } from "../../tasks/utils";
import { PoolInfoStruct } from "../../types/generated/IBooster";

const cowWethPid = 4;
const wstEthPid = 29;
const cowWethWhale = "0xb1c26d7ab776c58e349dfb30f475e70087f86fd2";
const wstEthWhale = "0x21ac89788d52070d23b8eacecbd3dc544178dc60";
const compWstethLpWhale = "0xec576a26335de1c360d2fc9a68cba6ba37af4a13";
const compWstethGaugeAddress = "0x9C0f4144D037688e0AdA74B22a9aAb7c14c58e6C";
const ankrWethGaugeAddress = "0x21D8dB8a46393FEdE4e91eAfBc0cCf092faCb469";

/**
 * Upgrade:
 * - 1) Stash implementation is updated to the new one
 * - 2) New BoosterOwnerSecondary becomes owner of BoosterOwner
 * - 3) PoolManagerV3 is replace with PoolManagerV4 and sealed
 */
describe("PoolManager/Stash/BoosterOwner Upgrades", () => {
    let protocolDao: Account;
    let deployer: Signer;
    let phase6: Phase6Deployed;
    let phase2: Phase2Deployed;

    let boosterOwnerSecondary: BoosterOwnerSecondary;
    let poolManagerV4: PoolManagerV4;
    let mockMintr: MockCurveMinter;
    let crv: ERC20;

    let newStashImpl: ExtraRewardStashV3;

    const whales = {};

    const mintrMintAmount = simpleToExactAmount(10);

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 16597635,
                    },
                },
            ],
        });

        const signers = await hre.ethers.getSigners();
        deployer = signers[0];

        protocolDao = await impersonateAccount(config.multisigs.daoMultisig);
        phase6 = await config.getPhase6(protocolDao.signer);
        phase2 = await config.getPhase2(protocolDao.signer);
        crv = MockERC20__factory.connect(config.addresses.token, deployer);

        whales[cowWethPid] = await impersonateAccount(cowWethWhale);

        mockMintr = await deployContract<MockCurveMinter>(
            hre,
            new MockCurveMinter__factory(deployer),
            "MockCurveMinter",
            [config.addresses.token, mintrMintAmount],
            {},
            false,
        );
    });

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    async function getEth(recipient: string) {
        const ethWhale = await impersonate(config.addresses.weth);
        await ethWhale.sendTransaction({
            to: recipient,
            value: simpleToExactAmount(1),
        });
    }

    async function getBal(to: string, amount: BigNumberish) {
        await getEth(config.addresses.balancerVault);
        const tokenWhaleSigner = await impersonateAccount(config.addresses.balancerVault);
        await crv.connect(tokenWhaleSigner.signer).transfer(to, amount);
    }

    async function getPoolInfo(pid: number) {
        const poolInfo = await phase6.booster.poolInfo(pid);
        const lpToken = ERC20__factory.connect(poolInfo.lptoken, deployer);
        const rewards = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, deployer);
        const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer);

        const whale = whales[pid];
        if (!whale) throw Error("No whale found");

        return { whale, lpToken, rewards, stash };
    }

    async function withMockMinter(fn: () => Promise<void>) {
        // Update the mintr slot of voter proxy to be our mock mintr
        const original = await hre.network.provider.send("eth_getStorageAt", [phase2.voterProxy.address, "0x0"]);
        const newSlot = "0x" + mockMintr.address.slice(2).padStart(64, "0");
        await getBal(mockMintr.address, mintrMintAmount);
        expect(await crv.balanceOf(mockMintr.address)).eq(mintrMintAmount);

        await hre.network.provider.send("hardhat_setStorageAt", [phase2.voterProxy.address, "0x0", newSlot]);
        await fn();
        await hre.network.provider.send("hardhat_setStorageAt", [phase2.voterProxy.address, "0x0", original]);
    }

    /* ---------------------------------------------------------------------
     * Deployment and Setup
     * --------------------------------------------------------------------- */

    describe("Deployment and Setup", () => {
        it("Deploy contracts", async () => {
            // const result = await deployUpgrade01(hre, deployer, false, 0);
            const result = await config.getPhase8(deployer);

            newStashImpl = phase6.stashV3;
            poolManagerV4 = result.poolManagerV4;
            boosterOwnerSecondary = result.boosterOwnerSecondary;
        });
        describe("Protocol DAO setup transactions", () => {
            it("Update stash implementation via BoosterOwner", async () => {
                await phase6.boosterOwner.setStashFactoryImplementation(
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    newStashImpl.address,
                );
            });
            it("Transfer ownership to BoosterOwnerSecondary", async () => {
                await phase6.boosterOwner.transferOwnership(boosterOwnerSecondary.address);
                expect(await phase6.boosterOwner.pendingowner()).eq(boosterOwnerSecondary.address);
                await boosterOwnerSecondary.acceptOwnershipBoosterOwner();
                expect(await phase6.boosterOwner.owner()).eq(boosterOwnerSecondary.address);
            });
            it("Swap out PoolManagerV3 for PoolManagerV4", async () => {
                expect(await phase6.poolManagerSecondaryProxy.operator()).not.eq(poolManagerV4.address);
                await phase6.poolManagerSecondaryProxy.connect(protocolDao.signer).setOperator(poolManagerV4.address);
                expect(await phase6.poolManagerSecondaryProxy.operator()).eq(poolManagerV4.address);
            });
            it("Seal PoolManagerV4", async () => {
                expect(await phase6.poolManagerSecondaryProxy.owner()).not.eq(poolManagerV4.address);
                await phase6.poolManagerSecondaryProxy.connect(protocolDao.signer).setOwner(poolManagerV4.address);
                expect(await phase6.poolManagerSecondaryProxy.owner()).eq(poolManagerV4.address);
            });
        });
    });

    /* ---------------------------------------------------------------------
     * Config checks
     * --------------------------------------------------------------------- */

    describe("Config checks", () => {
        it("BoosterOwnerSecondary has the correct config", async () => {
            const poolLength = await phase6.booster.poolLength();
            expect(await boosterOwnerSecondary.oldPidCheckpoint()).eq(poolLength.sub(1));
            expect(await boosterOwnerSecondary.booster()).eq(phase6.booster.address);
            expect(await boosterOwnerSecondary.boosterOwner()).eq(phase6.boosterOwner.address);
        });
        it("PoolManagerV4 has the correct config", async () => {
            const { poolManagerSecondaryProxy, poolManager } = phase6;
            const { multisigs, addresses } = config;
            expect(await poolManager.pools()).eq(poolManagerSecondaryProxy.address);
            expect(await poolManager.gaugeController()).eq(addresses.gaugeController);
            expect(await poolManager.operator()).eq(multisigs.daoMultisig);
            expect(await poolManager.protectAddPool()).eq(true);
        });
        // Extra reward stash config is checked after addPool below
    });

    /* ---------------------------------------------------------------------
     * Protected functions
     * --------------------------------------------------------------------- */

    describe("Protected functions", () => {
        it("BoosterOwnerSecondary", async () => {
            await expect(boosterOwnerSecondary.setSealStashImplementation()).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.setFeeTokenVerifier(ZERO_ADDRESS)).to.be.revertedWith("!manager");
            await expect(boosterOwnerSecondary.setManager(ZERO_ADDRESS)).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.transferOwnership(ZERO_ADDRESS)).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.setArbitrator(ZERO_ADDRESS)).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.setFeeInfo(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.updateFeeInfo(ZERO_ADDRESS, false)).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.setFeeManager(ZERO_ADDRESS)).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.setVoteDelegate(ZERO_ADDRESS)).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.shutdownSystem()).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.queueForceShutdown()).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.forceShutdownSystem()).to.be.revertedWith("!owner");
            await expect(
                boosterOwnerSecondary.setStashFactoryImplementation(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS),
            ).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.execute(ZERO_ADDRESS, 0, "0x")).to.be.revertedWith("!owner");
            await expect(
                boosterOwnerSecondary.setRescueTokenDistribution(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS),
            ).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.setStashExtraReward(1, ZERO_ADDRESS)).to.be.revertedWith("!owner");
            await expect(boosterOwnerSecondary.setStashRewardHook(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(
                "!owner",
            );
            await expect(boosterOwnerSecondary.setStashTokenIsValid(ZERO_ADDRESS, false)).to.be.revertedWith("!owner");
        });
        it("PoolManagerV4", async () => {
            await expect(poolManagerV4.setOperator(ZERO_ADDRESS)).to.be.revertedWith("!auth");
            await expect(poolManagerV4.setProtectPool(false)).to.be.revertedWith("!auth");
            await expect(poolManagerV4.shutdownPool(0)).to.be.revertedWith("!auth");
            await expect(poolManagerV4.shutdownSystem()).to.be.revertedWith("!auth");
        });
    });

    /* ---------------------------------------------------------------------
     * BoosterOwnerSecondary Functional tests
     * --------------------------------------------------------------------- */

    describe("BoosterOwnerSecondary functional tests", () => {
        it("Can call all fns on the Booster", async () => {
            const { booster } = phase6;

            await boosterOwnerSecondary.connect(protocolDao.signer).setArbitrator(ZERO_ADDRESS);
            expect(await booster.rewardArbitrator()).eq(ZERO_ADDRESS);

            expect((await booster.feeTokens(config.addresses.token)).active).eq(true);
            await boosterOwnerSecondary.connect(protocolDao.signer).updateFeeInfo(config.addresses.token, false);
            expect((await booster.feeTokens(config.addresses.token)).active).eq(false);

            await boosterOwnerSecondary.connect(protocolDao.signer).setFeeManager(config.multisigs.treasuryMultisig);
            expect(await booster.feeManager()).eq(config.multisigs.treasuryMultisig);
            await boosterOwnerSecondary.connect(protocolDao.signer).setFeeManager(protocolDao.address);
            expect(await booster.feeManager()).eq(protocolDao.address);

            await boosterOwnerSecondary.connect(protocolDao.signer).setVoteDelegate(ZERO_ADDRESS);
            expect(await booster.voteDelegate()).eq(ZERO_ADDRESS);
            await boosterOwnerSecondary.connect(protocolDao.signer).setVoteDelegate(protocolDao.address);
            expect(await booster.voteDelegate()).eq(protocolDao.address);

            const v3Implementation = await phase6.factories.stashFactory.v3Implementation();
            await boosterOwnerSecondary
                .connect(protocolDao.signer)
                .setStashFactoryImplementation(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS);
            expect(await phase6.factories.stashFactory.v1Implementation()).eq(ZERO_ADDRESS);
            expect(await phase6.factories.stashFactory.v2Implementation()).eq(ZERO_ADDRESS);
            expect(await phase6.factories.stashFactory.v3Implementation()).eq(ZERO_ADDRESS);
            await boosterOwnerSecondary
                .connect(protocolDao.signer)
                .setStashFactoryImplementation(ZERO_ADDRESS, ZERO_ADDRESS, v3Implementation);
            expect(await phase6.factories.stashFactory.v1Implementation()).eq(ZERO_ADDRESS);
            expect(await phase6.factories.stashFactory.v2Implementation()).eq(ZERO_ADDRESS);
            expect(await phase6.factories.stashFactory.v3Implementation()).eq(v3Implementation);
        });
        it("Can call execute", async () => {
            const token = IERC20__factory.connect(config.addresses.token, protocolDao.signer);
            expect(await token.allowance(phase6.boosterOwner.address, phase6.booster.address)).eq(0);

            const calldata = token.interface.encodeFunctionData("approve", [phase6.booster.address, 100]);

            await expect(
                boosterOwnerSecondary.connect(protocolDao.signer).execute(phase6.booster.address, 0, calldata),
            ).to.be.revertedWith("!invalid target");

            await boosterOwnerSecondary.connect(protocolDao.signer).execute(token.address, 0, calldata);
            expect(await token.allowance(phase6.boosterOwner.address, phase6.booster.address)).not.eq(0);
        });
        it("Cannot call removed fns", async () => {
            const callSetFactories = phase6.boosterOwner.interface.encodeFunctionData("setFactories", [
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
            ]);
            await expect(
                boosterOwnerSecondary.connect(protocolDao.signer).execute(phase6.booster.address, 0, callSetFactories),
            ).to.be.revertedWith("!allowed");

            const callSetStashFactoryImpl = phase6.boosterOwner.interface.encodeFunctionData(
                "setStashFactoryImplementation",
                [ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS],
            );
            await expect(
                boosterOwnerSecondary
                    .connect(protocolDao.signer)
                    .execute(phase6.boosterOwner.address, 0, callSetStashFactoryImpl),
            ).to.be.revertedWith("!success");

            const poolInfo = await phase6.booster.poolInfo(1);
            const callSetStashExtraReward = phase6.boosterOwner.interface.encodeFunctionData("setStashExtraReward", [
                poolInfo.stash,
                ZERO_ADDRESS,
            ]);
            await expect(
                boosterOwnerSecondary
                    .connect(protocolDao.signer)
                    .execute(phase6.boosterOwner.address, 0, callSetStashExtraReward),
            ).to.be.revertedWith("!success");

            const callTransferOwnership = phase6.boosterOwner.interface.encodeFunctionData("transferOwnership", [
                ZERO_ADDRESS,
            ]);
            await expect(
                boosterOwnerSecondary
                    .connect(protocolDao.signer)
                    .execute(phase6.boosterOwner.address, 0, callTransferOwnership),
            ).to.be.revertedWith("!success");

            const callSetFeeToken = phase6.boosterOwner.interface.encodeFunctionData("setFeeInfo", [
                ZERO_ADDRESS,
                ZERO_ADDRESS,
            ]);
            await expect(
                boosterOwnerSecondary
                    .connect(protocolDao.signer)
                    .execute(phase6.boosterOwner.address, 0, callSetFeeToken),
            ).to.be.revertedWith("!allowed");

            const callSetImpl = phase6.factories.stashFactory.interface.encodeFunctionData("setImplementation", [
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
            ]);
            await expect(
                boosterOwnerSecondary
                    .connect(protocolDao.signer)
                    .execute(phase6.factories.stashFactory.address, 0, callSetImpl),
            ).to.be.revertedWith("!allowed");

            const callSetExtraReward = new ExtraRewardStashV3__factory().interface.encodeFunctionData(
                "setExtraReward",
                [ZERO_ADDRESS],
            );
            await expect(
                boosterOwnerSecondary.connect(protocolDao.signer).execute(poolInfo.stash, 0, callSetExtraReward),
            ).to.be.revertedWith("!allowed");
        });
        it("Cannot add extra rewards to old pools", async () => {
            await expect(
                boosterOwnerSecondary.connect(protocolDao.signer).setStashExtraReward(1, ZERO_ADDRESS),
            ).to.be.revertedWith("!checkpoint");
        });
        it("Allows BoosterOwnerSecondary owner to be changed", async () => {
            const newOwner = await impersonateAccount(config.multisigs.vestingMultisig);
            let owner = await boosterOwnerSecondary.owner();
            expect(owner).eq(protocolDao.address);

            await boosterOwnerSecondary.connect(protocolDao.signer).transferOwnership(newOwner.address);
            owner = await boosterOwnerSecondary.owner();
            expect(owner).eq(protocolDao.address);
            let pendingOwner = await boosterOwnerSecondary.pendingowner();
            expect(pendingOwner).eq(newOwner.address);

            await expect(boosterOwnerSecondary.connect(protocolDao.signer).acceptOwnership()).to.be.revertedWith(
                "!pendingowner",
            );

            await boosterOwnerSecondary.connect(newOwner.signer).acceptOwnership();
            owner = await boosterOwnerSecondary.owner();
            expect(owner).eq(newOwner.address);
            pendingOwner = await boosterOwnerSecondary.pendingowner();
            expect(pendingOwner).eq(ZERO_ADDRESS);

            await boosterOwnerSecondary.connect(newOwner.signer).transferOwnership(protocolDao.address);
            await boosterOwnerSecondary.connect(protocolDao.signer).acceptOwnership();
        });
        it("Can seal stash implementation", async () => {
            await boosterOwnerSecondary.connect(protocolDao.signer).setSealStashImplementation();
            await expect(
                boosterOwnerSecondary
                    .connect(protocolDao.signer)
                    .setStashFactoryImplementation(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS),
            ).to.be.revertedWith("sealed");
        });
        it("Can set token verifier", async () => {
            expect(await boosterOwnerSecondary.feeTokenVerifier()).eq(ZERO_ADDRESS);
            await boosterOwnerSecondary.connect(protocolDao.signer).setFeeTokenVerifier(protocolDao.address);
            expect(await boosterOwnerSecondary.feeTokenVerifier()).eq(protocolDao.address);
        });
        it("Can verify fee tokens", async () => {
            const mockFeeDistro = await new MockFeeDistributor__factory(deployer).deploy([], []);
            const mockVerifier = await new MockFeeTokenVerifier__factory(deployer).deploy();
            const mockToken0 = await new MockERC20__factory(deployer).deploy("", "", 18, protocolDao.address, 100);
            const mockToken1 = await new MockERC20__factory(deployer).deploy("", "", 18, protocolDao.address, 100);

            // No verifier set
            await boosterOwnerSecondary.connect(protocolDao.signer).setFeeTokenVerifier(ZERO_ADDRESS);
            await boosterOwnerSecondary
                .connect(protocolDao.signer)
                .setFeeInfo(mockToken0.address, mockFeeDistro.address);
            const feeTokenInfo0 = await phase6.booster.feeTokens(mockToken0.address);
            expect(feeTokenInfo0.distro).eq(mockFeeDistro.address);

            // Uses token verifier (false)
            await boosterOwnerSecondary.connect(protocolDao.signer).setFeeTokenVerifier(mockVerifier.address);
            expect(await boosterOwnerSecondary.feeTokenVerifier()).eq(mockVerifier.address);
            await expect(
                boosterOwnerSecondary.connect(protocolDao.signer).setFeeInfo(mockToken1.address, mockFeeDistro.address),
            ).to.be.revertedWith("!verified");

            // Uses token verifier (true)
            await mockVerifier.setValid(true);
            await boosterOwnerSecondary
                .connect(protocolDao.signer)
                .setFeeInfo(mockToken1.address, mockFeeDistro.address);
            const feeTokenInfo1 = await phase6.booster.feeTokens(mockToken1.address);
            expect(feeTokenInfo1.distro).eq(mockFeeDistro.address);
        });
        it("Can set manager", async () => {
            const addr = await deployer.getAddress();
            expect(await boosterOwnerSecondary.manager()).not.eq(addr);
            await boosterOwnerSecondary.connect(protocolDao.signer).setManager(addr);
            expect(await boosterOwnerSecondary.manager()).eq(addr);

            expect(await boosterOwnerSecondary.feeTokenVerifier()).not.eq(ZERO_ADDRESS);
            await boosterOwnerSecondary.connect(deployer).setFeeTokenVerifier(ZERO_ADDRESS);
            expect(await boosterOwnerSecondary.feeTokenVerifier()).eq(ZERO_ADDRESS);
        });
        it("Can seal manager", async () => {
            await boosterOwnerSecondary.connect(protocolDao.signer).setManager(ZERO_ADDRESS);
            await expect(
                boosterOwnerSecondary.connect(protocolDao.signer).setManager(protocolDao.address),
            ).to.be.revertedWith("sealed");
            expect(await boosterOwnerSecondary.manager()).eq(ZERO_ADDRESS);
        });
    });

    /* ---------------------------------------------------------------------
     * PoolManagerV4 Functional tests
     * --------------------------------------------------------------------- */

    describe("PoolManagerV4 functional tests", () => {
        let ankrPid: BigNumberish;

        it("Can not call setOperator", async () => {
            await expect(phase6.poolManagerSecondaryProxy.setOperator(protocolDao.address)).to.be.revertedWith(
                "!owner",
            );
        });
        it("Can not call forceAddPool", async () => {
            await expect(
                phase6.poolManagerSecondaryProxy.forceAddPool(protocolDao.address, protocolDao.address, 3),
            ).to.be.revertedWith("!op");
        });
        it("Add a new pool", async () => {
            const poolLengthBefore = await phase6.booster.poolLength();

            // Test protect add pool
            await poolManagerV4.connect(protocolDao.signer).setProtectPool(true);
            expect(await poolManagerV4.protectAddPool()).eq(true);
            await expect(poolManagerV4["addPool(address)"](ankrWethGaugeAddress)).to.be.revertedWith("!auth");
            await poolManagerV4.connect(protocolDao.signer).setProtectPool(false);
            expect(await poolManagerV4.protectAddPool()).eq(false);

            await poolManagerV4["addPool(address)"](ankrWethGaugeAddress);
            const poolLengthAfter = await phase6.booster.poolLength();
            expect(poolLengthAfter.sub(poolLengthBefore)).eq(1);
            // Save RBN USDC PID
            ankrPid = poolLengthBefore;
        });
        it("New pool ExtraRewardStashV3 has correct config", async () => {
            const { voterProxy } = phase2;
            const { booster, factories } = phase6;
            const poolInfo = await booster.poolInfo(ankrPid);
            expect(poolInfo.gauge).eq(ankrWethGaugeAddress);
            expect(poolInfo.stash).not.eq(ZERO_ADDRESS);

            await booster.earmarkRewards(ankrPid);

            const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer);
            expect(await stash.pid()).eq(ankrPid);
            expect(await stash.operator()).eq(booster.address);
            expect(await stash.staker()).eq(voterProxy.address);
            expect(await stash.gauge()).eq(ankrWethGaugeAddress);
            expect(await stash.rewardFactory()).eq(factories.rewardFactory.address);
            expect(await stash.hasRedirected()).eq(true);

            const stashTokenImplementation = StashToken__factory.connect(
                await stash.stashTokenImplementation(),
                deployer,
            );
            expect(await stashTokenImplementation.stash()).eq(stash.address);
            expect(await stashTokenImplementation.isImplementation()).eq(true);
            await expect(stashTokenImplementation.init(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(
                "isImplementation",
            );
        });
    });

    /* ---------------------------------------------------------------------
     * General Functional tests
     * --------------------------------------------------------------------- */

    describe("Deposit and withdraw from existing pool", () => {
        const pid = cowWethPid;

        let lpToken: ERC20;
        let rewards: BaseRewardPool4626;
        let whale: Account;
        let whaleBalance: BigNumber;

        before(async () => {
            const poolInfo = await getPoolInfo(pid);
            whale = poolInfo.whale;
            lpToken = poolInfo.lpToken.connect(whale.signer);
            rewards = poolInfo.rewards.connect(whale.signer);
        });

        it("Deposit into COW/WETH pool", async () => {
            await lpToken.approve(phase6.booster.address, ethers.constants.MaxUint256);
            whaleBalance = await lpToken.balanceOf(whale.address);
            expect(whaleBalance, "No whale balance").gt(0);
            await phase6.booster.connect(whale.signer).depositAll(pid, true);
            expect(await rewards.balanceOf(whale.address)).eq(whaleBalance);
        });
        it("Call earmarkRewards for COW/WETH pool", async () => {
            const histBefore = await crv.balanceOf(rewards.address);
            await withMockMinter(async () => {
                await phase6.booster.earmarkRewards(pid);
            });
            const histAfter = await crv.balanceOf(rewards.address);
            expect(histAfter).gt(histBefore);
        });
        it("Claim rewards", async () => {
            await increaseTime(ONE_WEEK.mul(2));
            const earned = await rewards.earned(whale.address);
            const crvBalBefore = await crv.balanceOf(whale.address);
            await rewards["getReward()"]();
            const crvBalAfter = await crv.balanceOf(whale.address);
            const actualEarned = crvBalAfter.sub(crvBalBefore);
            expect(actualEarned).eq(earned);
            expect(actualEarned).gt(0);
        });
        it("Withdraw from COW/WETH pool", async () => {
            await rewards.connect(whale.signer).withdrawAllAndUnwrap(true);
            expect(await lpToken.balanceOf(whale.address)).eq(whaleBalance);
        });
    });

    describe("Deposit and withdraw from new pool", () => {
        let whale: Account;
        let pid: number;
        let stash: ExtraRewardStashV3;
        let lpToken: ERC20;
        let whaleBalance: BigNumber;
        let rewards: BaseRewardPool4626;

        before(async () => {
            pid = (await phase6.booster.poolLength()).toNumber();
            whale = await impersonateAccount(compWstethLpWhale);
            whales[pid] = whale;
        });
        it("Add DOLA/USDC pool", async () => {
            await poolManagerV4.connect(protocolDao.signer)["addPool(address)"](compWstethGaugeAddress);

            const poolInfo = await getPoolInfo(pid);
            lpToken = poolInfo.lpToken.connect(whale.signer);
            rewards = poolInfo.rewards.connect(whale.signer);
            stash = poolInfo.stash;
        });
        it("Deposit into DOLA/USDC pool", async () => {
            await lpToken.approve(phase6.booster.address, ethers.constants.MaxUint256);
            whaleBalance = await lpToken.balanceOf(whale.address);
            expect(whaleBalance, "No whale balance").gt(0);
            await phase6.booster.connect(whale.signer).depositAll(pid, true);
            expect(await rewards.balanceOf(whale.address)).eq(whaleBalance);
        });
        it("Add extra rewards", async () => {
            const extraRewardsFactory = new MockERC20__factory(deployer);
            const extraRewards = await extraRewardsFactory.deploy("", "", 18, stash.address, 100);
            expect(await extraRewards.balanceOf(stash.address)).eq(simpleToExactAmount(100));
            await boosterOwnerSecondary.connect(protocolDao.signer).setStashExtraReward(pid, extraRewards.address);

            const info = await stash.tokenInfo(extraRewards.address);
            expect(info.token).eq(extraRewards.address);

            const stashToken = StashToken__factory.connect(info.stashToken, deployer);
            expect(await stashToken.stash()).eq(stash.address);
            expect(await stashToken.isImplementation()).eq(false);
            expect(await stashToken.operator()).eq(phase6.booster.address);
            expect(await stashToken.rewardPool()).eq(info.rewardAddress);
            expect(await stashToken.baseToken()).eq(extraRewards.address);
            expect(await stashToken.isValid()).eq(true);
        });
        it("Call earmarkRewards for DOLA/USDC pool", async () => {
            const virtualRewardsAddress = await rewards.extraRewards(0);
            const virtualRewards = VirtualBalanceRewardPool__factory.connect(virtualRewardsAddress, protocolDao.signer);

            const stashToken = StashToken__factory.connect(await virtualRewards.rewardToken(), deployer);
            const baseToken = ERC20__factory.connect(await stashToken.baseToken(), deployer);

            // Simple check to confirm virtualRewards.rewardToken is a stash token
            expect(await stashToken.isValid()).eq(true);

            const stashTokenTotalSupplyBefore = await stashToken.totalSupply();
            const baseTokenBalanceBefore = await baseToken.balanceOf(stashToken.address);
            const vHistBefore = await virtualRewards.historicalRewards();

            const histBefore = await crv.balanceOf(rewards.address);
            await withMockMinter(async () => {
                await phase6.booster.earmarkRewards(pid);
            });
            const histAfter = await crv.balanceOf(rewards.address);
            expect(histAfter).gt(histBefore);

            const vHistAfter = await virtualRewards.historicalRewards();
            expect(vHistAfter).gt(vHistBefore);

            const stashTokenTotalSupplyAfter = await stashToken.totalSupply();
            const stashTokenTotalSupplyDelta = stashTokenTotalSupplyAfter.sub(stashTokenTotalSupplyBefore);
            expect(stashTokenTotalSupplyDelta).eq(simpleToExactAmount(100));

            const baseTokenBalanceAfter = await baseToken.balanceOf(stashToken.address);
            expect(baseTokenBalanceAfter.sub(baseTokenBalanceBefore)).eq(simpleToExactAmount(100));
        });
        it("Cannot call donate on virtual rewards", async () => {
            const virtualRewardsAddress = await rewards.extraRewards(0);
            const virtualRewards = VirtualBalanceRewardPool__factory.connect(virtualRewardsAddress, protocolDao.signer);
            await expect(virtualRewards.donate(100)).to.be.revertedWith("SafeERC20: low-level call failed");
        });
        it("Claim rewards", async () => {
            await increaseTime(ONE_WEEK.mul(2));
            const earned = await rewards.earned(whale.address);
            const crvBalBefore = await crv.balanceOf(whale.address);
            await rewards["getReward(address,bool)"](whale.address, false);
            const crvBalAfter = await crv.balanceOf(whale.address);
            expect(crvBalAfter.sub(crvBalBefore)).eq(earned);
        });
        it("Claim extra rewards", async () => {
            await increaseTime(ONE_WEEK.mul(2));
            const virtualRewardsAddress = await rewards.extraRewards(0);
            const virtualRewards = VirtualBalanceRewardPool__factory.connect(virtualRewardsAddress, whale.signer);

            const stashToken = StashToken__factory.connect(await virtualRewards.rewardToken(), deployer);
            const baseToken = ERC20__factory.connect(await stashToken.baseToken(), deployer);

            const stashTokenTotalSupplyBefore = await stashToken.totalSupply();
            const baseTokenBalanceBefore = await baseToken.balanceOf(stashToken.address);
            const whaleBaseTokenBalanceBefore = await baseToken.balanceOf(whale.address);

            await virtualRewards["getReward()"]();

            const stashTokenTotalSupplyAfter = await stashToken.totalSupply();
            const baseTokenBalanceAfter = await baseToken.balanceOf(stashToken.address);
            const whaleBaseTokenBalanceAfter = await baseToken.balanceOf(whale.address);

            const whaleRewards = whaleBaseTokenBalanceAfter.sub(whaleBaseTokenBalanceBefore);
            // Div by fullscale to deal with rounding precision in solidity
            expect(whaleRewards.div(fullScale)).eq(99);

            expect(stashTokenTotalSupplyBefore.sub(stashTokenTotalSupplyAfter)).eq(whaleRewards);
            expect(baseTokenBalanceBefore.sub(baseTokenBalanceAfter)).eq(whaleRewards);
        });
        it("Withdraw from the DOLA/USDC pool", async () => {
            const balance = await rewards.balanceOf(whale.address);
            const bptBalBefore = await lpToken.balanceOf(whale.address);
            await rewards.connect(whale.signer).withdrawAllAndUnwrap(true);
            const bptBalAfter = await lpToken.balanceOf(whale.address);
            expect(bptBalAfter.sub(bptBalBefore)).eq(balance);
        });
    });

    describe("Shutdown and re-add wstETH pool", () => {
        let poolInfo: PoolInfoStruct;
        let newPid: number;
        let whale: Account;
        let whaleBalance: BigNumber;

        let lpToken: ERC20;
        let rewards: BaseRewardPool4626;

        before(async () => {
            whale = await impersonateAccount(wstEthWhale);
            newPid = (await phase6.booster.poolLength()).toNumber();
            whales[newPid] = whale;
        });

        it("Shutdown pool", async () => {
            poolInfo = await phase6.booster.poolInfo(wstEthPid);
            const bptToken = IERC20__factory.connect(poolInfo.lptoken, deployer);
            const balanceBefore = await bptToken.balanceOf(phase6.booster.address);
            await poolManagerV4.connect(protocolDao.signer).shutdownPool(wstEthPid);
            const balanceAfter = await bptToken.balanceOf(phase6.booster.address);
            expect(balanceAfter).gt(balanceBefore);
        });
        it("Re-add wstETH pool", async () => {
            await poolManagerV4.connect(protocolDao.signer)["addPool(address)"](poolInfo.gauge);
            const newPoolInfo = await phase6.booster.poolInfo(newPid);
            expect(newPoolInfo.gauge).eq(poolInfo.gauge);
            expect(newPoolInfo.lptoken).eq(poolInfo.lptoken);

            const pi = await getPoolInfo(newPid);
            lpToken = pi.lpToken.connect(whale.signer);
            rewards = pi.rewards.connect(whale.signer);
        });
        it("Deposit into new wstETH pool", async () => {
            await lpToken.approve(phase6.booster.address, ethers.constants.MaxUint256);
            whaleBalance = await lpToken.balanceOf(whale.address);
            expect(whaleBalance, "No whale balance").gt(0);
            await phase6.booster.connect(whale.signer).depositAll(newPid, true);
            expect(await rewards.balanceOf(whale.address)).eq(whaleBalance);
        });
        it("Call earmarkRewards for wstETH pool", async () => {
            const histBefore = await crv.balanceOf(rewards.address);
            await withMockMinter(async () => {
                await phase6.booster.earmarkRewards(newPid);
            });
            const histAfter = await crv.balanceOf(rewards.address);
            expect(histAfter).gt(histBefore);
        });
        it("Withdraw from wstETH pool", async () => {
            const balance = await rewards.balanceOf(whale.address);
            const bptBalBefore = await lpToken.balanceOf(whale.address);
            await rewards.connect(whale.signer).withdrawAllAndUnwrap(true);
            const bptBalAfter = await lpToken.balanceOf(whale.address);
            expect(bptBalAfter.sub(bptBalBefore)).eq(balance);
        });
    });

    /* ---------------------------------------------------------------------
     * System Shutdown
     * --------------------------------------------------------------------- */

    describe.skip("System shutdown", () => {
        it("Can shutdown system", async () => {
            const poolLength = await phase6.booster.poolLength();
            await Promise.all(
                Array(poolLength.toNumber())
                    .fill(null)
                    .map(async (_, i) => {
                        const poolInfo = await phase6.booster.poolInfo(i);
                        if (!poolInfo.shutdown) {
                            await poolManagerV4.connect(protocolDao.signer).shutdownPool(i);
                        }
                    }),
            );

            await poolManagerV4.connect(protocolDao.signer).shutdownSystem();
            await boosterOwnerSecondary.connect(protocolDao.signer).shutdownSystem();
            expect(await phase6.booster.isShutdown()).eq(true);
        });
    });
});
