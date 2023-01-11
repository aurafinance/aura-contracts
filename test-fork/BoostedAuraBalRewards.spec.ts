import { expect } from "chai";
import { BigNumberish } from "ethers";
import hre, { network } from "hardhat";
import { formatEther, parseEther } from "ethers/lib/utils";

import { deployContract } from "../tasks/utils";
import { config } from "../tasks/deploy/mainnet-config";
import { impersonate, impersonateAccount } from "../test-utils/fork";
import { Phase2Deployed } from "../scripts/deploySystem";
import { Account, MockERC20__factory, BoostedAuraBalRewardPool, BoostedAuraBalRewardPool__factory } from "../types";
import { increaseTime, ONE_WEEK, simpleToExactAmount } from "../test-utils";

const DEBUG = false;
const FORK_BLOCK = 16370000;
const SLIPPAGE_OUTPUT_BPS = 9950;

const DEPLOYER = "0xa28ea848801da877e1844f954ff388e857d405e5";

describe("BoostedAuraBalRewards", () => {
    let dao: Account;
    let deployer: Account;
    let phase2: Phase2Deployed;
    let rewards: BoostedAuraBalRewardPool;

    const getEth = async (recipient: string) => {
        const ethWhale = await impersonate(config.addresses.weth);
        await ethWhale.sendTransaction({
            to: recipient,
            value: simpleToExactAmount(1),
        });
    };

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

    // Force a reward harvest by transfering BAL tokens directly
    // to the reward contract the contract will then swap it for
    // auraBAL and queue it for rewards
    async function forceHarvestRewards(amount = parseEther("100")) {
        await getBal(rewards.address, amount);
        await rewards.harvest(SLIPPAGE_OUTPUT_BPS);
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
        it("Deploy BoostedAuraBalRewards", async () => {
            rewards = await deployContract<BoostedAuraBalRewardPool>(
                hre,
                new BoostedAuraBalRewardPool__factory(deployer.signer),
                "BoostedAuraBalRewardPool",
                [
                    phase2.cvxCrv.address,
                    phase2.cvxCrv.address,
                    dao.address,
                    dao.address,
                    config.addresses.balancerVault,
                    config.addresses.token,
                    config.addresses.weth,
                    config.addresses.balancerPoolId,
                    phase2.cvxCrvRewards.address,
                ],
                {},
                DEBUG,
            );
        });
        it("Add BoostedAuraBalRewards to Booster platform rewards", async () => {
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
            const [rawBalanceBefore] = await rewards.rawBalanceOf(deployer.address);
            const underlyingStakedBalanceBefore = await phase2.cvxCrvRewards.balanceOf(rewards.address);

            const stakeAmount = simpleToExactAmount(10);
            await phase2.cvxCrv.connect(deployer.signer).approve(rewards.address, stakeAmount);
            await rewards.connect(deployer.signer).stake(stakeAmount);

            const stakedBalance = (await rewards.balanceOf(deployer.address)).sub(stakedBalanceBefore);
            const rawBalance = (await rewards.rawBalanceOf(deployer.address))[0].sub(rawBalanceBefore);
            console.log("Raw balance:", formatEther(rawBalance));
            console.log("Staked balance:", formatEther(stakedBalance));
            expect(stakedBalance).eq(stakeAmount);
            expect(rawBalance).eq(stakeAmount);

            const totalSupply = (await rewards.totalSupply()).sub(totalSupplyBefore);
            console.log("Total supply:", formatEther(totalSupply));
            expect(totalSupply).eq(stakedBalance);

            const underlyingStakedBalance = (await phase2.cvxCrvRewards.balanceOf(rewards.address)).sub(
                underlyingStakedBalanceBefore,
            );
            expect(underlyingStakedBalance).eq(stakeAmount);
        });
        it("Time increases (26 weeks) balance and total supply", async () => {
            const totalSupplyBefore = await rewards.totalSupply();
            const stakedBalanceBefore = await rewards.balanceOf(deployer.address);
            const [rawBalanceBefore] = await rewards.rawBalanceOf(deployer.address);

            await increaseTime(ONE_WEEK.mul(26));
            await rewards.reviewTimestamp(deployer.address);

            const stakedBalanceNow = await rewards.balanceOf(deployer.address);
            const expectedStakedBalance = stakedBalanceBefore.add(stakedBalanceBefore.mul(30).div(100));
            const stakedBalanceDelta = stakedBalanceNow.sub(stakedBalanceBefore);
            console.log("Staked balance (before):", formatEther(stakedBalanceBefore));
            console.log("Staked balance (after):", formatEther(stakedBalanceNow));
            expect(expectedStakedBalance).eq(stakedBalanceNow);

            const totalSupply = await rewards.totalSupply();
            console.log("Total supply (before):", formatEther(totalSupplyBefore));
            console.log("Total supply (after):", formatEther(totalSupply));
            expect(totalSupply).eq(totalSupplyBefore.add(stakedBalanceDelta));

            expect((await rewards.rawBalanceOf(deployer.address))[0]).eq(rawBalanceBefore);
        });
    });

    describe("Harvest", () => {
        it("Harvest rewards and convert to auraBAL", async () => {
            const auraBalBalanceBefore = await phase2.cvxCrv.balanceOf(rewards.address);
            await forceHarvestRewards();
            const auraBalBalanceAfter = await phase2.cvxCrv.balanceOf(rewards.address);
            const auraBalBalance = auraBalBalanceAfter.sub(auraBalBalanceBefore);
            console.log("auraBAL balance:", formatEther(auraBalBalance));
            expect(auraBalBalance).gt(0);
        });
    });

    describe("Claim rewards", () => {
        it("Get rewards for depositor");
    });

    describe("Withdraw", () => {
        // TODO:
    });
});
