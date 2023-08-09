import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { DeployL2MocksResult } from "scripts/deploySidechainMocks";

import {
    DEAD_ADDRESS,
    getTimestamp,
    impersonateAccount,
    increaseTime,
    ONE_WEEK,
    simpleToExactAmount,
    ZERO,
    ZERO_ADDRESS,
} from "../../test-utils";
import { Account, SidechainPhaseDeployed } from "../../types";
import { ERC20, GaugeVoteRewards, MockStakelessGauge__factory, StashRewardDistro } from "../../types/generated";
import { ERRORS, OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import { SideChainTestSetup, sidechainTestSetup } from "../sidechain/sidechainTestSetup";

const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;

const getCurrentEpoch = async () => {
    const timeStamp = await getTimestamp();

    const rewardsDuration = ONE_WEEK.mul(2);
    return timeStamp.div(rewardsDuration);
};

describe("GaugeVoteRewards", () => {
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
    const poolIds = [0, 1, 2];
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
    describe("behaviors", async () => {
        describe("should behave like Ownable ", async () => {
            const ctx: Partial<OwnableBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.owner = dao;
                    ctx.anotherAccount = alice;
                    ctx.ownable = gaugeVoteRewards;
                    return ctx as OwnableBehaviourContext;
                };
            });
            shouldBehaveLikeOwnable(() => ctx as OwnableBehaviourContext);
        });
    });
    describe("constructor", async () => {
        before("init contract", async () => {
            await setup();
        });
        it("should properly store valid arguments", async () => {
            expect(await gaugeVoteRewards.TOTAL_WEIGHT_PER_EPOCH(), "TOTAL_WEIGHT_PER_EPOCH").to.eq(10_000);
            expect(await gaugeVoteRewards.EPOCH_DURATION(), "EPOCH_DURATION").to.eq(ONE_WEEK.mul(2));
            expect(await gaugeVoteRewards.aura(), "aura").to.eq(testSetup.l1.phase2.cvx.address);
            expect(await gaugeVoteRewards.auraOFT(), "auraOFT").to.eq(testSetup.l1.canonical.auraProxyOFT.address);
            expect(await gaugeVoteRewards.booster(), "booster").to.eq(testSetup.l1.phase6.booster.address);
            expect(await gaugeVoteRewards.stashRewardDistro(), "stashRewardDistro").to.eq(
                testSetup.l1.canonical.stashRewardDistro.address,
            );
            expect(await gaugeVoteRewards.lzChainId(), "lzChainId").to.eq(L1_CHAIN_ID);
            expect(await gaugeVoteRewards.rewardPerEpoch(), "rewardPerEpoch").to.eq(0);
            expect(await gaugeVoteRewards.distributor(), "distributor").to.eq(ZERO_ADDRESS);
            expect(await gaugeVoteRewards.getDstChainId(ZERO_ADDRESS), "getDstChainId").to.eq(ZERO);
            expect(await gaugeVoteRewards.getChildGaugeVoteRewards(ZERO), "getChildGaugeVoteRewards").to.eq(
                ZERO_ADDRESS,
            );
            expect((await gaugeVoteRewards.getPoolId(ZERO_ADDRESS)).isSet, "getPoolId").to.eq(false);
            expect(await gaugeVoteRewards.getWeightByEpoch(ZERO, ZERO_ADDRESS), "getWeightByEpoch").to.eq(ZERO);
            expect(await gaugeVoteRewards.isProcessed(ZERO, ZERO_ADDRESS), "isProcessed").to.eq(false);
            expect(await gaugeVoteRewards.isNoDepositGauge(ZERO_ADDRESS), "isNoDepositGauge").to.eq(false);
            expect(await gaugeVoteRewards.getTotalWeight(ZERO), "getTotalWeight").to.eq(ZERO);
            expect(await gaugeVoteRewards.lzEndpoint()).eq(testSetup.l1.mocks.addresses.lzEndpoint);
            expect(await gaugeVoteRewards.getCurrentEpoch()).eq(await getCurrentEpoch());
        });
        it("should have valid approvals", async () => {
            expect(await cvx.allowance(gaugeVoteRewards.address, stashRewardDistro.address), "aura approval").to.be.eq(
                ethers.constants.MaxUint256,
            );
        });
    });
    describe("set configurations ", async () => {
        it("onlyOwner setDistributor", async () => {
            const tx = await gaugeVoteRewards.connect(dao.signer).setDistributor(distributor.address);
            await expect(tx).to.emit(gaugeVoteRewards, "SetDistributor").withArgs(distributor.address);
            expect(await gaugeVoteRewards.distributor(), "distributor").to.be.eq(distributor.address);
        });
        it("onlyOwner setRewardPerEpoch", async () => {
            const rewardPerEpoch = simpleToExactAmount(1000);
            const tx = await gaugeVoteRewards.connect(dao.signer).setRewardPerEpoch(rewardPerEpoch);
            await expect(tx).to.emit(gaugeVoteRewards, "SetRewardPerEpoch").withArgs(rewardPerEpoch);
            expect(await gaugeVoteRewards.rewardPerEpoch(), "rewardPerEpoch").to.be.eq(rewardPerEpoch);
        });
        it("onlyOwner setIsNoDepositGauge", async () => {
            const gauge = canonicalGauges[0];
            const tx = await gaugeVoteRewards.connect(dao.signer).setIsNoDepositGauge(gauge, true);
            await expect(tx).to.emit(gaugeVoteRewards, "SetIsNoDepositGauge").withArgs(gauge, true);
            expect(await gaugeVoteRewards.isNoDepositGauge(gauge), "isNoDepositGauge").to.be.eq(true);
        });
        it("onlyOwner setDstChainId != lzChainId", async () => {
            // Configure pid 1 to be on L1_CHAIN_ID
            // Do not set any configuration to pid 2
            const lzChainId = await gaugeVoteRewards.lzChainId();
            expect(L2_CHAIN_ID, "lzChainId").to.not.be.eq(lzChainId);
            const dstChainIds = [L2_CHAIN_ID];
            const gauges = [stakelessGauges[0]];

            expect(gauges.length, "params").to.be.eq(dstChainIds.length);
            await gaugeVoteRewards.connect(dao.signer).setDstChainId(gauges, dstChainIds);
            expect(await gaugeVoteRewards.getDstChainId(stakelessGauges[0]), "getDstChainId l2").to.be.eq(L2_CHAIN_ID);
            expect(await gaugeVoteRewards.getDstChainId(canonicalGauges[0]), "getDstChainId not set").to.be.eq(ZERO);
        });
        it("onlyOwner can set child gauge vote rewards addresses", async () => {
            const dstChainIds = [123, L2_CHAIN_ID];
            const voteRewards = [DEAD_ADDRESS, sidechain.childGaugeVoteRewards.address];

            let tx = await gaugeVoteRewards
                .connect(dao.signer)
                .setChildGaugeVoteRewards(dstChainIds[0], voteRewards[0]);
            await expect(tx)
                .to.emit(gaugeVoteRewards, "SetChildGaugeVoteRewards")
                .withArgs(dstChainIds[0], voteRewards[0]);

            tx = await gaugeVoteRewards.connect(dao.signer).setChildGaugeVoteRewards(dstChainIds[1], voteRewards[1]);
            await expect(tx)
                .to.emit(gaugeVoteRewards, "SetChildGaugeVoteRewards")
                .withArgs(dstChainIds[1], voteRewards[1]);

            expect(await gaugeVoteRewards.getChildGaugeVoteRewards(dstChainIds[0])).eq(voteRewards[0]);
            expect(await gaugeVoteRewards.getChildGaugeVoteRewards(dstChainIds[1])).eq(voteRewards[1]);
        });
        it("anyone setPoolIds and dst chain id", async () => {
            const poolLength = await testSetup.l1.phase6.booster.poolLength();
            const gauges = [canonicalGauges[2], stakelessGauges[0], canonicalGauges[0]];

            expect(poolLength.gte(poolIds.length));
            // Test
            await gaugeVoteRewards.connect(alice.signer).setPoolIds(0, poolIds.length);

            expect(await gaugeVoteRewards.getDstChainId(gauges[0]), "getDstChainId l1").to.be.eq(L1_CHAIN_ID);
            expect(await gaugeVoteRewards.getDstChainId(gauges[1]), "getDstChainId l2").to.be.eq(L2_CHAIN_ID);
            expect(await gaugeVoteRewards.getDstChainId(gauges[2]), "getDstChainId l1").to.be.eq(L1_CHAIN_ID);

            for (const pid in poolIds) {
                expect(
                    (await gaugeVoteRewards.getPoolId(testSetup.l1.mocks.gauges[pid].address)).isSet,
                    "getPoolId",
                ).to.be.eq(true);
            }
        });
    });
    describe("normal flow", async () => {
        it("Treasury sends aura to gauge vote rewards", async () => {
            await cvx.connect(deployer.signer).transfer(gaugeVoteRewards.address, simpleToExactAmount(10000));
            expect(await cvx.balanceOf(gaugeVoteRewards.address), "GaugeVoteRewards cvx balance").to.be.gt(ZERO);
        });
        it("set votes gauge weights", async () => {
            // canonicalGauges[0] is veBal non deposits , so its weight must be ignored.
            const gauges = [canonicalGauges[2], stakelessGauges[0], canonicalGauges[0]];
            const weights = [4_000, 4_000, 2_000];
            const epoch = await gaugeVoteRewards.getCurrentEpoch();

            expect(await gaugeVoteRewards.isNoDepositGauge(canonicalGauges[0]), "veBal gauge").to.be.eq(true);

            // Test
            await gaugeVoteRewards.connect(dao.signer).voteGaugeWeight(gauges, weights);
            // Verify gauges weights are set
            for (let i = 0; i < weights.length; i++) {
                const weight = weights[i];
                const gauge = gauges[i];
                const isNoDepositGauge = await gaugeVoteRewards.isNoDepositGauge(gauge);
                expect(await gaugeVoteRewards.getWeightByEpoch(epoch, gauge)).eq(isNoDepositGauge ? 0 : weight);
            }
        });
        it("process gauge rewards", async () => {
            const epoch = await gaugeVoteRewards.getCurrentEpoch();
            const gauge = canonicalGauges[2];
            const dstChainId = await gaugeVoteRewards.getDstChainId(gauge);
            const weight = await gaugeVoteRewards.getWeightByEpoch(epoch, gauge);
            const rewardPerEpoch = await gaugeVoteRewards.rewardPerEpoch();
            const totalWeight = await gaugeVoteRewards.getTotalWeight(epoch);
            const isProcessed = await gaugeVoteRewards.isProcessed(epoch, gauge);
            const amountToSend = rewardPerEpoch.mul(weight).div(totalWeight);
            const { value: pid } = await gaugeVoteRewards.getPoolId(gauge);

            const gaugeVoteRewardsCvxBalanceBefore = await cvx.balanceOf(gaugeVoteRewards.address);

            // Expect to have an amount to send and the destination chain is canonical
            expect(amountToSend, "amountToSend").to.be.gt(ZERO);
            expect(amountToSend, "amountToSend").to.be.eq(await gaugeVoteRewards.getAmountToSendByEpoch(epoch, gauge));
            expect(isProcessed, "isProcessed").to.be.eq(false);
            expect(await gaugeVoteRewards.lzChainId(), "dstChainId == lzChainId").to.be.eq(dstChainId);

            // Test
            const tx = await gaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch, [gauge]);

            const epochDistro = await stashRewardDistro.getCurrentEpoch();
            const rewardAmountPerEpoch = amountToSend.div(2).sub(1);
            await expect(tx)
                .to.emit(stashRewardDistro, "Funded")
                .withArgs(epochDistro.add(1), pid, cvx.address, rewardAmountPerEpoch);
            await expect(tx)
                .to.emit(stashRewardDistro, "Funded")
                .withArgs(epochDistro.add(2), pid, cvx.address, rewardAmountPerEpoch);
            // Current epoch should have been already queued
            const epoch0Funds = await stashRewardDistro.getFunds(epochDistro.add(1), pid, cvx.address);
            const epoch1Funds = await stashRewardDistro.getFunds(epochDistro.add(2), pid, cvx.address);
            expect(epoch0Funds, "epoch0Funds").to.be.eq(rewardAmountPerEpoch);
            expect(epoch1Funds, "epoch1Funds").to.be.eq(rewardAmountPerEpoch);

            const gaugeVoteRewardsCvxBalanceAfter = await cvx.balanceOf(gaugeVoteRewards.address);
            expect(gaugeVoteRewardsCvxBalanceAfter, "cvx balance").to.be.eq(
                gaugeVoteRewardsCvxBalanceBefore.sub(amountToSend),
            );
        });
        it("process sidechain gauge rewards", async () => {
            const gauge = stakelessGauges[0];
            const stakelessGauge = MockStakelessGauge__factory.connect(gauge, deployer.signer);
            const childGauge = await stakelessGauge.getRecipient();
            const gauges = [gauge];
            const epoch = await gaugeVoteRewards.getCurrentEpoch();
            const amountToSend = await gaugeVoteRewards.getAmountToSendByEpoch(epoch, gauge);
            const gaugeVoteRewardsCvxBalanceBefore = await cvx.balanceOf(gaugeVoteRewards.address);
            const childGugeVoteRewardsCvxBalanceBefore = await sidechain.auraOFT.balanceOf(
                sidechain.childGaugeVoteRewards.address,
            );

            // Test
            const tx = await gaugeVoteRewards
                .connect(distributor.signer)
                .processSidechainGaugeRewards(gauges, epoch, L2_CHAIN_ID, ZERO_ADDRESS, ZERO_ADDRESS, "0x", "0x", {
                    value: NATIVE_FEE,
                });

            // L2
            await expect(tx)
                .to.emit(sidechain.auraOFT, "Transfer")
                .withArgs(ZERO_ADDRESS, sidechain.childGaugeVoteRewards.address, amountToSend);
            await expect(tx)
                .to.emit(sidechain.auraOFT, "ReceiveFromChain")
                .withArgs(L1_CHAIN_ID, sidechain.childGaugeVoteRewards.address, amountToSend);

            const gaugeVoteRewardsCvxBalanceAfter = await cvx.balanceOf(gaugeVoteRewards.address);
            const childGugeVoteRewardsCvxBalanceAfter = await sidechain.auraOFT.balanceOf(
                sidechain.childGaugeVoteRewards.address,
            );

            expect(gaugeVoteRewardsCvxBalanceAfter, "cvx balance l1").to.be.eq(
                gaugeVoteRewardsCvxBalanceBefore.sub(amountToSend),
            );
            expect(childGugeVoteRewardsCvxBalanceAfter, "cvx balance l2").to.be.eq(
                childGugeVoteRewardsCvxBalanceBefore.add(amountToSend),
            );
            expect(
                await sidechain.childGaugeVoteRewards.getAmountToSendByEpoch(epoch, childGauge),
                "ChildGauge getAmountToSendByEpoch",
            ).to.be.eq(amountToSend);
            expect(
                await sidechain.childGaugeVoteRewards.getAmountSentByEpoch(epoch, childGauge),
                "ChildGauge getAmountSentByEpoch",
            ).to.be.eq(ZERO);
        });
        it("queue rewards via stashRewardDistro", async () => {
            const gauge = canonicalGauges[2];
            const epoch = await stashRewardDistro.getCurrentEpoch();
            const { value: pid } = await gaugeVoteRewards.getPoolId(gauge);
            const poolInfo = await testSetup.l1.phase6.booster.poolInfo(pid);

            const funds = await stashRewardDistro.getFunds(epoch.add(1), pid, cvx.address);
            const cvxBalanceBefore = await cvx.balanceOf(stashRewardDistro.address);
            const cvxStashBalanceBefore = await cvx.balanceOf(poolInfo.stash);

            expect(funds, "funds").to.be.gt(ZERO);

            // Test
            await increaseTime(ONE_WEEK);
            await stashRewardDistro["queueRewards(uint256,address)"](pid, cvx.address);
            const cvxBalanceAfter = await cvx.balanceOf(stashRewardDistro.address);
            const cvxStashBalanceAfter = await cvx.balanceOf(poolInfo.stash);

            expect(await stashRewardDistro.getFunds(epoch.add(1), pid, cvx.address), "funds").to.be.eq(ZERO);
            expect(cvxBalanceAfter, "cvxBalance").to.be.eq(cvxBalanceBefore.sub(funds));
            expect(cvxStashBalanceAfter, "cvxStashBalanceAfter").to.be.eq(cvxStashBalanceBefore.add(funds));
        });
        it("recovers any erc20  balance", async () => {
            const amount = 1;
            const cvxBalanceBefore = await cvx.balanceOf(gaugeVoteRewards.address);
            const cvxDaoBalanceBefore = await cvx.balanceOf(dao.address);

            // test
            await gaugeVoteRewards.connect(dao.signer).transferERC20(cvx.address, dao.address, amount);

            const cvxBalanceAfter = await cvx.balanceOf(gaugeVoteRewards.address);
            const cvxDaoBalanceAfter = await cvx.balanceOf(dao.address);
            expect(cvxBalanceAfter, "cvxBalance").to.be.eq(cvxBalanceBefore.sub(amount));
            expect(cvxDaoBalanceAfter, "cvxBalance").to.be.eq(cvxDaoBalanceBefore.add(amount));
        });
    });

    describe("edge cases", () => {
        describe("fails if caller is not the owner", () => {
            it("transferERC20", async () => {
                await expect(
                    gaugeVoteRewards.connect(alice.signer).transferERC20(cvx.address, dao.address, 1),
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("setDistributor", async () => {
                await expect(
                    gaugeVoteRewards.connect(alice.signer).setDistributor(distributor.address),
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("SetRewardPerEpoch", async () => {
                const rewardPerEpoch = simpleToExactAmount(10000);
                await expect(
                    gaugeVoteRewards.connect(alice.signer).setRewardPerEpoch(rewardPerEpoch),
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("SetRewardPerEpoch", async () => {
                await expect(
                    gaugeVoteRewards.connect(alice.signer).setIsNoDepositGauge(ZERO_ADDRESS, true),
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });

            it("setDstChainId", async () => {
                const dstChainIds = [L1_CHAIN_ID, L1_CHAIN_ID];
                const gauges = [testSetup.l1.mocks.gauges[0].address, testSetup.l1.mocks.gauges[1].address];
                await expect(
                    gaugeVoteRewards.connect(alice.signer).setDstChainId(gauges, dstChainIds),
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("voteGaugeWeight", async () => {
                await expect(gaugeVoteRewards.connect(alice.signer).voteGaugeWeight([], [])).to.be.revertedWith(
                    ERRORS.ONLY_OWNER,
                );
            });
            it("setChildGaugeVoteRewards", async () => {
                const dstChainId = L2_CHAIN_ID;
                const voteReward = ZERO_ADDRESS;
                await expect(
                    gaugeVoteRewards.connect(alice.signer).setChildGaugeVoteRewards(dstChainId, voteReward),
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
        });
        describe("fails if wrong parameters", () => {
            it("setDstChainId", async () => {
                const dstChainIds = [L1_CHAIN_ID];
                const gauges = [testSetup.l1.mocks.gauges[0].address, testSetup.l1.mocks.gauges[1].address];
                await expect(
                    gaugeVoteRewards.connect(dao.signer).setDstChainId(gauges, dstChainIds),
                ).to.be.revertedWith("!localChain");
            });
            it("setChildGaugeVoteRewards", async () => {
                const dstChainIds = await gaugeVoteRewards.lzChainId();
                const voteRewards = sidechain.childGaugeVoteRewards.address;
                await expect(
                    gaugeVoteRewards.connect(dao.signer).setChildGaugeVoteRewards(dstChainIds, voteRewards),
                ).to.be.revertedWith("!dstChainId");
            });
        });
        describe("set vote gauge weight fails", () => {
            it("when rewardPerEpoch is not set", async () => {
                await gaugeVoteRewards.connect(dao.signer).setRewardPerEpoch(0);

                await expect(gaugeVoteRewards.connect(dao.signer).voteGaugeWeight([], [])).to.be.revertedWith(
                    "!rewardPerEpoch",
                );
            });
            it("when wrong params", async () => {
                await gaugeVoteRewards.connect(dao.signer).setRewardPerEpoch(simpleToExactAmount(1_000));

                const dstChainIds = [];
                const gauges = [testSetup.l1.mocks.gauges[0].address, testSetup.l1.mocks.gauges[1].address];
                await expect(
                    gaugeVoteRewards.connect(dao.signer).voteGaugeWeight(gauges, dstChainIds),
                ).to.be.revertedWith("!length");
            });
            it("when current epoch has already votes", async () => {
                const epoch = await gaugeVoteRewards.getCurrentEpoch();
                // Each epoch is 2 week long
                const gauges = [canonicalGauges[2], stakelessGauges[0]];
                const weights = [5_000, 5_000];
                expect(await gaugeVoteRewards.getTotalWeight(epoch), "totalWeight").to.be.gt(ZERO);

                // Second time it should revert
                await expect(gaugeVoteRewards.connect(dao.signer).voteGaugeWeight(gauges, weights)).to.be.revertedWith(
                    "already voted",
                );
            });
            it("when total weight is not 10_000", async () => {
                const epochDuration = await gaugeVoteRewards.EPOCH_DURATION();
                // Each epoch is 2 week long
                await increaseTime(epochDuration);
                const gauges = [canonicalGauges[2], stakelessGauges[0]];
                const weights = [1_000, 1_000];
                await expect(gaugeVoteRewards.connect(dao.signer).voteGaugeWeight(gauges, weights)).to.be.revertedWith(
                    "!totalWeight",
                );
            });
        });
        describe("process gauge rewards fails", () => {
            it("when caller is not distributor", async () => {
                await expect(gaugeVoteRewards.connect(alice.signer).processGaugeRewards(ZERO, [])).to.be.revertedWith(
                    "!distributor",
                );
            });
            it("when future epoch", async () => {
                const epoch = await gaugeVoteRewards.getCurrentEpoch();
                const gauges = [];
                await expect(
                    gaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch.add(1), gauges),
                ).to.be.revertedWith("!epoch");
            });
            it("when there are no votes for the given gauge", async () => {
                const epoch = (await gaugeVoteRewards.getCurrentEpoch()).sub(10);
                const totalWeight = await gaugeVoteRewards.getTotalWeight(epoch);
                expect(totalWeight, "totalWeight").to.be.eq(ZERO);

                const gauges = [canonicalGauges[2]];
                await expect(gaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch, gauges)).to.be
                    .reverted;
            });
            it("with a sidechain gauge", async () => {
                const epoch = await gaugeVoteRewards.getCurrentEpoch();
                const gauges = [stakelessGauges[0]];
                await expect(
                    gaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch, gauges),
                ).to.be.revertedWith("dstChainId!=lzChainId");
            });
            it("with a gauge not mapped", async () => {
                const epoch = await gaugeVoteRewards.getCurrentEpoch();
                const gauges = [DEAD_ADDRESS];
                await expect(
                    gaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch, gauges),
                ).to.be.revertedWith("dstChainId!=lzChainId");
            });
            it("when amount to send is zero", async () => {
                const epoch = await gaugeVoteRewards.getCurrentEpoch();
                const gauges = [canonicalGauges[2], stakelessGauges[0], canonicalGauges[0]];
                const weights = [0, 8_000, 2_000];

                await gaugeVoteRewards.connect(dao.signer).voteGaugeWeight(gauges, weights);

                expect(
                    await gaugeVoteRewards.getAmountToSendByEpoch(epoch, canonicalGauges[2]),
                    "amountToSend",
                ).to.be.eq(ZERO);

                // canonicalGauges[2]  has weight 0, therefore amount to send must be zero
                await expect(
                    gaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch, [canonicalGauges[2]]),
                ).to.be.revertedWith("amountToSend=0");
            });
            it("when gauge should not receive deposits", async () => {
                const epoch = await gaugeVoteRewards.getCurrentEpoch();
                expect(await gaugeVoteRewards.isNoDepositGauge(canonicalGauges[0]), "noDepositGauge").to.be.eq(true);
                // reverts if  Processed
                await expect(
                    gaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch, [canonicalGauges[0]]),
                ).to.be.revertedWith("noDepositGauge");
            });
            it("when gauge has already been processed", async () => {
                const epochDuration = await gaugeVoteRewards.EPOCH_DURATION();
                // Each epoch is 2 week long
                await increaseTime(epochDuration);
                const epoch = await gaugeVoteRewards.getCurrentEpoch();
                const gauges = [canonicalGauges[2], stakelessGauges[0], canonicalGauges[0]];
                const weights = [4_000, 4_000, 2_000];

                await gaugeVoteRewards.connect(dao.signer).voteGaugeWeight(gauges, weights);
                // Process first time ok
                await gaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch, [canonicalGauges[2]]);
                // reverts if  Processed
                await expect(
                    gaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch, [canonicalGauges[2]]),
                ).to.be.revertedWith("isProcessed");
            });
        });
        describe("process sidechain gauge rewards fails", () => {
            it("when destination chain is missing a child gauge", async () => {
                const gauge = stakelessGauges[0];
                const gauges = [gauge];
                const epoch = await gaugeVoteRewards.getCurrentEpoch();

                await expect(
                    gaugeVoteRewards
                        .connect(distributor.signer)
                        .processSidechainGaugeRewards(
                            gauges,
                            epoch,
                            L1_CHAIN_ID,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            "0x",
                            "0x",
                            {
                                value: NATIVE_FEE,
                            },
                        ),
                ).to.be.revertedWith("!childGauge");
            });
            it("when destination destination chain and gauge do not match", async () => {
                const gauge = stakelessGauges[0];
                const gauges = [gauge];
                const epoch = await gaugeVoteRewards.getCurrentEpoch();

                await expect(
                    gaugeVoteRewards
                        .connect(distributor.signer)
                        .processSidechainGaugeRewards(gauges, epoch, 123, ZERO_ADDRESS, ZERO_ADDRESS, "0x", "0x", {
                            value: NATIVE_FEE,
                        }),
                ).to.be.revertedWith("!dstChainId");
            });
            it("when gauge amount is zero", async () => {
                const gauge = DEAD_ADDRESS;
                const gauges = [gauge];
                const epoch = await gaugeVoteRewards.getCurrentEpoch();
                await gaugeVoteRewards.connect(dao.signer).setDstChainId(gauges, [123]);

                await expect(
                    gaugeVoteRewards
                        .connect(distributor.signer)
                        .processSidechainGaugeRewards(gauges, epoch, 123, ZERO_ADDRESS, ZERO_ADDRESS, "0x", "0x", {
                            value: NATIVE_FEE,
                        }),
                ).to.be.revertedWith("amountToSend=0");
            });
            it("when gauge has been already processed", async () => {
                const epoch = await gaugeVoteRewards.getCurrentEpoch();
                const gauges = [stakelessGauges[0]];
                // Process first time ok
                await gaugeVoteRewards
                    .connect(distributor.signer)
                    .processSidechainGaugeRewards(gauges, epoch, L2_CHAIN_ID, ZERO_ADDRESS, ZERO_ADDRESS, "0x", "0x", {
                        value: NATIVE_FEE,
                    });
                // reverts if  Processed
                await expect(
                    gaugeVoteRewards
                        .connect(distributor.signer)
                        .processSidechainGaugeRewards(
                            gauges,
                            epoch,
                            L2_CHAIN_ID,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            "0x",
                            "0x",
                            {
                                value: NATIVE_FEE,
                            },
                        ),
                ).to.be.revertedWith("isProcessed");
            });
        });
    });
});
