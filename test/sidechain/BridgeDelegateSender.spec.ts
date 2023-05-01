import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { SidechainDeployed } from "scripts/deploySidechain";
import { impersonateAccount, increaseTime, simpleToExactAmount, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { Account } from "../../types";
import { SimpleBridgeDelegateSender } from "../../types/generated";
import {
    BridgeDelegateSenderBehaviourContext,
    shouldBehaveLikeBridgeDelegateSender,
} from "../shared/BridgeDelegateSender.behaviour";
import { ERRORS, OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import { SideChainTestSetup, sidechainTestSetup } from "./sidechainTestSetup";
const NATIVE_FEE = simpleToExactAmount("0.2");

describe("BridgeDelegateSender", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;

    // Testing contract
    let bridgeDelegateSender: SimpleBridgeDelegateSender;
    let testSetup: SideChainTestSetup;
    let sidechain: SidechainDeployed;
    /* -- Declare shared functions -- */
    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts);
        bridgeDelegateSender = testSetup.bridgeDelegates.bridgeDelegateSender as SimpleBridgeDelegateSender;
        sidechain = testSetup.l2.sidechain;
    };
    before("init contract", async () => {
        await setup();
    });

    describe("behaviors", async () => {
        describe("should behave like Ownable ", async () => {
            const ctx: Partial<OwnableBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.owner = deployer;
                    ctx.anotherAccount = alice;
                    ctx.ownable = bridgeDelegateSender;
                    return ctx as OwnableBehaviourContext;
                };
            });
            shouldBehaveLikeOwnable(() => ctx as OwnableBehaviourContext);
        });
        describe("should behave like BridgeDelegateSender ", async () => {
            const ctx: Partial<BridgeDelegateSenderBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.owner = deployer;
                    ctx.anotherAccount = alice;
                    ctx.bridgeDelegateSender = bridgeDelegateSender;
                    ctx.crvAddress = ZERO_ADDRESS;
                    return ctx as BridgeDelegateSenderBehaviourContext;
                };
            });
            shouldBehaveLikeBridgeDelegateSender(() => ctx as BridgeDelegateSenderBehaviourContext);
        });
    });
    describe("constructor", async () => {
        before(async () => {
            await setup();
        });
        it("should properly store valid arguments", async () => {
            expect(await bridgeDelegateSender.owner(), "owner").to.eq(deployer.address);
            expect(await bridgeDelegateSender.token(), "token").to.eq(testSetup.l1.mocks.addresses.token);
        });
    });
    describe("send tokens", async () => {
        it("fails if caller is not the owner", async () => {
            await expect(bridgeDelegateSender.connect(alice.signer).send(ZERO), "!onlyOwner").to.be.revertedWith(
                ERRORS.ONLY_OWNER,
            );
        });
        it("earmark rewards sends fees to l2Coordinator's bridgeDelegate", async () => {
            // BoosterLite.earmarkRewards => L2Coordinator.queueNewRewards
            // a) => IERC20(balToken).safeTransfer(bridgeDelegate, balance);
            // b) => L1Coordinator._notifyFees
            const pid = 0;
            const stake = true;
            const amount = simpleToExactAmount(10);

            const bridgeDelegateBalanceBefore = await testSetup.l2.mocks.token.balanceOf(bridgeDelegateSender.address);
            await testSetup.l2.mocks.bpt.approve(sidechain.booster.address, amount);
            await sidechain.booster.deposit(pid, amount, stake);
            await increaseTime(60 * 60 * 24);

            // Send fees
            await sidechain.booster.earmarkRewards(pid, { value: NATIVE_FEE });

            const bridgeDelegateBalanceAfter = await testSetup.l2.mocks.token.balanceOf(bridgeDelegateSender.address);
            const bridgeDelegateBalanceDelta = bridgeDelegateBalanceAfter.sub(bridgeDelegateBalanceBefore);

            expect(bridgeDelegateBalanceAfter, "bridgeDelegateBalance").to.be.gt(bridgeDelegateBalanceBefore);
            // simulate bridging tokens  L2=>L1
            await testSetup.l1.mocks.crv.transfer(bridgeDelegateSender.address, bridgeDelegateBalanceDelta);
        });
        it("fails to send tokens if l1Receiver is not set", async () => {
            expect(await bridgeDelegateSender.l1Receiver(), "l1Receiver").to.be.eq(ZERO_ADDRESS);
            await expect(
                bridgeDelegateSender.connect(deployer.signer).send(ZERO),
                "L1ReceiverNotSet",
            ).to.be.revertedWith("L1ReceiverNotSet");
        });
        it("allows to send tokens to another account", async () => {
            const l1Receiver = alice.address;
            await bridgeDelegateSender.setL1Receiver(l1Receiver);
            const balanceBefore = await testSetup.l1.mocks.crv.balanceOf(bridgeDelegateSender.address);

            const tx = await bridgeDelegateSender.connect(deployer.signer).send(balanceBefore);
            await expect(tx).to.emit(bridgeDelegateSender, "Send").withArgs(l1Receiver, balanceBefore);

            const balanceAfter = await testSetup.l1.mocks.crv.balanceOf(bridgeDelegateSender.address);
            const targetBalance = await testSetup.l1.mocks.crv.balanceOf(l1Receiver);

            expect(balanceAfter, "bridgeDelegateBalance").to.be.eq(ZERO);
            expect(targetBalance, "tokens sent to target").to.be.eq(balanceBefore);
        });
    });
});
