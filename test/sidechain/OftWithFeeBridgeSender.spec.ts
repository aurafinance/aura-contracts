import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { deployContract } from "../../tasks/utils";
import { impersonateAccount, simpleToExactAmount, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { Account } from "../../types";
import {
    LZEndpointMock__factory,
    MockOFTWithFee,
    MockOFTWithFee__factory,
    OftWithFeeBridgeSender,
    OftWithFeeBridgeSender__factory,
} from "../../types/generated";
import {
    BridgeDelegateSenderBehaviourContext,
    shouldBehaveLikeBridgeDelegateSender,
} from "../shared/BridgeDelegateSender.behaviour";
import { ERRORS, OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import { CanonicalPhaseDeployed, SideChainTestSetup, sidechainTestSetup } from "./sidechainTestSetup";

const NATIVE_FEE = simpleToExactAmount("0.2");

const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;

describe("OftWithFeeBridgeSender", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;

    // Testing contract∏
    let bridgeDelegateSender: OftWithFeeBridgeSender;
    let testSetup: SideChainTestSetup;
    let canonical: CanonicalPhaseDeployed;
    let oftWithFee: MockOFTWithFee;

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
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts);
        canonical = testSetup.l1.canonical;

        // For simplicity , only one instance of OFT is used in this test. OFT L1 == OFT L2
        oftWithFee = await deployContract<MockOFTWithFee>(
            hre,
            new MockOFTWithFee__factory(deployer.signer),
            "MockOFTWithFee",
            ["BAL-OFT", "BAL-OFT", testSetup.l2.mocks.addresses.lzEndpoint],
            {},
            false,
        );
        await oftWithFee.setTrustedRemoteAddress(L1_CHAIN_ID, oftWithFee.address);
        await oftWithFee.setTrustedRemoteAddress(L2_CHAIN_ID, oftWithFee.address);
        const l2LzEndpoint = LZEndpointMock__factory.connect(testSetup.l2.mocks.addresses.lzEndpoint, deployer.signer);
        await l2LzEndpoint.setDestLzEndpoint(oftWithFee.address, testSetup.l2.mocks.addresses.lzEndpoint);

        bridgeDelegateSender = await deployContract<OftWithFeeBridgeSender>(
            hre,
            new OftWithFeeBridgeSender__factory(deployer.signer),
            "OftWithFeeBridgeSender",
            [oftWithFee.address, L1_CHAIN_ID],
            {},
            false,
        );
        const testAmount = simpleToExactAmount(100);
        await bridgeDelegateSender.updateAuthorizedKeepers(deployer.address, true);

        // Send some OFT balance to the sender
        await oftWithFee.connect(deployer.signer).creditTo(L2_CHAIN_ID, bridgeDelegateSender.address, testAmount);

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
    describe("settings", async () => {
        before(async () => {
            await setup();
            await bridgeDelegateSender.setL1Receiver(canonical.l1Coordinator.address);
        });
        it("should properly store valid arguments", async () => {
            expect(await bridgeDelegateSender.owner(), "owner").to.eq(deployer.address);
            expect(await bridgeDelegateSender.crvOft(), "crvOft").to.eq(oftWithFee.address);
            expect(await bridgeDelegateSender.l1Receiver(), "l1Receiver").to.eq(canonical.l1Coordinator.address);
            expect(await bridgeDelegateSender.canonicalChainId(), "canonicalChainId").to.eq(L1_CHAIN_ID);
            expect(await bridgeDelegateSender.adapterParams(), "adapterParams").to.eq("0x");
        });
        it("adapter params fails if caller is not the owner", async () => {
            await expect(
                bridgeDelegateSender.connect(alice.signer).setAdapterParams("0x"),
                "!owner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("set adapter params", async () => {
            const tx = await bridgeDelegateSender.connect(deployer.signer).setAdapterParams("0x");
            await expect(tx).to.emit(bridgeDelegateSender, "SetAdapterParams").withArgs("0x");
        });
    });
    describe("send tokens", async () => {
        it("fails if caller is not the keeper", async () => {
            await expect(
                bridgeDelegateSender.connect(alice.signer).sendFrom(ZERO, ZERO, { value: 0 }),
                "!keeper",
            ).to.be.revertedWith(ERRORS.ONLY_KEEPER);
        });
        it("fails if caller min amount is zero", async () => {
            await expect(
                bridgeDelegateSender.connect(deployer.signer).sendFrom(ZERO, ZERO, { value: 0 }),
                "!mintAmount",
            ).to.be.revertedWith("!minAmount");
        });
        it("allows to send tokens to l1Coordinator", async () => {
            const l1Receiver = canonical.l1Coordinator;
            const receiverBalanceBefore = await oftWithFee.balanceOf(l1Receiver.address);
            const senderBalanceBefore = await oftWithFee.balanceOf(bridgeDelegateSender.address);
            expect(senderBalanceBefore).to.be.gt(ZERO);

            const tx = await bridgeDelegateSender
                .connect(deployer.signer)
                .sendFrom(senderBalanceBefore, senderBalanceBefore, { value: NATIVE_FEE });
            await expect(tx).to.emit(bridgeDelegateSender, "Send").withArgs(l1Receiver.address, senderBalanceBefore);

            const receiverBalanceAfter = await oftWithFee.balanceOf(l1Receiver.address);
            const senderBalanceAfter = await oftWithFee.balanceOf(bridgeDelegateSender.address);

            expect(senderBalanceAfter, "bridgeDelegateBalance").to.be.eq(ZERO);
            expect(receiverBalanceAfter, "tokens sent to address").to.be.eq(
                receiverBalanceBefore.add(senderBalanceBefore),
            );
        });
    });
});
