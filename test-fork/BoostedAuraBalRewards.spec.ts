import { expect } from "chai";
import { BigNumberish, ethers } from "ethers";
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

const feeTokenRewardPool = "0x62D7d772b2d909A0779d15299F4FC87e34513c6d";
const RETH = "0xae78736Cd615f374D3085123A210448E74Fc6393";
const WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";

const AURA_ETH_POOL_ID = "0xcfca23ca9ca720b6e98e3eb9b6aa0ffc4a5c08b9000200000000000000000274";

const BBUSD_RETH_POOL_ID = "0x334c96d792e4b26b841d28f53235281cec1be1f200020000000000000000038a";
const RETH_WETH_POOL_ID = "0x1e19cf2d73a72ef1332c882f20534b6519be0276000200000000000000000112";

const BBUSD_WSTETH_POOL_ID = "0x25accb7943fd73dda5e23ba6329085a3c24bfb6a000200000000000000000387";
const WSTETH_WETH_POOL_ID = "0x32296969ef14eb0c6d29669c550d4a0449130230000200000000000000000080";

function encodeFeeTokenRethWethPath() {
    const poolIds = [BBUSD_RETH_POOL_ID, RETH_WETH_POOL_ID];
    const assetIns = [config.addresses.feeToken, RETH];
    const bbusdToWethPath = ethers.utils.defaultAbiCoder.encode(["bytes32[]", "address[]"], [poolIds, assetIns]);
    return bbusdToWethPath;
}
function encodeFeeTokenWstethWethPath() {
    const poolIds = [BBUSD_WSTETH_POOL_ID, WSTETH_WETH_POOL_ID];
    const assetIns = [config.addresses.feeToken, WSTETH];
    const bbusdToWethPath = ethers.utils.defaultAbiCoder.encode(["bytes32[]", "address[]"], [poolIds, assetIns]);
    return bbusdToWethPath;
}

async function impersonateAndTransfer(tokenAddress: string, from: string, to: string, amount: BigNumberish) {
    const tokenWhaleSigner = await impersonateAccount(from);
    const token = MockERC20__factory.connect(tokenAddress, tokenWhaleSigner.signer);
    await token.transfer(to, amount);
}

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
    async function forceHarvestRewards(amount = parseEther("100")) {
        await getBal(rewards.address, amount);
        await getBBaUSD(rewards.address, amount);
        await getAura(rewards.address, amount);
        const crv = MockERC20__factory.connect(config.addresses.token, dao.signer);
        const feeToken = MockERC20__factory.connect(config.addresses.feeToken, dao.signer);

        expect(await crv.balanceOf(rewards.address), " crv balance").to.be.gt(0);
        expect(await feeToken.balanceOf(rewards.address), " feeToken balance").to.be.gt(0);
        expect(await phase2.cvx.balanceOf(rewards.address), " cvx balance").to.be.gt(0);

        await rewards.harvest(SLIPPAGE_OUTPUT_BPS);

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
        it("Add FeeToken as extra reward", async () => {
            await rewards.connect(dao.signer).addExtraReward(feeTokenRewardPool);
            expect(await rewards.extraRewards(0), "fee Token as extra reward").to.be.eq(feeTokenRewardPool);
        });

        it("Set approvals", async () => {
            await rewards.connect(dao.signer).setApprovals();
            // It should be able to setApprovals more than once, in case the allowance of a token goes to 0.
            await rewards.connect(dao.signer).setApprovals();
        });
        it("Set balancer paths", async () => {
            const tx = await rewards
                .connect(dao.signer)
                .setBalancerPath(config.addresses.feeToken, encodeFeeTokenRethWethPath());
            await expect(tx).to.emit(rewards, "SetBalancerPath").withArgs(config.addresses.feeToken);
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
        it("Harvest rewards and convert to auraBAL with a different swap path", async () => {
            // Update to a new path
            const tx = await rewards
                .connect(dao.signer)
                .setBalancerPath(config.addresses.feeToken, encodeFeeTokenWstethWethPath());
            await expect(tx).to.emit(rewards, "SetBalancerPath").withArgs(config.addresses.feeToken);

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
