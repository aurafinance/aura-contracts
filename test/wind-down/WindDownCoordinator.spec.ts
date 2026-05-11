import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer, BigNumber } from "ethers";
import {
    AuraBalRedemption,
    AuraBalRedemption__factory,
    AuraRedemption,
    AuraRedemption__factory,
    MockCurveVoteEscrow,
    MockCurveVoteEscrow__factory,
    MockERC20,
    MockERC20__factory,
    MockVoterProxy,
    MockVoterProxy__factory,
    MockWalletChecker,
    MockWalletChecker__factory,
    RAuraRedemption,
    RAuraRedemption__factory,
    WindDownCoordinator,
    WindDownCoordinator__factory,
} from "../../types/generated";
import { deployContract } from "../../tasks/utils";
import { simpleToExactAmount } from "../../test-utils/math";
import { getTimestamp, increaseTimeTo } from "../../test-utils/time";
import { impersonateAccount } from "../../test-utils/fork";
import { ZERO, ZERO_ADDRESS } from "../../test-utils/constants";

const BPS_DENOMINATOR = 10_000;
const AURABAL_BPS = 9000;
const SWEEP_DELAY = 60 * 60 * 24 * 365;
const LOCK_AMOUNT = simpleToExactAmount(100_000);
const TREASURY_USDC_FUND = simpleToExactAmount(2_000_000, 6);
const REDEEMABLE_AURA_SUPPLY = simpleToExactAmount(10_000_000);
const STAGE0_REDEEM_AMOUNT = simpleToExactAmount(1_000_000); // 10% — bootstraps rAURA supply
const DAY = 60 * 60 * 24;

