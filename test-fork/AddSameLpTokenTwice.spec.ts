import hre, { ethers, network } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { impersonateAccount, simpleToExactAmount } from "../test-utils";
import { config } from "../tasks/deploy/mainnet-config";
import { expect } from "chai";
import {
    MockCurveGauge,
    MockCurveGauge__factory,
    MockGaugeController__factory,
    IERC20__factory,
    PoolManagerV3__factory,
    Account,
    IERC20,
    BaseRewardPool4626__factory,
    BaseRewardPool4626,
    MockERC20__factory,
    GaugeMigrator,
    GaugeMigrator__factory,
} from "../types";
import { deployContract } from "../tasks/utils";
import { Phase2Deployed } from "../scripts/deploySystem";

const debug = false;
const balWhaleAddress = "0xff052381092420b7f24cc97fded9c0c17b2cbbb9";

describe("Add same LP Token twice", () => {
    let protocolDao: Signer;
    let gauge: string;
    let phase2: Phase2Deployed;
    let newPid: BigNumberish;
    let mockGauge: MockCurveGauge;
    let gaugeMigrator: GaugeMigrator;
    let depositToken: IERC20;
    let lpWhale: Account;
    let lpToken: IERC20;
    let crvRewards: BaseRewardPool4626;

    const setup = async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15500000,
                    },
                },
            ],
        });

        await impersonateAccount(config.multisigs.daoMultisig);
        protocolDao = await ethers.getSigner(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(protocolDao);

        const lpWhaleAddress = "0xf346592803eb47cb8d8fa9f90b0ef17a82f877e0";
        lpWhale = await impersonateAccount(lpWhaleAddress);
    };

    describe("PoolManager", () => {
        const oldPid = 0;

        before(() => setup());
        it("get old LP token", async () => {
            const poolInfo = await phase2.booster.poolInfo(oldPid);
            lpToken = IERC20__factory.connect(poolInfo.lptoken, lpWhale.signer);
            gauge = poolInfo.gauge;
        });
        it("mock gauge controller", async () => {
            // Mock gauge controller with one that returns 1 when you query the weight
            await network.provider.send("hardhat_setCode", [
                config.addresses.gaugeController,
                MockGaugeController__factory.bytecode,
            ]);
        });
        it("deploy fake gauge with old LP Token", async () => {
            mockGauge = await deployContract<MockCurveGauge>(
                hre,
                new MockCurveGauge__factory(protocolDao),
                "MockCurveGauge",
                ["MockCurveGauge", "MockCurveGauge", lpToken.address, []],
                {},
                debug,
            );
        });
        it("add old lp token pool", async () => {
            const poolManager = PoolManagerV3__factory.connect(phase2.poolManager.address, protocolDao);
            await poolManager["addPool(address)"](mockGauge.address);
            const poolSize = await phase2.booster.poolLength();

            newPid = poolSize.sub(1);
            const resp = await phase2.booster.poolInfo(newPid);

            expect(resp.lptoken).eq(lpToken.address);
            expect(resp.gauge, "new gauge != gauge ").not.eq(gauge);

            depositToken = IERC20__factory.connect(resp.token, lpWhale.signer);
            crvRewards = BaseRewardPool4626__factory.connect(resp.crvRewards, lpWhale.signer);
        });
        it("deposit lp tokens to new pool", async () => {
            const amount = await lpToken.balanceOf(lpWhale.address);
            const crvRewardsBefore = await crvRewards.balanceOf(lpWhale.address);

            expect(amount).gt(0);
            expect(crvRewardsBefore, "crvRewards balance before").eq(0);
            await lpToken.approve(phase2.booster.address, amount);
            const stake = true;

            await phase2.booster.connect(lpWhale.signer).deposit(newPid, amount, stake);

            const depositTokenBalance = await crvRewards.balanceOf(lpWhale.address);
            expect(depositTokenBalance, "crvRewards balance").eq(amount);
        });
        it("claim rewards", async () => {
            const balWhale = await impersonateAccount(balWhaleAddress);
            const bal = MockERC20__factory.connect(config.addresses.token, balWhale.signer);

            await bal.transfer(phase2.booster.address, simpleToExactAmount(100));
            await phase2.booster.earmarkRewards(newPid);

            const balBefore = await phase2.cvx.balanceOf(lpWhale.address);
            await crvRewards["getReward()"]();
            const balAfter = await phase2.cvx.balanceOf(lpWhale.address);
            expect(balAfter, "rewards balance").gt(balBefore);
        });
        it("withdraw lp tokens", async () => {
            const amount = await crvRewards.balanceOf(lpWhale.address);
            await crvRewards["withdraw(uint256,bool)"](amount, true);
            await depositToken.approve(phase2.booster.address, amount);

            await phase2.booster.connect(lpWhale.signer).withdraw(newPid, amount);

            const lpTokenBalance = await lpToken.balanceOf(lpWhale.address);
            expect(lpTokenBalance).eq(amount);
        });
    });
    describe("GaugeMigrator", () => {
        const oldPid = 0;
        let newPid: number;

        let oldCrvRewards: BaseRewardPool4626;
        const assertGaugeMigration = async (account: Account, fromPid: number, toPid: number): Promise<void> => {
            const fromPool = await phase2.booster.poolInfo(fromPid);
            const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool.crvRewards, account.signer);
            const fromCrvRewardsBefore = await fromCrvRewards.balanceOf(account.address);

            const toPool = await phase2.booster.poolInfo(toPid);
            const toCrvRewards = BaseRewardPool4626__factory.connect(toPool.crvRewards, account.signer);
            const toCrvRewardsBefore = await toCrvRewards.balanceOf(account.address);

            // Given the user has balance and wish  to migrate to different pool with same underlying asset
            expect(fromPool.lptoken, "lptokens").to.be.eq(toPool.lptoken);
            expect(fromPid, "pid").to.not.eq(toPid);
            expect(fromCrvRewardsBefore, "fromCrvRewards balance before").gt(0);
            // extraRewards
            await fromCrvRewards.approve(gaugeMigrator.address, fromCrvRewardsBefore);

            // When it migrates it's full position
            await gaugeMigrator.connect(account.signer).migrate(fromPid, toPid);

            // Then previous lp position must be zero and new position must hold all its previous liquidity
            const fromCrvRewardsAfter = await fromCrvRewards.balanceOf(account.address);
            const toCrvRewardsAfter = await toCrvRewards.balanceOf(account.address);

            expect(fromCrvRewardsAfter, "from crvRewards balance").to.be.eq(0);
            expect(toCrvRewardsAfter, "to crvRewards balance").to.be.eq(toCrvRewardsBefore.add(fromCrvRewardsBefore));
        };
        before(async () => {
            await setup();
        });
        it("deploy GaugeMigrator", async () => {
            gaugeMigrator = await deployContract<GaugeMigrator>(
                hre,
                new GaugeMigrator__factory(protocolDao),
                "GaugeMigrator",
                [phase2.booster.address],
                {},
                debug,
            );
        });
        it("get old LP token", async () => {
            const poolInfo = await phase2.booster.poolInfo(oldPid);
            lpToken = IERC20__factory.connect(poolInfo.lptoken, lpWhale.signer);
            gauge = poolInfo.gauge;

            oldCrvRewards = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, lpWhale.signer);
        });
        it("deposit lp tokens to old pool", async () => {
            const balance = await lpToken.balanceOf(lpWhale.address);
            const amount = simpleToExactAmount(100);
            expect(balance).to.gt(amount);

            const crvRewardsBefore = await oldCrvRewards.balanceOf(lpWhale.address);

            expect(amount).gt(0);
            expect(crvRewardsBefore, "crvRewards balance before").eq(0);
            await lpToken.approve(phase2.booster.address, amount);
            const stake = true;

            await phase2.booster.connect(lpWhale.signer).deposit(oldPid, amount, stake);

            const depositTokenBalance = await oldCrvRewards.balanceOf(lpWhale.address);
            expect(depositTokenBalance, "crvRewards balance").eq(amount);
        });
        context("add new pool", async () => {
            it("mock gauge controller", async () => {
                // Mock gauge controller with one that returns 1 when you query the weight
                await network.provider.send("hardhat_setCode", [
                    config.addresses.gaugeController,
                    MockGaugeController__factory.bytecode,
                ]);
                await network.provider.send("hardhat_setCode", [gauge, MockCurveGauge__factory.bytecode]);

                // Send some tokens to voter proxy to avoid calling the gauge while withdrawing, the curve gauge mock has an issue.
                const voterProxy = "0xaf52695e1bb01a16d33d7194c28c42b10e0dbec2";
                await lpToken.transfer(voterProxy, simpleToExactAmount(200));
            });
            it("deploy fake gauge with old LP Token", async () => {
                mockGauge = await deployContract<MockCurveGauge>(
                    hre,
                    new MockCurveGauge__factory(protocolDao),
                    "MockCurveGauge",
                    ["MockCurveGauge", "MockCurveGauge", lpToken.address, []],
                    {},
                    debug,
                );
            });
            it("add old lp token pool", async () => {
                const poolManager = PoolManagerV3__factory.connect(phase2.poolManager.address, protocolDao);
                await poolManager["addPool(address)"](mockGauge.address);
                const poolSize = await phase2.booster.poolLength();

                newPid = poolSize.sub(1).toNumber();
                const resp = await phase2.booster.poolInfo(newPid);

                expect(resp.lptoken).eq(lpToken.address);
                expect(resp.gauge, "new gauge != gauge ").not.eq(gauge);
            });
            it("migrates full lp position oldPid => newPid", async () => {
                await assertGaugeMigration(lpWhale, oldPid, newPid);
            });
        });
    });
});
