import hre, { network } from "hardhat";
import { expect } from "chai";
import { BigNumber, BigNumberish, ethers } from "ethers";
import { parseEther } from "ethers/lib/utils";

import {
    Account,
    IBalancerVault,
    MockERC20__factory,
    IBalancerVault__factory,
    IERC20,
    IERC20__factory,
    AuraBalVault,
    AuraBalStrategy,
    BBUSDHandlerv2,
    FeeForwarder,
    BalancerSwapsHandler,
    BalancerSwapsHandler__factory,
    VirtualBalanceRewardPool,
} from "../types";
import { simpleToExactAmount } from "../test-utils/math";
import { Phase2Deployed, Phase6Deployed } from "../scripts/deploySystem";
import { impersonate, impersonateAccount, increaseTime } from "../test-utils";
import { fullScale, ZERO_ADDRESS, DEAD_ADDRESS, ONE_WEEK } from "../test-utils/constants";
import { deployFeeForwarder, deployVault } from "../scripts/deployVault";
import { config as mainnetConfig } from "../tasks/deploy/mainnet-config";
import { config as goerliConfig } from "../tasks/deploy/goerli-config";
import { deployContract } from "../tasks/utils";

// Constants
const DEBUG = false;
const DEPOSIT_AMOUNT = simpleToExactAmount(10);

const testConfigs = {
    mainnet: {
        forkBlock: 16725720,
        auraBalWhale: "0xcaab2680d81df6b3e2ece585bb45cee97bf30cd7",
        auraWhale: "0xc9Cea7A3984CefD7a8D2A0405999CB62e8d206DC",
        bbaUsdWhale: "0x43b650399F2E4D6f03503f44042fabA8F7D73470",
        config: mainnetConfig,
        deployer: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    },
    goerli: {
        forkBlock: 8572175,
        auraBalWhale: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
        auraWhale: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
        bbaUsdWhale: "0xE0a171587b1Cae546E069A943EDa96916F5EE977",
        config: goerliConfig,
        deployer: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    },
};

const TEST_CONFIG = process.env.TEST_CONFIG;
const testConfig = testConfigs[TEST_CONFIG || "mainnet"];
if (!testConfig) throw new Error(`Test config not found for value: ${TEST_CONFIG}`);
const config = testConfig.config;

async function impersonateAndTransfer(tokenAddress: string, from: string, to: string, amount: BigNumberish) {
    const tokenWhaleSigner = await impersonateAccount(from);
    const token = MockERC20__factory.connect(tokenAddress, tokenWhaleSigner.signer);
    await token.transfer(to, amount);
}

