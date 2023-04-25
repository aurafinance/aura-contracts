import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import { BridgeDelegateReceiver, IERC20__factory, L1Coordinator } from "../../types/generated";
import { OwnableBehaviourContext, shouldBehaveLikeOwnable, ERRORS } from "../../test/shared/Ownable.behaviour";
import { DEAD_ADDRESS, ZERO, impersonateAccount, increaseTime, simpleToExactAmount } from "../../test-utils";
import { Account } from "../../types";
import { SideChainTestSetup, sidechainTestSetup } from "./sidechainTestSetup";
import { SidechainDeployed } from "scripts/deploySidechain";
const NATIVE_FEE = simpleToExactAmount("0.2");

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

    /* -- Declare shared functions -- */
    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts);
        sidechain = testSetup.l2.sidechain;
        bridgeDelegateReceiver = testSetup.bridgeDelegates.bridgeDelegateReceiver;
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
                testSetup.l2.mocks.addresses.sidechainLzChainId,
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
            const feeDebtBefore = await l1Coordinator.feeDebt(srcChainId);
            await testSetup.l2.mocks.bpt.approve(sidechain.booster.address, amount);
            await sidechain.booster.deposit(pid, amount, stake);
            await increaseTime(60 * 60 * 24);
            // Send fees
            await sidechain.booster.earmarkRewards(pid, { value: NATIVE_FEE });

            const feeDebtAfter = await l1Coordinator.feeDebt(srcChainId);
            expect(feeDebtAfter, "feeDebt").to.be.gt(feeDebtBefore);
        });
        it("allows to settle debt from a side chain", async () => {
            const srcChainId = await bridgeDelegateReceiver.srcChainId();
            const feeDebtBefore = await l1Coordinator.feeDebt(srcChainId);
            expect(feeDebtBefore, "fee debt").to.be.gt(ZERO);

            // When settle  fee debt
            await testSetup.l1.mocks.crv.transfer(bridgeDelegateReceiver.address, feeDebtBefore);
            const tx = await bridgeDelegateReceiver.connect(deployer.signer).settleFeeDebt(feeDebtBefore);
            await expect(tx).to.emit(bridgeDelegateReceiver, "SettleFeeDebt").withArgs(feeDebtBefore);

            const feeDebtAfter = await l1Coordinator.connect(dao.signer).feeDebt(srcChainId);
            expect(feeDebtAfter, "feeDebt").to.be.eq(ZERO);
        });
        it("fails if settle more than the actual debt", async () => {
            const amount = 1;
            const srcChainId = await bridgeDelegateReceiver.srcChainId();
            const feeDebtBefore = await l1Coordinator.feeDebt(srcChainId);
            await expect(
                bridgeDelegateReceiver.connect(dao.signer).settleFeeDebt(feeDebtBefore.add(amount)),
                "Arithmetic operation underflowed",
            ).to.be.reverted;
        });
        it("fails when L1Coordinator does not haven a bridgeDelegate", async () => {
            expect(
                await l1Coordinator
                    .connect(dao.signer)
                    .setBridgeDelegate(testSetup.l2.mocks.addresses.sidechainLzChainId, DEAD_ADDRESS),
            );

            await expect(bridgeDelegateReceiver.settleFeeDebt(ZERO), "!bridgeDelegate").to.be.revertedWith(
                "!bridgeDelegate",
            );
        });
    });
});