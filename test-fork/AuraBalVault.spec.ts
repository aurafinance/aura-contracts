import hre, { network } from "hardhat";
import { expect } from "chai";
import { BigNumberish, ethers } from "ethers";
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
    VirtualShareRewardPool,
    FeeForwarder,
    FeeForwarder__factory,
} from "../types";
import { simpleToExactAmount } from "../test-utils/math";
import { Phase2Deployed, Phase6Deployed } from "../scripts/deploySystem";
import { impersonate, impersonateAccount, increaseTime } from "../test-utils";
import { ZERO_ADDRESS, DEAD_ADDRESS, ONE_WEEK } from "../test-utils/constants";
import { deployVault } from "../scripts/deployVault";
import { config as mainnetConfig } from "../tasks/deploy/mainnet-config";
import { config as goerliConfig } from "../tasks/deploy/goerli-config";
import { deployContract } from "../tasks/utils";

// Constants
const DEBUG = false;
const DEPOSIT_AMOUNT = simpleToExactAmount(10);

const testConfigs = {
    mainnet: {
        forkBlock: 16570000,
        auraBalWhale: "0xcaab2680d81df6b3e2ece585bb45cee97bf30cd7",
        auraWhale: "0xc9Cea7A3984CefD7a8D2A0405999CB62e8d206DC",
        bbaUsdWhale: "0xe649B71783d5008d10a96b6871e3840a398d4F06",
        config: mainnetConfig,
        deployer: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    },
    goerli: {
        forkBlock: 8550494,
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
    let auraRewards: VirtualShareRewardPool;

    let dao: Account;
    let deployer: Account;
    let depositor: Account;
    let account: Account;
    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    let bVault: IBalancerVault;
    let wethToken: IERC20;
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

        await getAuraBal(deployer.address, parseEther("50"));
        await getAuraBal(depositor.address, parseEther("50"));
    });

    /* -------------------------------------------------------------------------
     * Tests
     * ----------------------------------------------------------------------- */

    describe("deploy reward forwarder", () => {
        it("deploy reward forwarder", async () => {
            feeForwarder = await deployContract<FeeForwarder>(
                hre,
                new FeeForwarder__factory(deployer.signer),
                "FeeForwarder",
                [config.multisigs.daoMultisig],
                {},
                false,
            );
        });
        it("update booster platform to reward forwarder", async () => {
            expect(await phase6.booster.treasury()).not.eq(feeForwarder.address);
            await phase6.booster.connect(dao.signer).setTreasury(feeForwarder.address);
            expect(await phase6.booster.treasury()).eq(feeForwarder.address);
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
        it("forward rewards from reward forwarder", async () => {
            const amount = simpleToExactAmount(10);
            const balBefore = await phase2.cvx.balanceOf(feeForwarder.address);
            await getAura(feeForwarder.address, amount);
            const balAfter = await phase2.cvx.balanceOf(feeForwarder.address);
            expect(balAfter).gt(0);
            expect(balAfter.sub(balBefore)).eq(amount);

            const sBalBefore = await phase2.cvx.balanceOf(strategy.address);
            await feeForwarder.connect(dao.signer).forward(vault.address, phase2.cvx.address, balAfter);
            const sBalAfter = await phase2.cvx.balanceOf(strategy.address);

            expect(sBalAfter.sub(sBalBefore)).eq(balAfter);
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
            expect(await vault.callIncentive()).eq(500);
            expect(await vault.MAX_CALL_INCENTIVE()).eq(500);
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
            expect(await auraRewards.vault()).eq(vault.address);
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
            await expect(strategy.harvest(deployer.address, 0)).to.be.revertedWith("Vault calls only");
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
            expect(sharesAfter.sub(sharesBefore)).eq(shares);
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
        it("Multiple depoists");
        it("Multiple withdraw");
    });

    describe("BBUSDHandler", async () => {
        it("sell bbUSD for auraBAL");
    });
});
