import hre, { ethers, network } from "hardhat";
import { Signer } from "ethers";
import { impersonateAccount } from "../test-utils";
import { config } from "../tasks/deploy/mainnet-config";
import { expect } from "chai";
import {
    IERC20__factory,
    PoolManagerV3__factory,
    Account,
    IERC20,
    BaseRewardPool4626__factory,
    BaseRewardPool4626,
    GaugeMigrator,
    GaugeMigrator__factory,
} from "../types";
import { deployContract } from "../tasks/utils";
import { Phase6Deployed, Phase8Deployed } from "../scripts/deploySystem";

const debug = false;
const gaugeAddress = "0xcd4722b7c24c29e0413bdcd9e51404b4539d14ae";

const rewardPoolWhaleAddress = "0x39D787fdf7384597C7208644dBb6FDa1CcA4eBdf";

describe("Add same Gauge twice", () => {
    let protocolDao: Signer;
    let oldGauge: string;
    let phase6: Phase6Deployed;
    let phase8: Phase8Deployed;
    let newPid: number;
    let gaugeMigrator: GaugeMigrator;
    let depositToken: IERC20;
    let lpWhale: Account;
    let rewardPoolWhale: Account;
    let lpToken: IERC20;
    let crvRewards: BaseRewardPool4626;

    const setup = async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 16734857,
                    },
                },
            ],
        });

        await impersonateAccount(config.multisigs.daoMultisig);
        protocolDao = await ethers.getSigner(config.multisigs.daoMultisig);
        phase6 = await config.getPhase6(protocolDao);
        phase8 = await config.getPhase8(protocolDao);

        const lpWhaleAddress = "0x21ac89788d52070D23B8EaCEcBD3Dc544178DC60";
        lpWhale = await impersonateAccount(lpWhaleAddress);

        rewardPoolWhale = await impersonateAccount(rewardPoolWhaleAddress);
        lpToken = await IERC20__factory.connect("0x32296969ef14eb0c6d29669c550d4a0449130230", lpWhale.signer);
    };

    describe("PoolManager", () => {
        const oldPid = 29;

        before(() => setup());
        it("shut down old pool", async () => {
            const poolManager = PoolManagerV3__factory.connect(phase8.poolManagerV4.address, protocolDao);
            const oldPool = await phase6.booster.poolInfo(oldPid);
            oldGauge = oldPool.gauge;
            await poolManager.shutdownPool(oldPid);
        });
        it("add old lp token pool", async () => {
            const poolManager = PoolManagerV3__factory.connect(phase8.poolManagerV4.address, protocolDao);
            await poolManager["addPool(address)"](gaugeAddress);
            const poolSize = await phase6.booster.poolLength();

            newPid = poolSize.toNumber() - 1;
            const resp = await phase6.booster.poolInfo(newPid);

            expect(resp.gauge, "new gauge != gauge ").eq(oldGauge);

            depositToken = IERC20__factory.connect(resp.token, lpWhale.signer);
            crvRewards = BaseRewardPool4626__factory.connect(resp.crvRewards, lpWhale.signer);
        });
        it("deposit lp tokens to new pool", async () => {
            const amount = await lpToken.balanceOf(lpWhale.address);
            const crvRewardsBefore = await crvRewards.balanceOf(lpWhale.address);

            expect(amount).gt(0);
            expect(crvRewardsBefore, "crvRewards balance before").eq(0);
            await lpToken.approve(phase6.booster.address, amount);
            const stake = true;

            await phase6.booster.connect(lpWhale.signer).deposit(newPid, amount, stake);

            const depositTokenBalance = await crvRewards.balanceOf(lpWhale.address);
            expect(depositTokenBalance, "crvRewards balance").eq(amount);
        });
        it("claim rewards", async () => {
            await crvRewards["getReward()"]();
        });
        it("withdraw lp tokens", async () => {
            const amount = await crvRewards.balanceOf(lpWhale.address);
            await crvRewards["withdraw(uint256,bool)"](amount, true);
            await depositToken.approve(phase6.booster.address, amount);

            await phase6.booster.connect(lpWhale.signer).withdraw(newPid, amount);

            const lpTokenBalance = await lpToken.balanceOf(lpWhale.address);
            expect(lpTokenBalance).eq(amount);
        });

        const assertGaugeMigration = async (account: Account, fromPid: number, toPid: number): Promise<void> => {
            const fromPool = await phase6.booster.poolInfo(fromPid);
            const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool.crvRewards, account.signer);
            const fromCrvRewardsBefore = await fromCrvRewards.balanceOf(account.address);

            const toPool = await phase6.booster.poolInfo(toPid);
            const toCrvRewards = BaseRewardPool4626__factory.connect(toPool.crvRewards, account.signer);
            const toCrvRewardsBefore = await toCrvRewards.balanceOf(account.address);

            // Given the user has balance and wish  to migrate to different pool with same underlying asset
            expect(fromPool.lptoken, "lptokens").to.be.eq(toPool.lptoken);
            expect(fromPid, "pid").to.not.eq(toPid);
            expect(fromCrvRewardsBefore, "fromCrvRewards balance before").gt(0);
            console.log("from: ", fromPid, fromCrvRewardsBefore.toString());
            // extraRewards
            await fromCrvRewards.approve(gaugeMigrator.address, fromCrvRewardsBefore);

            // When it migrates it's full position
            await gaugeMigrator.connect(account.signer).migrate(fromPid, toPid);

            // Then previous lp position must be zero and new position must hold all its previous liquidity
            const fromCrvRewardsAfter = await fromCrvRewards.balanceOf(account.address);
            const toCrvRewardsAfter = await toCrvRewards.balanceOf(account.address);
            console.log("to: ", toPid, toCrvRewardsAfter.toString());

            expect(fromCrvRewardsAfter, "from crvRewards balance").to.be.eq(0);
            expect(toCrvRewardsAfter, "to crvRewards balance").to.be.eq(toCrvRewardsBefore.add(fromCrvRewardsBefore));
        };
        it("deploy GaugeMigrator", async () => {
            gaugeMigrator = await deployContract<GaugeMigrator>(
                hre,
                new GaugeMigrator__factory(protocolDao),
                "GaugeMigrator",
                [phase6.booster.address],
                {},
                debug,
            );
        });
        it("migrates full lp position oldPid => newPid", async () => {
            await assertGaugeMigration(rewardPoolWhale, oldPid, newPid);
        });
    });
});
