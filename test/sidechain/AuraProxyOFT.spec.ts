import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";

import { impersonateAccount, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { Account } from "../../types";
import { AuraOFT, AuraProxyOFT, AuraProxyOFT__factory, OFT } from "../../types/generated";
import { OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import {
    ERRORS,
    PausableProxyOFTBehaviourContext,
    shouldBehaveLikePausableProxyOFT,
} from "../shared/PausableProxyOFT.behaviour";
import { SideChainTestSetup, sidechainTestSetup } from "./sidechainTestSetup";

const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;

describe("AuraProxyOFT", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;
    let guardian: Account;

    // Testing contract
    let auraOFT: AuraOFT;
    let auraProxyOFT: AuraProxyOFT;
    let testSetup: SideChainTestSetup;
    let idSnapShot: number;

    /* -- Declare shared functions -- */
    const setup = async () => {
        if (idSnapShot) {
            await hre.ethers.provider.send("evm_revert", [idSnapShot]);
            return;
        }
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID);
        auraOFT = testSetup.l2.sidechain.auraOFT;
        auraProxyOFT = testSetup.l1.canonical.auraProxyOFT;
        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);
        guardian = await impersonateAccount(testSetup.l2.multisigs.pauseGuardian);
        // Send some balances in order to test
        // dirty trick to get some cvx balance.
        const cvxDepositorAccount = await impersonateAccount(testSetup.l1.phase2.vestedEscrows[0].address);
        const cvxConnected = testSetup.l1.phase2.cvx.connect(cvxDepositorAccount.signer);
        const cvxBalance = await cvxConnected.balanceOf(cvxDepositorAccount.address);
        await cvxConnected.transfer(deployer.address, cvxBalance.div(4));
        await cvxConnected.transfer(alice.address, cvxBalance.div(4));

        await testSetup.l1.phase2.cvx.connect(alice.signer).approve(auraProxyOFT.address, ethers.constants.MaxUint256);
    };
    describe("behaviors", async () => {
        describe("should behave like Ownable", async () => {
            const ctx: Partial<OwnableBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.owner = dao;
                    ctx.anotherAccount = alice;
                    ctx.ownable = auraProxyOFT;
                    return ctx as OwnableBehaviourContext;
                };
            });
            shouldBehaveLikeOwnable(() => ctx as OwnableBehaviourContext);
        });
        describe("should behave like PausableProxyOFT", async () => {
            const ctx: Partial<PausableProxyOFTBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();

                    ctx.pausableProxyOFT = auraProxyOFT;
                    ctx.oft = auraOFT as unknown as OFT;
                    ctx.owner = dao;
                    ctx.guardian = guardian;
                    ctx.sudo = dao;
                    ctx.anotherAccount = alice;
                    ctx.inflowLimit = testSetup.l1.mocks.addresses.sidechain.auraInflowLimit;
                    ctx.canonicalChainId = L1_CHAIN_ID;
                    ctx.sideChainId = L2_CHAIN_ID;

                    return ctx as PausableProxyOFTBehaviourContext;
                };
            });
            shouldBehaveLikePausableProxyOFT(() => ctx as PausableProxyOFTBehaviourContext);
        });
    });
    describe("constructor", async () => {
        before(async () => {
            await setup();
        });
        it("should properly store valid arguments", async () => {
            expect(await auraProxyOFT.locker(), "locker").to.eq(testSetup.l1.phase2.cvxLocker.address);
        });
        it("fails if called with wrong arguments", async () => {
            await expect(
                new AuraProxyOFT__factory(deployer.signer).deploy(
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    ZERO,
                ),
                ERRORS.GUARDIAN_ZERO_ADDRESS,
            ).to.be.revertedWith(ERRORS.GUARDIAN_ZERO_ADDRESS);
        });
    });

    // All test coverage is tested in bundle at test/sidechain/AuraOFT.spec.ts
    // No need to add more tests here in isolation.
});
