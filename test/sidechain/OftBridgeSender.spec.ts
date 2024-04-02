import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { deployContract } from "../../tasks/utils";
import { impersonateAccount, simpleToExactAmount, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { bridgeTokenFromL1ToL2 } from "../../test/shared/common";
import { Account } from "../../types";
import { ERC20, OftBridgeSender, OftBridgeSender__factory } from "../../types/generated";
import {
    BridgeDelegateSenderBehaviourContext,
    shouldBehaveLikeBridgeDelegateSender,
} from "../shared/BridgeDelegateSender.behaviour";
import { ERRORS, OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import {
    CanonicalPhaseDeployed,
    SidechainDeployed,
    SideChainTestSetup,
    sidechainTestSetup,
} from "./sidechainTestSetup";

const NATIVE_FEE = simpleToExactAmount("0.2");

const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;

describe("OftBridgeSender", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;

    // Testing contract∏
    let bridgeDelegateSender: OftBridgeSender;
    let testSetup: SideChainTestSetup;
    let sidechain: SidechainDeployed;
    let canonical: CanonicalPhaseDeployed;
    let cvx: ERC20;

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
        sidechain = testSetup.l2.sidechain;
        canonical = testSetup.l1.canonical;
        cvx = testSetup.l1.phase2.cvx;

        // Avalanche OFT is BAL, for testing purposes we use Aura
        bridgeDelegateSender = await deployContract<OftBridgeSender>(
            hre,
            new OftBridgeSender__factory(deployer.signer),
            "OftBridgeSender",
            [sidechain.auraOFT.address, L1_CHAIN_ID],
            {},
            false,
        );
        await bridgeDelegateSender.updateAuthorizedKeepers(deployer.address, true);
        // transferOwnership

        // Send some balances in order to test
        // dirty trick to get some cvx balance.
        const cvxDepositorAccount = await impersonateAccount(testSetup.l1.phase2.vestedEscrows[0].address);
        const cvxConnected = cvx.connect(cvxDepositorAccount.signer);
        const cvxBalance = await cvxConnected.balanceOf(cvxDepositorAccount.address);
        await cvxConnected.transfer(deployer.address, cvxBalance);

        const testAmount = simpleToExactAmount(100);
        await bridgeTokenFromL1ToL2(deployer, cvx, testSetup.l1.canonical.auraProxyOFT, L2_CHAIN_ID, testAmount);

        await sidechain.auraOFT.connect(deployer.signer).transfer(bridgeDelegateSender.address, testAmount);

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
            expect(await bridgeDelegateSender.crvOft(), "crvOft").to.eq(sidechain.auraOFT.address);
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
                bridgeDelegateSender.connect(alice.signer).sendFrom(ZERO, { value: 0 }),
                "!keeper",
            ).to.be.revertedWith(ERRORS.ONLY_KEEPER);
        });
        it("allows to send tokens to l1Coordinator", async () => {
            const l1Receiver = canonical.l1Coordinator;
            const receiverBalanceBefore = await cvx.balanceOf(l1Receiver.address);
            const senderBalanceBefore = await sidechain.auraOFT.balanceOf(bridgeDelegateSender.address);
            expect(senderBalanceBefore).to.be.gt(ZERO);

            const tx = await bridgeDelegateSender
                .connect(deployer.signer)
                .sendFrom(senderBalanceBefore, { value: NATIVE_FEE });
            await expect(tx).to.emit(bridgeDelegateSender, "Send").withArgs(l1Receiver.address, senderBalanceBefore);

            const receiverBalanceAfter = await cvx.balanceOf(l1Receiver.address);
            const senderBalanceAfter = await sidechain.auraOFT.balanceOf(bridgeDelegateSender.address);

            expect(senderBalanceAfter, "bridgeDelegateBalance").to.be.eq(ZERO);
            expect(receiverBalanceAfter, "tokens sent to address").to.be.eq(
                receiverBalanceBefore.add(senderBalanceBefore),
            );
        });
    });
});
