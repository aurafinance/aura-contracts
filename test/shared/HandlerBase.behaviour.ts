import hre from "hardhat";
import { expect } from "chai";
import { AuraBalStrategyBase, ERC20, HandlerBase, MockERC20, MockERC20__factory } from "../../types/generated";
import { Account } from "types";
import { simpleToExactAmount } from "../../test-utils/math";
import { deployContract } from "../../tasks/utils";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { loadFixture } from "ethereum-waffle";

export interface HandlerBaseBehaviourContext {
    rewardHandler: HandlerBase;
    token: ERC20;
    owner: Account;
    anotherAccount: Account;
    strategy: AuraBalStrategyBase;
    addresses: {
        weth: string;
        balancerVault: string;
    };
    fixture: () => Promise<HandlerBaseBehaviourContext>;
}

export function shouldBehaveLikeHandlerBase(_ctx: () => HandlerBaseBehaviourContext): void {
    describe("HandlerBase", () => {
        let rewardHandler: HandlerBase;
        let token: ERC20;
        let owner: Account;
        let anotherAccount: Account;
        let strategy: AuraBalStrategyBase;

        let ctx: HandlerBaseBehaviourContext;
        before("reset contracts", async () => {
            const { fixture } = _ctx();
            ctx = await loadFixture(fixture);
            rewardHandler = ctx.rewardHandler;
            token = ctx.token;
            owner = ctx.owner;
            anotherAccount = ctx.anotherAccount;
            strategy = ctx.strategy;
        });
        describe("store values", async () => {
            it("should properly store constructor arguments", async () => {
                expect(await rewardHandler.owner(), "owner").to.eq(owner.address);
                expect(await rewardHandler.pendingOwner(), "pendingOwner").to.eq(ZERO_ADDRESS);
                expect(await rewardHandler.token(), "token").to.eq(token.address);
                expect(await rewardHandler.strategy(), "strategy").to.eq(strategy.address);
                expect(await rewardHandler.WETH_TOKEN(), "WETH_TOKEN").to.eq(ctx.addresses.weth);
            });
        });
        describe("set new owner", async () => {
            it("setPendingOwner fails if caller is not owner", async () => {
                await expect(
                    rewardHandler.connect(anotherAccount.signer).setPendingOwner(ZERO_ADDRESS),
                    "fails due to only owner",
                ).to.be.revertedWith("owner only");
            });
            it("applyPendingOwner fails if caller is not owner", async () => {
                await expect(
                    rewardHandler.connect(anotherAccount.signer).applyPendingOwner(),
                    "fails due to only owner",
                ).to.be.revertedWith("owner only");
            });
            it("applyPendingOwner fails pending owner is ZERO_ADDRESS", async () => {
                expect(await rewardHandler.pendingOwner(), "pending owner").to.be.eq(ZERO_ADDRESS);
                await expect(
                    rewardHandler.connect(owner.signer).applyPendingOwner(),
                    "fails invalid owner",
                ).to.be.revertedWith("invalid owner");
            });
            it("via setPendingOwner and applyPendingOwner", async () => {
                await rewardHandler.connect(owner.signer).setPendingOwner(anotherAccount.address);
                expect(await rewardHandler.pendingOwner(), "pending owner").to.be.eq(anotherAccount.address);
                // No Events
                await rewardHandler.connect(owner.signer).applyPendingOwner();
                expect(await rewardHandler.owner(), "pending owner").to.be.eq(anotherAccount.address);
                expect(await rewardHandler.pendingOwner(), "pending owner").to.be.eq(ZERO_ADDRESS);

                // Revert changes
                await rewardHandler.connect(anotherAccount.signer).setPendingOwner(owner.address);
                await rewardHandler.connect(anotherAccount.signer).applyPendingOwner();
                expect(await rewardHandler.owner(), "pending owner").to.be.eq(owner.address);
            });
        });
        describe("rescueToken", async () => {
            let randomToken: MockERC20;
            before(async () => {
                randomToken = await deployContract<MockERC20>(
                    hre,
                    new MockERC20__factory(owner.signer),
                    "RandomToken",
                    ["randomToken", "randomToken", 18, owner.address, 10000000],
                    {},
                    false,
                );
            });

            it("transfer token from handler to target address", async () => {
                // Given that the handler has some token balance
                const amount = simpleToExactAmount(200);
                await randomToken.transfer(rewardHandler.address, amount);

                const ownerBalanceBefore = await randomToken.balanceOf(owner.address);
                const rewardHandlerBalanceBefore = await randomToken.balanceOf(rewardHandler.address);

                expect(rewardHandlerBalanceBefore, "reward handler balance").to.eq(amount);

                // When rescue token
                const tx = await rewardHandler.rescueToken(randomToken.address, owner.address);
                // Then tokens are sent to target address
                await expect(tx)
                    .to.emit(randomToken, "Transfer")
                    .withArgs(rewardHandler.address, owner.address, amount);
                const ownerBalanceAfter = await randomToken.balanceOf(owner.address);
                const rewardHandlerBalanceAfter = await randomToken.balanceOf(rewardHandler.address);
                expect(rewardHandlerBalanceAfter, "reward handler balance").to.eq(
                    rewardHandlerBalanceBefore.sub(amount),
                );
                expect(ownerBalanceAfter, "owner handler balance").to.eq(ownerBalanceBefore.add(amount));
            });
            it("fails if caller is not owner", async () => {
                await expect(
                    rewardHandler.connect(anotherAccount.signer).rescueToken(ZERO_ADDRESS, ZERO_ADDRESS),
                    "fails due to owner only ",
                ).to.be.revertedWith("owner only");
            });
            it("fails if token is handler sell token", async () => {
                await expect(
                    rewardHandler.connect(owner.signer).rescueToken(token.address, ZERO_ADDRESS),
                    "fails due to not allowed",
                ).to.be.revertedWith("not allowed");
            });
        });
        describe("sell", async () => {
            // sell test must be done on the implementation.
            it("fails if strategy is not the caller", async () => {
                await expect(rewardHandler.sell(), "fails due to ").to.be.revertedWith("strategy only");
            });
        });
    });
}
