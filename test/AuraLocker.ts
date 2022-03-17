import hre, { ethers } from "hardhat";
import { Signer, ContractTransaction } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { AuraStakingProxy, Booster, ConvexToken, CvxCrvToken, AuraLocker, BaseRewardPool } from "../types/generated";
import {
    BN,
    sum,
    getTimestamp,
    increaseTime,
    ONE_WEEK,
    ONE_DAY,
    simpleToExactAmount,
    ZERO,
    ZERO_ADDRESS,
} from "../test-utils";

interface UserLock {
    amount: BN;
    unlockTime: number;
}
interface SnapshotData {
    account: {
        auraLockerBalance: BN;
        balances: { locked: BN; nextUnlockIndex: number };
        cvxBalance: BN;
        claimableRewards: Array<{ token: string; amount: BN }>;
        delegatee: string;
        locks: UserLock[];
        rewardData: {
            periodFinish: number;
            lastUpdateTime: number;
            rewardRate: BN;
            rewardPerTokenStored: BN;
        };
        votes: BN;
    };
    delegatee: {
        checkpointedVotes: Array<{ votes: BN; epochStart: number }>;
        unlocks: BN[];
        votes: BN;
    };
    cvxBalance: BN;
    lockedSupply: BN;
    epochs: Array<{ supply: BN; date: number }>;
}

