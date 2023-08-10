import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { DeployL2MocksResult } from "scripts/deploySidechainMocks";

import {
    getTimestamp,
    impersonateAccount,
    increaseTime,
    increaseTimeTo,
    ONE_DAY,
    ONE_WEEK,
    simpleToExactAmount,
    ZERO,
    ZERO_ADDRESS,
} from "../../test-utils";
import { Account, SidechainPhaseDeployed } from "../../types";
import {
    ERC20,
    ExtraRewardStashV3__factory,
    GaugeVoteRewards,
    MockStakelessGauge__factory,
    StashRewardDistro,
    VirtualBalanceRewardPool__factory,
} from "../../types/generated";
import { SideChainTestSetup, sidechainTestSetup } from "../sidechain/sidechainTestSetup";

const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;

describe("StashRewardDistro", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let distributor: Account;
    let alice: Account;
    let dao: Account;
    let l2mocks: DeployL2MocksResult;
    let cvx: ERC20;

    // Testing contract
    let gaugeVoteRewards: GaugeVoteRewards;
    let stashRewardDistro: StashRewardDistro;
    let testSetup: SideChainTestSetup;
    let sidechain: SidechainPhaseDeployed;
    const canonicalGauges = [];
    const stakelessGauges = [];
    let idSnapShot: number;

    /* -- Declare shared functions -- */
    const setup = async () => {
        if (idSnapShot) {
            await hre.ethers.provider.send("evm_revert", [idSnapShot]);
            idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
            return;
        }
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[4].getAddress());
        distributor = await impersonateAccount(await accounts[5].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID);
        cvx = testSetup.l1.phase2.cvx;

        // Mocks for this test only
        const stakelessGauge = await new MockStakelessGauge__factory(deployer.signer).deploy(
            testSetup.l2.mocks.gauge.address,
        );
        // Gauge to be mapped to L2
        stakelessGauges.push(stakelessGauge.address);

        // Non deposit gauge ie veBal
        canonicalGauges.push(testSetup.l1.mocks.gauges[0].address);
        // Gauge to be mapped to L1
        canonicalGauges.push(testSetup.l1.mocks.gauges[1].address);
        // Gauge to be mapped to L1
        canonicalGauges.push(testSetup.l1.mocks.gauges[2].address);

        // Send some balances in order to test
        // dirty trick to get some cvx balance.
        const cvxDepositorAccount = await impersonateAccount(testSetup.l1.phase2.vestedEscrows[0].address);
        const cvxConnected = cvx.connect(cvxDepositorAccount.signer);
        const cvxBalance = await cvxConnected.balanceOf(cvxDepositorAccount.address);
        await cvxConnected.transfer(deployer.address, cvxBalance);

        sidechain = testSetup.l2.sidechain;

        ({ gaugeVoteRewards, stashRewardDistro } = testSetup.l1.canonical);
        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);
        l2mocks = testSetup.l2.mocks;

        // transfer LP tokens to accounts
        const balance = await l2mocks.bpt.balanceOf(deployer.address);
        await l2mocks.bpt.transfer(alice.address, balance.div(4));

        idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
    };
    before("init contract", async () => {
        await setup();
    });
    after(async () => {
        await hre.ethers.provider.send("evm_revert", [idSnapShot]);
    });
    describe("constructor", async () => {
        before("init contract", async () => {
            await setup();
        });
        it("should properly store valid arguments", async () => {
            expect(await stashRewardDistro.EPOCH_DURATION(), "EPOCH_DURATION").to.eq(ONE_WEEK);
            expect(await stashRewardDistro.booster(), "booster").to.eq(testSetup.l1.phase6.booster.address);
            expect(await stashRewardDistro.getFunds(ZERO, ZERO, ZERO_ADDRESS), "funds").to.eq(ZERO);
        });
    });

    describe("normal flow", async () => {
        before("configure gaugeVoteRewards", async () => {
            const dstChainIds = [L2_CHAIN_ID];
            const voteRewards = [sidechain.childGaugeVoteRewards.address];
            const rewardPerEpoch = simpleToExactAmount(1000);
            const poolLength = await testSetup.l1.phase6.booster.poolLength();

            await gaugeVoteRewards.connect(dao.signer).setDistributor(distributor.address);
            await gaugeVoteRewards.connect(dao.signer).setRewardPerEpoch(rewardPerEpoch);
            await gaugeVoteRewards.connect(dao.signer).setIsNoDepositGauge(canonicalGauges[0], true);
            await gaugeVoteRewards.connect(dao.signer).setDstChainId([stakelessGauges[0]], dstChainIds);
            await gaugeVoteRewards.connect(dao.signer).setChildGaugeVoteRewards(dstChainIds[0], voteRewards[0]);
            await gaugeVoteRewards.connect(alice.signer).setPoolIds(0, poolLength.toNumber());
        });

        it("vote on gauges and process rewards", async () => {
            const gauges = [canonicalGauges[2], stakelessGauges[0], canonicalGauges[0]];
            const weights = [4_000, 4_000, 2_000];
            const epoch = await gaugeVoteRewards.getCurrentEpoch();

            await cvx.connect(deployer.signer).transfer(gaugeVoteRewards.address, simpleToExactAmount(10000));

            await gaugeVoteRewards.connect(dao.signer).voteGaugeWeight(gauges, weights);

            await gaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch, [canonicalGauges[2]]);
            await gaugeVoteRewards
                .connect(distributor.signer)
                .processSidechainGaugeRewards(
                    [stakelessGauges[0]],
                    epoch,
                    L2_CHAIN_ID,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    "0x",
                    "0x",
                    {
                        value: NATIVE_FEE,
                    },
                );
        });
        it("queue rewards via stashRewardDistro", async () => {
            const gauge = canonicalGauges[2];
            const epoch = await stashRewardDistro.getCurrentEpoch();
            const { value: pid } = await gaugeVoteRewards.getPoolId(gauge);
            const poolInfo = await testSetup.l1.phase6.booster.poolInfo(pid);
            const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer.signer);
            // Tricky to add extra stash
            const boOwner = await impersonateAccount(await testSetup.l1.phase6.boosterOwner.owner());
            await testSetup.l1.phase6.boosterOwner
                .connect(boOwner.signer)
                .setStashExtraReward(poolInfo.stash, cvx.address);

            const tokenInfo = await stash.tokenInfo(cvx.address);

            const funds = await stashRewardDistro.getFunds(epoch.add(1), pid, cvx.address);
            const cvxBalanceBefore = await cvx.balanceOf(stashRewardDistro.address);
            const cvxStashBalanceBefore = await cvx.balanceOf(tokenInfo.stashToken);

            expect(funds, "funds").to.be.gt(ZERO);

            // Test
            await increaseTime(ONE_WEEK);
            await stashRewardDistro["queueRewards(uint256,address)"](pid, cvx.address);
            const cvxBalanceAfter = await cvx.balanceOf(stashRewardDistro.address);
            const cvxStashBalanceAfter = await cvx.balanceOf(tokenInfo.stashToken);

            expect(await stashRewardDistro.getFunds(epoch, pid, cvx.address), "funds").to.be.eq(ZERO);
            expect(cvxBalanceAfter, "cvxBalance").to.be.eq(cvxBalanceBefore.sub(funds));
            expect(cvxStashBalanceAfter, "cvxStashBalanceAfter").to.be.eq(cvxStashBalanceBefore.add(funds));
        });
        it("anyone can fund a pool that already has some funds", async () => {
            const gauge = canonicalGauges[2];
            const { value: pid } = await gaugeVoteRewards.getPoolId(gauge);
            const epoch = await stashRewardDistro.getCurrentEpoch();
            const fundsBefore = await stashRewardDistro.getFunds(epoch.add(1), pid, cvx.address);
            const cvxBalanceBefore = await cvx.balanceOf(stashRewardDistro.address);
            expect(fundsBefore, "funds").to.be.gt(ZERO);

            // Fund for 1 period
            const amount = simpleToExactAmount(1000);
            const periods = 3;
            const amountPerPeriod = amount.sub(periods).div(periods);

            // Test
            await cvx.connect(deployer.signer).approve(stashRewardDistro.address, amount.mul(3));
            const tx1 = await stashRewardDistro.fundPool(pid, cvx.address, amount, periods);
            await expect(tx1)
                .emit(stashRewardDistro, "Funded")
                .withArgs(epoch.add(1), pid, cvx.address, amountPerPeriod);
            await expect(tx1)
                .emit(stashRewardDistro, "Funded")
                .withArgs(epoch.add(2), pid, cvx.address, amountPerPeriod);
            await expect(tx1)
                .emit(stashRewardDistro, "Funded")
                .withArgs(epoch.add(3), pid, cvx.address, amountPerPeriod);

            // Verify
            const fundsAfter = await stashRewardDistro.getFunds(epoch.add(1), pid, cvx.address);
            const cvxBalanceAfter = await cvx.balanceOf(stashRewardDistro.address);

            expect(fundsAfter, "fundsAfter").to.be.eq(fundsBefore.add(amountPerPeriod));
            expect(cvxBalanceAfter, "cvxBalance").to.be.eq(cvxBalanceBefore.add(amount));
        });
        it("queue rewards of a past epoch", async () => {
            await increaseTime(ONE_WEEK);

            const gauge = canonicalGauges[2];
            const epoch = await stashRewardDistro.getCurrentEpoch();
            const { value: pid } = await gaugeVoteRewards.getPoolId(gauge);
            const poolInfo = await testSetup.l1.phase6.booster.poolInfo(pid);
            const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer.signer);

            const tokenInfo = await stash.tokenInfo(cvx.address);

            const funds = await stashRewardDistro.getFunds(epoch, pid, cvx.address);
            const cvxBalanceBefore = await cvx.balanceOf(stashRewardDistro.address);
            const cvxStashBalanceBefore = await cvx.balanceOf(tokenInfo.stashToken);

            expect(funds, "funds").to.be.gt(ZERO);

            // Test
            await stashRewardDistro["queueRewards(uint256,address,uint256)"](pid, cvx.address, epoch);
            const cvxBalanceAfter = await cvx.balanceOf(stashRewardDistro.address);
            const cvxStashBalanceAfter = await cvx.balanceOf(tokenInfo.stashToken);

            expect(await stashRewardDistro.getFunds(epoch, pid, cvx.address), "funds").to.be.eq(ZERO);
            expect(cvxBalanceAfter, "cvxBalance").to.be.eq(cvxBalanceBefore.sub(funds));
            expect(cvxStashBalanceAfter, "cvxStashBalanceAfter").to.be.eq(cvxStashBalanceBefore.add(funds));
        });
        it("processIdleRewards", async () => {
            const gauge = canonicalGauges[2];
            const { value: pid } = await gaugeVoteRewards.getPoolId(gauge);

            const poolInfo = await testSetup.l1.phase6.booster.poolInfo(pid);
            const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer.signer);
            const tokenInfo = await stash.tokenInfo(cvx.address);
            const rewards = VirtualBalanceRewardPool__factory.connect(tokenInfo.rewardAddress, deployer.signer);

            // Send some rewards that get queued
            const rewardRate = await rewards.rewardRate();
            const periodFinish = await rewards.periodFinish();
            await increaseTime(ONE_DAY);
            const elapsedTime = (await getTimestamp()).sub(periodFinish.sub(ONE_WEEK));
            await cvx.transfer(stash.address, rewardRate.mul(elapsedTime));
            await testSetup.l1.phase6.booster.earmarkRewards(pid);

            const queuedRewards = await rewards.queuedRewards();
            await increaseTimeTo(periodFinish.add(1));
            const now = await getTimestamp();
            // Given that
            expect(periodFinish, "periodFinish").to.be.lt(now);
            expect(queuedRewards, "queueRewards").to.be.gt(ZERO);

            // Test
            const tx = await stashRewardDistro.processIdleRewards(pid, cvx.address);
            await expect(tx).to.emit(rewards, "RewardAdded");
        });
    });
    describe("edge cases", () => {
        it("fund fails when amount is zero", async () => {
            const amount = 0;
            await expect(stashRewardDistro.connect(alice.signer).fundPool(0, cvx.address, amount, 1)).to.be.reverted;
        });
        it("queueRewards fails when there are no rewards", async () => {
            // Given
            const pid = 0;
            const epoch = await stashRewardDistro.getCurrentEpoch();
            const funds = await stashRewardDistro.getFunds(epoch, pid, cvx.address);
            expect(funds, "epoch funds").to.be.eq(ZERO);
            await expect(
                stashRewardDistro.connect(alice.signer)[`queueRewards(uint256,address)`](pid, cvx.address),
            ).to.be.revertedWith("!amount");
        });
        it("queueRewards fails when future epoch", async () => {
            // Given
            const pid = 0;
            const epoch = await stashRewardDistro.getCurrentEpoch();
            await expect(
                stashRewardDistro
                    .connect(alice.signer)
                    [`queueRewards(uint256,address,uint256)`](pid, cvx.address, epoch.add(1)),
            ).to.be.revertedWith("!epoch");
        });
        it("processIdleRewards when period finish has not ended", async () => {
            const pid = 2;
            const poolInfo = await testSetup.l1.phase6.booster.poolInfo(pid);
            const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer.signer);
            const tokenInfo = await stash.tokenInfo(cvx.address);
            const rewards = VirtualBalanceRewardPool__factory.connect(tokenInfo.rewardAddress, deployer.signer);
            const periodFinish = await rewards.periodFinish();
            expect(periodFinish, "periodFinish").to.be.gt(await getTimestamp());

            await expect(
                stashRewardDistro.connect(alice.signer).processIdleRewards(pid, cvx.address),
            ).to.be.revertedWith("!periodFinish");
        });

        it("processIdleRewards when there are no queued rewards", async () => {
            await increaseTime(ONE_WEEK);

            const pid = 2;
            const poolInfo = await testSetup.l1.phase6.booster.poolInfo(pid);
            const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer.signer);
            const tokenInfo = await stash.tokenInfo(cvx.address);
            const rewards = VirtualBalanceRewardPool__factory.connect(tokenInfo.rewardAddress, deployer.signer);
            const periodFinish = await rewards.periodFinish();
            const queuedRewards = await rewards.queuedRewards();
            expect(periodFinish, "periodFinish").to.be.lte(await getTimestamp());
            expect(queuedRewards, "queuedRewards").to.be.eq(ZERO);
            await expect(
                stashRewardDistro.connect(alice.signer).processIdleRewards(pid, cvx.address),
            ).to.be.revertedWith("!queueRewards");
        });
    });
});