describe("WindDownCoordinator", () => {
    let accounts: Signer[];
    let deployer: Signer;
    let deployerAddress: string;
    let owner: Signer;
    let ownerAddress: string;
    let outsider: Signer;
    let alice: Signer;
    let aliceAddress: string;

    let aura: MockERC20;
    let auraBal: MockERC20;
    let crvBpt: MockERC20;
    let treasuryUsdc: MockERC20;

    let walletChecker: MockWalletChecker;
    let escrow: MockCurveVoteEscrow;
    let voterProxy: MockVoterProxy;

    let auraRedemption: AuraRedemption;
    let rAuraRedemption: RAuraRedemption;
    let auraBalRedemption: AuraBalRedemption;

    let coordinator: WindDownCoordinator;

    // Timeline (relative to beforeEach start `now`):
    //   now + 100d  → veBAL lock unlocks
    //   now + 200d  → AuraRedemption.expiry
    //   Happy-path splitAndFinalize requires both to be in the past.
    let unlockTime: BigNumber;
    let auraExpiry: BigNumber;

    const deployMock = async (name: string, dec: number, to: string, amount: BigNumber) =>
        deployContract<MockERC20>(
            hre,
            new MockERC20__factory(deployer),
            name,
            [name, name, dec, to, amount.div(simpleToExactAmount(1, dec))],
            {},
            false,
        );

    const deployCoordinator = async (
        overrides: Partial<{
            voterProxy: string;
            escrow: string;
            bpt: string;
            aura: string;
            rAura: string;
            auraBal: string;
            bps: number;
            owner: string;
        }> = {},
    ) =>
        deployContract<WindDownCoordinator>(
            hre,
            new WindDownCoordinator__factory(deployer),
            "WindDownCoordinator",
            [
                overrides.voterProxy ?? voterProxy.address,
                overrides.escrow ?? escrow.address,
                overrides.bpt ?? crvBpt.address,
                overrides.aura ?? auraRedemption.address,
                overrides.rAura ?? rAuraRedemption.address,
                overrides.auraBal ?? auraBalRedemption.address,
                overrides.bps ?? AURABAL_BPS,
                overrides.owner ?? ownerAddress,
            ],
            {},
            false,
        );

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        owner = accounts[1];
        outsider = accounts[2];
        alice = accounts[3];

        deployerAddress = await deployer.getAddress();
        ownerAddress = await owner.getAddress();
        aliceAddress = await alice.getAddress();
    });

    beforeEach(async () => {
        aura = await deployMock("AURA", 18, deployerAddress, simpleToExactAmount(100_000_000));
        auraBal = await deployMock("auraBAL", 18, deployerAddress, simpleToExactAmount(1_000_000));
        crvBpt = await deployMock("BPT", 18, deployerAddress, simpleToExactAmount(1_000_000));
        treasuryUsdc = await deployMock("USDC", 6, deployerAddress, TREASURY_USDC_FUND);

        walletChecker = await deployContract<MockWalletChecker>(
            hre,
            new MockWalletChecker__factory(deployer),
            "MockWalletChecker",
            [],
            {},
            false,
        );
        escrow = await deployContract<MockCurveVoteEscrow>(
            hre,
            new MockCurveVoteEscrow__factory(deployer),
            "MockCurveVoteEscrow",
            [walletChecker.address, crvBpt.address],
            {},
            false,
        );

        voterProxy = await deployContract<MockVoterProxy>(
            hre,
            new MockVoterProxy__factory(deployer),
            "MockVoterProxy",
            [],
            {},
            false,
        );

        // Seed a locked BPT position for the VoterProxy.
        await walletChecker.approveWallet(voterProxy.address);
        await crvBpt.transfer(voterProxy.address, LOCK_AMOUNT);
        const vpAccount = await impersonateAccount(voterProxy.address);
        await crvBpt.connect(vpAccount.signer).approve(escrow.address, LOCK_AMOUNT);
        const now = await getTimestamp();
        unlockTime = now.add(100 * DAY);
        auraExpiry = now.add(200 * DAY);
        await escrow.connect(vpAccount.signer).create_lock(LOCK_AMOUNT, unlockTime);

        // Redemption contracts owned by deployer initially so we can finalize before handing
        // ownership to the coordinator.
        auraRedemption = await deployContract<AuraRedemption>(
            hre,
            new AuraRedemption__factory(deployer),
            "AuraRedemption",
            ["rAURA", "rAURA", aura.address, REDEEMABLE_AURA_SUPPLY, auraExpiry, deployerAddress],
            {},
            false,
        );
        rAuraRedemption = await deployContract<RAuraRedemption>(
            hre,
            new RAuraRedemption__factory(deployer),
            "RAuraRedemption",
            [auraRedemption.address, SWEEP_DELAY, deployerAddress],
            {},
            false,
        );
        auraBalRedemption = await deployContract<AuraBalRedemption>(
            hre,
            new AuraBalRedemption__factory(deployer),
            "AuraBalRedemption",
            [auraBal.address, SWEEP_DELAY, deployerAddress],
            {},
            false,
        );

        // Fund AuraRedemption with a residual-treasury-worth USDC and finalize it so the
        // coordinator's sweep path has something to move.
        await treasuryUsdc.transfer(auraRedemption.address, TREASURY_USDC_FUND);
        await auraRedemption.finalize([treasuryUsdc.address]);

        // Redeem some AURA so rAURA.totalSupply > 0 when the coordinator later finalizes
        // RAuraRedemption (which requires a non-zero snapshot supply). This also drains
        // a pro-rata slice of the USDC basket — factored into expected residual below.
        await aura.approve(auraRedemption.address, STAGE0_REDEEM_AMOUNT);
        await auraRedemption.redeem(STAGE0_REDEEM_AMOUNT);

        coordinator = await deployCoordinator({});
        await auraRedemption.setOwner(coordinator.address);
        await rAuraRedemption.setOwner(coordinator.address);
        await auraBalRedemption.setOwner(coordinator.address);
    });

    // ─────────────────────────── Constructor ───────────────────────────

    describe("constructor", () => {
        it("reverts on zero voterProxy", async () =>
            expect(deployCoordinator({ voterProxy: ZERO_ADDRESS })).to.revertedWith("!voterProxy"));
        it("reverts on zero votingEscrow", async () =>
            expect(deployCoordinator({ escrow: ZERO_ADDRESS })).to.revertedWith("!votingEscrow"));
        it("reverts on zero crvBpt", async () =>
            expect(deployCoordinator({ bpt: ZERO_ADDRESS })).to.revertedWith("!crvBpt"));
        it("reverts on zero auraRedemption", async () =>
            expect(deployCoordinator({ aura: ZERO_ADDRESS })).to.revertedWith("!auraRedemption"));
        it("reverts on zero rAuraRedemption", async () =>
            expect(deployCoordinator({ rAura: ZERO_ADDRESS })).to.revertedWith("!rAuraRedemption"));
        it("reverts on zero auraBalRedemption", async () =>
            expect(deployCoordinator({ auraBal: ZERO_ADDRESS })).to.revertedWith("!auraBalRedemption"));
        it("reverts on zero bps", async () => expect(deployCoordinator({ bps: 0 })).to.revertedWith("!bps"));
        it("reverts on bps > denominator", async () =>
            expect(deployCoordinator({ bps: BPS_DENOMINATOR + 1 })).to.revertedWith("!bps"));
        it("reverts on bps == denominator", async () =>
            expect(deployCoordinator({ bps: BPS_DENOMINATOR })).to.revertedWith("!bps"));
        it("reverts on zero owner", async () =>
            expect(deployCoordinator({ owner: ZERO_ADDRESS })).to.revertedWith("!owner"));

        it("stores immutables and initial stage", async () => {
            expect(await coordinator.voterProxy()).eq(voterProxy.address);
            expect(await coordinator.votingEscrow()).eq(escrow.address);
            expect(await coordinator.crvBpt()).eq(crvBpt.address);
            expect(await coordinator.auraRedemption()).eq(auraRedemption.address);
            expect(await coordinator.rAuraRedemption()).eq(rAuraRedemption.address);
            expect(await coordinator.auraBalRedemption()).eq(auraBalRedemption.address);
            expect(await coordinator.auraBalBps()).eq(AURABAL_BPS);
            expect(await coordinator.owner()).eq(ownerAddress);
            expect(await coordinator.stage()).eq(0); // UNSTARTED
        });
    });

    // ─────────────────────────── unlockAndWithdraw ───────────────────────────

    describe("unlockAndWithdraw", () => {
        it("reverts if caller is not owner", async () => {
            await expect(coordinator.connect(outsider).unlockAndWithdraw()).to.revertedWith("!owner");
            expect(await coordinator.stage()).eq(0);
        });

        it("owner surfaces the escrow revert before the lock unlock time", async () => {
            await expect(coordinator.connect(owner).unlockAndWithdraw()).to.revertedWith("!success");
            expect(await coordinator.stage()).eq(0);
        });

        it("only owner transitions to WITHDRAWN and pulls BPT", async () => {
            await increaseTimeTo(unlockTime.add(1));
            await coordinator.connect(owner).unlockAndWithdraw();

            expect(await crvBpt.balanceOf(voterProxy.address)).eq(ZERO);
            expect(await crvBpt.balanceOf(coordinator.address)).eq(LOCK_AMOUNT);
            expect(await escrow.balanceOf(voterProxy.address)).eq(ZERO);
            expect(await coordinator.stage()).eq(1); // WITHDRAWN
        });

        it("emits Withdrawn with the BPT amount", async () => {
            await increaseTimeTo(unlockTime.add(1));
            const tx = await coordinator.connect(owner).unlockAndWithdraw();
            await expect(tx).to.emit(coordinator, "Withdrawn").withArgs(LOCK_AMOUNT);
        });

        it("reverts on stage when called twice", async () => {
            await increaseTimeTo(unlockTime.add(1));
            await coordinator.connect(owner).unlockAndWithdraw();
            await expect(coordinator.connect(owner).unlockAndWithdraw()).to.revertedWith("!stage");
        });
    });

    // ─────────────────────────── splitAndFinalize ───────────────────────────

    describe("splitAndFinalize", () => {
        it("reverts when still UNSTARTED (before unlockAndWithdraw)", async () => {
            // Warp past both time gates so the only failure is the stage check.
            await increaseTimeTo(auraExpiry.add(1));
            await expect(coordinator.connect(owner).splitAndFinalize()).to.revertedWith("!stage");
        });

        describe("after unlockAndWithdraw", () => {
            beforeEach(async () => {
                await increaseTimeTo(unlockTime.add(1));
                await coordinator.connect(owner).unlockAndWithdraw();
            });

            it("reverts if caller is not owner", async () => {
                await increaseTimeTo(auraExpiry.add(1));
                await expect(coordinator.connect(outsider).splitAndFinalize()).to.revertedWith("!owner");
            });

            it("reverts if AuraRedemption.expiry has not passed", async () => {
                // Stage is WITHDRAWN; block.timestamp is > unlockTime but still < auraExpiry.
                expect(await getTimestamp()).lt(auraExpiry);
                await expect(coordinator.connect(owner).splitAndFinalize()).to.revertedWith("!expired");
            });

            it("sweeps residuals, splits BPT per bps, finalizes, transitions FINALIZED", async () => {
                await increaseTimeTo(auraExpiry.add(1));
                const totalBpt = await crvBpt.balanceOf(coordinator.address);
                const expectedAuraBalShare = totalBpt.mul(AURABAL_BPS).div(BPS_DENOMINATOR);
                const expectedRAuraShare = totalBpt.sub(expectedAuraBalShare);

                const tx = await coordinator.connect(owner).splitAndFinalize();

                // Residuals flowed from A into B (minus what the Stage 0 redeem already took).
                const redeemedSlice = TREASURY_USDC_FUND.mul(STAGE0_REDEEM_AMOUNT).div(REDEEMABLE_AURA_SUPPLY);
                const expectedResidual = TREASURY_USDC_FUND.sub(redeemedSlice);
                expect(await treasuryUsdc.balanceOf(auraRedemption.address)).eq(ZERO);
                expect(await treasuryUsdc.balanceOf(rAuraRedemption.address)).eq(expectedResidual);

                // BPT split 90/10.
                expect(await crvBpt.balanceOf(auraBalRedemption.address)).eq(expectedAuraBalShare);
                expect(await crvBpt.balanceOf(rAuraRedemption.address)).eq(expectedRAuraShare);
                expect(await crvBpt.balanceOf(coordinator.address)).eq(ZERO);

                // Children finalized + allocations recorded.
                expect(await rAuraRedemption.finalized()).eq(true);
                expect(await auraBalRedemption.finalized()).eq(true);
                expect(await rAuraRedemption.redeemableTokenAllocation(crvBpt.address)).eq(expectedRAuraShare);
                expect(await rAuraRedemption.redeemableTokenAllocation(treasuryUsdc.address)).eq(expectedResidual);
                expect(await auraBalRedemption.redeemableTokenAllocation(crvBpt.address)).eq(expectedAuraBalShare);

                expect(await coordinator.stage()).eq(2); // FINALIZED
                await expect(tx)
                    .to.emit(coordinator, "SplitAndFinalized")
                    .withArgs(expectedAuraBalShare, expectedRAuraShare, [treasuryUsdc.address]);
            });

            it("filters fully redeemed residual tokens out of Stage 2 finalization", async () => {
                const remainingRedeem = REDEEMABLE_AURA_SUPPLY.sub(STAGE0_REDEEM_AMOUNT);
                await aura.approve(auraRedemption.address, remainingRedeem);
                await auraRedemption.redeem(remainingRedeem);
                expect(await treasuryUsdc.balanceOf(auraRedemption.address)).eq(ZERO);

                await increaseTimeTo(auraExpiry.add(1));
                const totalBpt = await crvBpt.balanceOf(coordinator.address);
                const expectedAuraBalShare = totalBpt.mul(AURABAL_BPS).div(BPS_DENOMINATOR);
                const expectedRAuraShare = totalBpt.sub(expectedAuraBalShare);

                const tx = await coordinator.connect(owner).splitAndFinalize();

                expect(await treasuryUsdc.balanceOf(rAuraRedemption.address)).eq(ZERO);
                expect(await rAuraRedemption.redeemableTokensLength()).eq(1);
                expect(await rAuraRedemption.redeemableTokens(0)).eq(crvBpt.address);
                expect(await rAuraRedemption.redeemableTokenAllocation(treasuryUsdc.address)).eq(ZERO);
                await expect(tx)
                    .to.emit(coordinator, "SplitAndFinalized")
                    .withArgs(expectedAuraBalShare, expectedRAuraShare, []);
            });

            it("reverts on a second splitAndFinalize call", async () => {
                await increaseTimeTo(auraExpiry.add(1));
                await coordinator.connect(owner).splitAndFinalize();
                await expect(coordinator.connect(owner).splitAndFinalize()).to.revertedWith("!stage");
            });
        });
    });

    // ─────────────────────────── execute (escape hatch) ───────────────────────────

    describe("execute", () => {
        it("reverts if caller is not owner", async () => {
            const data = aura.interface.encodeFunctionData("totalSupply");
            await expect(coordinator.connect(outsider).execute(aura.address, 0, data)).to.revertedWith("!owner");
        });

        it("owner can proxy a child setOwner via execute", async () => {
            const data = auraRedemption.interface.encodeFunctionData("setOwner", [aliceAddress]);
            await coordinator.connect(owner).execute(auraRedemption.address, 0, data);
            expect(await auraRedemption.owner()).eq(aliceAddress);
        });

        it("owner can rescue a stray ERC20 via execute", async () => {
            const stray = await deployMock("STRAY", 18, deployerAddress, simpleToExactAmount(100));
            await stray.transfer(coordinator.address, simpleToExactAmount(100));

            const data = stray.interface.encodeFunctionData("transfer", [ownerAddress, simpleToExactAmount(100)]);
            await coordinator.connect(owner).execute(stray.address, 0, data);
            expect(await stray.balanceOf(ownerAddress)).eq(simpleToExactAmount(100));
            expect(await stray.balanceOf(coordinator.address)).eq(ZERO);
        });

        it("propagates target revert as !success", async () => {
            const data = crvBpt.interface.encodeFunctionData("transfer", [ownerAddress, simpleToExactAmount(1)]);
            await expect(coordinator.connect(owner).execute(crvBpt.address, 0, data)).to.revertedWith("!success");
        });

        it("emits Executed on success", async () => {
            const data = auraRedemption.interface.encodeFunctionData("setOwner", [aliceAddress]);
            const tx = await coordinator.connect(owner).execute(auraRedemption.address, 0, data);
            const rcpt = await tx.wait();
            const event = rcpt.events?.find(e => e.event === "Executed");
            expect(event).to.exist;
            expect(event!.args!.target).eq(auraRedemption.address);
            expect(event!.args!.value).eq(ZERO);
        });
    });

    // ─────────────────────────── setOwner ───────────────────────────

    describe("setOwner", () => {
        it("rotates owner", async () => {
            await coordinator.connect(owner).setOwner(aliceAddress);
            expect(await coordinator.owner()).eq(aliceAddress);
        });
        it("reverts if caller is not owner", async () =>
            expect(coordinator.connect(outsider).setOwner(aliceAddress)).to.revertedWith("!owner"));
        it("reverts on zero", async () =>
            expect(coordinator.connect(owner).setOwner(ZERO_ADDRESS)).to.revertedWith("!owner"));
    });

    // ─────────────────────────── receive (ETH) ───────────────────────────

    describe("receive", () => {
        it("accepts plain ETH transfers", async () => {
            const before = await ethers.provider.getBalance(coordinator.address);
            await deployer.sendTransaction({
                to: coordinator.address,
                value: ethers.utils.parseEther("1"),
            });
            expect((await ethers.provider.getBalance(coordinator.address)).sub(before)).eq(
                ethers.utils.parseEther("1"),
            );
        });
    });
});
