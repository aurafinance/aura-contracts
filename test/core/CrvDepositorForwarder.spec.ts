import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    deployCrvDepositorWrapperForwarder,
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    MultisigConfig,
    SystemDeployed,
} from "../../scripts/deploySystem";
import { deployContract } from "../../tasks/utils";
import { increaseTime, simpleToExactAmount } from "../../test-utils";
import { ONE_WEEK, ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import {
    BaseRewardPool,
    BaseRewardPool__factory,
    CrvDepositor,
    CrvDepositorWrapperForwarder,
    CvxCrvToken,
    ERC20,
    ExtraRewardStashV3__factory,
    IERC20,
    IERC20__factory,
    MockERC20__factory,
    StashRewardDistro,
    StashRewardDistro__factory,
} from "../../types/generated";

describe("CrvDepositorWrapperForwarder", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let crvDepositor: CrvDepositor;
    let cvxCrv: CvxCrvToken;
    let deployer: Signer;
    let dao: Signer;
    let deployerAddress: string;
    let alice: Signer;
    let aliceAddress: string;
    let multisigs: MultisigConfig;
    let crv: ERC20;
    let crvDepositorWrapper: CrvDepositorWrapperForwarder;
    let cvxCrvStaking: BaseRewardPool;
    let stashRewardDistro: StashRewardDistro;
    let contracts: SystemDeployed;
    let lpToken: IERC20;

    const pid = 0;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();
        dao = accounts[3];

        mocks = await deployMocks(hre, deployer);
        multisigs = await getMockMultisigs(accounts[1], accounts[2], accounts[3]);
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
        await phase3.poolManager.connect(dao).setProtectPool(false);
        await phase3.boosterOwner.connect(dao).setFeeInfo(mocks.lptoken.address, mocks.feeDistribution.address);
        await phase3.boosterOwner.connect(dao).setFeeInfo(mocks.crv.address, mocks.feeDistribution.address);
        contracts = await deployPhase4(hre, deployer, phase3, mocks.addresses);

        stashRewardDistro = await deployContract<StashRewardDistro>(
            hre,
            new StashRewardDistro__factory(deployer),
            "StashRewardDistro",
            [contracts.booster.address],
            {},
            false,
            0,
        );

        const { crvDepositorWrapperForwarder } = await deployCrvDepositorWrapperForwarder(
            hre,
            deployer,
            { ...phase2, pid, stashRewardDistro },
            mocks.addresses,
        );

        alice = accounts[0];
        aliceAddress = await alice.getAddress();

        crvDepositor = contracts.crvDepositor.connect(alice);
        cvxCrv = contracts.cvxCrv.connect(alice);
        crv = mocks.crv.connect(alice);
        crvDepositorWrapper = crvDepositorWrapperForwarder.connect(alice);
        cvxCrvStaking = contracts.cvxCrvRewards;

        const tx = await mocks.crvBpt.connect(alice).approve(crvDepositor.address, ethers.constants.MaxUint256);
        await tx.wait();

        const crvBalance = await mocks.crvBpt.balanceOf(deployerAddress);

        const calls = [await mocks.crvBpt.transfer(aliceAddress, crvBalance.mul(90).div(100))];
        await Promise.all(calls.map(tx => tx.wait()));

        // transfer LP tokens to accounts
        const balance = await mocks.lptoken.balanceOf(deployerAddress);
        for (const account of accounts) {
            const accountAddress = await account.getAddress();
            const share = balance.div(accounts.length);
            const tx = await mocks.lptoken.transfer(accountAddress, share);
            await tx.wait();
        }
        lpToken = IERC20__factory.connect(mocks.lptoken.address, deployer);
    });
    describe("setting setters", () => {
        it("initial configuration is correct", async () => {
            expect(await crvDepositorWrapper.crvDeposit()).to.equal(crvDepositor.address);
            expect(await crvDepositorWrapper.cvxCrv()).to.equal(cvxCrv.address);
            expect(await crvDepositorWrapper.stashRewardDistro()).to.equal(stashRewardDistro.address);
            expect(await crvDepositorWrapper.pid()).to.equal(pid);
        });

        it("anyone set approvals", async () => {
            const crvBpt = MockERC20__factory.connect(mocks.addresses.tokenBpt, deployer);
            expect(
                await crvBpt.allowance(crvDepositorWrapper.address, crvDepositor.address),
                "initial allowance",
            ).to.be.eq(ZERO);

            await crvDepositorWrapper.setApprovals();

            expect(await crvBpt.allowance(crvDepositorWrapper.address, crvDepositor.address), "allowance").to.be.gt(
                ZERO,
            );
            expect(
                await cvxCrv.allowance(crvDepositorWrapper.address, stashRewardDistro.address),
                "allowance",
            ).to.be.gt(ZERO);
        });
    });

    describe("depositing via wrapper", () => {
        it("allows the sender to deposit crv, wrap to crvBpt and deposit", async () => {
            const lock = true;
            const stakeAddress = ZERO_ADDRESS;
            const balance = await crv.balanceOf(aliceAddress);
            const amount = balance.mul(10).div(100);
            const epoch = await stashRewardDistro.getCurrentEpoch();

            const cvxCrvBalanceBefore = await cvxCrv.balanceOf(aliceAddress);
            const cvxCrvForwardBalanceBefore = await cvxCrv.balanceOf(stashRewardDistro.address);

            const minOut = await crvDepositorWrapper.getMinOut(amount, "10000");

            await crv.approve(crvDepositorWrapper.address, amount);
            // Test
            await crvDepositorWrapper.deposit(amount, minOut, lock, stakeAddress);

            const cvxCrvBalanceAfter = await cvxCrv.balanceOf(aliceAddress);
            const cvxCrvForwardBalanceAfter = await cvxCrv.balanceOf(stashRewardDistro.address);

            const cvxCrvBalanceDelta = cvxCrvBalanceAfter.sub(cvxCrvBalanceBefore);
            const cvxCrvForwardBalanceDelta = cvxCrvForwardBalanceAfter.sub(cvxCrvForwardBalanceBefore);

            expect(cvxCrvBalanceDelta, "cvxCrv caller balance should not change").to.equal(ZERO);
            expect(cvxCrvForwardBalanceDelta, "cvxCrv stashRewardDistro.address balance should increase").to.equal(
                minOut,
            );

            expect(await stashRewardDistro.getFunds(epoch.add(1), pid, cvxCrv.address)).to.be.eq(minOut.sub(1));
        });

        it("should be able to deposit more than once in the same epoch", async () => {
            const lock = true;
            const stakeAddress = ZERO_ADDRESS;
            const balance = await crv.balanceOf(aliceAddress);
            const amount = balance.mul(10).div(100);
            const epoch = await stashRewardDistro.getCurrentEpoch();
            const fundsBefore = await stashRewardDistro.getFunds(epoch.add(1), pid, cvxCrv.address);

            const cvxCrvBalanceBefore = await cvxCrv.balanceOf(aliceAddress);
            const cvxCrvForwardBalanceBefore = await cvxCrv.balanceOf(stashRewardDistro.address);

            const minOut = await crvDepositorWrapper.getMinOut(amount, "10000");

            await crv.approve(crvDepositorWrapper.address, amount);
            // Test
            await crvDepositorWrapper.deposit(amount, minOut, lock, stakeAddress);

            const cvxCrvBalanceAfter = await cvxCrv.balanceOf(aliceAddress);
            const cvxCrvForwardBalanceAfter = await cvxCrv.balanceOf(stashRewardDistro.address);

            const cvxCrvBalanceDelta = cvxCrvBalanceAfter.sub(cvxCrvBalanceBefore);
            const cvxCrvForwardBalanceDelta = cvxCrvForwardBalanceAfter.sub(cvxCrvForwardBalanceBefore);

            expect(cvxCrvBalanceDelta, "cvxCrv caller balance should not change").to.equal(ZERO);
            expect(cvxCrvForwardBalanceDelta, "cvxCrv stashRewardDistro.address balance should increase").to.equal(
                minOut,
            );
            expect(await stashRewardDistro.getFunds(epoch.add(1), pid, cvxCrv.address)).to.be.eq(
                fundsBefore.add(minOut.sub(1)),
            );
        });
        it("stakes on behalf of user should not be possible", async () => {
            const lock = true;
            const stakeAddress = cvxCrvStaking.address;
            const balance = await crv.balanceOf(aliceAddress);
            const amount = balance.mul(10).div(100);
            const tx = crvDepositorWrapper.deposit(amount, amount, lock, stakeAddress);
            await expect(tx).to.be.revertedWith("!_stakeAddress");
        });
    });

    describe("distribute rewards", () => {
        it("add extra reward to pool", async () => {
            const poolInfo = await contracts.booster.poolInfo(pid);
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, deployer);

            const extraRewardsLength = await crvRewards.extraRewardsLength();

            await contracts.boosterOwner.connect(dao).setStashExtraReward(poolInfo.stash, cvxCrv.address);
            expect(await crvRewards.extraRewardsLength()).to.be.eq(extraRewardsLength.add(1));
        });

        it("user deposits into the gauge with extra rewards stash", async () => {
            const amount = simpleToExactAmount(100);
            await lpToken.approve(contracts.booster.address, amount.mul(10));
            const tx = await contracts.booster.deposit(pid, amount, true);
            await expect(tx)
                .to.emit(contracts.booster, "Deposited")
                .withArgs(await deployer.getAddress(), pid, amount);
        });

        it("queueRewards via stashRewardDistro", async () => {
            await increaseTime(ONE_WEEK);
            const epoch = await stashRewardDistro.getCurrentEpoch();
            const fundsBefore = await stashRewardDistro.getFunds(epoch, pid, cvxCrv.address);
            const poolInfo = await contracts.booster.poolInfo(pid);
            const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer);

            const tokenInfo = await stash.tokenInfo(cvxCrv.address);
            const cvxCrvStashTokenBalanceBefore = await cvxCrv.balanceOf(tokenInfo.stashToken);
            // const cvxCrvStashTokenBalanceBefore = await cvxCrv.balanceOf(tokenInfo.stashToken);
            const cvxCrvStashRewardDistroBefore = await cvxCrv.balanceOf(stashRewardDistro.address);

            // stashRewardDistro is funded and has balance.
            expect(fundsBefore).to.be.gt(ZERO);
            expect(cvxCrvStashRewardDistroBefore).to.be.gt(ZERO);
            expect(cvxCrvStashTokenBalanceBefore).to.be.eq(ZERO);

            // Test queue the rewards
            await stashRewardDistro["queueRewards(uint256,address)"](pid, cvxCrv.address);

            const cvxCrvStashBalanceAfter = await cvxCrv.balanceOf(poolInfo.stash);
            const cvxCrvStashRewardDistroAfter = await cvxCrv.balanceOf(stashRewardDistro.address);

            // stashRewardDistro is no longer funded and has not balance.
            expect(await stashRewardDistro.getFunds(epoch, pid, cvxCrv.address)).to.be.eq(ZERO);
            expect(cvxCrvStashRewardDistroAfter).to.be.eq(2); // small wei is left on the stash reward distro to later on call process idle rewards
            // extra rewards cvxCrv are sent to the stash
            expect(cvxCrvStashBalanceAfter).to.be.eq(cvxCrvStashRewardDistroBefore.sub(2));
        });

        it("call earmarkRewards to distribute all extra rewards", async () => {
            const poolInfo = await contracts.booster.poolInfo(pid);
            const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer);

            const tokenInfo = await stash.tokenInfo(cvxCrv.address);
            const rewardPool = BaseRewardPool__factory.connect(tokenInfo.rewardAddress, deployer);

            const earnedBefore = await rewardPool.earned(deployerAddress);
            const periodFinishBefore = await rewardPool.periodFinish();

            expect(earnedBefore).to.be.eq(ZERO);

            // Distribute the extra rewards  by calling earmarkRewards
            await contracts.booster.earmarkRewards(pid);

            const cvxCrvStashTokenBalanceAfter = await cvxCrv.balanceOf(tokenInfo.stashToken);

            await increaseTime(ONE_WEEK);
            const earnedAfter = await rewardPool.earned(deployerAddress);

            const periodFinishAfter = await rewardPool.periodFinish();
            // cvxCrv are transfer to the stash token and the virtual pool starts a new period
            expect(cvxCrvStashTokenBalanceAfter).to.be.gt(ZERO);
            expect(earnedAfter).to.be.gt(ZERO);
            expect(periodFinishAfter).to.be.gt(periodFinishBefore);
        });
    });
});