// TODO -
// - [ ] @AuraLocker.approveRewardDistributor
// - [ ] @AuraLocker.setKickIncentive
// - [ ] @AuraLocker.shutdown
// - [ ] @AuraLocker.recoverERC20
// - [ ] @AuraLocker.getReward when _rewardsToken == cvxCrv && _stake
// - [ ] @AuraLocker._processExpiredLocks  when if (_checkDelay > 0)
// - [ ] @AuraLocker.getPastTotalSupply
// - [ ] @AuraLocker.balanceOf when locks[i].unlockTime <= block.timestamp
// - [ ] @AuraLocker.lockedBalances
// - [ ] @AuraLocker.totalSupply
// - [ ] @AuraLocker.totalSupplyAtEpoch
// - [ ] @AuraLocker.findEpochId
// - [x] @AuraLocker.epochCount
// - [x] @AuraLocker.decimals()
// - [x] @AuraLocker.name()
// - [x] @AuraLocker.symbol()
// - [x] @AuraLocker.claimableRewards
// - [ ] @AuraLocker.queueNewRewards when NOT if(block.timestamp >= rdata.periodFinish)
// - [ ] @AuraLocker.notifyRewardAmount when NOT if (block.timestamp >= rdata.periodFinish)
// - [ ] Reward.rewardPerTokenStored changed from uint208=>uint96 , verify overflows
describe("AuraLocker", () => {
    let accounts: Signer[];
    let auraLocker: AuraLocker;
    let cvxStakingProxy: AuraStakingProxy;
    let cvxCrvRewards: BaseRewardPool;
    let booster: Booster;
    let cvx: ConvexToken;
    let cvxCrv: CvxCrvToken;
    let mocks: DeployMocksResult;

    let deployer: Signer;

    let alice: Signer;
    let aliceInitialBalance: BN;
    let aliceAddress: string;
    let bob: Signer;
    let bobAddress: string;
    const boosterPoolId = 0;
    const getSnapShot = async (accountAddress: string): Promise<SnapshotData> => {
        const rewardData = await auraLocker.rewardData(cvxCrv.address);
        // const userData = await auraLocker.userData(accountAddress);
        const delegateeAddress = await auraLocker.delegates(accountAddress);
        const locks = await getUserLocks(accountAddress, delegateeAddress);
        const checkpointedVotes = await getCheckpointedVotes(delegateeAddress);

        // const delegateeLocks = await getDelegateeLocks(delegateeAddress);
        // await auraLocker.delegateeUnlocks(delegateeAddress,lastEpoch.index),
        return logSnapShot({
            account: {
                balances: await auraLocker.balances(accountAddress),
                auraLockerBalance: await auraLocker.balanceOf(accountAddress),
                cvxBalance: await cvx.balanceOf(accountAddress),
                delegatee: delegateeAddress,
                rewardData,
                claimableRewards: await auraLocker.claimableRewards(accountAddress),
                votes: await auraLocker.getVotes(accountAddress),
                locks: locks.userLocks,
            },
            delegatee: {
                unlocks: locks.delegateeUnlocks,
                votes: await auraLocker.getVotes(delegateeAddress),
                checkpointedVotes,
            },
            lockedSupply: await auraLocker.lockedSupply(),
            cvxBalance: await cvx.balanceOf(auraLocker.address),
            epochs: await getEpochs(),
        });
    };
    const logSnapShot = (snapshot: SnapshotData): SnapshotData => {
        console.log(`
        account.rewardData.lastUpdateTime:      ${snapshot.account.rewardData.lastUpdateTime}
        account.rewardData.periodFinish:        ${snapshot.account.rewardData.periodFinish}
        account.rewardData.rewardPerTokenStored:${snapshot.account.rewardData.rewardPerTokenStored.toString()}
        account.rewardData.rewardRate:          ${snapshot.account.rewardData.rewardRate.toString()}
        account.auraLockerBal:            ${snapshot.account.auraLockerBalance.toString()}
        account.balances.locked:          ${snapshot.account.balances.locked.toString()}
        account.balances.nextUnlockIndex: ${snapshot.account.balances.nextUnlockIndex}
        account.cvxBalance:     ${snapshot.account.cvxBalance.toString()}
        account.claimableRewar: ${snapshot.account.claimableRewards
            .map(cr => `token: ${cr.token}, amount: ${cr.amount.toString()}`)
            .join(",")}
        account.delegatee:      ${snapshot.account.delegatee}
        account.locks:          ${snapshot.account.locks
            .map(l => `{ amount:${l.amount.toString()}, unlockTime:${l.unlockTime.toString()} }`)
            .join(",")}
        account.votes:          ${snapshot.account.votes.toString()}
        cvxBalance:     ${snapshot.cvxBalance.toString()}
        lockedSupply:   ${snapshot.lockedSupply.toString()}
        epochs:         ${snapshot.epochs
            .map(e => `{ supply:${e.supply.toString()}, date:${e.date.toString()}}`)
            .join(",")}
        delegatee.cpVotes: ${snapshot.delegatee.checkpointedVotes
            .map(u => `{epochStart:${u.epochStart.toString()}, votes:${u.votes.toString()} }`)
            .join(",")}
        delegatee.unlocks: ${snapshot.delegatee.unlocks.map(u => u.toString()).join(",")}
        delegatee.votes:   ${snapshot.delegatee.votes.toString()}
        `);
        // delegatee.unlocks:   ${snapshot.delegatee.unlocks.toString()}
        return snapshot;
    };
    const getEpochs = async (): Promise<Array<{ supply: BN; date: number }>> => {
        const epochs = [];
        try {
            for (let i = 0; i < 128; i++) epochs.push(await auraLocker.epochs(i));
        } catch (error) {
            // do nothing
        }
        return epochs;
    };
    const getUserLocks = async (
        userAddress: string,
        delegateeAddress: string,
    ): Promise<{ userLocks: Array<UserLock>; delegateeUnlocks: Array<BN> }> => {
        // :Promise<{ {supply: BN, date: number}, index:number }>
        // let epoch:{supply: BigNumber, date: number};
        const userLocks: Array<UserLock> = [];
        const delegateeUnlocks: Array<BN> = [];
        try {
            for (let i = 0; i < 128; i++) {
                const lock = await auraLocker.userLocks(userAddress, i);
                userLocks.push(lock);
                if (delegateeAddress !== ZERO_ADDRESS) {
                    delegateeUnlocks.push(await auraLocker.delegateeUnlocks(delegateeAddress, lock.unlockTime));
                }
            }
        } catch (error) {
            // do nothing
        }
        return { userLocks, delegateeUnlocks };
    };
    const getCheckpointedVotes = async (
        delegateeAddress: string,
    ): Promise<Array<{ votes: BN; epochStart: number }>> => {
        // :Promise<{ {supply: BN, date: number}, index:number }>
        // let epoch:{supply: BigNumber, date: number};
        const checkpointedVotes: Array<{ votes: BN; epochStart: number }> = [];
        try {
            const len = await auraLocker.numCheckpoints(delegateeAddress);
            for (let i = 0; i < len; i++) checkpointedVotes.push(await auraLocker.checkpoints(delegateeAddress, i));
        } catch (error) {
            // do nothing
        }
        return checkpointedVotes;
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const getDelegateeLocks = async (userAddress: string): Promise<Array<BN>> => {
        // :Promise<{ {supply: BN, date: number}, index:number }>
        // let epoch:{supply: BigNumber, date: number};
        const unlocks: Array<BN> = [];
        try {
            for (let i = 0; i < 128; i++) unlocks.push(await auraLocker.delegateeUnlocks(userAddress, i));
        } catch (error) {
            // do nothing
        }
        return unlocks;
    };
    const getCurrentEpoch = async (timeStamp?: BN) => {
        if (!timeStamp) {
            timeStamp = await getTimestamp();
        }
        const rewardsDuration = await auraLocker.rewardsDuration();
        return timeStamp.div(rewardsDuration).mul(rewardsDuration);
    };
    // ============================================================
    const verifyCheckpointDelegate = async (
        tx: ContractTransaction,
        dataBefore: SnapshotData,
        dataAfter: SnapshotData,
    ) => {
        // const expectedUserLocks = dataBefore.account.locks.map(l => l.amount)[dataBefore.account.locks.length-1];
        // const expectedUserLocks = dataBefore.account.locks.map(l => l.amount).reduce(sum,BN.from(0));
        // const expectedDelgateeUnlocks = expectedUserLocks;
        // const expectedDelgateeVotes = expectedUserLocks;
        // const expectedDelgateeUnlocks = dataBefore.delegatee.unlocks.reduce(sum,BN.from(0)).add(expectedUserLocks);
        // const expectedDelgateeVotes = dataBefore.delegatee.checkpointedVotes.map(c=>c.votes).reduce(sum,BN.from(0)).add(expectedUserLocks);
        // const expectedDelgateeUnlocks = dataBefore.delegatee.unlocks[dataBefore.delegatee.unlocks.length-1].add(expectedUserLocks);
        // const expectedDelgateeVotes = dataBefore.delegatee.checkpointedVotes.map(c=>c.votes).reduce(sum,BN.from(0)).add(expectedUserLocks);
        // expect(dataAfter.delegatee.unlocks.reduce(sum,BN.from(0)), "delegatee unlocks increased").eq(expectedDelgateeUnlocks);
        // expect(dataAfter.delegatee.checkpointedVotes.map(c=>c.votes).reduce(sum,BN.from(0)), "delegatee checkpoints votes increased").eq(expectedDelgateeVotes);
        await expect(tx).emit(auraLocker, "DelegateCheckpointed").withArgs(dataAfter.account.delegatee);
    };

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
        cvxCrvRewards = contracts.cvxCrvRewards;
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

    it("checks all initial config", async () => {
        expect(await auraLocker.name(), "AuraLocker name").to.equal(mocks.namingConfig.vlCvxName);
        expect(await auraLocker.symbol(), "AuraLocker symbol").to.equal(mocks.namingConfig.vlCvxSymbol);
        // hardcoded on smart contract.
        expect(await auraLocker.decimals(), "AuraLocker decimals").to.equal(18);
        expect(await auraLocker.stakingToken(), "AuraLocker staking token").to.equal(cvx.address);
        expect(await auraLocker.cvxCrv(), "AuraLocker cvxCrv").to.equal(cvxCrv.address);
        expect(await auraLocker.cvxcrvStaking(), "AuraLocker cvxCrvStaking").to.equal(cvxCrvRewards.address);
        expect(await auraLocker.epochCount(), "AuraLocker epoch counts").to.equal(1);
        expect(await auraLocker.queuedCvxCrvRewards(), "AuraLocker lockDuration").to.equal(0);
        expect(await auraLocker.rewardPerToken(cvxCrv.address), "AuraLocker rewardPerToken").to.equal(0);
        // expect(await auraLocker.rewardTokens(0),"AuraLocker lockDuration").to.equal( 86400 * 7 * 17);

        // constants
        expect(await auraLocker.newRewardRatio(), "AuraLocker newRewardRatio").to.equal(830);
        expect(await auraLocker.rewardsDuration(), "AuraLocker rewardsDuration").to.equal(86400 * 7);
        expect(await auraLocker.lockDuration(), "AuraLocker lockDuration").to.equal(86400 * 7 * 17);
    });

    context.skip("performing basic flow", () => {
        before(async () => {
            await setup();
        });
        it("can't process locks if nothing has been locked", async () => {
            const resp = auraLocker.connect(alice).processExpiredLocks(false);
            await expect(resp).to.revertedWith("no locks");
        });

        it("lock CVX", async () => {
            const cvxAmount = simpleToExactAmount(100);
            let tx = await cvx.connect(alice).approve(auraLocker.address, cvxAmount);
            await tx.wait();
            const dataBefore = await getSnapShot(aliceAddress);
            // - [] Verify updateReward
            // - [] Verify _checkpointEpoch
            // epochs[0] , no changes
            // - [x] Verify Balances[user].
            // - [x] Verify LockedBalance[user].
            // - [x] Verify delegate - lock amount
            // - [] Verify delegate - _checkpointDelegate
            // - [x] Verify epoch.supply
            tx = await auraLocker.connect(alice).lock(aliceAddress, cvxAmount);

            await expect(tx).emit(auraLocker, "Staked").withArgs(aliceAddress, cvxAmount, cvxAmount);
            const dataAfter = await getSnapShot(aliceAddress);

            const lockResp = await tx.wait();
            const lockBlock = await ethers.provider.getBlock(lockResp.blockNumber);
            const lockTimestamp = ethers.BigNumber.from(lockBlock.timestamp);

            expect(dataAfter.cvxBalance, "Staked CVX").to.equal(dataBefore.cvxBalance.add(cvxAmount));
            expect(dataAfter.lockedSupply, "Staked lockedSupply ").to.equal(dataBefore.lockedSupply.add(cvxAmount));
            expect(dataAfter.account.cvxBalance, "cvx balance").to.equal(dataBefore.account.cvxBalance.sub(cvxAmount));

            expect(dataAfter.account.balances.locked, "user cvx balances locked").to.equal(
                dataBefore.account.balances.locked.add(cvxAmount),
            );
            expect(dataAfter.account.balances.nextUnlockIndex, "user balances nextUnlockIndex").to.equal(
                dataBefore.account.balances.nextUnlockIndex,
            );

            const currentEpoch = await getCurrentEpoch(lockTimestamp);
            const lock = await auraLocker.userLocks(aliceAddress, 0);
            const lockDuration = await auraLocker.lockDuration();

            const unlockTime = lockDuration.add(currentEpoch);
            expect(lock.amount, "user locked amount").to.equal(cvxAmount);
            expect(lock.unlockTime, "user unlockTime").to.equal(unlockTime);

            expect(dataAfter.account.delegatee, "user delegatee does not change").to.equal(
                dataBefore.account.delegatee,
            );
            if (dataAfter.account.delegatee !== ZERO_ADDRESS) {
                console.log("ts:delegatee is not zero", dataAfter.account.delegatee);
                const delegateeUnlocks = await auraLocker.delegateeUnlocks(dataAfter.account.delegatee, unlockTime);
                expect(delegateeUnlocks, "user unlockTime").to.equal(cvxAmount);
            }
            // If the last epoch date is before the current epoch, the epoch index should not be updated.
            const lenA = dataAfter.epochs.length;
            const lenB = dataBefore.epochs.length;
            expect(dataAfter.epochs[lenA - 1].supply, "epoch date does not change").to.equal(
                dataBefore.epochs[lenB - 1].supply.add(cvxAmount),
            );
            expect(dataAfter.epochs[lenA - 1].date, "epoch date does not change").to.equal(
                dataBefore.epochs[lenB - 1].date,
            );
        });

        it("supports delegation", async () => {
            // Given
            const dataBefore = await getSnapShot(aliceAddress);

            const tx = await auraLocker.connect(alice).delegate(bobAddress);
            await expect(tx).emit(auraLocker, "DelegateChanged").withArgs(aliceAddress, ZERO_ADDRESS, bobAddress);

            const dataAfter = await getSnapShot(aliceAddress);

            expect(dataBefore.account.delegatee).eq(ZERO_ADDRESS);
            expect(dataBefore.account.auraLockerBalance).eq(dataAfter.account.auraLockerBalance);
            expect(dataBefore.account.votes).eq(0);
            expect(dataBefore.delegatee.votes).eq(0);
            expect(dataBefore.delegatee.unlocks.length, "delegatee unlocks").eq(0);

            expect(dataAfter.account.delegatee).eq(bobAddress);
            expect(dataAfter.account.votes).eq(0);
            expect(dataAfter.delegatee.votes).eq(0);

            await verifyCheckpointDelegate(tx, dataBefore, dataAfter);
        });

        it("distribute rewards from the booster", async () => {
            // TODO - is it needed?
            await booster.earmarkRewards(boosterPoolId);
            await increaseTime(ONE_DAY);

            const incentive = await booster.stakerIncentive();
            const rate = await mocks.crvMinter.rate();
            const stakingCrvBalance = await mocks.crv.balanceOf(cvxStakingProxy.address);
            expect(stakingCrvBalance).to.equal(rate.mul(incentive).div(10000));

            const tx = await cvxStakingProxy.distribute();
            await tx.wait();
        });

        it("can't process locks that haven't expired", async () => {
            const resp = auraLocker.connect(alice).processExpiredLocks(false);
            await expect(resp).to.revertedWith("no exp locks");
        });

        it("checkpoint CVX locker epoch", async () => {
            await increaseTime(ONE_DAY.mul(15));

            const dataBefore = await getSnapShot(aliceAddress);
            const tx = await auraLocker.checkpointEpoch();
            await tx.wait();
            const dataAfter = await getSnapShot(aliceAddress);

            const rewardsDuration = await auraLocker.rewardsDuration();
            const newEpochs = ONE_DAY.mul(15).div(rewardsDuration).add(0);
            // TODO - at midnight, the epochs are 0 plus instead of 1 plus
            // TODO - ASK  maha if the last epoch should be added.
            expect(dataAfter.epochs.length, "new epochs added").to.equal(newEpochs.add(dataBefore.epochs.length));

            const vlCVXBalance = await auraLocker.balanceAtEpochOf(0, aliceAddress);
            expect(vlCVXBalance, "vlCVXBalance at epoch is correct").to.equal(simpleToExactAmount(100));
            expect(
                await auraLocker.balanceAtEpochOf(dataAfter.account.locks.length, aliceAddress),
                "vlCVXBalance at epoch is correct",
            ).to.equal(simpleToExactAmount(100));
        });

        it("get rewards from CVX locker", async () => {
            console.log("==========get rewards from CVX locker=====");
            await increaseTime(ONE_DAY.mul(105));
            const cvxCrvBefore = await cvxCrv.balanceOf(aliceAddress);
            const dataBefore = await getSnapShot(aliceAddress);

            // const lastTimeRewardApplicable = await auraLocker.lastTimeRewardApplicable(cvxCrv.address);
            expect(await auraLocker.rewardPerToken(cvxCrv.address), "rewardPerToken").to.equal(
                dataBefore.account.claimableRewards[0].amount.div(100),
            );
            // expect(await auraLocker.lastTimeRewardApplicable(cvxCrv.address), "lastTimeRewardApplicable").to.equal(await getTimestamp());

            const tx = await auraLocker["getReward(address)"](aliceAddress);
            const dataAfter = await getSnapShot(aliceAddress);

            await tx.wait();
            const cvxCrvAfter = await cvxCrv.balanceOf(aliceAddress);

            const cvxCrvBalance = cvxCrvAfter.sub(cvxCrvBefore);
            expect(cvxCrvBalance.gt("0")).to.equal(true);
            expect(cvxCrvBalance).to.equal(dataBefore.account.claimableRewards[0].amount);
            expect(dataAfter.account.claimableRewards[0].amount).to.equal(0);
            await expect(tx)
                .emit(auraLocker, "RewardPaid")
                .withArgs(aliceAddress, await auraLocker.rewardTokens(0), cvxCrvBalance);
        });

        it("process expired locks", async () => {
            const relock = false;
            console.log("=============process expired locks=============== before");
            const dataBefore = await getSnapShot(aliceAddress);
            const tx = await auraLocker.connect(alice).processExpiredLocks(relock);
            await tx.wait();
            console.log("=============process expired locks=============== after");
            const dataAfter = await getSnapShot(aliceAddress);
            const balance = await cvx.balanceOf(aliceAddress);

            expect(dataAfter.account.balances.locked, "user cvx balances locked decreases").to.equal(0);
            expect(dataAfter.lockedSupply, "lockedSupply decreases").to.equal(
                dataBefore.lockedSupply.sub(dataBefore.account.balances.locked),
            );
            expect(balance).to.equal(aliceInitialBalance);
            await verifyCheckpointDelegate(tx, dataBefore, dataAfter);
            await expect(tx)
                .emit(auraLocker, "Withdrawn")
                .withArgs(aliceAddress, dataBefore.account.balances.locked, relock);
        });
    });

    context("testing edge scenarios", () => {
        let dataBefore: SnapshotData;
        // t = 0.5, Lock, delegate to self, wait 15 weeks (1.5 weeks before lockup)
        beforeEach(async () => {
            await setup();
            // Given that alice locks cvx and delegates to herself
            await cvx.connect(alice).approve(auraLocker.address, simpleToExactAmount(100));
            await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(100));
            await auraLocker.connect(alice).delegate(aliceAddress);

            await increaseTime(ONE_WEEK.mul(15));
            await auraLocker.checkpointEpoch();
            dataBefore = await getSnapShot(aliceAddress);
        });
        it.skip("gives a 0 balance one lock has expired", async () => {
            // it gets votes (past votes of current epoch)
            expect(await auraLocker.getVotes(aliceAddress)).eq(dataBefore.delegatee.unlocks[0]);
            await increaseTime(ONE_WEEK.mul(2));
            expect(await auraLocker.getVotes(aliceAddress)).eq(0);
        });
        // t = 15.5, Confirm lock hasn't yet expired. Then try to withdraw (fails)
        // t = 16.5, Confirm lock hasn't yet expired. Then try to withdraw without relock (fails)
        // t = 16.5, relock
        it.skip("allows locks to be processed one week before they are expired ONLY if relocking", async () => {
            expect(dataBefore.account.locks[0].unlockTime).gt(await getTimestamp());

            await expect(auraLocker.connect(alice).processExpiredLocks(true)).to.be.revertedWith("no exp locks");
            await expect(auraLocker.connect(alice).processExpiredLocks(false)).to.be.revertedWith("no exp locks");

            await increaseTime(ONE_WEEK);

            expect((await auraLocker.userLocks(aliceAddress, 0)).unlockTime).gt(await getTimestamp());
            await expect(auraLocker.connect(alice).processExpiredLocks(false)).to.be.revertedWith("no exp locks");

            expect(await auraLocker.getVotes(aliceAddress)).eq(simpleToExactAmount(100));
            expect((await auraLocker.balances(aliceAddress)).locked).eq(simpleToExactAmount(100));
            dataBefore = await getSnapShot(aliceAddress);

            const tx = await auraLocker.connect(alice).processExpiredLocks(true);
            const dataAfter = await getSnapShot(aliceAddress);

            const timeBefore = await getTimestamp();
            await increaseTime(ONE_WEEK);
            // as it is re-lock the cvx should not change.
            expect(dataAfter.account.cvxBalance, "cvx balance does not change").eq(dataBefore.account.cvxBalance);
            expect(await auraLocker.getVotes(aliceAddress)).eq(simpleToExactAmount(100));
            expect(await auraLocker.getPastVotes(aliceAddress, timeBefore)).eq(simpleToExactAmount(100));
            expect((await auraLocker.balances(aliceAddress)).locked).eq(simpleToExactAmount(100));
            await verifyCheckpointDelegate(tx, dataBefore, dataAfter);
            await expect(tx)
                .emit(auraLocker, "Withdrawn")
                .withArgs(aliceAddress, dataBefore.account.balances.locked, true);
        });
        it.skip("allows locks to be processed after they are expired", async () => {
            await increaseTime(ONE_WEEK);

            expect(dataBefore.account.locks[0].unlockTime).gt(await getTimestamp());
            await expect(auraLocker.connect(alice).processExpiredLocks(false)).to.be.revertedWith("no exp locks");

            await increaseTime(ONE_WEEK);

            await auraLocker.connect(alice).processExpiredLocks(false);

            expect(await auraLocker.getVotes(aliceAddress)).eq(0);
            expect((await auraLocker.balances(aliceAddress)).locked).eq(0);
        });
        it.skip("allows lock to be processed with other unexpired locks following", async () => {
            await cvx.connect(alice).approve(auraLocker.address, simpleToExactAmount(100));
            await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(10));
            await increaseTime(ONE_WEEK);
            await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(10));
            await increaseTime(ONE_WEEK);

            const beforeCvxBalance = await cvx.balanceOf(aliceAddress);
            await auraLocker.connect(alice).processExpiredLocks(true);
            expect(await cvx.balanceOf(aliceAddress), "relock - cvx balance does not change").eq(beforeCvxBalance);

            await auraLocker.connect(alice).lock(aliceAddress, simpleToExactAmount(10));
            await increaseTime(ONE_WEEK);

            expect(await auraLocker.getVotes(aliceAddress)).eq(simpleToExactAmount(130));
            expect((await auraLocker.balances(aliceAddress)).locked).eq(simpleToExactAmount(130));
        });
        it.skip("doesn't allow processing of the same lock twice", async () => {
            await increaseTime(ONE_WEEK);

            await auraLocker.connect(alice).processExpiredLocks(true);

            await increaseTime(ONE_WEEK);

            await expect(auraLocker.connect(alice).processExpiredLocks(true)).to.be.revertedWith("no exp locks");
        });

        // e.g. unlockTime = 17, now = 15.5, kick > 20
        it("kicks user after sufficient time has elapsed", async () => {
            console.log("========CURRENT TEST=====");
            await increaseTime(ONE_WEEK.mul(4));

            // expect (17 + 3) > now
            const kickRewardEpochDelay = await auraLocker.kickRewardEpochDelay();
            expect(BN.from(dataBefore.account.locks[0].unlockTime).add(ONE_WEEK.mul(kickRewardEpochDelay))).gt(
                await getTimestamp(),
            );

            await expect(auraLocker.connect(alice).kickExpiredLocks(aliceAddress)).to.be.revertedWith("no exp locks");
            // TODO - sol:_processExpiredLocks() - else -

            await increaseTime(ONE_WEEK);

            const tx = await auraLocker.connect(alice).kickExpiredLocks(aliceAddress);
            const dataAfter = await getSnapShot(aliceAddress);

            expect(dataAfter.account.cvxBalance, "cvx reward should be kicked").gt(dataBefore.account.cvxBalance);
            expect(dataAfter.account.cvxBalance, "cvx reward should be kicked").eq(
                dataBefore.account.cvxBalance.add(dataBefore.account.balances.locked),
            );
            await verifyCheckpointDelegate(tx, dataBefore, dataAfter);
            // Two events should be trigger, Withdrawn (locked amount) and KickReward (kick reward)
            // As the kicked user and lock user are the same, both amounts should be equal to the locked amount.
            await expect(tx)
                .emit(auraLocker, "Withdrawn")
                .withArgs(aliceAddress, dataBefore.account.balances.locked, false);
            await expect(tx)
                .emit(auraLocker, "KickReward")
                .withArgs(aliceAddress, aliceAddress, simpleToExactAmount(1));
        });

        const oneWeekInAdvance = async (): Promise<BN> => {
            const now = await getTimestamp();
            return now.add(ONE_WEEK);
        };
        const floorToWeek = t => Math.trunc(Math.trunc(t / ONE_WEEK.toNumber()) * ONE_WEEK.toNumber());

        // for example, delegate, then add a lock.. should keep the same checkpoint and update it
        it.skip("combines multiple delegation checkpoints in the same epoch", async () => {
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
        it.skip("allows for delegate checkpointing and balance lookup after 16 weeks have elapsed");
        it.skip("should allow re-delegating in the same period");
        it.skip("allows delegation even with 0 balance");
    });

    context.skip("queueing new rewards", () => {
        it.skip("only allows the rewardsDistributor to queue cvxCRV rewards");
        it.skip("only starts distributing the rewards when the queued amount is over 83% of the remaining");
    });

    context.skip("checking delegation timelines", () => {
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
            let tx = await booster.earmarkRewards(boosterPoolId);
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
        it("fails to delegate back to the same delegate", async () => {
            await expect(auraLocker.connect(alice).delegate(delegate0)).to.be.revertedWith("Must choose new delegatee");
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

    context.skip("fails if", () => {
        before(async () => {
            await setup();
        });
        it("lock wrong amount of CVX", async () => {
            const cvxAmount = 0;
            await expect(auraLocker.connect(alice).lock(aliceAddress, cvxAmount)).revertedWith("Cannot stake 0");
        });
        it("get past supply before any lock.", async () => {
            await expect(auraLocker.connect(alice).getPastTotalSupply(await getTimestamp())).revertedWith(
                "ERC20Votes: block not yet mined",
            );
        });
        it("approves reward wrong arguments", async () => {
            const tx = auraLocker.approveRewardDistributor(ZERO_ADDRESS, ZERO_ADDRESS, false);
            await expect(tx).revertedWith("Reward does not exist");
        });
        it.skip("@balanceAtEpochOf wrong epoch", async () => {
            await expect(await auraLocker.balanceAtEpochOf(10, aliceAddress)).revertedWith("Wrong epoch");
        });
        // admin role
        it("non admin - shutdowns", async () => {
            await expect(auraLocker.connect(alice).shutdown()).revertedWith("Ownable: caller is not the owner");
        });
        it("non admin - add Reward", async () => {
            await expect(auraLocker.connect(alice).addReward(ZERO_ADDRESS, ZERO_ADDRESS)).revertedWith(
                "Ownable: caller is not the owner",
            );
        });
        it("non admin - set Kick Incentive", async () => {
            await expect(auraLocker.connect(alice).setKickIncentive(ZERO, ZERO)).revertedWith(
                "Ownable: caller is not the owner",
            );
        });
        it("non admin - approves reward distributor", async () => {
            await expect(
                auraLocker.connect(alice).approveRewardDistributor(ZERO_ADDRESS, ZERO_ADDRESS, false),
            ).revertedWith("Ownable: caller is not the owner");
        });
        it("non admin - recover ERC20", async () => {
            await expect(auraLocker.connect(alice).recoverERC20(ZERO_ADDRESS, ZERO)).revertedWith(
                "Ownable: caller is not the owner",
            );
        });
    });
    context.skip("admin", () => {
        before(async () => {
            await setup();
        });
        it("approves reward distributor", async () => {
            const cvxAmount = simpleToExactAmount(100);
            await cvx.connect(alice).approve(auraLocker.address, cvxAmount);

            // approves  distributor
            await auraLocker.approveRewardDistributor(cvxCrv.address, cvxCrvRewards.address, true);
            await expect(await auraLocker.rewardDistributors(cvxCrv.address, cvxCrvRewards.address)).to.eq(true);

            // disapproves  distributor
            await auraLocker.approveRewardDistributor(cvxCrv.address, cvxCrvRewards.address, false);
            await expect(await auraLocker.rewardDistributors(cvxCrv.address, cvxCrvRewards.address)).to.eq(false);
        });
        it.skip("set Kick Incentive", async () => {
            // require(_rate <= 500, "over max rate"); //max 5% per epoch
            // require(_delay >= 2, "min delay"); //minimum 2 epochs of grace
            // KickIncentiveSet
            //  then what to do with it ?
            await expect(auraLocker.setKickIncentive(ZERO, ZERO)).revertedWith("Ownable: caller is not the owner");
        });
        it.skip("recover ERC20", async () => {
            // require(_tokenAddress != address(stakingToken), "Cannot withdraw staking token");
            // require(rewardData[_tokenAddress].lastUpdateTime == 0, "Cannot withdraw reward token");
            // IERC20(_tokenAddress).safeTransfer(owner(), _tokenAmount);
            // emit Recovered(_tokenAddress, _tokenAmount);

            await expect(auraLocker.recoverERC20(ZERO_ADDRESS, ZERO)).revertedWith("Ownable: caller is not the owner");
        });
    });
    context.skip("is shutdown", () => {
        before(async () => {
            await setup();
            // Given that the aura locker is shutdown
            await auraLocker.connect(deployer).shutdown();
            expect(await auraLocker.isShutdown()).to.eq(true);
        });
        it.skip("fails if lock", async () => {
            const cvxAmount = simpleToExactAmount(100);
            await cvx.connect(alice).approve(auraLocker.address, cvxAmount);
            const tx2 = auraLocker.connect(alice).lock(aliceAddress, cvxAmount);
            await expect(tx2).revertedWith("shutdown");
        });
        // _processExpiredLocks
    });
});