describe("AuraBalVault", () => {
    let feeForwarder: FeeForwarder;
    let vault: AuraBalVault;
    let strategy: AuraBalStrategy;
    let bbusdHandler: BBUSDHandlerv2;
    let auraRewards: VirtualBalanceRewardPool;

    let dao: Account;
    let deployer: Account;
    let depositor: Account;
    let account: Account;
    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    let bVault: IBalancerVault;
    let wethToken: IERC20;
    let feeToken: IERC20;
    let balToken: IERC20;
    let balWethBptToken: IERC20;

    /* -------------------------------------------------------------------------
     * Helper functions
     * ----------------------------------------------------------------------- */

    async function getEth(recipient: string) {
        const ethWhale = await impersonate(config.addresses.weth);
        await ethWhale.sendTransaction({
            to: recipient,
            value: simpleToExactAmount(1),
        });
    }

    async function getAuraBal(to: string, amount: BigNumberish) {
        const auraBalWhaleAddr = testConfig.auraBalWhale;
        const auraBalWhale = await impersonateAccount(auraBalWhaleAddr);
        await phase2.cvxCrv.connect(auraBalWhale.signer).transfer(to, amount);
    }

    async function getBal(to: string, amount: BigNumberish) {
        await getEth(config.addresses.balancerVault);
        const tokenWhaleSigner = await impersonateAccount(config.addresses.balancerVault);
        const crv = MockERC20__factory.connect(config.addresses.token, tokenWhaleSigner.signer);
        await crv.transfer(to, amount);
    }

    async function getAura(to: string, amount: BigNumberish) {
        const whaleAddress = testConfig.auraWhale;
        await impersonateAndTransfer(phase2.cvx.address, whaleAddress, to, amount);
    }

    async function getBBaUSD(to: string, amount: BigNumberish) {
        const whaleAddress = testConfig.bbaUsdWhale;
        await impersonateAndTransfer(config.addresses.feeToken, whaleAddress, to, amount);
    }

    // Force a reward harvest by transferring BAL, BBaUSD and Aura tokens directly
    // to the reward contract the contract will then swap it for
    // auraBAL and queue it for rewards
    async function forceHarvestRewards(amount = parseEther("10"), signer = dao.signer) {
        await getBal(strategy.address, amount);
        await getBBaUSD(strategy.address, amount);
        await getAura(strategy.address, amount);
        const crv = MockERC20__factory.connect(config.addresses.token, signer);
        const feeToken = MockERC20__factory.connect(config.addresses.feeToken, signer);

        expect(await crv.balanceOf(strategy.address), " crv balance").to.be.gt(0);
        expect(await feeToken.balanceOf(strategy.address), " feeToken balance").to.be.gt(0);
        expect(await phase2.cvx.balanceOf(strategy.address), " cvx balance").to.be.gt(0);

        await vault.connect(signer)["harvest(uint256)"](0);

        expect(await crv.balanceOf(strategy.address), " crv balance").to.be.eq(0);
        expect(await feeToken.balanceOf(strategy.address), " feeToken balance").to.be.eq(0);
        expect(await phase2.cvx.balanceOf(strategy.address), " cvx balance").to.be.eq(0);
    }

    /* -------------------------------------------------------------------------
     * Before
     * ----------------------------------------------------------------------- */

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: testConfig.forkBlock,
                    },
                },
            ],
        });

        const accounts = await hre.ethers.getSigners();

        deployer = await impersonateAccount(testConfig.deployer, true);
        depositor = await impersonateAccount(await accounts[0].getAddress(), true);
        account = await impersonateAccount(await accounts[1].getAddress(), true);
        dao = await impersonateAccount(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(dao.signer);
        phase6 = await config.getPhase6(dao.signer);

        bVault = IBalancerVault__factory.connect(config.addresses.balancerVault, dao.signer);
        wethToken = IERC20__factory.connect(config.addresses.weth, dao.signer);
        balToken = IERC20__factory.connect(config.addresses.token, dao.signer);
        balWethBptToken = IERC20__factory.connect(config.addresses.tokenBpt, dao.signer);
        feeToken = IERC20__factory.connect(config.addresses.feeToken, dao.signer);

        await getAuraBal(deployer.address, parseEther("50"));
        await getAuraBal(depositor.address, parseEther("50"));
    });

    /* -------------------------------------------------------------------------
     * Tests
     * ----------------------------------------------------------------------- */

    describe("deploy reward forwarder", () => {
        it("deploy reward forwarder", async () => {
            if (TEST_CONFIG === "goerli") {
                const result = await deployFeeForwarder(config, hre, deployer.signer, false);
                feeForwarder = result.feeForwarder;
            } else {
                const result = await config.getFeeForwarder(deployer.signer);
                feeForwarder = result.feeForwarder;
            }
        });
        it("update booster platform to reward forwarder", async () => {
            expect(await phase6.booster.treasury()).not.eq(feeForwarder.address);
            await phase6.booster.connect(dao.signer).setTreasury(feeForwarder.address);
            expect(await phase6.booster.treasury()).eq(feeForwarder.address);
        });
        it("earmarkRewards with platform", async () => {
            await phase6.booster.earmarkRewards(1);
        });
    });

    describe("deploy vault", () => {
        it("deploy vault", async () => {
            if (TEST_CONFIG === "goerli") {
                const result = await config.getAuraBalVault(deployer.signer);

                vault = result.vault;
                strategy = result.strategy;
                bbusdHandler = result.bbusdHandler;
                auraRewards = result.auraRewards;
            } else {
                const result = await deployVault(config, hre, deployer.signer, DEBUG);

                vault = result.vault;
                strategy = result.strategy;
                bbusdHandler = result.bbusdHandler;
                auraRewards = result.auraRewards;
            }
        });
        it("update booster platform to vault", async () => {
            expect(await phase6.booster.treasury()).not.eq(vault.address);
            await phase6.booster.connect(dao.signer).setTreasury(vault.address);
            expect(await phase6.booster.treasury()).eq(vault.address);
        });
    });

    describe("check initial configuration", () => {
        it("check strategy", async () => {
            expect(await vault.strategy()).eq(strategy.address);
            await expect(vault.setStrategy(DEAD_ADDRESS)).to.be.revertedWith("Strategy already set");
        });
        it("check reward tokens", async () => {
            expect(await strategy.totalRewardTokens()).eq(1);
            expect(await strategy.rewardTokens(0)).eq(config.addresses.feeToken);
            expect(await strategy.rewardHandlers(config.addresses.feeToken)).eq(bbusdHandler.address);
        });
        it("set harvester", async () => {
            expect(await vault.authorizedHarvesters(dao.address)).eq(false);
            await vault.updateAuthorizedHarvesters(dao.address, true);
            expect(await vault.authorizedHarvesters(dao.address)).eq(true);
        });
        it("check AURA as extra reward", async () => {
            expect(await vault.extraRewardsLength()).eq(1);
            expect(await vault.extraRewards(0)).eq(auraRewards.address);
        });
        it("check approvals", async () => {
            const max = ethers.constants.MaxUint256;
            expect(await phase2.cvxCrv.allowance(strategy.address, phase6.cvxCrvRewards.address)).eq(max);
            expect(await balToken.allowance(strategy.address, bVault.address)).eq(max);
            expect(await wethToken.allowance(strategy.address, bVault.address)).eq(max);
            expect(await balWethBptToken.allowance(strategy.address, bVault.address)).eq(max);
        });
    });

    describe("check configurations", () => {
        it("check feeForwarder is configured correctly", async () => {
            expect(await feeForwarder.owner()).eq(dao.address);
        });
        it("check vault is configured correctly", async () => {
            expect(await vault.isHarvestPermissioned()).eq(true);
            expect(await vault.FEE_DENOMINATOR()).eq(10000);
            expect(await vault.underlying()).eq(phase2.cvxCrv.address);
            expect(await vault.strategy()).eq(strategy.address);
            expect(await vault.name()).eq(`Staked ${await phase2.cvxCrv.name()}`);
            expect(await vault.symbol()).eq(`stk${await phase2.cvxCrv.symbol()}`);
        });
        it("check auraBAL strategy is configured correctly", async () => {
            expect(await strategy.balVault()).eq(bVault.address);
            expect(await strategy.WETH_TOKEN()).eq(wethToken.address);
            expect(await strategy.BAL_TOKEN()).eq(balToken.address);
            expect(await strategy.BAL_ETH_POOL_TOKEN()).eq(balWethBptToken.address);
        });
        it("check bbusd handler is configured correctly", async () => {
            expect(await bbusdHandler.owner()).eq(deployer.address);
            expect(await bbusdHandler.pendingOwner()).eq(ZERO_ADDRESS);
            expect(await bbusdHandler.token()).eq(config.addresses.feeToken);
            expect(await bbusdHandler.strategy()).eq(strategy.address);
            expect(await bbusdHandler.balVault()).eq(config.addresses.balancerVault);
        });
        it("check AURA virtual share pool is configured correctly", async () => {
            expect(await auraRewards.deposits()).eq(vault.address);
            expect(await auraRewards.rewardToken()).eq(phase2.cvx.address);
            expect(await auraRewards.operator()).eq(strategy.address);
        });
    });

    describe("check protected functions", () => {
        const OWNER_ERROR = "Ownable: caller is not the owner";
        it("FeeForwarder", async () => {
            const connectedVault = feeForwarder.connect(account.signer);
            await expect(connectedVault.forward(ZERO_ADDRESS, ZERO_ADDRESS, 0)).to.be.revertedWith(OWNER_ERROR);
        });
        it("AuraBalVault", async () => {
            const connectedVault = vault.connect(account.signer);
            await expect(connectedVault.updateAuthorizedHarvesters(ZERO_ADDRESS, true)).to.be.revertedWith(OWNER_ERROR);
            await expect(connectedVault.setHarvestPermissions(true)).to.be.revertedWith(OWNER_ERROR);
            await expect(connectedVault.setStrategy(phase2.cvxCrv.address)).to.be.revertedWith(OWNER_ERROR);
            await expect(connectedVault.addExtraReward(phase2.cvxCrv.address)).to.be.revertedWith(OWNER_ERROR);
            await expect(connectedVault.clearExtraRewards()).to.be.revertedWith(OWNER_ERROR);
        });
        it("AuraBalStrategy", async () => {
            const connectedStrat = strategy.connect(account.signer);
            await expect(connectedStrat.addRewardToken(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(OWNER_ERROR);
            await expect(connectedStrat.updateRewardToken(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(OWNER_ERROR);
        });
        it("BBUSDHandler", async () => {
            const connectedHandler = bbusdHandler.connect(account.signer);
            await expect(connectedHandler.setPendingOwner(ZERO_ADDRESS)).to.be.revertedWith("owner only");
            await expect(connectedHandler.applyPendingOwner()).to.be.revertedWith("owner only");
            await expect(connectedHandler.rescueToken(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith("owner only");
        });
        it("AuraRewards", async () => {
            const connectedAuraRewards = auraRewards.connect(account.signer);
            await expect(connectedAuraRewards.stake(ZERO_ADDRESS, 0)).to.be.revertedWith("!authorized");
            await expect(connectedAuraRewards.withdraw(ZERO_ADDRESS, 0)).to.be.revertedWith("!authorized");
            await expect(connectedAuraRewards.queueNewRewards(100)).to.be.revertedWith("!authorized");
        });
    });

    describe("Setters", () => {
        it("AuraBalVault", async () => {
            expect(await vault.withdrawalPenalty()).eq(100);
            await vault.setWithdrawalPenalty(0);
            expect(await vault.withdrawalPenalty()).eq(0);
        });
    });

    describe("deposit auraBAL", () => {
        it("can deposit into vault", async () => {
            await phase2.cvxCrv.connect(depositor.signer).approve(vault.address, ethers.constants.MaxUint256);
            await vault.connect(depositor.signer).deposit(DEPOSIT_AMOUNT, depositor.address);
            expect(await vault.totalSupply()).eq(DEPOSIT_AMOUNT);
            expect(await vault.balanceOf(depositor.address)).eq(DEPOSIT_AMOUNT);
            expect(await vault.balanceOfUnderlying(depositor.address)).eq(DEPOSIT_AMOUNT);
        });
    });

    describe("harvesting rewards", () => {
        it("can call harvest", async () => {
            const auraBalanceBefore = await phase2.cvx.balanceOf(auraRewards.address);
            const stakedBalanceBefore = await phase6.cvxCrvRewards.balanceOf(strategy.address);
            const totalUnderlyingBefore = await vault.totalUnderlying();
            await forceHarvestRewards(simpleToExactAmount(100));
            const stakedBalanceAfter = await phase6.cvxCrvRewards.balanceOf(strategy.address);
            const auraBalanceAfter = await phase2.cvx.balanceOf(auraRewards.address);
            const totalUnderlyingAfter = await vault.totalUnderlying();

            expect(totalUnderlyingAfter).gt(totalUnderlyingBefore);
            expect(stakedBalanceAfter).gt(stakedBalanceBefore);
            expect(auraBalanceAfter).gt(auraBalanceBefore);

            // Depositor balances
            const underlyingBalance = await vault.balanceOfUnderlying(depositor.address);
            expect(underlyingBalance).gt(DEPOSIT_AMOUNT);
        });
        it("can not call harvest while protected", async () => {
            expect(await vault.totalSupply()).gt(0);
            await expect(vault.connect(account.signer)["harvest()"]()).to.be.revertedWith("permissioned harvest");
        });
        it("can not call harvest on the strategy", async () => {
            await expect(strategy.harvest(0)).to.be.revertedWith("Vault calls only");
        });
    });

    describe("claim AURA rewards", () => {
        it("can claim extra AURA rewards", async () => {
            await increaseTime(ONE_WEEK);
            const earned = await auraRewards.earned(depositor.address);
            expect(earned).gt(0);
            const balBefore = await phase2.cvx.balanceOf(depositor.address);
            await auraRewards.connect(depositor.signer)["getReward()"]();
            const balAfter = await phase2.cvx.balanceOf(depositor.address);
            expect(balAfter.sub(balBefore)).gte(earned);
        });
    });

    describe("withdraw auraBAL", () => {
        it("can withdraw rewards", async () => {
            const balanceOfUnderlying = await vault.balanceOfUnderlying(depositor.address);
            const balanceBefore = await phase2.cvxCrv.balanceOf(depositor.address);
            const shares = await vault.balanceOf(depositor.address);
            await vault.connect(depositor.signer).redeem(shares, depositor.address, depositor.address);
            const balanceAfter = await phase2.cvxCrv.balanceOf(depositor.address);
            expect(balanceAfter.sub(balanceBefore)).gte(balanceOfUnderlying);
            expect(balanceAfter.sub(balanceBefore)).gt(DEPOSIT_AMOUNT);
        });
    });

    describe("Forward rewards from feeForwarder", () => {
        it("forward rewards", async () => {
            const amount = simpleToExactAmount(10);
            const balBefore = await phase2.cvx.balanceOf(feeForwarder.address);
            await getAura(feeForwarder.address, amount);
            await getBal(feeForwarder.address, amount);
            const balAfter = await phase2.cvx.balanceOf(feeForwarder.address);
            expect(balAfter).gt(0);
            expect(balAfter.sub(balBefore)).eq(amount);

            const sBalBefore = await phase2.cvx.balanceOf(strategy.address);
            const bBalBefore = await balToken.balanceOf(strategy.address);
            await feeForwarder.connect(dao.signer).forward(vault.address, phase2.cvx.address, amount);
            await feeForwarder.connect(dao.signer).forward(vault.address, config.addresses.token, amount);
            const sBalAfter = await phase2.cvx.balanceOf(strategy.address);
            const bBalAfter = await balToken.balanceOf(strategy.address);

            expect(sBalAfter.sub(sBalBefore)).eq(amount);
            expect(bBalAfter.sub(bBalBefore)).eq(amount);

            const underlyingBefore = await vault.totalUnderlying();
            await vault.connect(dao.signer)["harvest()"]();
            const underlyingAfter = await vault.totalUnderlying();
            expect(underlyingAfter).gt(underlyingBefore);
        });
    });

    describe("mint stkauraBAL", () => {
        it("mint to sender with totalSupply == 0", async () => {
            expect(await vault.totalSupply()).eq(0);
            const shares = await vault.convertToShares(DEPOSIT_AMOUNT);
            const preview = await vault.previewMint(shares);
            expect(DEPOSIT_AMOUNT).eq(preview);

            const totalAssetsBefore = await vault.totalAssets();
            const sharesBefore = await vault.balanceOf(depositor.address);
            await vault.connect(depositor.signer).mint(shares, depositor.address);
            const sharesAfter = await vault.balanceOf(depositor.address);
            const totalAssetsAfter = await vault.totalAssets();

            expect(sharesAfter.sub(sharesBefore)).eq(shares);
            expect(totalAssetsAfter.sub(totalAssetsBefore)).eq(DEPOSIT_AMOUNT);
            expect(await vault.maxRedeem(depositor.address)).eq(shares);
        });
        it("mint to sender with totalSupply > 0", async () => {
            expect(await vault.totalSupply()).gt(0);
            const shares = await vault.convertToShares(DEPOSIT_AMOUNT);
            const sharesBefore = await vault.balanceOf(depositor.address);
            await vault.connect(depositor.signer).mint(shares, depositor.address);
            const sharesAfter = await vault.balanceOf(depositor.address);
            // TODO: fix precision?
            expect(shares).eq(sharesAfter.sub(sharesBefore).add(1));
        });
    });

    describe("redeem auraBAL", () => {
        it("redeem to sender", async () => {
            const shares = (await vault.balanceOf(depositor.address)).div(2);
            const expectedAssets = await vault.convertToAssets(shares);

            const assetsBefore = await phase2.cvxCrv.balanceOf(depositor.address);
            await vault.connect(depositor.signer).redeem(shares, depositor.address, depositor.address);
            const assetsAfter = await phase2.cvxCrv.balanceOf(depositor.address);
            expect(assetsAfter.sub(assetsBefore)).eq(expectedAssets);
        });
        it("redeem as approved spender", async () => {
            const redeemer = account;
            const shares = await vault.balanceOf(depositor.address);
            const allowanceBefore = await vault.allowance(depositor.address, redeemer.address);
            await vault.connect(depositor.signer).approve(redeemer.address, shares);
            const allowanceAfter = await vault.allowance(depositor.address, redeemer.address);
            expect(allowanceAfter.sub(allowanceBefore)).eq(shares);

            const expectedAssets = await vault.convertToAssets(shares);
            const assetsBefore = await phase2.cvxCrv.balanceOf(redeemer.address);
            await vault.connect(redeemer.signer).redeem(shares, redeemer.address, depositor.address);
            const assetsAfter = await phase2.cvxCrv.balanceOf(redeemer.address);
            expect(assetsAfter.sub(assetsBefore)).eq(expectedAssets);
        });
    });

    describe("Multiple user deposits", () => {
        let ALICE: Account;
        let DAVID: Account;
        let SARAH: Account;
        let PETER: Account;

        const amount = simpleToExactAmount(2);
        let harvestAmount: BigNumber;

        before(async () => {
            const accounts = await hre.ethers.getSigners();
            [ALICE, DAVID, SARAH, PETER] = await Promise.all(
                accounts.map(async account => impersonateAccount(await account.getAddress())),
            );
        });

        it("Multiple equal depoists", async () => {
            expect(await vault.totalSupply()).eq(0);

            await getAuraBal(ALICE.address, amount);
            await getAuraBal(DAVID.address, amount);

            await phase2.cvxCrv.connect(ALICE.signer).approve(vault.address, amount);
            await vault.connect(ALICE.signer).deposit(amount, ALICE.address);
            await phase2.cvxCrv.connect(DAVID.signer).approve(vault.address, amount);
            await vault.connect(DAVID.signer).deposit(amount, DAVID.address);

            const aliceBal = await vault.balanceOf(ALICE.address);
            const aliceUnderBal = await vault.balanceOfUnderlying(ALICE.address);
            const davidBal = await vault.balanceOf(DAVID.address);
            const davidUnderBal = await vault.balanceOfUnderlying(DAVID.address);

            expect(aliceBal).eq(amount);
            expect(aliceBal).eq(davidBal);
            expect(aliceUnderBal).eq(davidUnderBal);
        });
        it("2x deposit", async () => {
            const depositAmount = amount.mul(2);
            await getAuraBal(SARAH.address, depositAmount);
            await phase2.cvxCrv.connect(SARAH.signer).approve(vault.address, depositAmount);
            await vault.connect(SARAH.signer).deposit(depositAmount, SARAH.address);

            const bal = await vault.balanceOf(SARAH.address);
            const underBal = await vault.balanceOfUnderlying(SARAH.address);
            expect(bal).eq(depositAmount);
            expect(underBal).eq(depositAmount);
        });
        it("4x deposit", async () => {
            const depositAmount = amount.mul(4);
            await getAuraBal(PETER.address, depositAmount);
            await phase2.cvxCrv.connect(PETER.signer).approve(vault.address, depositAmount);
            await vault.connect(PETER.signer).deposit(depositAmount, PETER.address);

            const bal = await vault.balanceOf(PETER.address);
            const underBal = await vault.balanceOfUnderlying(PETER.address);
            expect(bal).eq(depositAmount);
            expect(underBal).eq(depositAmount);
        });
        it("Harvest", async () => {
            await getBal(strategy.address, simpleToExactAmount(10));
            const balBefore = await phase6.cvxCrvRewards.balanceOf(strategy.address);
            expect(await balToken.balanceOf(strategy.address)).eq(simpleToExactAmount(10));
            await vault.connect(dao.signer)["harvest()"]();
            const balAfter = await phase6.cvxCrvRewards.balanceOf(strategy.address);
            expect(await balToken.balanceOf(strategy.address)).eq(0);

            harvestAmount = balAfter.sub(balBefore);
            expect(harvestAmount).gt(0);
        });
        it("Multiple withdraw", async () => {
            const aliceBalanceBefore = await phase2.cvxCrv.balanceOf(ALICE.address);
            const davidBalanceBefore = await phase2.cvxCrv.balanceOf(DAVID.address);
            const sarahBalanceBefore = await phase2.cvxCrv.balanceOf(SARAH.address);
            const peterBalanceBefore = await phase2.cvxCrv.balanceOf(PETER.address);

            const aliceAuraBalanceBefore = await phase2.cvx.balanceOf(ALICE.address);
            const davidAuraBalanceBefore = await phase2.cvx.balanceOf(DAVID.address);
            const sarahAuraBalanceBefore = await phase2.cvx.balanceOf(SARAH.address);
            const peterAuraBalanceBefore = await phase2.cvx.balanceOf(PETER.address);

            await increaseTime(ONE_WEEK.mul(2));

            await vault
                .connect(ALICE.signer)
                .redeem(await vault.balanceOf(ALICE.address), ALICE.address, ALICE.address);
            await vault
                .connect(DAVID.signer)
                .redeem(await vault.balanceOf(DAVID.address), DAVID.address, DAVID.address);
            await vault
                .connect(SARAH.signer)
                .redeem(await vault.balanceOf(SARAH.address), SARAH.address, SARAH.address);
            await vault
                .connect(PETER.signer)
                .redeem(await vault.balanceOf(PETER.address), PETER.address, PETER.address);

            const compare = (a: BigNumber, b: BigNumber, y: BigNumberish = "10") => {
                // Round it down to deal with off by 1 kek
                expect(a.div(y)).eq(b.div(y));
            };

            // Aura rewards
            await auraRewards.connect(ALICE.signer)["getReward()"]();
            const aliceAuraBalance = (await phase2.cvx.balanceOf(ALICE.address)).sub(aliceAuraBalanceBefore);
            await auraRewards.connect(DAVID.signer)["getReward()"]();
            const davidAuraBalance = (await phase2.cvx.balanceOf(DAVID.address)).sub(davidAuraBalanceBefore);
            compare(aliceAuraBalance, davidAuraBalance, fullScale);

            await auraRewards.connect(SARAH.signer)["getReward()"]();
            const sarahAuraBalance = (await phase2.cvx.balanceOf(SARAH.address)).sub(sarahAuraBalanceBefore);
            compare(sarahAuraBalance, davidAuraBalance.mul(2), fullScale);

            await auraRewards.connect(PETER.signer)["getReward()"]();
            const peterAuraBalance = (await phase2.cvx.balanceOf(PETER.address)).sub(peterAuraBalanceBefore);
            compare(peterAuraBalance, sarahAuraBalance.mul(2), fullScale);

            // CvxCrv Rewards
            const aliceBalance = (await phase2.cvxCrv.balanceOf(ALICE.address)).sub(aliceBalanceBefore);
            const davidBalance = (await phase2.cvxCrv.balanceOf(DAVID.address)).sub(davidBalanceBefore);
            compare(aliceBalance, davidBalance);

            const sarahBalance = (await phase2.cvxCrv.balanceOf(SARAH.address)).sub(sarahBalanceBefore);
            compare(sarahBalance, davidBalance.mul(2));

            const peterBalance = (await phase2.cvxCrv.balanceOf(PETER.address)).sub(peterBalanceBefore);
            compare(peterBalance, sarahBalance.mul(2));

            expect(await vault.totalSupply()).eq(0);
        });
    });

    describe("BBUSDHandler", async () => {
        let handler: BalancerSwapsHandler;
        const strategyAddress = deployer.address;
        before(async () => {
            // Deploy BalancerSwapsHandler
            handler = await deployContract<BalancerSwapsHandler>(
                hre,
                new BalancerSwapsHandler__factory(deployer.signer),
                "BBUSDHandlerv3",
                [
                    config.addresses.feeToken,
                    strategyAddress,
                    config.addresses.balancerVault,
                    config.addresses.weth,
                    phase2.cvx.address,
                    phase2.cvxCrv.address,
                    {
                        poolIds: config.addresses.feeTokenHandlerPath.poolIds,
                        assetsIn: config.addresses.feeTokenHandlerPath.assetsIn,
                    },
                ],
                {},
                false,
            );
        });
        it("fund handler with bbUSD", async () => {
            const amount = simpleToExactAmount(100);
            await getBBaUSD(handler.address, amount);
            expect(await feeToken.balanceOf(handler.address)).gt(0);
        });
        it("sell bbUSD for WETH", async () => {
            const wethBefore = await wethToken.balanceOf(strategyAddress);
            expect(wethBefore).eq(0);

            await handler.connect(deployer.signer).sell();
            const wethAfter = await wethToken.balanceOf(strategyAddress);
            const bbUSDAfter = await feeToken.balanceOf(handler.address);
            expect(wethAfter).gt(wethBefore);
            expect(bbUSDAfter).eq(0);
        });
    });
});
