import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { AuraStakingProxy, Booster, AuraToken, CvxCrvToken, AuraLocker } from "../types/generated";
import { BN, getTimestamp, increaseTime, ONE_WEEK, simpleToExactAmount, ZERO_ADDRESS } from "../test-utils";

describe("AuraLocker", () => {
    let accounts: Signer[];
    let auraLocker: AuraLocker;
    let cvxStakingProxy: AuraStakingProxy;
    let booster: Booster;
    let cvx: AuraToken;
    let cvxCrv: CvxCrvToken;
    let mocks: DeployMocksResult;

    let deployer: Signer;

    let alice: Signer;
    let aliceInitialBalance: BN;
    let aliceAddress: string;
    let bob: Signer;
    let bobAddress: string;

    const setup = async () => {
        mocks = await deployMocks(deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(deployer, mocks.addresses);
        const phase2 = await deployPhase2(deployer, phase1, multisigs, mocks.namingConfig);
        const phase3 = await deployPhase3(
            hre,
            deployer,
            phase2,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );
        const contracts = await deployPhase4(deployer, phase3, mocks.addresses);

        alice = accounts[1];
        aliceAddress = await alice.getAddress();
        bob = accounts[2];
        bobAddress = await bob.getAddress();

        booster = contracts.booster;
        auraLocker = contracts.cvxLocker;
        cvxStakingProxy = contracts.cvxStakingProxy;
        cvx = contracts.cvx;
        cvxCrv = contracts.cvxCrv;

        aliceInitialBalance = simpleToExactAmount(200);
        let tx = await cvx.transfer(aliceAddress, simpleToExactAmount(200));
        await tx.wait();

        tx = await cvx.transfer(bobAddress, simpleToExactAmount(100));
        await tx.wait();
    };

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];

        await setup();
    });

    // it("checks all initial config", async () => {
    //     // expect(await )
    // });

    context("performing basic flow", () => {
        before(async () => {
            await setup();
        });
        it("lock CVX", async () => {
            let tx = await cvx.connect(alice).approve(auraLocker.address, simpleToExactAmount(100));
            await tx.wait();

            tx = await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(100));
            const lockResp = await tx.wait();
            const lockBlock = await ethers.provider.getBlock(lockResp.blockNumber);
            const lockTimestamp = ethers.BigNumber.from(lockBlock.timestamp);

            const stakedCvx = await cvx.balanceOf(auraLocker.address);
            expect(stakedCvx).to.equal(simpleToExactAmount(100));

            const balanceAfter = await cvx.balanceOf(aliceAddress);
            expect(balanceAfter).to.equal(aliceInitialBalance.sub(simpleToExactAmount(100)));

            const lock = await auraLocker.userLocks(aliceAddress, 0);

            expect(lock.amount).to.equal(simpleToExactAmount(100));

            const lockDuration = await auraLocker.lockDuration();
            const rewardsDuration = await auraLocker.rewardsDuration();

            expect(lock.unlockTime).to.equal(lockDuration.add(lockTimestamp.div(rewardsDuration).mul(rewardsDuration)));
        });

        it("supports delegation", async () => {
            const delegateBefore = await auraLocker.delegates(aliceAddress);
            const balBefore = await auraLocker.balanceOf(aliceAddress);
            const votesBefore = await auraLocker.getVotes(aliceAddress);
            const delegatedBefore = await auraLocker.getVotes(bobAddress);

            const tx = await auraLocker.connect(alice).delegate(bobAddress);
            await tx.wait();

            const delegateAfter = await auraLocker.delegates(aliceAddress);
            const balAfter = await auraLocker.balanceOf(aliceAddress);
            const votesAfter = await auraLocker.getVotes(aliceAddress);
            const delegatedAfter = await auraLocker.getVotes(bobAddress);

            expect(delegateBefore).eq(ZERO_ADDRESS);
            expect(delegateAfter).eq(bobAddress);
            expect(balAfter).eq(balBefore);
            expect(votesBefore).eq(0);
            expect(votesAfter).eq(0);
            expect(delegatedBefore).eq(0);
            expect(delegatedAfter).eq(balBefore);
        });

        it("distribute rewards from the booster", async () => {
            await booster.earmarkRewards(0);
            await increaseTime(60 * 60 * 24);

            const incentive = await booster.stakerIncentive();
            const rate = await mocks.crvMinter.rate();
            const stakingCrvBalance = await mocks.crv.balanceOf(cvxStakingProxy.address);
            expect(stakingCrvBalance).to.equal(rate.mul(incentive).div(10000));

            const tx = await cvxStakingProxy.distribute();
            await tx.wait();
        });

        it("can't process locks that haven't expired", async () => {
            const resp = auraLocker.connect(alice)["processExpiredLocks(bool)"](false);
            await expect(resp).to.revertedWith("no exp locks");
        });

        it("checkpoint CVX locker epoch", async () => {
            await increaseTime(60 * 60 * 24 * 15);

            const tx = await auraLocker.checkpointEpoch();
            await tx.wait();

            const vlCVXBalance = await auraLocker.balanceAtEpochOf(0, aliceAddress);
            expect(vlCVXBalance).to.equal(simpleToExactAmount(100));
        });

        it("get rewards from CVX locker", async () => {
            await increaseTime(60 * 60 * 24 * 105);
            const cvxCrvBefore = await cvxCrv.balanceOf(aliceAddress);

            const tx = await auraLocker["getReward(address)"](aliceAddress);
            await tx.wait();
            const cvxCrvAfter = await cvxCrv.balanceOf(aliceAddress);

            const cvxCrvBalance = cvxCrvAfter.sub(cvxCrvBefore);
            expect(cvxCrvBalance.gt("0")).to.equal(true);
        });

        it("process expired locks", async () => {
            const tx = await auraLocker.connect(alice)["processExpiredLocks(bool)"](false);
            await tx.wait();

            const balance = await cvx.balanceOf(aliceAddress);
            expect(balance).to.equal(aliceInitialBalance);
        });
    });

    context("testing edge scenarios", () => {
        // t = 0.5, Lock, delegate to self, wait 15 weeks (1.5 weeks before lockup)
        beforeEach(async () => {
            await setup();

            await cvx.connect(alice).approve(auraLocker.address, simpleToExactAmount(100));
            await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(100));
            await auraLocker.connect(alice).delegate(aliceAddress);

            await increaseTime(ONE_WEEK.mul(15));
            await auraLocker.checkpointEpoch();
        });
        it("gives a 0 balance one lock has expired", async () => {
            expect(await auraLocker.getVotes(aliceAddress)).eq(simpleToExactAmount(100));
            await increaseTime(ONE_WEEK.mul(2));
            expect(await auraLocker.getVotes(aliceAddress)).eq(0);
        });
        // t = 15.5, Confirm lock hasn't yet expired. Then try to withdraw (fails)
        // t = 16.5, Confirm lock hasn't yet expired. Then try to withdraw without relock (fails)
        // t = 16.5, relock
        it("allows locks to be processed one week before they are expired ONLY if relocking", async () => {
            expect((await auraLocker.userLocks(aliceAddress, 0)).unlockTime).gt(await getTimestamp());
            await expect(auraLocker.connect(alice).processExpiredLocks(true)).to.be.revertedWith("no exp locks");
            await expect(auraLocker.connect(alice).processExpiredLocks(false)).to.be.revertedWith("no exp locks");

            await increaseTime(ONE_WEEK);

            expect((await auraLocker.userLocks(aliceAddress, 0)).unlockTime).gt(await getTimestamp());
            await expect(auraLocker.connect(alice).processExpiredLocks(false)).to.be.revertedWith("no exp locks");

            expect(await auraLocker.getVotes(aliceAddress)).eq(simpleToExactAmount(100));
            expect((await auraLocker.balances(aliceAddress)).locked).eq(simpleToExactAmount(100));

            await auraLocker.connect(alice).processExpiredLocks(true);

            const timeBefore = await getTimestamp();
            await increaseTime(ONE_WEEK);

            expect(await auraLocker.getVotes(aliceAddress)).eq(simpleToExactAmount(100));
            expect(await auraLocker.getPastVotes(aliceAddress, timeBefore)).eq(simpleToExactAmount(100));
            expect((await auraLocker.balances(aliceAddress)).locked).eq(simpleToExactAmount(100));
        });
        it("allows locks to be processed after they are expired", async () => {
            await increaseTime(ONE_WEEK);

            expect((await auraLocker.userLocks(aliceAddress, 0)).unlockTime).gt(await getTimestamp());
            await expect(auraLocker.connect(alice).processExpiredLocks(false)).to.be.revertedWith("no exp locks");

            await increaseTime(ONE_WEEK);

            await auraLocker.connect(alice).processExpiredLocks(false);

            expect(await auraLocker.getVotes(aliceAddress)).eq(0);
            expect((await auraLocker.balances(aliceAddress)).locked).eq(0);
        });
        it("allows lock to be processed with other unexpired locks following", async () => {
            await cvx.connect(alice).approve(auraLocker.address, simpleToExactAmount(100));
            await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(10));
            await increaseTime(ONE_WEEK);
            await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(10));
            await increaseTime(ONE_WEEK);

            await auraLocker.connect(alice).processExpiredLocks(true);

            await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(10));
            await increaseTime(ONE_WEEK);

            expect(await auraLocker.getVotes(aliceAddress)).eq(simpleToExactAmount(130));
            expect((await auraLocker.balances(aliceAddress)).locked).eq(simpleToExactAmount(130));
        });
        it("doesn't allow processing of the same lock twice", async () => {
            await increaseTime(ONE_WEEK);

            await auraLocker.connect(alice).processExpiredLocks(true);

            await increaseTime(ONE_WEEK);

            await expect(auraLocker.connect(alice).processExpiredLocks(true)).to.be.revertedWith("no exp locks");
        });

        // e.g. unlockTime = 17, now = 15.5, kick > 20
        it("kicks user after sufficient time has elapsed", async () => {
            await increaseTime(ONE_WEEK.mul(4));

            // expect (17 + 3) > now
            expect(BN.from((await auraLocker.userLocks(aliceAddress, 0)).unlockTime).add(ONE_WEEK.mul(3))).gt(
                await getTimestamp(),
            );
            await expect(auraLocker.connect(alice).kickExpiredLocks(aliceAddress)).to.be.revertedWith("no exp locks");

            await increaseTime(ONE_WEEK);

            await auraLocker.connect(alice).kickExpiredLocks(aliceAddress);
        });

        const oneWeekInAdvance = async (): Promise<BN> => {
            const now = await getTimestamp();
            return now.add(ONE_WEEK);
        };
        const floorToWeek = t => Math.trunc(Math.trunc(t / ONE_WEEK.toNumber()) * ONE_WEEK.toNumber());

        // for example, delegate, then add a lock.. should keep the same checkpoint and update it
        it("combines multiple delegation checkpoints in the same epoch", async () => {
            await cvx.connect(alice).approve(auraLocker.address, simpleToExactAmount(100));
            await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(10));

            const nextEpoch = await floorToWeek(await oneWeekInAdvance());
            const checkpointCount0 = await auraLocker.numCheckpoints(aliceAddress);
            const checkpoint0 = await auraLocker.checkpoints(aliceAddress, checkpointCount0 - 1);

            expect(checkpoint0.epochStart).eq(nextEpoch);
            expect(checkpoint0.votes).eq(simpleToExactAmount(110));

            await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(10));
            await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(10));

            const checkpointCount1 = await auraLocker.numCheckpoints(aliceAddress);
            const checkpoint1 = await auraLocker.checkpoints(aliceAddress, checkpointCount1 - 1);

            expect(checkpointCount1).eq(checkpointCount0);
            expect(checkpoint1.epochStart).eq(nextEpoch);
            expect(checkpoint1.votes).eq(simpleToExactAmount(130));

            await auraLocker.connect(alice).delegate(bobAddress);

            const checkpointCount2 = await auraLocker.numCheckpoints(aliceAddress);
            const checkpoint2 = await auraLocker.checkpoints(aliceAddress, checkpointCount2 - 1);

            expect(checkpointCount2).eq(checkpointCount0);
            expect(checkpoint2.epochStart).eq(nextEpoch);
            expect(checkpoint2.votes).eq(0);
        });
        it("allows for delegate checkpointing and balance lookup after 16 weeks have elapsed");
        it("should allow re-delegating in the same period");
        it("allows delegation even with 0 balance");
    });

    context("queueing new rewards", () => {
        it("only allows the rewardsDistributor to queue cvxCRV rewards");
        it("only starts distributing the rewards when the queued amount is over 83% of the remaining");
    });

    context("checking delegation timelines", () => {
        let delegate0, delegate1, delegate2;

        /*                                **
         *  0   1   2   3   8   9 ... 16  17  18 <-- Weeks
         * alice    alice    bob                 <-- Locking
         *    ^
         * +alice ^           ^                  <-- delegate 0
         *      +alice      +bob        ^        <-- delegate 1
         *                            +alice     <-- delegate 2
         *
         * delegate0 has balance of 100 in 1
         * delegate1 has balance of 100 from 2, 200 from 3-8, 300 from 9-16 & 100 from 17
         * delegate2 has balance of 100 from 17
         */
        before(async () => {
            await setup();
            delegate0 = await accounts[2].getAddress();
            delegate1 = await accounts[3].getAddress();
            delegate2 = await accounts[4].getAddress();

            // Mint some cvxCRV and add as the reward token manually
            let tx = await booster.earmarkRewards(0);
            await tx.wait();

            tx = await cvxStakingProxy.distribute();
            await tx.wait();

            tx = await cvx.connect(alice).approve(auraLocker.address, simpleToExactAmount(100));
            await tx.wait();
            tx = await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(100));
            await tx.wait();

            const lock = await auraLocker.userLocks(aliceAddress, 0);
            expect(lock.amount).to.equal(simpleToExactAmount(100));
        });
        it("has no delegation at the start", async () => {
            const delegate = await auraLocker.delegates(aliceAddress);
            expect(delegate).eq(ZERO_ADDRESS);

            expect((await auraLocker.rewardData(cvxCrv.address)).rewardRate).gt(0);
        });
        it("fails to delegate to 0", async () => {
            await expect(auraLocker.connect(alice).delegate(ZERO_ADDRESS)).to.be.revertedWith(
                "Must delegate to someone",
            );
        });
        it("fails when bob tries to delegate with no locks", async () => {
            await expect(auraLocker.connect(bob).delegate(delegate0)).to.be.revertedWith("Nothing to delegate");
        });
        // t = 0.5 -> 1.5
        it("delegates to 0", async () => {
            const tx = await auraLocker.connect(alice).delegate(delegate0);
            await tx.wait();

            const aliceBal = (await auraLocker.balances(aliceAddress)).locked;
            const aliceVotes = await auraLocker.getVotes(aliceAddress);
            const delegatee = await auraLocker.delegates(aliceAddress);
            let delegateVotes = await auraLocker.getVotes(delegate0);
            expect(aliceBal).eq(simpleToExactAmount(100));
            expect(aliceVotes).eq(0);
            expect(delegatee).eq(delegate0);
            expect(delegateVotes).eq(0);

            await increaseTime(ONE_WEEK);

            delegateVotes = await auraLocker.getVotes(delegate0);
            expect(delegateVotes).eq(simpleToExactAmount(100));
        });
        it("fails to delegate back to 0", async () => {
            await expect(auraLocker.connect(alice).delegate(ZERO_ADDRESS)).to.be.revertedWith(
                "Must delegate to someone",
            );
        });
        // t = 1.5 -> 2.5
        it("changes delegation to delegate1", async () => {
            const tx = await auraLocker.connect(alice).delegate(delegate1);
            await tx.wait();

            const delegatee = await auraLocker.delegates(aliceAddress);
            let delegate0Votes = await auraLocker.getVotes(delegate0);
            let delegate1Votes = await auraLocker.getVotes(delegate1);
            expect(delegatee).eq(delegate1);
            expect(delegate0Votes).eq(simpleToExactAmount(100));
            expect(delegate1Votes).eq(0);

            const week1point5 = await getTimestamp();

            await increaseTime(ONE_WEEK);

            const week2point5 = await getTimestamp();

            delegate0Votes = await auraLocker.getVotes(delegate0);
            const delegate0Historic = await auraLocker.getPastVotes(delegate0, week1point5);
            const delegate0Now = await auraLocker.getPastVotes(delegate0, week2point5);
            delegate1Votes = await auraLocker.getVotes(delegate1);
            const delegate1Historic = await auraLocker.getPastVotes(delegate1, week1point5);
            const delegate1Now = await auraLocker.getPastVotes(delegate1, week2point5);

            expect(delegate0Votes).eq(0);
            expect(delegate0Historic).eq(simpleToExactAmount(100));
            expect(delegate0Now).eq(0);
            expect(delegate1Votes).eq(simpleToExactAmount(100));
            expect(delegate1Historic).eq(0);
            expect(delegate1Now).eq(simpleToExactAmount(100));
        });

        // t = 2.5 -> 8.5
        it("deposits more for alice", async () => {
            let tx = await cvx.connect(alice).approve(auraLocker.address, simpleToExactAmount(100));
            await tx.wait();
            tx = await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(100));
            await tx.wait();

            const week2point5 = await getTimestamp();

            await increaseTime(ONE_WEEK);

            const week3point5 = await getTimestamp();

            const delegate1Historic = await auraLocker.getPastVotes(delegate1, week2point5);
            const delegate1Now = await auraLocker.getPastVotes(delegate1, week3point5);

            expect(delegate1Historic).eq(simpleToExactAmount(100));
            expect(delegate1Now).eq(simpleToExactAmount(200));

            await increaseTime(ONE_WEEK.mul(5));
        });
        // t = 8.5 -> 16.5
        it("deposits for bob and delegates", async () => {
            let tx = await cvx.connect(bob).approve(auraLocker.address, simpleToExactAmount(100));
            await tx.wait();
            tx = await auraLocker.connect(bob).lock(bobAddress, simpleToExactAmount(100));
            await tx.wait();
            tx = await auraLocker.connect(bob).delegate(delegate1);
            await tx.wait();

            const week8point5 = await getTimestamp();

            await increaseTime(ONE_WEEK);

            const week9point5 = await getTimestamp();

            const delegate1Historic = await auraLocker.getPastVotes(delegate1, week8point5);
            const delegate1Now = await auraLocker.getPastVotes(delegate1, week9point5);

            expect(delegate1Historic).eq(simpleToExactAmount(200));
            expect(delegate1Now).eq(simpleToExactAmount(300));

            await increaseTime(ONE_WEEK.mul(7));
        });

        // t = 16.5 -> 17.5
        it("delegates alice to 2 and omits upcoming release", async () => {
            const tx = await auraLocker.connect(alice).delegate(delegate2);
            await tx.wait();

            const week16point5 = await getTimestamp();

            await increaseTime(ONE_WEEK);

            const week17point5 = await getTimestamp();

            const delegate1Historic = await auraLocker.getPastVotes(delegate1, week16point5);
            const delegate1Now = await auraLocker.getPastVotes(delegate1, week17point5);
            const delegate2Historic = await auraLocker.getPastVotes(delegate2, week16point5);
            const delegate2Now = await auraLocker.getPastVotes(delegate2, week17point5);

            expect(delegate1Historic).eq(simpleToExactAmount(300));
            expect(delegate1Now).eq(simpleToExactAmount(100));

            expect(delegate2Historic).eq(simpleToExactAmount(0));
            expect(delegate2Now).eq(simpleToExactAmount(100));
        });
    });
});
