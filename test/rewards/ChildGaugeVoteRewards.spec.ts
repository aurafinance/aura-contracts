import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { DeployL2MocksResult } from "scripts/deploySidechainMocks";

import {
    DEAD_ADDRESS,
    getTimestamp,
    impersonateAccount,
    ONE_WEEK,
    simpleToExactAmount,
    ZERO,
    ZERO_ADDRESS,
} from "../../test-utils";
import { Account, SidechainPhaseDeployed } from "../../types";
import {
    AuraOFT,
    ChildGaugeVoteRewards,
    ERC20,
    GaugeVoteRewards,
    MockStakelessGauge,
    MockStakelessGauge__factory,
    StashRewardDistro,
} from "../../types/generated";
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

describe("ChildGaugeVoteRewards", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let distributor: Account;
    let alice: Account;
    let dao: Account;
    let l2mocks: DeployL2MocksResult;
    let cvx: ERC20;
    let auraOFT: AuraOFT;
    let stashRewardDistro: StashRewardDistro;
    let gaugeVoteRewards: GaugeVoteRewards;
    let stakelessGauge: MockStakelessGauge;

    // Testing contract
    let childGaugeVoteRewards: ChildGaugeVoteRewards;

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
        stakelessGauge = await new MockStakelessGauge__factory(deployer.signer).deploy(
            testSetup.l2.mocks.gauge.address,
        );
        // Gauge to be mapped to L2
        stakelessGauges.push(stakelessGauge.address);
        // await testSetup.l1.phase6.poolManager["addPool(address)"](stakelessGauge.address);

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

        ({ gaugeVoteRewards } = testSetup.l1.canonical);
        ({ childGaugeVoteRewards, stashRewardDistro, auraOFT } = sidechain);

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
                    ctx.ownable = childGaugeVoteRewards;
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
            expect(await childGaugeVoteRewards.aura(), "aura").to.eq(auraOFT.address);
            expect(await childGaugeVoteRewards.booster(), "booster").to.eq(sidechain.booster.address);
            expect(await childGaugeVoteRewards.stashRewardDistro(), "stashRewardDistro").to.eq(
                stashRewardDistro.address,
            );
            expect(await childGaugeVoteRewards.distributor(), "distributor").to.eq(ZERO_ADDRESS);
            expect(
                await childGaugeVoteRewards.getAmountToSendByEpoch(ZERO, ZERO_ADDRESS),
                "getAmountToSendByEpoch",
            ).to.eq(ZERO);
            expect(await childGaugeVoteRewards.getAmountSentByEpoch(ZERO, ZERO_ADDRESS), "getAmountSentByEpoch").to.eq(
                ZERO,
            );
            const poolId = await childGaugeVoteRewards.getPoolId(ZERO_ADDRESS);
            expect(poolId.isSet, "getPoolId").to.eq(false);
            expect(await childGaugeVoteRewards.lzEndpoint()).eq(testSetup.l2.mocks.addresses.lzEndpoint);
        });
        it("should have valid approvals", async () => {
            expect(
                await auraOFT.allowance(childGaugeVoteRewards.address, stashRewardDistro.address),
                "aura approval",
            ).to.be.eq(ethers.constants.MaxUint256);
        });
    });
    describe("set configurations ", async () => {
        it("onlyOwner setDistributor", async () => {
            const tx = await childGaugeVoteRewards.connect(dao.signer).setDistributor(distributor.address);
            await expect(tx).to.emit(childGaugeVoteRewards, "SetDistributor").withArgs(distributor.address);
            expect(await childGaugeVoteRewards.distributor(), "distributor").to.be.eq(distributor.address);
        });
        it("anyone setPoolIds and dst chain id", async () => {
            // Test
            await childGaugeVoteRewards.connect(alice.signer).setPoolIds(0, 1);
            const poolId = await childGaugeVoteRewards.getPoolId(testSetup.l2.mocks.gauge.address);
            expect(poolId.isSet, "getPoolId").to.eq(true);
        });
    });
    describe("normal flow", async () => {
        describe("canonical flow", async () => {
            before("send aura and configure gaugeVoteRewards", async () => {
                await cvx.connect(deployer.signer).transfer(gaugeVoteRewards.address, simpleToExactAmount(10000));
                expect(await cvx.balanceOf(gaugeVoteRewards.address), "GaugeVoteRewards cvx balance").to.be.gt(ZERO);

                const rewardPerEpoch = simpleToExactAmount(1000);
                const dstChainIds = [L2_CHAIN_ID];
                const gauges = [stakelessGauges[0]];
                const voteRewards = [sidechain.childGaugeVoteRewards.address];
                const poolLength = await testSetup.l1.phase6.booster.poolLength();

                await gaugeVoteRewards.connect(dao.signer).setDistributor(distributor.address);
                await gaugeVoteRewards.connect(dao.signer).setRewardPerEpoch(rewardPerEpoch);
                await gaugeVoteRewards.connect(dao.signer).setIsNoDepositGauge(canonicalGauges[2], true);
                await gaugeVoteRewards.connect(dao.signer).setDstChainId(gauges, dstChainIds);
                await gaugeVoteRewards.connect(dao.signer).setChildGaugeVoteRewards(dstChainIds[0], voteRewards[0]);
                await gaugeVoteRewards.connect(alice.signer).setPoolIds(0, poolLength);
            });
            it("set votes gauge weights", async () => {
                // canonicalGauges[0] is veBal non deposits , so its weight must be ignored.
                const gauges = [canonicalGauges[2], stakelessGauges[0], canonicalGauges[0]];
                const weights = [4_000, 4_000, 2_000];
                const epoch = await gaugeVoteRewards.getCurrentEpoch();

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
            it("process sidechain gauge rewards", async () => {
                const gauge = stakelessGauges[0];
                const childGauge = await stakelessGauge.getRecipient();
                const gauges = [gauge];
                const epoch = await gaugeVoteRewards.getCurrentEpoch();
                const amountToSend = await gaugeVoteRewards.getAmountToSendByEpoch(epoch, gauge);
                const gaugeVoteRewardsCvxBalanceBefore = await cvx.balanceOf(gaugeVoteRewards.address);
                const childGugeVoteRewardsCvxBalanceBefore = await auraOFT.balanceOf(childGaugeVoteRewards.address);

                // Test
                const tx = await gaugeVoteRewards
                    .connect(distributor.signer)
                    .processSidechainGaugeRewards(gauges, epoch, L2_CHAIN_ID, ZERO_ADDRESS, ZERO_ADDRESS, "0x", "0x", {
                        value: NATIVE_FEE,
                    });

                // L2
                await expect(tx)
                    .to.emit(auraOFT, "Transfer")
                    .withArgs(ZERO_ADDRESS, childGaugeVoteRewards.address, amountToSend);
                await expect(tx)
                    .to.emit(auraOFT, "ReceiveFromChain")
                    .withArgs(L1_CHAIN_ID, childGaugeVoteRewards.address, amountToSend);

                const gaugeVoteRewardsCvxBalanceAfter = await cvx.balanceOf(gaugeVoteRewards.address);
                const childGugeVoteRewardsCvxBalanceAfter = await auraOFT.balanceOf(childGaugeVoteRewards.address);

                expect(gaugeVoteRewardsCvxBalanceAfter, "cvx balance l1").to.be.eq(
                    gaugeVoteRewardsCvxBalanceBefore.sub(amountToSend),
                );
                expect(childGugeVoteRewardsCvxBalanceAfter, "cvx balance l2").to.be.eq(
                    childGugeVoteRewardsCvxBalanceBefore.add(amountToSend),
                );
                expect(
                    await childGaugeVoteRewards.getAmountToSendByEpoch(epoch, childGauge),
                    "ChildGauge getAmountToSendByEpoch",
                ).to.be.eq(amountToSend);
                expect(
                    await childGaugeVoteRewards.getAmountSentByEpoch(epoch, childGauge),
                    "ChildGauge getAmountSentByEpoch",
                ).to.be.eq(ZERO);
            });
        });
        describe("sidechain flow", async () => {
            it("process sidechain gauge rewards", async () => {
                const epoch = await gaugeVoteRewards.getCurrentEpoch();
                const gauge = testSetup.l2.mocks.gauge.address;
                const childGugeVoteRewardsCvxBalanceBefore = await auraOFT.balanceOf(childGaugeVoteRewards.address);
                const { value: pid } = await childGaugeVoteRewards.getPoolId(gauge);

                const amountToSend = await childGaugeVoteRewards.getAmountToSendByEpoch(epoch, gauge);
                expect(
                    await childGaugeVoteRewards.getAmountToSendByEpoch(epoch, gauge),
                    "ChildGauge getAmountToSendByEpoch",
                ).to.be.gt(ZERO);
                expect(
                    await childGaugeVoteRewards.getAmountSentByEpoch(epoch, gauge),
                    "ChildGauge getAmountSentByEpoch",
                ).to.be.eq(ZERO);

                // Test
                const tx = await childGaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch, [gauge]);

                const epochDistro = (await stashRewardDistro.getCurrentEpoch()).add(1);
                const rewardAmountPerEpoch = amountToSend.div(2).sub(1);
                await expect(tx)
                    .to.emit(stashRewardDistro, "Funded")
                    .withArgs(epochDistro, pid, auraOFT.address, rewardAmountPerEpoch);
                await expect(tx)
                    .to.emit(stashRewardDistro, "Funded")
                    .withArgs(epochDistro.add(1), pid, auraOFT.address, rewardAmountPerEpoch);

                const childGugeVoteRewardsCvxBalanceAfter = await auraOFT.balanceOf(childGaugeVoteRewards.address);
                expect(childGugeVoteRewardsCvxBalanceAfter, "cvx balance l2").to.be.eq(
                    childGugeVoteRewardsCvxBalanceBefore.sub(amountToSend),
                );
                expect(
                    await childGaugeVoteRewards.getAmountToSendByEpoch(epoch, gauge),
                    "ChildGauge getAmountToSendByEpoch",
                ).to.be.eq(amountToSend);
                expect(
                    await childGaugeVoteRewards.getAmountSentByEpoch(epoch, gauge),
                    "ChildGauge getAmountSentByEpoch",
                ).to.be.eq(amountToSend);
            });
        });
    });

    describe("edge cases", () => {
        describe("fails if caller is not the owner", () => {
            it("setDistributor", async () => {
                await expect(childGaugeVoteRewards.connect(alice.signer).initialize(ZERO_ADDRESS)).to.be.revertedWith(
                    ERRORS.ONLY_OWNER,
                );
            });
            it("setDistributor", async () => {
                await expect(
                    childGaugeVoteRewards.connect(alice.signer).setDistributor(distributor.address),
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
        });

        describe("process gauge rewards fails", () => {
            it("when caller is not distributor", async () => {
                await expect(
                    childGaugeVoteRewards.connect(alice.signer).processGaugeRewards(ZERO, []),
                ).to.be.revertedWith("!distributor");
            });
            it("when future epoch", async () => {
                const epoch = await getCurrentEpoch();
                const gauges = [testSetup.l2.mocks.gauge.address];
                await expect(
                    childGaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch.add(1), gauges),
                ).to.be.revertedWith("amountToSend=0");
            });
            it("with wrong gauge", async () => {
                const epoch = await getCurrentEpoch();
                const gauges = [DEAD_ADDRESS];
                await expect(
                    childGaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch, gauges),
                ).to.be.revertedWith("amountToSend=0");
            });
            it("when gauge has already been processed", async () => {
                const epoch = await getCurrentEpoch();
                const gauges = [testSetup.l2.mocks.gauge.address];
                await expect(
                    childGaugeVoteRewards.connect(distributor.signer).processGaugeRewards(epoch, gauges),
                ).to.be.revertedWith("amountSent!=0");
            });
        });
    });
});
