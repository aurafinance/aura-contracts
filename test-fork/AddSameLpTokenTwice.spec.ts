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
    BaseRewardPool__factory,
    BaseRewardPool,
    MockERC20__factory,
} from "../types";
import { deployContract } from "../tasks/utils";
import { Phase2Deployed } from "../scripts/deploySystem";

const debug = false;

describe("Add same LP Token twice", () => {
    let protocolDao: Signer;
    let gauge: string;
    let phase2: Phase2Deployed;
    let mockGauge: MockCurveGauge;
    let pid: BigNumberish;

    let depositToken: IERC20;
    let lpWhale: Account;
    let lpToken: IERC20;
    let crvRewards: BaseRewardPool;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15135072,
                    },
                },
            ],
        });

        await impersonateAccount(config.multisigs.daoMultisig);
        protocolDao = await ethers.getSigner(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(protocolDao);

        const lpWhaleAddress = "0xf346592803eb47cb8d8fa9f90b0ef17a82f877e0";
        lpWhale = await impersonateAccount(lpWhaleAddress);
    });

    describe("PoolManager", () => {
        it("get existing LP token", async () => {
            const resp = await phase2.booster.poolInfo(0);
            lpToken = IERC20__factory.connect(resp.lptoken, lpWhale.signer);
            gauge = resp.gauge;
        });
        it("mock gauge controller", async () => {
            // Mock gauge controller with one that returns 1 when you query the weight
            await network.provider.send("hardhat_setCode", [
                config.addresses.gaugeController,
                MockGaugeController__factory.bytecode,
            ]);
        });
        it("deploy fake gauge with existing LP Token", async () => {
            mockGauge = await deployContract<MockCurveGauge>(
                hre,
                new MockCurveGauge__factory(protocolDao),
                "MockCurveGauge",
                ["MockCurveGauge", "MockCurveGauge", lpToken.address, []],
                {},
                debug,
            );
        });
        it("add existing lp token pool", async () => {
            const poolManager = PoolManagerV3__factory.connect(phase2.poolManager.address, protocolDao);
            await poolManager["addPool(address)"](mockGauge.address);
            const poolSize = await phase2.booster.poolLength();

            pid = poolSize.sub(1);
            const resp = await phase2.booster.poolInfo(pid);

            expect(resp.lptoken).eq(lpToken.address);
            expect(resp.gauge).not.eq(gauge);

            depositToken = IERC20__factory.connect(resp.token, lpWhale.signer);
            crvRewards = BaseRewardPool__factory.connect(resp.crvRewards, lpWhale.signer);
        });
        it("depsit lp tokens", async () => {
            const amount = await lpToken.balanceOf(lpWhale.address);
            expect(amount).gt(0);
            await lpToken.approve(phase2.booster.address, amount);

            await phase2.booster.connect(lpWhale.signer).deposit(pid, amount, true);

            const depositTokenBalance = await crvRewards.balanceOf(lpWhale.address);
            expect(depositTokenBalance).eq(amount);
        });
        it("claim rewards", async () => {
            const balWhale = await impersonateAccount("0xff052381092420b7f24cc97fded9c0c17b2cbbb9");
            const bal = await MockERC20__factory.connect(config.addresses.token, balWhale.signer);

            await bal.transfer(phase2.booster.address, simpleToExactAmount(100));
            await phase2.booster.earmarkRewards(pid);

            const balBefore = await phase2.cvx.balanceOf(lpWhale.address);
            await crvRewards["getReward()"]();
            const balAfter = await phase2.cvx.balanceOf(lpWhale.address);
            expect(balAfter).gt(balBefore);
        });
        it("widthdraw lp tokens", async () => {
            const amount = await crvRewards.balanceOf(lpWhale.address);
            await crvRewards.withdraw(amount, true);
            await depositToken.approve(phase2.booster.address, amount);

            await phase2.booster.connect(lpWhale.signer).withdraw(pid, amount);

            const lpTokenBalance = await lpToken.balanceOf(lpWhale.address);
            expect(lpTokenBalance).eq(amount);
        });
    });
});
