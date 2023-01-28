import { expect } from "chai";
import { BigNumberish } from "ethers";
import hre, { network } from "hardhat";
import { formatEther, parseEther } from "ethers/lib/utils";

import { deployContract } from "../tasks/utils";
import { config } from "../tasks/deploy/mainnet-config";
import { impersonate, impersonateAccount } from "../test-utils/fork";
import { Phase2Deployed } from "../scripts/deploySystem";
import { Account, MockERC20__factory, AuraBalBoostedRewardPool, AuraBalBoostedRewardPool__factory } from "../types";
import { simpleToExactAmount } from "../test-utils";

const DEBUG = false;
const FORK_BLOCK = 16370000;
const SLIPPAGE_OUTPUT_BPS = 9950;

const DEPLOYER = "0xa28ea848801da877e1844f954ff388e857d405e5";

async function impersonateAndTransfer(tokenAddress: string, from: string, to: string, amount: BigNumberish) {
    const tokenWhaleSigner = await impersonateAccount(from);
    const token = MockERC20__factory.connect(tokenAddress, tokenWhaleSigner.signer);
    await token.transfer(to, amount);
}

describe("AuraBalBoostedRewards", () => {
    let dao: Account;
    let deployer: Account;
    let phase2: Phase2Deployed;
    let rewards: AuraBalBoostedRewardPool;

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
    async function forceHarvestRewards(amount = parseEther("10")) {
        await getBal(rewards.address, amount);
        await getBBaUSD(rewards.address, amount);
        await getAura(rewards.address, amount);
        const crv = MockERC20__factory.connect(config.addresses.token, dao.signer);
        const feeToken = MockERC20__factory.connect(config.addresses.feeToken, dao.signer);

        expect(await crv.balanceOf(rewards.address), " crv balance").to.be.gt(0);
        expect(await feeToken.balanceOf(rewards.address), " feeToken balance").to.be.gt(0);
        expect(await phase2.cvx.balanceOf(rewards.address), " cvx balance").to.be.gt(0);

        await rewards.connect(dao.signer).harvest(SLIPPAGE_OUTPUT_BPS);

        expect(await crv.balanceOf(rewards.address), " crv balance").to.be.eq(0);
        expect(await feeToken.balanceOf(rewards.address), " feeToken balance").to.be.eq(0);
        expect(await phase2.cvx.balanceOf(rewards.address), " cvx balance").to.be.eq(0);
    }

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

        deployer = await impersonateAccount(DEPLOYER, true);
        dao = await impersonateAccount(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(dao.signer);

        await getAuraBal(deployer.address, parseEther("100"));
    });

    describe("Deploy and configured", () => {
        it("Deploy AuraBalBoostedRewards", async () => {
            rewards = await deployContract<AuraBalBoostedRewardPool>(
                hre,
                new AuraBalBoostedRewardPool__factory(deployer.signer),
                "AuraBalBoostedRewardPool",
                [
                    dao.address,
                    phase2.cvxCrv.address,
                    phase2.cvxCrvRewards.address,
                    config.addresses.balancerVault,
                    config.addresses.token,
                    config.addresses.weth,
                    config.addresses.balancerPoolId,
                ],
                {},
                DEBUG,
            );
        });
        it("Add AuraBalBoostedRewards to Booster platform rewards", async () => {
            await phase2.booster.connect(dao.signer).setTreasury(rewards.address);
            expect(await phase2.booster.treasury()).eq(rewards.address);
        });
        it("Set approvals", async () => {
            await rewards.connect(dao.signer).setApprovals();
        });
    });

    describe("Deposits", () => {
        it("Deposit increments user balance and total supply", async () => {
            const totalSupplyBefore = await rewards.totalSupply();
            const stakedBalanceBefore = await rewards.balanceOf(deployer.address);
            const underlyingStakedBalanceBefore = await phase2.cvxCrvRewards.balanceOf(rewards.address);

            const stakeAmount = simpleToExactAmount(10);
            await phase2.cvxCrv.connect(deployer.signer).approve(rewards.address, stakeAmount);
            await rewards.connect(deployer.signer).stake(stakeAmount);

            const stakedBalance = (await rewards.balanceOf(deployer.address)).sub(stakedBalanceBefore);

            console.log("Staked balance:", formatEther(stakedBalance));
            expect(stakedBalance).eq(stakeAmount);

            const totalSupply = (await rewards.totalSupply()).sub(totalSupplyBefore);
            console.log("Total supply:", formatEther(totalSupply));
            expect(totalSupply).eq(stakedBalance);

            const underlyingStakedBalance = (await phase2.cvxCrvRewards.balanceOf(rewards.address)).sub(
                underlyingStakedBalanceBefore,
            );
            expect(underlyingStakedBalance).eq(stakeAmount);
        });
    });

    describe("Harvest", () => {
        it("Harvest rewards and convert to auraBAL", async () => {
            const auraBalBalanceBefore = await phase2.cvxCrvRewards.balanceOf(rewards.address);
            await forceHarvestRewards();
            const auraBalBalanceAfter = await phase2.cvxCrvRewards.balanceOf(rewards.address);
            const auraBalBalance = auraBalBalanceAfter.sub(auraBalBalanceBefore);
            console.log("auraBAL balance:", formatEther(auraBalBalance));
            expect(auraBalBalance).gt(0);
        });
    });

    describe("Claim rewards", () => {
        it("Get rewards for depositor");
    });

    describe("Withdraw", () => {
        it("Withdraw stake from pool");
    });
});
