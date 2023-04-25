import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import { BridgeDelegateReceiver, IERC20__factory, L1Coordinator } from "../../types/generated";
import { OwnableBehaviourContext, shouldBehaveLikeOwnable, ERRORS } from "../../test/shared/Ownable.behaviour";
import { ZERO, impersonateAccount } from "../../test-utils";
import { Account } from "../../types";
import { SideChainTestSetup, sidechainTestSetup } from "./sidechainTestSetup";

describe("BridgeDelegateReceiver", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    // Testing contract
    let bridgeDelegateReceiver: BridgeDelegateReceiver;
    let l1Coordinator: L1Coordinator;
    let testSetup: SideChainTestSetup;

    /* -- Declare shared functions -- */
    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());
        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts);
        bridgeDelegateReceiver = testSetup.bridgeDelegates.bridgeDelegateReceiver;
        l1Coordinator = testSetup.l1.canonical.l1Coordinator;
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
                    ctx.ownable = bridgeDelegateReceiver;
                    return ctx as OwnableBehaviourContext;
                };
            });
            shouldBehaveLikeOwnable(() => ctx as OwnableBehaviourContext);
        });
    });
    describe("constructor", async () => {
        before(async () => {
            await setup();
        });
        it("should properly store valid arguments", async () => {
            expect(await bridgeDelegateReceiver.owner(), "owner").to.eq(deployer.address);
            expect(await bridgeDelegateReceiver.l1Coordinator(), "l1Coordinator").to.eq(l1Coordinator.address);
            expect(await bridgeDelegateReceiver.srcChainId(), "srcChainId").to.eq(
                testSetup.l2.mocks.addresses.remoteLzChainId,
            );
        });
        it("should be initialized", async () => {
            const debTokenAddress = await l1Coordinator.balToken();
            const debToken = IERC20__factory.connect(debTokenAddress, deployer.signer);

            expect(
                await debToken.allowance(bridgeDelegateReceiver.address, l1Coordinator.address),
                "debt Token allowance",
            ).to.eq(ethers.constants.MaxUint256);
        });
    });
    describe("settleFeeDebt", async () => {
        it("fails if caller is not the owner", async () => {
            await expect(
                bridgeDelegateReceiver.connect(alice.signer).settleFeeDebt(ZERO),
                "!onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("allows to settle debt", async () => {
            // TODO
        });
    });
});
