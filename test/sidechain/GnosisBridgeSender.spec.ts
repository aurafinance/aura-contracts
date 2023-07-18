import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";

import { deployGnosisBridgeSender } from "../../scripts/deployBridgeDelegates";
import { deployContract } from "../../tasks/utils";
import { impersonateAccount, simpleToExactAmount, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { Account } from "../../types";
import { GnosisBridgeSender, MockERC677, MockERC677__factory } from "../../types/generated";
import {
    BridgeDelegateSenderBehaviourContext,
    shouldBehaveLikeBridgeDelegateSender,
} from "../shared/BridgeDelegateSender.behaviour";
import { ERRORS, OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";

const debug = false;

describe("BridgeDelegateSender", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;

    // Testing contract
    let bridgeDelegateSender: GnosisBridgeSender;
    let bridgeAddress: string;
    let crv: MockERC677;
    /* -- Declare shared functions -- */
    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        bridgeAddress = await accounts[6].getAddress();
        crv = await deployContract(
            hre,
            new MockERC677__factory(deployer.signer),
            "MockERC677",
            ["CRV", "CRV", 18, deployer.address, 100000],
            {},
            debug,
        );
        bridgeDelegateSender = await deployGnosisBridgeSender(hre, deployer.signer, bridgeAddress, crv.address);

        // send some balance to the bridge delegate
        await crv.transfer(bridgeDelegateSender.address, simpleToExactAmount(2));
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
                    ctx.crvAddress = crv.address;
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
            expect(await bridgeDelegateSender.bridge(), "bridge").to.eq(bridgeAddress);
        });
    });
    describe("send tokens", async () => {
        it("fails if caller is not the owner", async () => {
            await expect(bridgeDelegateSender.connect(alice.signer).send(ZERO), "!keeper").to.be.revertedWith(
                ERRORS.ONLY_KEEPER,
            );
        });
        it("set keeper", async () => {
            await bridgeDelegateSender.updateAuthorizedKeepers(deployer.address, true);
            expect(await bridgeDelegateSender.authorizedKeepers(deployer.address)).eq(true);
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
            const balanceBefore = await crv.balanceOf(bridgeDelegateSender.address);
            await crv.approve(l1Receiver, balanceBefore);

            expect(balanceBefore, "balance").to.not.be.eq(ZERO);

            const tx = await bridgeDelegateSender.connect(deployer.signer).send(balanceBefore, { gasLimit: 1000000 });

            await expect(tx).to.emit(bridgeDelegateSender, "Send").withArgs(l1Receiver, balanceBefore);

            const balanceAfter = await crv.balanceOf(bridgeDelegateSender.address);
            const targetBalance = await crv.balanceOf(l1Receiver);

            expect(balanceAfter, "bridgeDelegateBalance").to.be.eq(ZERO);
            expect(targetBalance, "tokens sent to target").to.be.eq(balanceBefore);
        });
    });
});
