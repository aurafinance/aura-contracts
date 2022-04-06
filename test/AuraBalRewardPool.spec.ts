import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4, SystemDeployed } from "../scripts/deploySystem";
import { deployMocks, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { AuraBalRewardPool, ERC20, MockVoteStorage__factory } from "../types/generated";
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "../test-utils/constants";
import { increaseTime, getTimestamp } from "../test-utils/time";
import { BN, simpleToExactAmount } from "../test-utils/math";
import { assertBNClose, assertBNClosePercent } from "../test-utils/assertions";

describe("AuraBalRewardPool", () => {
    let accounts: Signer[];

    let contracts: SystemDeployed;
    let rewards: AuraBalRewardPool;
    let cvxCrv: ERC20;

    let deployer: Signer;

    let alice: Signer;
    let aliceAddress: string;
    let bob: Signer;
    let bobAddress: string;

    let initialBal: BN;
    let rewardAmount: BN;

    const reset = async () => {
        const mocks = await deployMocks(deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();
        const phase1 = await deployPhase1(deployer, mocks.addresses);
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
        contracts = await deployPhase4(deployer, phase3, mocks.addresses);

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        bob = accounts[2];
        bobAddress = await bob.getAddress();

        rewards = contracts.initialCvxCrvStaking.connect(alice);
        cvxCrv = contracts.cvxCrv.connect(alice) as ERC20;

        initialBal = await mocks.crvBpt.balanceOf(await deployer.getAddress());
        await mocks.crvBpt.transfer(aliceAddress, initialBal);
        await mocks.crvBpt.connect(alice).approve(contracts.crvDepositor.address, initialBal);
        await contracts.crvDepositor.connect(alice)["deposit(uint256,bool,address)"](initialBal, true, ZERO_ADDRESS);
        initialBal = initialBal.div(2);
        await cvxCrv.transfer(bobAddress, initialBal);
    };

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        await reset();
    });

    it("initial configuration is correct", async () => {
        expect(await rewards.stakingToken()).eq(cvxCrv.address);
        expect(await rewards.rewardToken()).eq(contracts.cvx.address);
        expect(await rewards.rewardManager()).eq(await deployer.getAddress());
        expect(await rewards.auraLocker()).eq(contracts.cvxLocker.address);
        expect(await rewards.penaltyForwarder()).eq(contracts.penaltyForwarder.address);
        const currentTime = await getTimestamp();
        expect(await rewards.startTime()).gt(currentTime.add(ONE_DAY.mul(6)));
        expect(await rewards.startTime()).lt(currentTime.add(ONE_DAY.mul(8)));
        rewardAmount = await contracts.cvx.balanceOf(rewards.address);
        expect(rewardAmount).gt(simpleToExactAmount(1000));
    });
    describe("basic flow", () => {
        it("allows users to deposit before rewards are added (no rewards accrued)", async () => {
            await cvxCrv.approve(rewards.address, initialBal.div(5));
            await rewards.stake(initialBal.div(5));
            expect(await rewards.rewardPerTokenStored()).eq(0);
        });
        it("allows anyone to trigger rewards distribution after startTime", async () => {
            await expect(rewards.initialiseRewards()).to.be.revertedWith("!authorized");
            await increaseTime(ONE_WEEK.mul(2));
            const timeBefore = await getTimestamp();
            const balBefore = await contracts.cvx.balanceOf(rewards.address);
            await rewards.initialiseRewards();
            const rewardRate = await rewards.rewardRate();
            const periodFinish = await rewards.periodFinish();

            assertBNClosePercent(rewardRate, balBefore.div(ONE_WEEK.mul(2)), "0.01");
            assertBNClose(periodFinish, timeBefore.add(ONE_WEEK.mul(2)), 4);
        });
        it("accrues rewards to existing depositors following startTime", async () => {
            await increaseTime(ONE_WEEK.div(5));
            const balBefore = await contracts.cvxLocker.balances(aliceAddress);
            await rewards.getReward(true);
            const balAfter = await contracts.cvxLocker.balances(aliceAddress);
            assertBNClosePercent(balAfter.locked.sub(balBefore.locked), rewardAmount.div(10), "0.01");
        });
        it("allows subsequent deposits", async () => {
            await cvxCrv.connect(bob).approve(rewards.address, initialBal.div(5));
            await rewards.connect(bob).stake(initialBal.div(5));
        });
        it("penalises claimers who do not lock", async () => {
            await increaseTime(ONE_WEEK.div(5));
            const earned = await rewards.earned(bobAddress);
            assertBNClosePercent(earned, rewardAmount.div(20), "0.01");

            const balBefore = await contracts.cvx.balanceOf(bobAddress);
            await rewards.connect(bob).getReward(false);
            const balAfter = await contracts.cvx.balanceOf(bobAddress);

            assertBNClosePercent(balAfter.sub(balBefore), earned.mul(8).div(10), "0.001");
            assertBNClosePercent(await rewards.pendingPenalty(), earned.mul(2).div(10), "0.001");
        });
        it("gives all rewards to claimers who lock", async () => {
            const balBefore = await contracts.cvxLocker.balances(aliceAddress);
            await rewards.getReward(true);
            const balAfter = await contracts.cvxLocker.balances(aliceAddress);
            assertBNClosePercent(balAfter.locked.sub(balBefore.locked), rewardAmount.div(20), "0.01");
        });
        it("allows anyone to forward penalty on to the PenaltyForwarder", async () => {
            const penalty = await rewards.pendingPenalty();
            expect(penalty).gt(0);

            await rewards.forwardPenalty();
            expect(await contracts.cvx.balanceOf(contracts.penaltyForwarder.address)).eq(penalty);
            expect(await rewards.pendingPenalty()).eq(0);
        });
        it("only forwards penalties once", async () => {
            const balBefore = await contracts.cvx.balanceOf(rewards.address);
            await rewards.forwardPenalty();
            const balAfter = await contracts.cvx.balanceOf(rewards.address);
            expect(balAfter).eq(balBefore);
        });
    });
    describe("funding rewards", () => {
        before(async () => {
            await reset();
        });
        it("blocks funding before startTime", async () => {
            await expect(rewards.connect(bob).initialiseRewards()).to.be.revertedWith("!authorized");
        });
        it("allows rewardManager to start process early", async () => {
            const tx = await rewards.connect(deployer).initialiseRewards();
            await expect(tx).to.emit(rewards, "RewardAdded").withArgs(rewardAmount);
        });
        it("only allows funding to be called once, ever", async () => {
            await increaseTime(ONE_WEEK);
            await expect(rewards.initialiseRewards()).to.be.revertedWith("!one time");
        });
    });
});
