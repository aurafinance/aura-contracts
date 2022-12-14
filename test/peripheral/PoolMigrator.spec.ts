import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    deployPhase5,
    deployPhase6,
    deployPhase7,
    MultisigConfig,
    Phase2Deployed,
    Phase6Deployed,
    PoolsSnapshot,
} from "../../scripts/deploySystem";
import { simpleToExactAmount } from "../../test-utils/math";
import {
    PoolMigrator,
    MockERC20__factory,
    MockCurveGauge__factory,
    BaseRewardPool4626__factory,
    ERC20__factory,
} from "../../types/generated";

describe("PoolMigrator", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let deployer: Signer;
    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    let poolMigrator: PoolMigrator;
    let alice: Signer;
    let aliceAddress: string;
    let poolsSnapshot: PoolsSnapshot[];
    let multisigs: MultisigConfig;
    const setup = async () => {
        // Full system deployment
        accounts = await ethers.getSigners();

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        deployer = accounts[0];
        mocks = await deployMocks(hre, deployer);
        multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();
        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        phase2 = await deployPhase2(hre, deployer, phase1, distro, multisigs, mocks.namingConfig, mocks.addresses);
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.setProtectPool(false);
        const phase4 = await deployPhase4(hre, deployer, phase3, mocks.addresses);
        await deployPhase5(hre, deployer, phase4, multisigs, mocks.addresses);
        phase6 = await deployPhase6(hre, deployer, phase2, multisigs, mocks.namingConfig, mocks.addresses);

        const poolLength = await phase2.booster.poolLength();
        poolsSnapshot = await Promise.all(
            Array(poolLength.toNumber())
                .fill(null)
                .map(async (_, i) => {
                    const poolInfo = await phase2.booster.poolInfo(i);
                    return { ...poolInfo, pid: i };
                }),
        );

        poolMigrator = phase6.poolMigrator;
    };
    const shutdownSystem = async () => {
        // shutdown pools
        const poolLength = await phase2.booster.poolLength();
        await Promise.all(
            Array(poolLength.toNumber())
                .fill(null)
                .map(async (_, i) => {
                    const poolInfo = await phase2.booster.poolInfo(i);
                    if (!poolInfo.shutdown) {
                        await phase2.poolManager.shutdownPool(i);
                        return { ...poolInfo, shutdown: true, pid: i };
                    }
                    return { ...poolInfo, pid: i };
                }),
        );
        // shutdown system
        await phase2.poolManagerSecondaryProxy.shutdownSystem();
        await phase2.boosterOwner.shutdownSystem();
        // update voterproxy operator
        await phase2.voterProxy.setOperator(phase6.booster.address);
        // update Aura operator
        await phase2.cvx.updateOperator();
    };
    const reAddPools = async () => {
        const { poolManager } = phase6;

        for (let i = 0; i < poolsSnapshot.length; i++) {
            const poolInfo = poolsSnapshot[i];
            if (!poolInfo.shutdown) {
                await poolManager["addPool(address)"](poolInfo.gauge);
            }
        }

        await deployPhase7(hre, deployer, phase2, "0x0000000000000000000000000000000000000000");
    };

    describe("migration ", async () => {
        beforeEach(async () => {
            await setup();
        });
        it("initial configuration is correct", async () => {
            expect(await poolMigrator.boosterV1(), "old booster").to.be.eq(phase2.booster.address);
            expect(await poolMigrator.boosterV2(), "new booster").to.be.eq(phase6.booster.address);
        });
        it("migrates from one pid to another pid", async () => {
            const fromPid = 1;
            const toPid = 1;

            // deposit into "from" pool.
            await mocks.lptoken.transfer(aliceAddress, simpleToExactAmount(100, 18));
            const balanceLPToken = await mocks.lptoken.balanceOf(aliceAddress);
            expect(balanceLPToken, "lp token balance").to.be.gt(0);
            await mocks.lptoken.connect(alice).approve(phase2.booster.address, balanceLPToken);
            await phase2.booster.connect(alice).deposit(fromPid, balanceLPToken, true);

            await shutdownSystem();
            await reAddPools();

            const fromPool = await phase2.booster.poolInfo(fromPid);
            const toPool = await phase6.booster.poolInfo(toPid);

            const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool.crvRewards, alice);
            const fromCrvRewardsBefore = await fromCrvRewards.balanceOf(aliceAddress);

            const toCrvRewards = BaseRewardPool4626__factory.connect(toPool.crvRewards, alice);
            const toCrvRewardsBefore = await toCrvRewards.balanceOf(aliceAddress);

            expect(fromCrvRewardsBefore, "crv rewards balance").to.be.gt(0);
            expect(fromPool.lptoken, "lp token").to.be.eq(toPool.lptoken);

            // When it migrates it's full position
            await fromCrvRewards.connect(alice).approve(poolMigrator.address, fromCrvRewardsBefore);
            await poolMigrator.connect(alice).migrate([fromPid], [toPid], [fromCrvRewardsBefore]);

            // Then previous lp position must be zero and new position must hold all its previous liquidity
            const fromCrvRewardsAfter = await fromCrvRewards.balanceOf(aliceAddress);
            const toCrvRewardsAfter = await toCrvRewards.balanceOf(aliceAddress);

            expect(fromCrvRewardsAfter, "from crvRewards balance").to.be.eq(0);
            expect(toCrvRewardsAfter, "to crvRewards balance").to.be.eq(toCrvRewardsBefore.add(fromCrvRewardsBefore));
        });
        it("migrates from one pid to another pid, default amount", async () => {
            const fromPid = 1;
            const toPid = 1;

            // deposit into "from" pool.
            await mocks.lptoken.transfer(aliceAddress, simpleToExactAmount(100, 18));
            const balanceLPToken = await mocks.lptoken.balanceOf(aliceAddress);
            expect(balanceLPToken, "lp token balance").to.be.gt(0);
            await mocks.lptoken.connect(alice).approve(phase2.booster.address, balanceLPToken);
            await phase2.booster.connect(alice).deposit(fromPid, balanceLPToken, true);

            await shutdownSystem();
            await reAddPools();

            const fromPool = await phase2.booster.poolInfo(fromPid);
            const toPool = await phase6.booster.poolInfo(toPid);

            const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool.crvRewards, alice);
            const fromCrvRewardsBefore = await fromCrvRewards.balanceOf(aliceAddress);

            const toCrvRewards = BaseRewardPool4626__factory.connect(toPool.crvRewards, alice);
            const toCrvRewardsBefore = await toCrvRewards.balanceOf(aliceAddress);

            expect(fromCrvRewardsBefore, "crv rewards balance").to.be.gt(0);
            expect(fromPool.lptoken, "lp token").to.be.eq(toPool.lptoken);

            // When it migrates it's full position
            await fromCrvRewards.connect(alice).approve(poolMigrator.address, fromCrvRewardsBefore);
            await poolMigrator.connect(alice).migrate([fromPid], [toPid], [ethers.constants.MaxUint256]);

            // Then previous lp position must be zero and new position must hold all its previous liquidity
            const fromCrvRewardsAfter = await fromCrvRewards.balanceOf(aliceAddress);
            const toCrvRewardsAfter = await toCrvRewards.balanceOf(aliceAddress);

            expect(fromCrvRewardsAfter, "from crvRewards balance").to.be.eq(0);
            expect(toCrvRewardsAfter, "to crvRewards balance").to.be.eq(toCrvRewardsBefore.add(fromCrvRewardsBefore));
        });
        it("migrates from one pid to another pid, partial migration", async () => {
            const fromPid = 1;
            const toPid = 1;

            // deposit into "from" pool.
            await mocks.lptoken.transfer(aliceAddress, simpleToExactAmount(100, 18));
            const balanceLPToken = await mocks.lptoken.balanceOf(aliceAddress);
            expect(balanceLPToken, "lp token balance").to.be.gt(0);
            await mocks.lptoken.connect(alice).approve(phase2.booster.address, balanceLPToken);
            await phase2.booster.connect(alice).deposit(fromPid, balanceLPToken, true);

            await shutdownSystem();
            await reAddPools();

            const fromPool = await phase2.booster.poolInfo(fromPid);
            const toPool = await phase6.booster.poolInfo(toPid);

            const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool.crvRewards, alice);
            const fromCrvRewardsBefore = await fromCrvRewards.balanceOf(aliceAddress);
            const lpToken = ERC20__factory.connect(toPool.lptoken, alice);

            const toCrvRewards = BaseRewardPool4626__factory.connect(toPool.crvRewards, alice);

            const toCrvRewardsBefore = await toCrvRewards.balanceOf(aliceAddress);
            const lpTokenBefore = await lpToken.balanceOf(aliceAddress);

            expect(fromCrvRewardsBefore, "crv rewards balance").to.be.gt(0);
            expect(fromPool.lptoken, "lp token").to.be.eq(toPool.lptoken);
            const amount = fromCrvRewardsBefore.div(2);

            // When it migrates, withdraws all but only deposits half
            await fromCrvRewards.connect(alice).approve(poolMigrator.address, fromCrvRewardsBefore);

            //  Test
            await poolMigrator.connect(alice).migrate([fromPid], [toPid], [amount]);

            const lpTokenAfter = await lpToken.balanceOf(aliceAddress);
            const fromCrvRewardsAfter = await fromCrvRewards.balanceOf(aliceAddress);
            const toCrvRewardsAfter = await toCrvRewards.balanceOf(aliceAddress);

            expect(fromCrvRewardsAfter, "from crvRewards balance").to.be.eq(fromCrvRewardsBefore.sub(amount));
            expect(lpTokenAfter, "lp token balance").to.be.eq(lpTokenBefore);
            expect(toCrvRewardsAfter, "to crvRewards balance").to.be.eq(toCrvRewardsBefore.add(amount));
        });
    });

    describe("fails", async () => {
        before(async () => {
            await setup();
            await shutdownSystem();
            await reAddPools();
        });
        it("when a pool does not exist", async () => {
            await expect(poolMigrator.migrate([1000], [0], [500])).to.be.reverted;
            await expect(poolMigrator.migrate([0], [1000], [500])).to.be.reverted;
        });
        it("when inputs are invalid", async () => {
            await expect(poolMigrator.migrate([1000, 100], [0], [500])).to.be.revertedWith("Invalid input");
            await expect(poolMigrator.migrate([0], [1000, 100], [500])).to.be.revertedWith("Invalid input");
            await expect(poolMigrator.migrate([0], [1000], [500, 500])).to.be.revertedWith("Invalid input");
        });
        it("when lp token are different", async () => {
            // Given two different lp tokens
            const newPoolIdx = await phase6.booster.poolLength();
            const lptoken = await new MockERC20__factory(deployer).deploy(
                "mockLPToken",
                "mLPT",
                18,
                await deployer.getAddress(),
                10000000,
            );
            const gauge = await new MockCurveGauge__factory(deployer).deploy(
                `TestGauge_${newPoolIdx}`,
                `tstGauge_${newPoolIdx}`,
                lptoken.address,
                [],
            );
            await mocks.voting.vote_for_gauge_weights(gauge.address, 1);
            await phase6.poolManager["addPool(address)"](gauge.address);

            const fromPoolInfo = await phase6.booster.poolInfo(0);
            const toPoolInfo = await phase6.booster.poolInfo(newPoolIdx);

            expect(fromPoolInfo.lptoken, "lp tokens").to.not.be.eq(toPoolInfo.lptoken);

            //  When it migrates
            await expect(poolMigrator.migrate([0], [newPoolIdx], [0])).to.be.revertedWith("Invalid lptokens");
        });
        it("when gauges are different", async () => {
            // Given two different lp tokens
            const newPoolIdx = await phase6.booster.poolLength();
            const gauge = await new MockCurveGauge__factory(deployer).deploy(
                `TestGauge_${newPoolIdx}`,
                `tstGauge_${newPoolIdx}`,
                mocks.lptoken.address,
                [],
            );
            await mocks.voting.vote_for_gauge_weights(gauge.address, 1);
            await phase6.poolManager["addPool(address)"](gauge.address);

            const fromPoolInfo = await phase6.booster.poolInfo(0);
            const toPoolInfo = await phase6.booster.poolInfo(newPoolIdx);

            expect(fromPoolInfo.lptoken, "lp tokens").to.be.eq(toPoolInfo.lptoken);
            expect(fromPoolInfo.gauge, "gauges").to.not.be.eq(toPoolInfo.gauge);

            //  When it migrates
            await expect(poolMigrator.migrate([0], [newPoolIdx], [0])).to.be.revertedWith("Invalid gauges");
        });
        it("when amount is incorrect", async () => {
            const fromPid = 0;
            const toPid = 0;
            const fromPool = await phase6.booster.poolInfo(fromPid);
            const toPool = await phase6.booster.poolInfo(toPid);
            const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool.crvRewards, alice);
            const fromCrvRewardsBalance = await fromCrvRewards.balanceOf(aliceAddress);
            expect(fromPool.lptoken, "lp token").to.be.eq(toPool.lptoken);

            await expect(
                poolMigrator.connect(alice).migrate([fromPid], [toPid], [fromCrvRewardsBalance.add(1)]),
            ).to.be.revertedWith("ERC4626: withdrawal amount exceeds allowance");
        });
        it("migrates from one pid without balance", async () => {
            const fromPid = 0;
            const toPid = 0;
            const fromPool = await phase6.booster.poolInfo(fromPid);
            const toPool = await phase6.booster.poolInfo(toPid);
            const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool.crvRewards, alice);
            const fromCrvRewardsBefore = await fromCrvRewards.balanceOf(aliceAddress);
            expect(fromCrvRewardsBefore, "crv rewards balance").to.be.eq(0);
            expect(fromPool.lptoken, "lp token").to.be.eq(toPool.lptoken);

            await expect(poolMigrator.connect(alice).migrate([fromPid], [toPid], [0])).to.be.revertedWith(
                "RewardPool : Cannot stake 0",
            );
        });
    });
});
