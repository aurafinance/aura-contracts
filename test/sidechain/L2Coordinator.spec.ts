/* eslint-disable @typescript-eslint/no-unused-vars */
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { SidechainDeployed } from "scripts/deploySidechain";
import { impersonateAccount, simpleToExactAmount } from "../../test-utils";
import { Account } from "../../types";
import { L2Coordinator } from "../../types/generated";
import { OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import { SideChainTestSetup, sidechainTestSetup } from "./sidechainTestSetup";
const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;
describe("L2Coordinator", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;

    // Testing contract
    let l2Coordinator: L2Coordinator;
    let testSetup: SideChainTestSetup;
    let sidechain: SidechainDeployed;

    /* -- Declare shared functions -- */
    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID);
        sidechain = testSetup.l2.sidechain;
        l2Coordinator = testSetup.l2.sidechain.l2Coordinator;
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
                    ctx.owner = dao;
                    ctx.anotherAccount = alice;
                    ctx.ownable = l2Coordinator;
                    return ctx as OwnableBehaviourContext;
                };
            });
            shouldBehaveLikeOwnable(() => ctx as OwnableBehaviourContext);
        });
    });
});
