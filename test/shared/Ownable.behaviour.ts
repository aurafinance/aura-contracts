import { expect } from "chai";
import { Ownable } from "../../types/generated";
import { Account } from "types";
import { DEAD_ADDRESS, ZERO_ADDRESS } from "../../test-utils/constants";
import { loadFixture } from "ethereum-waffle";

export interface OwnableBehaviourContext {
    ownable: Ownable;
    owner: Account;
    anotherAccount: Account;
    fixture: () => Promise<OwnableBehaviourContext>;
}

export const ERRORS = {
    ONLY_OWNER: "Ownable: caller is not the owner",
    ZERO_ADDRESS: "Ownable: new owner is the zero address",
};

export function shouldBehaveLikeOwnable(_ctx: () => OwnableBehaviourContext): void {
    describe("Ownable", () => {
        let ownable: Ownable;
        let owner: Account;
        let anotherAccount: Account;

        let ctx: OwnableBehaviourContext;
        before("reset contracts", async () => {
            const { fixture } = _ctx();
            ctx = await loadFixture(fixture);
            ownable = ctx.ownable;
            owner = ctx.owner;
            anotherAccount = ctx.anotherAccount;
        });
        describe("store values", async () => {
            it("should properly store constructor arguments", async () => {
                expect(await ownable.owner(), "owner").to.eq(owner.address);
            });
        });
        describe("transfer ownership", async () => {
            it("transferOwnership fails if caller is not owner", async () => {
                await expect(
                    ownable.connect(anotherAccount.signer).transferOwnership(DEAD_ADDRESS),
                    "fails due to only owner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("transferOwnership fails if address is zero", async () => {
                await expect(
                    ownable.connect(owner.signer).transferOwnership(ZERO_ADDRESS),
                    "fails due to zero address",
                ).to.be.revertedWith(ERRORS.ZERO_ADDRESS);
            });
            it("transferOwnership to new owner", async () => {
                const tx = await ownable.connect(owner.signer).transferOwnership(anotherAccount.address);
                await expect(tx)
                    .to.emit(ownable, "OwnershipTransferred")
                    .withArgs(owner.address, anotherAccount.address);

                expect(await ownable.owner(), "owner").to.be.eq(anotherAccount.address);
            });

            it("renounceOwnership", async () => {
                const tx = await ownable.connect(anotherAccount.signer).renounceOwnership();
                await expect(tx)
                    .to.emit(ownable, "OwnershipTransferred")
                    .withArgs(anotherAccount.address, ZERO_ADDRESS);

                expect(await ownable.owner(), "owner").to.be.eq(ZERO_ADDRESS);
            });
        });
    });
}
