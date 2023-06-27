import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";

import { deployContract } from "../../tasks/utils";
import { getTimestamp, increaseTime } from "../../test-utils";
import { DEAD_ADDRESS, ONE_WEEK, ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import { simpleToExactAmount } from "../../test-utils/math";
import {
    ExtraRewardStashScheduler,
    ExtraRewardStashScheduler__factory,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    MockERC20,
    MockERC20__factory,
} from "../../types/generated";

const debug = false;

describe("ExtraRewardStashScheduler", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Signer;
    let deployerAddress: string;
    let alice: Signer;
    let aliceAddress: string;
    let cvx: MockERC20;
    let extraRewardStashAuraBal: ExtraRewardStashV3;
    let extraRewardStashAuraWeth: ExtraRewardStashV3;
    // Testing contract
    let extraRewardStashScheduler: ExtraRewardStashScheduler;

    /* -- Declare shared functions -- */

    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();
        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        //    Deploy Mocks

        cvx = await deployContract<MockERC20>(
            hre,
            new MockERC20__factory(deployer),
            "Mockcvx",
            ["mockcvx", "mockcvx", 18, deployerAddress, 10000000],
            {},
            debug,
        );
        const crv = await deployContract<MockERC20>(
            hre,
            new MockERC20__factory(deployer),
            "Mockcrv",
            ["mockcrv", "mockcrv", 18, deployerAddress, 10000000],
            {},
            debug,
        );

        extraRewardStashAuraBal = await deployContract<ExtraRewardStashV3>(
            hre,
            new ExtraRewardStashV3__factory(deployer),
            "ExtraRewardStash",
            [crv.address],
            {},
            debug,
        );
        extraRewardStashAuraWeth = await deployContract<ExtraRewardStashV3>(
            hre,
            new ExtraRewardStashV3__factory(deployer),
            "ExtraRewardStash",
            [crv.address],
            {},
            debug,
        );
        // Deploy test contract.
        extraRewardStashScheduler = await deployContract<ExtraRewardStashScheduler>(
            hre,
            new ExtraRewardStashScheduler__factory(deployer),
            "ExtraRewardStashScheduler",
            [cvx.address],
            {},
            debug,
        );

        extraRewardStashScheduler = extraRewardStashScheduler.connect(alice);

        await cvx.transfer(aliceAddress, simpleToExactAmount(100));
    };

    before("init contract", async () => {
        await setup();
    });

    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            const currentEpoch = await extraRewardStashScheduler.getCurrentEpoch();
            expect(await extraRewardStashScheduler.epochDuration(), "epochDuration").to.eq(ONE_WEEK);
            expect(await extraRewardStashScheduler.cvx(), "cvx").to.eq(cvx.address);
            expect(await extraRewardStashScheduler.epochRewards(currentEpoch, ZERO_ADDRESS), "epochRewards").to.eq(
                ZERO,
            );
        });
    });

    describe("queueRewards for one stash", async () => {
        const amount = simpleToExactAmount(20);

        it("should add a reward for two periods", async () => {
            const nEpochs = 2;
            const stashAddress = extraRewardStashAuraBal.address;
            await cvx.connect(alice).approve(extraRewardStashScheduler.address, amount);

            const cvxBalanceBefore = await cvx.balanceOf(extraRewardStashScheduler.address);

            // Test
            await extraRewardStashScheduler.queueRewards(stashAddress, nEpochs, amount);

            const cvxBalanceAfter = await cvx.balanceOf(extraRewardStashScheduler.address);
            expect(cvxBalanceAfter, "balance after").to.be.eq(cvxBalanceBefore.add(amount));
        });
        it("verifies epochRewards rewards are correct ", async () => {
            const epoch = await extraRewardStashScheduler.getCurrentEpoch();
            const epoch1Amount = await extraRewardStashScheduler.epochRewards(epoch, extraRewardStashAuraBal.address);
            const epoch2Amount = await extraRewardStashScheduler.epochRewards(
                epoch.add(1),
                extraRewardStashAuraBal.address,
            );

            expect(epoch1Amount, "epoch reward amounts").to.be.eq(epoch2Amount);
            expect(epoch1Amount.add(epoch2Amount), "epoch reward amounts").to.be.eq(amount);
        });
    });
    describe("queueRewards for another stash more than once", async () => {
        const amount = simpleToExactAmount(20);

        it("should add a reward for 1 period", async () => {
            const nEpochs = 1;
            const stashAddress = extraRewardStashAuraWeth.address;
            await cvx.connect(alice).approve(extraRewardStashScheduler.address, amount);

            const cvxBalanceBefore = await cvx.balanceOf(extraRewardStashScheduler.address);

            // Test
            await extraRewardStashScheduler.queueRewards(stashAddress, nEpochs, amount);

            const cvxBalanceAfter = await cvx.balanceOf(extraRewardStashScheduler.address);
            expect(cvxBalanceAfter, "balance after").to.be.eq(cvxBalanceBefore.add(amount));
        });
        it("verifies epochRewards rewards are correct ", async () => {
            const stashAddress = extraRewardStashAuraWeth.address;
            const epoch = await extraRewardStashScheduler.getCurrentEpoch();
            const epoch1Amount = await extraRewardStashScheduler.epochRewards(epoch, stashAddress);
            const epoch2Amount = await extraRewardStashScheduler.epochRewards(epoch.add(1), stashAddress);

            expect(epoch1Amount, "epoch reward amounts").to.be.eq(amount);
            expect(epoch2Amount, "epoch reward amounts").to.be.eq(ZERO);
            expect(epoch1Amount.add(epoch2Amount), "epoch reward amounts").to.be.eq(amount);
        });
        it("fails to  add rewards again", async () => {
            await cvx.connect(alice).approve(extraRewardStashScheduler.address, amount);
            const stashAddress = extraRewardStashAuraWeth.address;
            await expect(extraRewardStashScheduler.queueRewards(stashAddress, 1, amount), "error").to.be.revertedWith(
                "already queued",
            );
        });

        it("should add rewards again for 2 periods", async () => {
            const nEpochs = 2;
            const stashAddress = extraRewardStashAuraWeth.address;
            await cvx.connect(alice).approve(extraRewardStashScheduler.address, amount);

            const cvxBalanceBefore = await cvx.balanceOf(extraRewardStashScheduler.address);

            // Test
            await extraRewardStashScheduler.forceQueueRewards(stashAddress, nEpochs, amount);

            const cvxBalanceAfter = await cvx.balanceOf(extraRewardStashScheduler.address);
            expect(cvxBalanceAfter, "balance after").to.be.eq(cvxBalanceBefore.add(amount));

            // Verifies epoch 1 has double the amount
            const epoch = await extraRewardStashScheduler.getCurrentEpoch();
            const epoch1Amount = await extraRewardStashScheduler.epochRewards(epoch, stashAddress);
            const epoch2Amount = await extraRewardStashScheduler.epochRewards(epoch.add(1), stashAddress);

            expect(epoch1Amount, "epoch reward amounts").to.be.eq(amount.add(amount.div(2)));
            expect(epoch2Amount, "epoch reward amounts").to.be.eq(amount.div(2));
            expect(epoch1Amount.add(epoch2Amount), "epoch reward amounts").to.be.eq(amount.mul(2));
        });
    });

    //
    describe("forward", async () => {
        it("forward current epoch", async () => {
            const now = await getTimestamp();
            const currentEpoch = now.div(await extraRewardStashScheduler.epochDuration());
            const epoch = await extraRewardStashScheduler.getCurrentEpoch();
            const stashAddress = extraRewardStashAuraBal.address;

            expect(currentEpoch, "currentEpoch").to.be.eq(epoch);
            const cvxBalanceBefore = await cvx.balanceOf(extraRewardStashScheduler.address);
            const stashCvxBalanceBefore = await cvx.balanceOf(stashAddress);

            const epochAmountBefore = await extraRewardStashScheduler.epochRewards(epoch, stashAddress);
            expect(epochAmountBefore, "epochAmount").to.be.gt(ZERO);

            // Test
            await extraRewardStashScheduler.forwardRewards(stashAddress);
            // Verify events, storage change, balance, etc.
            const cvxBalanceAfter = await cvx.balanceOf(extraRewardStashScheduler.address);
            const stashCvxBalanceAfter = await cvx.balanceOf(stashAddress);
            const epochAmountAfter = await extraRewardStashScheduler.epochRewards(epoch, stashAddress);

            expect(cvxBalanceAfter, "cvxBalance").to.be.eq(cvxBalanceBefore.sub(epochAmountBefore));
            expect(stashCvxBalanceAfter, "cvxBalance").to.be.eq(stashCvxBalanceBefore.add(epochAmountBefore));
            expect(epochAmountAfter, "epochAmount").to.be.eq(ZERO);
        });
        it("fails if the given stash does not have any reward assigned", async () => {
            await expect(
                extraRewardStashScheduler.forwardRewards(DEAD_ADDRESS),
                "nothing to forward",
            ).to.be.revertedWith("!amount");
        });
    });

    //
    describe("forward providing an epoch", async () => {
        it("forward  past epoch", async () => {
            await increaseTime(ONE_WEEK);
            const stashAddress = extraRewardStashAuraWeth.address;

            const now = await getTimestamp();
            const currentEpoch = now.div(await extraRewardStashScheduler.epochDuration());
            const epoch = (await extraRewardStashScheduler.getCurrentEpoch()).sub(1);

            expect(currentEpoch, "currentEpoch").to.be.gt(epoch);
            const cvxBalanceBefore = await cvx.balanceOf(extraRewardStashScheduler.address);
            const epochAmountBefore = await extraRewardStashScheduler.epochRewards(epoch, stashAddress);
            expect(epochAmountBefore, "epochAmount").to.be.gt(ZERO);

            // Test
            await extraRewardStashScheduler.forwardEpochRewards(stashAddress, epoch);
            // Verify events, storage change, balance, etc.
            const cvxBalanceAfter = await cvx.balanceOf(extraRewardStashScheduler.address);
            const epochAmountAfter = await extraRewardStashScheduler.epochRewards(epoch, stashAddress);

            expect(cvxBalanceAfter, "cvxBalance").to.be.eq(cvxBalanceBefore.sub(epochAmountBefore));
            expect(epochAmountAfter, "epochAmount").to.be.eq(ZERO);
        });
        it("forward  current epoch", async () => {
            const stashAddress = extraRewardStashAuraWeth.address;

            const now = await getTimestamp();
            const currentEpoch = now.div(await extraRewardStashScheduler.epochDuration());
            const epoch = await extraRewardStashScheduler.getCurrentEpoch();

            expect(currentEpoch, "currentEpoch").to.be.eq(epoch);
            const cvxBalanceBefore = await cvx.balanceOf(extraRewardStashScheduler.address);
            const epochAmountBefore = await extraRewardStashScheduler.epochRewards(epoch, stashAddress);
            expect(epochAmountBefore, "epochAmount").to.be.gt(ZERO);
            // Test
            await extraRewardStashScheduler.forwardEpochRewards(stashAddress, epoch);
            // Verify events, storage change, balance, etc.
            const cvxBalanceAfter = await cvx.balanceOf(extraRewardStashScheduler.address);
            const epochAmountAfter = await extraRewardStashScheduler.epochRewards(epoch, stashAddress);

            expect(cvxBalanceAfter, "cvxBalance").to.be.eq(cvxBalanceBefore.sub(epochAmountBefore));
            expect(epochAmountAfter, "epochAmount").to.be.eq(ZERO);
        });
        it("fails if epoch is in the future", async () => {
            const epoch = (await extraRewardStashScheduler.getCurrentEpoch()).add(1);
            await expect(
                extraRewardStashScheduler.forwardEpochRewards(DEAD_ADDRESS, epoch),
                "nothing to forward",
            ).to.be.revertedWith("!epoch");
        });
    });
});
