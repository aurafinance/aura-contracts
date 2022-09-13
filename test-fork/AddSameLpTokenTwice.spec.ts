import hre, { ethers, network } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { BN, impersonateAccount, simpleToExactAmount } from "../test-utils";
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
    ERC20__factory,
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
                        blockNumber: 15500000, // 15135072, // Jul-13-2022
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
        const existingPid = 0;

        before(() => setup());
        it("get existing LP token", async () => {
            const poolInfo = await phase2.booster.poolInfo(existingPid);
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

            newPid = poolSize.sub(1);
            const resp = await phase2.booster.poolInfo(newPid);

            expect(resp.lptoken).eq(lpToken.address);
            expect(resp.gauge, "new gauge != gauge ").not.eq(gauge);

            depositToken = IERC20__factory.connect(resp.token, lpWhale.signer);
            crvRewards = BaseRewardPool4626__factory.connect(resp.crvRewards, lpWhale.signer);
        });
        it("deposit lp tokens", async () => {
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

        describe("GaugeMigrator", async () => {
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
                expect(toCrvRewardsAfter, "to crvRewards balance").to.be.eq(
                    toCrvRewardsBefore.add(fromCrvRewardsBefore),
                );
            };

            it("deploy GaugeMigrator", async () => {
                gaugeMigrator = await deployContract<GaugeMigrator>(
                    hre,
                    new GaugeMigrator__factory(protocolDao),
                    "GaugeMigrator",
                    [phase2.booster.address],
                    {},
                    debug,
                );
                //  whale with current position
                lpWhale = await impersonateAccount("0xa51ed1d803b09f4d08226f9f91e6dcc79ec0feb7");
                // When trying to move a LP position it fails with
                // Error: Transaction reverted without a reason string
                // at BaseRewardPool4626._withdrawAndUnwrapTo (convex-platform/contracts/contracts/BaseRewardPool.sol:275)
                // at GaugeMigrator.migrate (contracts/GaugeMigrator.sol:34)
            });
            xit("deposit lp tokens", async () => {
                const pidDeposit = existingPid;
                const lpTokenBalance = await lpToken.balanceOf(lpWhale.address);
                const poolInfo = await phase2.booster.poolInfo(pidDeposit);
                crvRewards = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, lpWhale.signer);

                const crvRewardsBefore = await crvRewards.balanceOf(lpWhale.address);

                expect(lpTokenBalance, "lp token balance").gt(0);
                expect(crvRewardsBefore, "crvRewards balance before").gte(0);
                await lpToken.approve(phase2.booster.address, lpTokenBalance);
                const stake = true;

                await phase2.booster.connect(lpWhale.signer).deposit(pidDeposit, lpTokenBalance, stake);

                const depositTokenBalance = await crvRewards.balanceOf(lpWhale.address);
                expect(depositTokenBalance, "crvRewards balance").eq(lpTokenBalance);

                // When trying to deposit to existingPid , the following error
                // Error: Transaction reverted without a reason string
                // at <UnrecognizedContract>.<unknown> (0x34f33cdaed8ba0e1ceece80e5f4a73bcf234cfac)
                // at <UnrecognizedContract>.<unknown> (0x34f33cdaed8ba0e1ceece80e5f4a73bcf234cfac)
                // at VoterProxy.deposit (convex-platform/contracts/contracts/VoterProxy.sol:178)
                // at Booster.deposit (convex-platform/contracts/contracts/Booster.sol:410)
            });
            it("migrates full lp position existingPid => newPid", async () => {
                await assertGaugeMigration(lpWhale, existingPid, BN.from(newPid).toNumber());
            });
            xit("migrates back full lp position newPid => existingPid", async () => {
                await assertGaugeMigration(lpWhale, BN.from(newPid).toNumber(), existingPid);
                // If first deposit lpTokens to new pool (pid), then when trying to migrate to existingPid
                // migrates back full lp position newPid => existingPid:
                // Error: Transaction reverted without a reason string
                //  at <UnrecognizedContract>.<unknown> (0x34f33cdaed8ba0e1ceece80e5f4a73bcf234cfac)
                //  at <UnrecognizedContract>.<unknown> (0x34f33cdaed8ba0e1ceece80e5f4a73bcf234cfac)
                //  at VoterProxy.deposit (convex-platform/contracts/contracts/VoterProxy.sol:178)
                //  at Booster.deposit (convex-platform/contracts/contracts/Booster.sol:410)
                //  at BaseRewardPool4626.deposit (convex-platform/contracts/contracts/BaseRewardPool4626.sol:62)
                //  at BaseRewardPool4626.functionCall (@openzeppelin/contracts-0.6/utils/Address.sol:90)
                //  at GaugeMigrator.migrate (contracts/GaugeMigrator.sol:37)
            });
        });
    });
});
