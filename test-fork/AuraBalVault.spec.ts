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
} from "../types";
import { simpleToExactAmount } from "../test-utils/math";
import { Phase2Deployed, Phase6Deployed } from "../scripts/deploySystem";
import { impersonate, impersonateAccount, increaseTime } from "../test-utils";
import { ZERO_ADDRESS, DEAD_ADDRESS, ONE_WEEK } from "../test-utils/constants";
import { deployVault } from "../scripts/deployVault";
import { config } from "../tasks/deploy/mainnet-config";

// Constants
const DEBUG = false;
const FORK_BLOCK = 16370000;
const DEPOSIT_AMOUNT = simpleToExactAmount(10);
const DEPLOYER = "0xA28ea848801da877E1844F954FF388e857d405e5";

async function impersonateAndTransfer(tokenAddress: string, from: string, to: string, amount: BigNumberish) {
    const tokenWhaleSigner = await impersonateAccount(from);
    const token = MockERC20__factory.connect(tokenAddress, tokenWhaleSigner.signer);
    await token.transfer(to, amount);
}

describe("AuraBalVault", () => {
    let vault: AuraBalVault;
    let strategy: AuraBalStrategy;
    let bbusdHandler: BBUSDHandlerv2;
    let auraRewards: VirtualShareRewardPool;

    let dao: Account;
    let deployer: Account;
    let depositor: Account;
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
        const auraBalWhaleAddr = "0xcaab2680d81df6b3e2ece585bb45cee97bf30cd7";
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
        const whaleAddress = "0xc9Cea7A3984CefD7a8D2A0405999CB62e8d206DC";
        await impersonateAndTransfer(phase2.cvx.address, whaleAddress, to, amount);
    }

    async function getBBaUSD(to: string, amount: BigNumberish) {
        const whaleAddress = "0xe649B71783d5008d10a96b6871e3840a398d4F06";
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
                        blockNumber: FORK_BLOCK,
                    },
                },
            ],
        });

        const accounts = await hre.ethers.getSigners();

        deployer = await impersonateAccount(DEPLOYER, true);
        depositor = await impersonateAccount(await accounts[0].getAddress(), true);
        dao = await impersonateAccount(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(dao.signer);
        phase6 = await config.getPhase6(dao.signer);

        bVault = IBalancerVault__factory.connect(config.addresses.balancerVault, dao.signer);
        wethToken = IERC20__factory.connect(config.addresses.weth, dao.signer);
        balToken = IERC20__factory.connect(config.addresses.token, dao.signer);
        balWethBptToken = IERC20__factory.connect(config.addresses.tokenBpt, dao.signer);

        await getAuraBal(deployer.address, parseEther("100"));
        await getAuraBal(depositor.address, parseEther("100"));
    });

    /* -------------------------------------------------------------------------
     * Tests
     * ----------------------------------------------------------------------- */

    it("deploy", async () => {
        const result = await deployVault(hre, deployer.signer, DEBUG);

        vault = result.vault;
        strategy = result.strategy;
        bbusdHandler = result.bbusdHandler;
        auraRewards = result.auraRewards;
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
        it("check vault is configured correctly", async () => {
            expect(await vault.isHarvestPermissioned()).eq(true);
            expect(await vault.callIncentive()).eq(500);
            expect(await vault.MAX_CALL_INCENTIVE()).eq(500);
            expect(await vault.FEE_DENOMINATOR()).eq(10000);
            expect(await vault.underlying()).eq(phase2.cvxCrv.address);
            expect(await vault.strategy()).eq(strategy.address);
            expect(await vault.name()).eq("Staked Aura BAL");
            expect(await vault.symbol()).eq("stkauraBAL");
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

    describe("deposit auraBAL", () => {
        it("can deposit into vault", async () => {
            await phase2.cvxCrv.connect(depositor.signer).approve(vault.address, ethers.constants.MaxUint256);
            await vault.connect(depositor.signer).deposit(DEPOSIT_AMOUNT);
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
            await expect(vault["harvest()"]()).to.be.revertedWith("permissioned harvest");
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
            await vault.connect(depositor.signer).withdrawAll();
            const balanceAfter = await phase2.cvxCrv.balanceOf(depositor.address);
            expect(balanceAfter.sub(balanceBefore)).gte(balanceOfUnderlying);
            expect(balanceAfter.sub(balanceBefore)).gt(DEPOSIT_AMOUNT);
        });
    });
});
