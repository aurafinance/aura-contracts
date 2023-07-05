import { expect } from "chai";
import { Signer } from "ethers";
import hre, { network } from "hardhat";

import { waitForTx } from "../../tasks/utils";
import { getTimestamp, impersonate, increaseTime } from "../../test-utils";
import { ONE_DAY, ONE_WEEK, ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import { BN } from "../../test-utils/math";
import {
    WardenQuestScheduler,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    IERC20,
    IDarkQuestBoard__factory,
    IDarkQuestBoard,
} from "../../types/generated";
import { config } from "../../tasks/deploy/mainnet-config";
import { deployWardenQuestScheduler } from "../../scripts/deployPeripheral";

const debug = false;
const keeperAddress = "0xcC247CDe79624801169475C9Ba1f716dB3959B8f";

describe("WardenQuestScheduler", () => {
    let deployer: Signer;
    let keeper: Signer;
    let multisig: Signer;

    let deployerAddress: string;
    let cvx: IERC20;
    let extraRewardStashAuraWeth: ExtraRewardStashV3;
    let darkQuestBoard: IDarkQuestBoard;
    // Testing contract
    let wardenQuestScheduler: WardenQuestScheduler;
    let auraWethQuestId = ZERO;
    let auraBalQuestId = ZERO;
    let createQuestEpoch = ZERO;
    const questAuraWeth = {
        stash: "0xDD8AB2eAf5487faB70c36F6997AFb1D5D743E516",
        gauge: "0x275dF57d2B23d53e20322b4bb71Bf1dCb21D0A00",
        pid: 100,
        objective: "518349574900000000000000",
        rewardPerVote: "37100000000000000",
        totalRewardAmount: "38461538457580000000000",
        feeAmount: "1538461538303200000000",
        blacklist: ["0xaF52695E1bB01A16D33D7194C28C42b10e0Dbec2", "0x9cC56Fa7734DA21aC88F6a816aF10C5b898596Ce"],
    };
    const questAuraBal = {
        stash: "0xebFE79b8f19ACFBbB8A89a8e694Df471a6F461b7",
        gauge: "0x0312AA8D0BA4a1969Fddb382235870bF55f7f242",
        pid: 101,
        objective: "622019489900000000000000",
        rewardPerVote: "37100000000000000",
        totalRewardAmount: "46153846150580000000000",
        feeAmount: "1846153846023200000000",
        blacklist: ["0xaF52695E1bB01A16D33D7194C28C42b10e0Dbec2", "0x9cC56Fa7734DA21aC88F6a816aF10C5b898596Ce"],
    };

    /* -- Declare shared functions -- */

    const setup = async (blockNumber: number) => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: blockNumber,
                    },
                },
            ],
        });
        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        deployer = await impersonate(deployerAddress);
        keeper = await impersonate(keeperAddress);
        multisig = await impersonate(config.multisigs.incentivesMultisig);
        cvx = (await config.getPhase2(deployer)).cvx as unknown as IERC20;
        extraRewardStashAuraWeth = ExtraRewardStashV3__factory.connect(questAuraWeth.stash, deployer);

        const darkQuestBoardManagerAddress = "0x2F793E40CF7473A371A3E6f3d3682F81070D3041";
        const darkQuestBoardManager = await impersonate(darkQuestBoardManagerAddress);
        darkQuestBoard = IDarkQuestBoard__factory.connect(config.addresses.darkQuestBoard, darkQuestBoardManager);

        // Deploy test contract.
        ({ wardenQuestScheduler } = await deployWardenQuestScheduler(hre, deployer));
        // Authorize keepers  and transfer ownership
        await wardenQuestScheduler.updateAuthorizedKeepers(keeperAddress, true);
        await wardenQuestScheduler.updateAuthorizedKeepers(config.multisigs.incentivesMultisig, true);
        await wardenQuestScheduler.transferOwnership(config.multisigs.incentivesMultisig);
    };

    before("init contract", async () => {
        await setup(17527580);
    });

    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            const currentEpoch = await wardenQuestScheduler.getCurrentEpoch();
            expect(await wardenQuestScheduler.epochDuration(), "epochDuration").to.eq(ONE_WEEK);
            expect(await wardenQuestScheduler.duration(), "duration").to.eq(2);
            expect(await wardenQuestScheduler.cvx(), "cvx").to.eq(cvx.address);
            expect(await wardenQuestScheduler.owner(), "owner").to.eq(config.multisigs.incentivesMultisig);
            expect(await wardenQuestScheduler.authorizedKeepers(keeperAddress), "keeper").to.eq(true);
            expect(await wardenQuestScheduler.quests(0), "quests").to.eq(ZERO_ADDRESS);
            expect(await wardenQuestScheduler.rewardsQueue(currentEpoch, ZERO_ADDRESS), "rewardsQueue").to.eq(ZERO);
        });
    });

    describe("multisig create quests - wednesday", async () => {
        before(async () => {
            createQuestEpoch = await wardenQuestScheduler.getCurrentEpoch();
        });
        it("for aura-weth gauge", async () => {
            const amount = BN.from(questAuraWeth.feeAmount).add(BN.from(questAuraWeth.totalRewardAmount));
            await cvx.connect(multisig).approve(wardenQuestScheduler.address, amount);

            const cvxBalanceBefore = await cvx.balanceOf(config.multisigs.incentivesMultisig);
            // Test
            const tx = await wardenQuestScheduler
                .connect(multisig)
                .createQuest(
                    questAuraWeth.pid,
                    questAuraWeth.objective,
                    questAuraWeth.rewardPerVote,
                    questAuraWeth.totalRewardAmount,
                    questAuraWeth.feeAmount,
                    questAuraWeth.blacklist,
                );

            const cvxBalanceAfter = await cvx.balanceOf(config.multisigs.incentivesMultisig);
            // Find quest id
            const receipt = await waitForTx(tx, debug);
            const event = receipt.events.find(e => e.address === config.addresses.darkQuestBoard);
            auraWethQuestId = BN.from(event.topics[1]);

            expect(cvxBalanceAfter, "balance after").to.be.eq(cvxBalanceBefore.sub(amount));
            expect(auraWethQuestId, "questID").to.not.be.eq(ZERO);
        });
        it("for aura-BAL gauge", async () => {
            const amount = BN.from(questAuraBal.feeAmount).add(BN.from(questAuraBal.totalRewardAmount));
            await cvx.connect(multisig).approve(wardenQuestScheduler.address, amount);

            const cvxBalanceBefore = await cvx.balanceOf(config.multisigs.incentivesMultisig);
            // Test
            const tx = await wardenQuestScheduler
                .connect(multisig)
                .createQuest(
                    questAuraBal.pid,
                    questAuraBal.objective,
                    questAuraBal.rewardPerVote,
                    questAuraBal.totalRewardAmount,
                    questAuraBal.feeAmount,
                    questAuraBal.blacklist,
                );

            const cvxBalanceAfter = await cvx.balanceOf(config.multisigs.incentivesMultisig);
            // Find quest id
            const receipt = await waitForTx(tx, debug);
            const event = receipt.events.find(e => e.address === config.addresses.darkQuestBoard);
            auraBalQuestId = BN.from(event.topics[1]);

            expect(cvxBalanceAfter, "balance after").to.be.eq(cvxBalanceBefore.sub(amount));
            expect(auraBalQuestId, "questID").to.not.be.eq(ZERO);
        });
        it("Can call execute - removes blacklist account", async () => {
            const questID = auraBalQuestId;

            const questBlacklist = await darkQuestBoard.questBlacklist(questID, 0);

            expect(questBlacklist).to.be.eq(questAuraBal.blacklist[0]);
            const account = questBlacklist;

            const calldata = darkQuestBoard.interface.encodeFunctionData("removeFromBlacklist", [questID, account]);
            const tx = await wardenQuestScheduler.connect(keeper).execute(darkQuestBoard.address, 0, calldata);
            await expect(tx).to.emit(darkQuestBoard, "RemoveVoterBlacklist").withArgs(questID, account);

            const questBlacklistAfter = await darkQuestBoard.questBlacklist(questID, 0);
            expect(questBlacklistAfter).to.not.be.eq(account);
        });
    });
    describe("anyone withdraws unused rewards", async () => {
        let now: BN;
        let darkQuestBoardPeriodInit: BN;
        before(async () => {
            // Move to next epoch by forwarding only one day , wednesday => thursday
            now = await getTimestamp();
            const nowDate = new Date(0);
            nowDate.setUTCSeconds(now.toNumber());

            darkQuestBoardPeriodInit = createQuestEpoch.add(1).mul(ONE_WEEK);
        });
        it("fails to withdraw from an open quest - week 1", async () => {
            await increaseTime(ONE_WEEK);

            const currentEpoch = await wardenQuestScheduler.getCurrentEpoch();
            expect(createQuestEpoch, "epochs").to.be.eq(currentEpoch.sub(1));
            await expect(
                wardenQuestScheduler.connect(keeper).withdrawAndQueueUnusedRewards(auraWethQuestId),
            ).to.be.revertedWith("!periodFinish");
            await expect(
                wardenQuestScheduler.connect(keeper).withdrawAndQueueUnusedRewards(auraBalQuestId),
            ).to.be.revertedWith("!periodFinish");
        });
        it("fails to withdraw from an open quest - week 2", async () => {
            await increaseTime(ONE_WEEK);

            // Paladin close first period
            await darkQuestBoard.closeQuestPeriod(darkQuestBoardPeriodInit);

            const currentEpoch = await wardenQuestScheduler.getCurrentEpoch();
            expect(createQuestEpoch, "epochs").to.be.eq(currentEpoch.sub(2));
            await expect(
                wardenQuestScheduler.connect(keeper).withdrawAndQueueUnusedRewards(auraWethQuestId),
            ).to.be.revertedWith("!periodFinish");
            await expect(
                wardenQuestScheduler.connect(keeper).withdrawAndQueueUnusedRewards(auraBalQuestId),
            ).to.be.revertedWith("!periodFinish");
        });
        it("after the 2 week period  - aura weth", async () => {
            // Move to next epoch by forwarding only one day , wednesday => thursday
            await increaseTime(ONE_DAY);
            // Paladin close second period
            await darkQuestBoard.closeQuestPeriod(darkQuestBoardPeriodInit.add(ONE_WEEK));
            const currentEpoch = await wardenQuestScheduler.getCurrentEpoch();

            // It should withdraw unused rewards
            const tx = await wardenQuestScheduler.connect(keeper).withdrawAndQueueUnusedRewards(auraWethQuestId);
            await expect(tx).to.emit(wardenQuestScheduler, "QueuedRewards");
            // It should queue them in two different periods
            const rewardsQueue0 = await wardenQuestScheduler.rewardsQueue(currentEpoch, questAuraWeth.pid);
            const rewardsQueue1 = await wardenQuestScheduler.rewardsQueue(currentEpoch.add(1), questAuraWeth.pid);
            // Validate that are queued to the right epoch
            expect(rewardsQueue0).to.be.eq(rewardsQueue1);
            expect(await wardenQuestScheduler.rewardsQueue(currentEpoch.sub(1), questAuraWeth.pid)).to.be.eq(ZERO);
            expect(await wardenQuestScheduler.rewardsQueue(currentEpoch.add(2), questAuraWeth.pid)).to.be.eq(ZERO);
        });
    });
    describe("anyone forward rewards", async () => {
        it("forward current epoch - aura weth", async () => {
            const currentEpoch = await wardenQuestScheduler.getCurrentEpoch();
            const rewardsQueue = await wardenQuestScheduler.rewardsQueue(currentEpoch, questAuraWeth.pid);
            const balanceBefore = await cvx.balanceOf(extraRewardStashAuraWeth.address);

            const tx = await wardenQuestScheduler.connect(keeper).forwardRewards(questAuraWeth.pid);
            await expect(tx)
                .to.emit(wardenQuestScheduler, "ForwardedRewards")
                .withArgs(currentEpoch, questAuraWeth.pid, rewardsQueue);

            const balanceAfter = await cvx.balanceOf(extraRewardStashAuraWeth.address);
            expect(balanceAfter, "stash cvx balance").to.be.eq(balanceBefore.add(rewardsQueue));
            expect(await wardenQuestScheduler.rewardsQueue(currentEpoch, questAuraWeth.pid), "cleared reward").to.be.eq(
                ZERO,
            );
        });
        it("fails future epoch - aura weth", async () => {
            const currentEpoch = await wardenQuestScheduler.getCurrentEpoch();
            await expect(
                wardenQuestScheduler.connect(keeper).forwardQueuedRewards(currentEpoch.add(1), questAuraWeth.pid),
            ).to.be.revertedWith("!epoch");
        });
        it("forward second epoch - aura weth", async () => {
            await increaseTime(ONE_WEEK);

            const currentEpoch = await wardenQuestScheduler.getCurrentEpoch();
            const rewardsQueue = await wardenQuestScheduler.rewardsQueue(currentEpoch, questAuraWeth.pid);
            const balanceBefore = await cvx.balanceOf(extraRewardStashAuraWeth.address);

            const tx = await wardenQuestScheduler.connect(keeper).forwardQueuedRewards(currentEpoch, questAuraWeth.pid);
            await expect(tx)
                .to.emit(wardenQuestScheduler, "ForwardedRewards")
                .withArgs(currentEpoch, questAuraWeth.pid, rewardsQueue);

            const balanceAfter = await cvx.balanceOf(extraRewardStashAuraWeth.address);
            expect(balanceAfter, "stash cvx balance").to.be.eq(balanceBefore.add(rewardsQueue));
            expect(await wardenQuestScheduler.rewardsQueue(currentEpoch, questAuraWeth.pid), "cleared reward").to.be.eq(
                ZERO,
            );
        });
    });
    describe("edge cases", async () => {
        it("long after period finish - aura bal", async () => {
            await increaseTime(ONE_WEEK);
            const currentEpoch = await wardenQuestScheduler.getCurrentEpoch();

            // It should withdraw unused rewards
            const tx = await wardenQuestScheduler.connect(keeper).withdrawAndQueueUnusedRewards(auraBalQuestId);
            await expect(tx).to.emit(wardenQuestScheduler, "QueuedRewards");
            // It should queue them in two different periods
            const rewardsQueue0 = await wardenQuestScheduler.rewardsQueue(currentEpoch, questAuraBal.pid);
            const rewardsQueue1 = await wardenQuestScheduler.rewardsQueue(currentEpoch.add(1), questAuraBal.pid);
            // Validate that are queued to the right epoch
            expect(rewardsQueue0).to.be.eq(rewardsQueue1);
            expect(await wardenQuestScheduler.rewardsQueue(currentEpoch.sub(1), questAuraBal.pid)).to.be.eq(ZERO);
            expect(await wardenQuestScheduler.rewardsQueue(currentEpoch.add(2), questAuraBal.pid)).to.be.eq(ZERO);
        });
        it("cancel queue - current epoch", async () => {
            // Another Balancer Migration ?? No worries, it is possible to cancel the queue and recover rewards.
            const currentEpoch = await wardenQuestScheduler.getCurrentEpoch();
            const rewardsQueue = await wardenQuestScheduler.rewardsQueue(currentEpoch, questAuraBal.pid);
            const balanceBefore = await cvx.balanceOf(config.multisigs.incentivesMultisig);

            const tx = await wardenQuestScheduler.connect(multisig).cancelQueuedRewards(currentEpoch, questAuraBal.pid);
            await expect(tx)
                .to.emit(wardenQuestScheduler, "CanceledRewards")
                .withArgs(currentEpoch, questAuraBal.pid, rewardsQueue);

            const balanceAfter = await cvx.balanceOf(config.multisigs.incentivesMultisig);
            expect(balanceAfter, "recover rewards").to.be.eq(balanceBefore.add(rewardsQueue));
            expect(await wardenQuestScheduler.rewardsQueue(currentEpoch, questAuraBal.pid), "cleared reward").to.be.eq(
                ZERO,
            );
        });
        it("cancel queue - future epoch", async () => {
            // Another Balancer Migration ?? No worries, it is possible to cancel the queue and recover rewards.
            const epoch = (await wardenQuestScheduler.getCurrentEpoch()).add(1);
            const rewardsQueue = await wardenQuestScheduler.rewardsQueue(epoch, questAuraBal.pid);
            const balanceBefore = await cvx.balanceOf(config.multisigs.incentivesMultisig);

            const tx = await wardenQuestScheduler.connect(multisig).cancelQueuedRewards(epoch, questAuraBal.pid);
            await expect(tx)
                .to.emit(wardenQuestScheduler, "CanceledRewards")
                .withArgs(epoch, questAuraBal.pid, rewardsQueue);

            const balanceAfter = await cvx.balanceOf(config.multisigs.incentivesMultisig);
            expect(balanceAfter, "recover rewards").to.be.eq(balanceBefore.add(rewardsQueue));
            expect(await wardenQuestScheduler.rewardsQueue(epoch, questAuraBal.pid), "cleared reward").to.be.eq(ZERO);
        });
        it("fails as only owner cancel queue", async () => {
            // Another Balancer Migration ?? No worries, it is possible to cancel the queue and recover rewards.
            const epoch = (await wardenQuestScheduler.getCurrentEpoch()).add(1);

            await expect(
                wardenQuestScheduler.connect(keeper).cancelQueuedRewards(epoch, questAuraBal.pid),
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
        it("fails if queue is already cancelled", async () => {
            const epoch = (await wardenQuestScheduler.getCurrentEpoch()).add(1);

            await expect(
                wardenQuestScheduler.connect(multisig).cancelQueuedRewards(epoch, questAuraBal.pid),
            ).to.be.revertedWith("!amount");
        });
    });
});
