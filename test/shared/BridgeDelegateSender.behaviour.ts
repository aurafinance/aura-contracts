import { expect } from "chai";
import { loadFixture } from "ethereum-waffle";
import { Account } from "types";

import { DEAD_ADDRESS, ZERO_ADDRESS } from "../../test-utils/constants";
import { BridgeDelegateSender } from "../../types/generated";

export interface BridgeDelegateSenderBehaviourContext {
    bridgeDelegateSender: BridgeDelegateSender;
    owner: Account;
    anotherAccount: Account;
    crvAddress: string;
    fixture: () => Promise<BridgeDelegateSenderBehaviourContext>;
}

export const ERRORS = {
    ONLY_OWNER: "Ownable: caller is not the owner",
    ZERO_ADDRESS: "!0",
};

export function shouldBehaveLikeBridgeDelegateSender(_ctx: () => BridgeDelegateSenderBehaviourContext): void {
    describe("BridgeDelegateSender", () => {
        let bridgeDelegateSender: BridgeDelegateSender;
        let owner: Account;
        let anotherAccount: Account;
        let crvAddress: string;
        let ctx: BridgeDelegateSenderBehaviourContext;

        before("reset contracts", async () => {
            const { fixture } = _ctx();
            ctx = await loadFixture(fixture);
            ({ bridgeDelegateSender, owner, anotherAccount, crvAddress } = ctx);
        });
        describe("store values", async () => {
            it("should properly store constructor arguments", async () => {
                expect(await bridgeDelegateSender.crv(), "crv").to.eq(crvAddress);
                expect(await bridgeDelegateSender.l1Receiver(), "l1Receiver").to.eq(ZERO_ADDRESS);
                expect(await bridgeDelegateSender.l2Coordinator(), "l2Coordinator").to.eq(ZERO_ADDRESS);
            });
        });
        describe("setL1Receiver", async () => {
            it("fails if caller is not the owner", async () => {
                await expect(
                    bridgeDelegateSender.connect(anotherAccount.signer).setL1Receiver(ZERO_ADDRESS),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("fails if address is ZERO_ADDRESS", async () => {
                await expect(
                    bridgeDelegateSender.connect(owner.signer).setL1Receiver(ZERO_ADDRESS),
                    "!ZERO_ADDRESS",
                ).to.be.revertedWith(ERRORS.ZERO_ADDRESS);
            });
            it("updates the l1Receiver", async () => {
                const l1ReceiverBefore = await bridgeDelegateSender.l1Receiver();
                await bridgeDelegateSender.setL1Receiver(DEAD_ADDRESS);
                // No events
                const l1ReceiverAfter = await bridgeDelegateSender.l1Receiver();
                expect(l1ReceiverAfter, "l1Receiver").to.not.be.eq(l1ReceiverBefore);
                expect(l1ReceiverAfter, "l1Receiver").to.be.eq(DEAD_ADDRESS);
            });
        });
        describe("setL2Coordinator", async () => {
            it("fails if caller is not the owner", async () => {
                await expect(
                    bridgeDelegateSender.connect(anotherAccount.signer).setL2Coordinator(ZERO_ADDRESS),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("fails if address is ZERO_ADDRESS", async () => {
                await expect(
                    bridgeDelegateSender.connect(owner.signer).setL2Coordinator(ZERO_ADDRESS),
                    "!ZERO_ADDRESS",
                ).to.be.revertedWith(ERRORS.ZERO_ADDRESS);
            });
            it("updates the L2Coordinator", async () => {
                const l2CoordinatorBefore = await bridgeDelegateSender.l2Coordinator();
                await bridgeDelegateSender.setL2Coordinator(DEAD_ADDRESS);
                // No events
                const l2CoordinatorAfter = await bridgeDelegateSender.l2Coordinator();
                expect(l2CoordinatorAfter, "l2Coordinator").to.not.be.eq(l2CoordinatorBefore);
                expect(l2CoordinatorAfter, "l2Coordinator").to.be.eq(DEAD_ADDRESS);
            });
        });
    });
}
