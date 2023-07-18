import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";

import {
    DEAD_ADDRESS,
    impersonateAccount,
    increaseTime,
    simpleToExactAmount,
    ZERO,
    ZERO_ADDRESS,
} from "../../test-utils";
import { ERRORS, OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../../test/shared/Ownable.behaviour";
import { Account } from "../../types";
import { BridgeDelegateReceiver, IERC20__factory, L1Coordinator } from "../../types/generated";
import { SidechainDeployed, SideChainTestSetup, sidechainTestSetup } from "./sidechainTestSetup";

const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;

describe("BridgeDelegateReceiver", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;

    // Testing contract
    let bridgeDelegateReceiver: BridgeDelegateReceiver;
    let l1Coordinator: L1Coordinator;
    let testSetup: SideChainTestSetup;
    let sidechain: SidechainDeployed;
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
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID);
        sidechain = testSetup.l2.sidechain;
        bridgeDelegateReceiver = testSetup.bridgeDelegates.bridgeDelegateReceiver;
        l1Coordinator = testSetup.l1.canonical.l1Coordinator;
        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);

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
            expect(await bridgeDelegateReceiver.srcChainId(), "srcChainId").to.eq(L2_CHAIN_ID);
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
    describe("settle fee debt", async () => {
        it("fails if caller is not the owner", async () => {
            await expect(
                bridgeDelegateReceiver.connect(alice.signer).settleFeeDebt(ZERO),
                "!onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("earmark rewards sends fees to l2Coordinator's bridgeDelegate", async () => {
            // BoosterLite.earmarkRewards => L2Coordinator.queueNewRewards => L1Coordinator._notifyFees
            const pid = 0;
            const stake = true;
            const amount = simpleToExactAmount(10);

            const srcChainId = await bridgeDelegateReceiver.srcChainId();
            const feeDebtBefore = await l1Coordinator.feeDebtOf(srcChainId);
            await testSetup.l2.mocks.bpt.approve(sidechain.booster.address, amount);
            await sidechain.booster.deposit(pid, amount, stake);
            await increaseTime(60 * 60 * 24);
            // Send fees
            await sidechain.booster.earmarkRewards(pid, ZERO_ADDRESS, { value: 0 });
            await sidechain.l2Coordinator.notifyFees(ZERO_ADDRESS, { value: NATIVE_FEE });

            const feeDebtAfter = await l1Coordinator.feeDebtOf(srcChainId);
            expect(feeDebtAfter, "feeDebt").to.be.gt(feeDebtBefore);
        });
        it("allows to settle debt from a side chain", async () => {
            const srcChainId = await bridgeDelegateReceiver.srcChainId();
            const feeDebtBefore = await l1Coordinator.feeDebtOf(srcChainId);
            expect(feeDebtBefore, "fee debt").to.be.gt(ZERO);

            // When settle  fee debt
            await testSetup.l1.mocks.crv.transfer(bridgeDelegateReceiver.address, feeDebtBefore);
            const tx = await bridgeDelegateReceiver.connect(deployer.signer).settleFeeDebt(feeDebtBefore);
            await expect(tx).to.emit(bridgeDelegateReceiver, "SettleFeeDebt").withArgs(feeDebtBefore);

            const feeDebtAfter = await l1Coordinator.connect(dao.signer).feeDebtOf(srcChainId);
            const settledFeeDebtOf = await l1Coordinator.connect(dao.signer).settledFeeDebtOf(srcChainId);
            expect(feeDebtAfter, "feeDebt").to.be.eq(settledFeeDebtOf);
        });
        it("fails if settle more than the actual debt", async () => {
            const amount = 1;
            const srcChainId = await bridgeDelegateReceiver.srcChainId();
            const feeDebtBefore = await l1Coordinator.feeDebtOf(srcChainId);
            await expect(
                bridgeDelegateReceiver.connect(dao.signer).settleFeeDebt(feeDebtBefore.add(amount)),
                "Arithmetic operation underflowed",
            ).to.be.reverted;
        });
        it("fails when L1Coordinator does not haven a bridgeDelegate", async () => {
            expect(await l1Coordinator.connect(dao.signer).setBridgeDelegate(L2_CHAIN_ID, DEAD_ADDRESS));

            await expect(bridgeDelegateReceiver.settleFeeDebt(ZERO), "!bridgeDelegate").to.be.revertedWith(
                "!bridgeDelegate",
            );
        });
    });
});
