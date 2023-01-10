import { expect } from "chai";
import { BigNumberish } from "ethers";
import hre, { network } from "hardhat";
import { formatEther, parseEther } from "ethers/lib/utils";

import { deployContract } from "../tasks/utils";
import { config } from "../tasks/deploy/mainnet-config";
import { impersonate, impersonateAccount } from "../test-utils/fork";
import { Phase2Deployed } from "../scripts/deploySystem";
import { Account, MockERC20__factory, BoostedAuraBalRewardPool, BoostedAuraBalRewardPool__factory } from "../types";
import { simpleToExactAmount } from "../test-utils";

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
        rewards.harvest(SLIPPAGE_OUTPUT_BPS);
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
    });

    describe("Deposits", () => {
        it("Deposit increments user balance and total supply");
        it("Time increases balance and total supply");
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
