import hre, { ethers } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { AuraStakingProxy, Booster, ConvexToken, CvxCrvToken, AuraLocker } from "../types/generated";
import { increaseTime, ZERO_ADDRESS } from "../test-utils";

describe("AuraLocker", () => {
    let accounts: Signer[];
    let auraLocker: AuraLocker;
    let cvxStakingProxy: AuraStakingProxy;
    let booster: Booster;
    let cvx: ConvexToken;
    let cvxCrv: CvxCrvToken;
    let mocks: DeployMocksResult;

    let deployer: Signer;

    let alice: Signer;
    let aliceAddress: string;
    let aliceInitialCvxBalance: BigNumberish;
    let bob: Signer;
    let bobAddress: string;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];

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

        const tx = await cvx.transfer(aliceAddress, ethers.utils.parseEther("100"));
        await tx.wait();

        aliceInitialCvxBalance = await cvx.balanceOf(aliceAddress);
    });

    async function earmarkRewards() {
        await increaseTime(60 * 60 * 24);
        const tx = await booster.earmarkRewards(0);
        await tx.wait();
    }

    it("lock CVX", async () => {
        let tx = await cvx.connect(alice).approve(auraLocker.address, aliceInitialCvxBalance);
        await tx.wait();

        tx = await auraLocker.connect(alice).lock(aliceAddress, aliceInitialCvxBalance);
        const lockResp = await tx.wait();
        const lockBlock = await ethers.provider.getBlock(lockResp.blockNumber);
        const lockTimestamp = ethers.BigNumber.from(lockBlock.timestamp);

        const stakedCvx = await cvx.balanceOf(auraLocker.address);
        expect(stakedCvx).to.equal(aliceInitialCvxBalance);

        const balanceAfter = await cvx.balanceOf(aliceAddress);
        expect(balanceAfter).to.equal(0);

        const lock = await auraLocker.userLocks(aliceAddress, 0);

        expect(lock.amount).to.equal(aliceInitialCvxBalance);

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
        await earmarkRewards();
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

        const vlCVXBalance = await auraLocker.balanceAtEpochOf("0", aliceAddress);
        expect(vlCVXBalance).to.equal(aliceInitialCvxBalance);
    });

    it("get rewards from CVX locker", async () => {
        await increaseTime(60 * 60 * 24 * 100);
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
        expect(balance).to.equal(aliceInitialCvxBalance);
    });
});
