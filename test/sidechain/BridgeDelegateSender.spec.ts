import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import {
    BridgeDelegateSender,
    IERC20__factory,
    L1Coordinator,
    SimpleBridgeDelegateSender,
} from "../../types/generated";
import { OwnableBehaviourContext, shouldBehaveLikeOwnable, ERRORS } from "../shared/Ownable.behaviour";
import { DEAD_ADDRESS, ZERO, ZERO_ADDRESS, impersonateAccount } from "../../test-utils";
import { Account } from "../../types";
import { SideChainTestSetup, sidechainTestSetup } from "./sidechainTestSetup";

describe("BridgeDelegateSender", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;

    // Testing contract
    let bridgeDelegateSender: SimpleBridgeDelegateSender;
    let l1Coordinator: L1Coordinator;
    let testSetup: SideChainTestSetup;

    /* -- Declare shared functions -- */
    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts);
        bridgeDelegateSender = testSetup.bridgeDelegates.bridgeDelegateSender as SimpleBridgeDelegateSender;
        l1Coordinator = testSetup.l1.canonical.l1Coordinator;
        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);
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
    describe("settleFeeDebt", async () => {
        it("fails if caller is not the owner", async () => {
            await expect(
                bridgeDelegateSender.connect(alice.signer).send(ZERO_ADDRESS, ZERO),
                "!onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("allows to settle debt", async () => {
            await bridgeDelegateSender.connect(deployer.signer).send(DEAD_ADDRESS, ZERO);
            // check balances before and after
            // check debt amount before and after
        });
    });
});
