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
    Phase5Deployed,
} from "../../scripts/deploySystem";
import { simpleToExactAmount } from "../../test-utils/math";
import { MockERC20__factory, MockCurveGauge__factory, BaseRewardPool4626__factory } from "../../types/generated";
import { GaugeMigrator } from "types/generated/GaugeMigrator";

describe("GaugeMigrator", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let deployer: Signer;
    let contracts: Phase5Deployed;
    let gaugeMigrator: GaugeMigrator;
    let alice: Signer;
    let aliceAddress: string;

    before(async () => {
        // Full system deployment
        accounts = await ethers.getSigners();

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        deployer = accounts[0];
        mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();
        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        const phase2 = await deployPhase2(
            hre,
            deployer,
            phase1,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.setProtectPool(false);
        const phase4 = await deployPhase4(hre, deployer, phase3, mocks.addresses);
        contracts = await deployPhase5(hre, deployer, phase4, multisigs, mocks.addresses);
        gaugeMigrator = contracts.gaugeMigrator;
    });

    it("initial configuration is correct", async () => {
        expect(await gaugeMigrator.booster()).to.be.eq(contracts.booster.address);
    });
    it("migrates from one pid to another pid", async () => {
        const fromPid = 0;
        const toPid = 1;
        const fromPool = await contracts.booster.poolInfo(fromPid);
        const toPool = await contracts.booster.poolInfo(toPid);

        // deposit into "from" pool.
        await mocks.lptoken.transfer(aliceAddress, simpleToExactAmount(100, 18));
        const balanceLPToken = await mocks.lptoken.balanceOf(aliceAddress);
        expect(balanceLPToken, "lp token balance").to.be.gt(0);
        await mocks.lptoken.connect(alice).approve(contracts.booster.address, balanceLPToken);
        await contracts.booster.connect(alice).deposit(fromPid, balanceLPToken, true);

        const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool.crvRewards, alice);
        const fromCrvRewardsBefore = await fromCrvRewards.balanceOf(aliceAddress);

        const toCrvRewards = BaseRewardPool4626__factory.connect(toPool.crvRewards, alice);
        const toCrvRewardsBefore = await toCrvRewards.balanceOf(aliceAddress);

        expect(fromCrvRewardsBefore, "crv rewards balance").to.be.gt(0);
        expect(fromPool.lptoken, "lp token").to.be.eq(toPool.lptoken);

        // When it migrates it's full position
        await fromCrvRewards.connect(alice).approve(gaugeMigrator.address, fromCrvRewardsBefore);
        await gaugeMigrator.connect(alice).migrate(fromPid, toPid);

        // Then previous lp position must be zero and new position must hold all its previous liquidity
        const fromCrvRewardsAfter = await fromCrvRewards.balanceOf(aliceAddress);
        const toCrvRewardsAfter = await toCrvRewards.balanceOf(aliceAddress);

        expect(fromCrvRewardsAfter, "from crvRewards balance").to.be.eq(0);
        expect(toCrvRewardsAfter, "to crvRewards balance").to.be.eq(toCrvRewardsBefore.add(fromCrvRewardsBefore));
    });
    describe("fails ", async () => {
        it("when 'from' pool is the same as the 'to' pool", async () => {
            await expect(gaugeMigrator.migrate(0, 0)).to.be.revertedWith("Invalid pids");
        });
        it("when a pool does not exist", async () => {
            await expect(gaugeMigrator.migrate(1000, 0)).to.be.reverted;
            await expect(gaugeMigrator.migrate(0, 1000)).to.be.reverted;
        });
        it("when lp token are different", async () => {
            // Given two different lp tokens
            const newPoolIdx = await contracts.booster.poolLength();
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
            await contracts.poolManager["addPool(address)"](gauge.address);

            const fromPoolInfo = await contracts.booster.poolInfo(0);
            const toPoolInfo = await contracts.booster.poolInfo(newPoolIdx);

            expect(fromPoolInfo.lptoken, "lp tokens").to.not.be.eq(toPoolInfo.lptoken);

            //  When it migrates
            await expect(gaugeMigrator.migrate(0, newPoolIdx)).to.be.revertedWith("Invalid lptokens");
        });
        it("migrates from one pid without balance", async () => {
            const fromPid = 0;
            const toPid = 1;
            const fromPool = await contracts.booster.poolInfo(fromPid);
            const toPool = await contracts.booster.poolInfo(toPid);
            const fromCrvRewards = BaseRewardPool4626__factory.connect(fromPool.crvRewards, alice);
            const fromCrvRewardsBefore = await fromCrvRewards.balanceOf(aliceAddress);
            expect(fromCrvRewardsBefore, "crv rewards balance").to.be.eq(0);
            expect(fromPool.lptoken, "lp token").to.be.eq(toPool.lptoken);
            // When it migrates it's full position
            await expect(gaugeMigrator.connect(alice).migrate(fromPid, toPid)).to.be.revertedWith(
                "RewardPool : Cannot stake 0",
            );
        });
    });
});
