import hre, { ethers } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { Booster, ConvexToken, CvxCrvToken, CvxLocker, CvxRewardPool, CvxStakingProxy } from "../types/generated";
import { increaseTime } from "../test-utils";

describe("CvxLocker", () => {
    let accounts: Signer[];
    let cvxLocker: CvxLocker;
    let cvxRewards: CvxRewardPool;
    let cvxStakingProxy: CvxStakingProxy;
    let booster: Booster;
    let cvx: ConvexToken;
    let cvxCrv: CvxCrvToken;
    let mocks: DeployMocksResult;

    let deployer: Signer;

    let alice: Signer;
    let aliceAddress: string;
    let aliceInitialCvxBalance: BigNumberish;

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

        booster = contracts.booster;
        cvxLocker = contracts.cvxLocker;
        cvxStakingProxy = contracts.cvxStakingProxy;
        cvxRewards = contracts.cvxRewards;
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
        let tx = await cvx.connect(alice).approve(cvxLocker.address, aliceInitialCvxBalance);
        await tx.wait();

        tx = await cvxLocker.connect(alice).lock(aliceAddress, aliceInitialCvxBalance, 0);
        const lockResp = await tx.wait();
        const lockBlock = await ethers.provider.getBlock(lockResp.blockNumber);
        const lockTimestamp = ethers.BigNumber.from(lockBlock.timestamp.toString());

        const stakedCvx = await cvxRewards.balanceOf(cvxStakingProxy.address);
        expect(stakedCvx.toString()).to.equal(aliceInitialCvxBalance.toString());

        const balanceAfter = await cvx.balanceOf(aliceAddress);
        expect(balanceAfter.toString()).to.equal("0");

        const lock = await cvxLocker.userLocks(aliceAddress, "0");

        expect(lock.amount.toString()).to.equal(aliceInitialCvxBalance.toString());
        expect(lock.boosted.toString()).to.equal(aliceInitialCvxBalance.toString());

        const lockDuration = await cvxLocker.lockDuration();
        const rewardsDuration = await cvxLocker.rewardsDuration();

        expect(lock.unlockTime.toString()).to.equal(
            lockDuration.add(lockTimestamp.div(rewardsDuration).mul(rewardsDuration)).toString(),
        );
    });

    it("distribute rewards from the booster", async () => {
        await earmarkRewards();
        await increaseTime(60 * 60 * 24);

        const incentive = await booster.stakerIncentive();
        const rate = await mocks.crvMinter.rate();
        const stakingCrvBalance = await mocks.crv.balanceOf(cvxRewards.address);
        expect(stakingCrvBalance.toString()).to.equal(rate.mul(incentive).div(10000).toString());

        const rewardPerToken = await cvxRewards.rewardPerToken();
        expect(rewardPerToken.gt("0")).to.equal(true);

        const tx = await cvxStakingProxy.distribute();
        await tx.wait();
    });

    it("can't process locks that haven't expired", async () => {
        const resp = cvxLocker.connect(alice)["processExpiredLocks(bool)"](false);
        await expect(resp).to.revertedWith("no exp locks");
    });

    it("checkpoint CVX locker epoch", async () => {
        await increaseTime(60 * 60 * 24 * 120);

        const tx = await cvxLocker.checkpointEpoch();
        await tx.wait();

        const vlCVXBalance = await cvxLocker.balanceAtEpochOf("0", aliceAddress);
        expect(vlCVXBalance.toString()).to.equal(aliceInitialCvxBalance.toString());
    });

    it("get rewards from CVX locker", async () => {
        const cvxCrvBefore = await cvxCrv.balanceOf(aliceAddress);

        const tx = await cvxLocker["getReward(address)"](aliceAddress);
        await tx.wait();
        const cvxCrvAfter = await cvxCrv.balanceOf(aliceAddress);

        const cvxCrvBalance = cvxCrvAfter.sub(cvxCrvBefore);
        expect(cvxCrvBalance.gt("0")).to.equal(true);
    });

    it("process expired locks", async () => {
        const tx = await cvxLocker.connect(alice)["processExpiredLocks(bool)"](false);
        await tx.wait();

        const balance = await cvx.balanceOf(aliceAddress);
        expect(balance.toString()).to.equal(aliceInitialCvxBalance.toString());
    });
});
