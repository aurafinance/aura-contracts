import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer, BigNumber } from "ethers";
import {
    AuraRedemption,
    AuraRedemption__factory,
    RAuraRedemption,
    RAuraRedemption__factory,
    MockERC20,
    MockERC20__factory,
} from "../../types/generated";
import { deployContract } from "../../tasks/utils";
import { simpleToExactAmount } from "../../test-utils/math";
import { getTimestamp, increaseTimeTo } from "../../test-utils/time";
import { ZERO, ZERO_ADDRESS } from "../../test-utils/constants";

const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

describe("RAuraRedemption (Contract B)", () => {
    let accounts: Signer[];
    let deployer: Signer;
    let deployerAddress: string;
    let owner: Signer;
    let ownerAddress: string;
    let alice: Signer;
    let aliceAddress: string;
    let bob: Signer;
    let bobAddress: string;
    let outsider: Signer;

    let aura: MockERC20;
    let bal: MockERC20;
    let weth: MockERC20;

    let auraRedemption: AuraRedemption;
    let contract: RAuraRedemption;

    const REDEEMABLE_AURA_SUPPLY = simpleToExactAmount(50_000_000);
    const STAGE0_BAL = simpleToExactAmount(1_000_000);
    const STAGE0_WETH = simpleToExactAmount(500);

    // Stage 2 basket that flows into RAuraRedemption (10% of BAL/WETH + residual).
    const STAGE2_BAL = simpleToExactAmount(200_000);
    const STAGE2_WETH = simpleToExactAmount(50);

    const ALICE_REDEEM = REDEEMABLE_AURA_SUPPLY.div(100); // 500k AURA → 500k rAURA
    const BOB_REDEEM = REDEEMABLE_AURA_SUPPLY.div(200); // 250k AURA → 250k rAURA
    const SWEEP_DELAY = 60 * 60 * 24 * 365; // 365 days

    let expiry: BigNumber;

    const deployMock = async (name: string, dec: number, to: string, amount: BigNumber) =>
        deployContract<MockERC20>(
            hre,
            new MockERC20__factory(deployer),
            name,
            [name, name, dec, to, amount.div(simpleToExactAmount(1, dec))],
            {},
            false,
        );

    const deployRAura = async (args: { rAura?: string; delay?: number; owner?: string }) =>
        deployContract<RAuraRedemption>(
            hre,
            new RAuraRedemption__factory(deployer),
            "RAuraRedemption",
            [args.rAura ?? auraRedemption.address, args.delay ?? SWEEP_DELAY, args.owner ?? ownerAddress],
            {},
            false,
        );

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        owner = accounts[1];
        alice = accounts[2];
        bob = accounts[3];
        outsider = accounts[4];

        deployerAddress = await deployer.getAddress();
        ownerAddress = await owner.getAddress();
        aliceAddress = await alice.getAddress();
        bobAddress = await bob.getAddress();
    });

    beforeEach(async () => {
        // Deploy AURA + basket and mint AURA to alice & bob.
        aura = await deployMock("AURA", 18, deployerAddress, simpleToExactAmount(100_000_000));
        bal = await deployMock("BAL", 18, deployerAddress, STAGE0_BAL.add(STAGE2_BAL));
        weth = await deployMock("WETH", 18, deployerAddress, STAGE0_WETH.add(STAGE2_WETH));

        await aura.transfer(aliceAddress, ALICE_REDEEM);
        await aura.transfer(bobAddress, BOB_REDEEM);

        // Deploy & fund AuraRedemption with a short expiry so we can close it easily.
        const now = await getTimestamp();
        expiry = now.add(60 * 60); // 1h

        auraRedemption = await deployContract<AuraRedemption>(
            hre,
            new AuraRedemption__factory(deployer),
            "AuraRedemption",
            ["Redeemed AURA", "rAURA", aura.address, REDEEMABLE_AURA_SUPPLY, expiry, ownerAddress],
            {},
            false,
        );

        await bal.transfer(auraRedemption.address, STAGE0_BAL);
        await weth.transfer(auraRedemption.address, STAGE0_WETH);
        await auraRedemption.connect(owner).finalize([bal.address, weth.address]);

        // Alice and Bob burn AURA for rAURA.
        await aura.connect(alice).approve(auraRedemption.address, ALICE_REDEEM);
        await aura.connect(bob).approve(auraRedemption.address, BOB_REDEEM);
        await auraRedemption.connect(alice).redeem(ALICE_REDEEM);
        await auraRedemption.connect(bob).redeem(BOB_REDEEM);

        // Now deploy RAuraRedemption and fund it with Stage 2 basket.
        contract = await deployRAura({});
        await bal.transfer(contract.address, STAGE2_BAL);
        await weth.transfer(contract.address, STAGE2_WETH);
    });

    describe("constructor", () => {
        it("reverts on zero rAura", async () => {
            await expect(deployRAura({ rAura: ZERO_ADDRESS })).to.revertedWith("!rAura");
        });
        it("reverts on zero delay", async () => {
            await expect(deployRAura({ delay: 0 })).to.revertedWith("!delay");
        });
        it("reverts on zero owner", async () => {
            await expect(deployRAura({ owner: ZERO_ADDRESS })).to.revertedWith("!owner");
        });
        it("stores immutables", async () => {
            expect(await contract.auraRedemption()).eq(auraRedemption.address);
            expect(await contract.SWEEP_DELAY()).eq(SWEEP_DELAY);
            expect(await contract.owner()).eq(ownerAddress);
            expect(await contract.finalized()).eq(false);
            expect(await contract.REDEEMABLE_RAURA_SUPPLY()).eq(ZERO);
            expect(await contract.sweepAfter()).eq(ZERO);
        });
    });

    describe("finalize", () => {
        it("reverts if AuraRedemption.expiry has not passed", async () => {
            await expect(contract.connect(owner).finalize([bal.address, weth.address])).to.revertedWith("!expired");
        });
        it("reverts if not owner", async () => {
            await increaseTimeTo(expiry.add(1));
            await expect(contract.connect(outsider).finalize([bal.address])).to.revertedWith("!owner");
        });
        it("reverts on empty tokens", async () => {
            await increaseTimeTo(expiry.add(1));
            await expect(contract.connect(owner).finalize([])).to.revertedWith("!tokens");
        });
        it("reverts on token == rAura (auraRedemption)", async () => {
            await increaseTimeTo(expiry.add(1));
            await expect(contract.connect(owner).finalize([auraRedemption.address])).to.revertedWith("!token");
        });
        it("reverts on zero-balance token", async () => {
            await increaseTimeTo(expiry.add(1));
            const empty = await deployMock("EMPTY", 18, deployerAddress, ZERO);
            await expect(contract.connect(owner).finalize([empty.address])).to.revertedWith("!funded");
        });
        it("reverts on duplicate token", async () => {
            await increaseTimeTo(expiry.add(1));
            await expect(contract.connect(owner).finalize([bal.address, bal.address])).to.revertedWith("dup");
        });
        it("succeeds after expiry, snapshots rAURA supply, sets sweepAfter", async () => {
            await increaseTimeTo(expiry.add(1));
            const expectedSupply = ALICE_REDEEM.add(BOB_REDEEM);
            expect(await auraRedemption.totalSupply()).eq(expectedSupply);

            const tx = await contract.connect(owner).finalize([bal.address, weth.address]);
            const rcpt = await tx.wait();
            const now = BigNumber.from((await ethers.provider.getBlock(rcpt.blockNumber)).timestamp);

            expect(await contract.finalized()).eq(true);
            expect(await contract.REDEEMABLE_RAURA_SUPPLY()).eq(expectedSupply);
            expect(await contract.sweepAfter()).eq(now.add(SWEEP_DELAY));
            expect(await contract.redeemableTokenAllocation(bal.address)).eq(STAGE2_BAL);
            expect(await contract.redeemableTokenAllocation(weth.address)).eq(STAGE2_WETH);

            const event = rcpt.events?.find(e => e.event === "Finalized");
            expect(event!.args!.denominator).eq(expectedSupply);
            expect(event!.args!.tokens).to.deep.eq([bal.address, weth.address]);
        });
        it("cannot finalize twice", async () => {
            await increaseTimeTo(expiry.add(1));
            await contract.connect(owner).finalize([bal.address]);
            await expect(contract.connect(owner).finalize([weth.address])).to.revertedWith("finalized");
        });
    });

    describe("redeem", () => {
        beforeEach(async () => {
            await increaseTimeTo(expiry.add(1));
            await contract.connect(owner).finalize([bal.address, weth.address]);
        });
        it("reverts if not finalized", async () => {
            const fresh = await deployRAura({});
            await expect(fresh.connect(alice).redeem(1)).to.revertedWith("!finalized");
        });
        it("reverts on zero amount", async () => {
            await expect(contract.connect(alice).redeem(0)).to.revertedWith("!amount");
        });
        it("burns rAURA and pays pro-rata basket", async () => {
            // Alice has ALICE_REDEEM rAURA. REDEEMABLE_RAURA_SUPPLY = ALICE_REDEEM+BOB_REDEEM.
            // Redeeming all of Alice's rAURA pays ALICE/total of the basket.
            const totalSupply = ALICE_REDEEM.add(BOB_REDEEM);
            await auraRedemption.connect(alice).approve(contract.address, ALICE_REDEEM);

            const balBefore = await bal.balanceOf(aliceAddress);
            const wethBefore = await weth.balanceOf(aliceAddress);
            const burnBefore = await auraRedemption.balanceOf(BURN_ADDRESS);

            const tx = await contract.connect(alice).redeem(ALICE_REDEEM);
            const rcpt = await tx.wait();

            const expBal = STAGE2_BAL.mul(ALICE_REDEEM).div(totalSupply);
            const expWeth = STAGE2_WETH.mul(ALICE_REDEEM).div(totalSupply);

            expect((await bal.balanceOf(aliceAddress)).sub(balBefore)).eq(expBal);
            expect((await weth.balanceOf(aliceAddress)).sub(wethBefore)).eq(expWeth);

            // rAURA moved to burn address.
            expect((await auraRedemption.balanceOf(BURN_ADDRESS)).sub(burnBefore)).eq(ALICE_REDEEM);

            const event = rcpt.events?.find(e => e.event === "Redeemed");
            expect(event!.args!.user).eq(aliceAddress);
            expect(event!.args!.burned).eq(ALICE_REDEEM);
        });
        it("both holders redeeming together drain basket (minus rounding dust)", async () => {
            await auraRedemption.connect(alice).approve(contract.address, ALICE_REDEEM);
            await auraRedemption.connect(bob).approve(contract.address, BOB_REDEEM);
            await contract.connect(alice).redeem(ALICE_REDEEM);
            await contract.connect(bob).redeem(BOB_REDEEM);

            // Integer division can leave <= (numTokens) wei per redeemer as dust.
            expect((await bal.balanceOf(contract.address)).lte(2)).eq(true);
            expect((await weth.balanceOf(contract.address)).lte(2)).eq(true);
        });
    });

    describe("sweep", () => {
        beforeEach(async () => {
            await increaseTimeTo(expiry.add(1));
            await contract.connect(owner).finalize([bal.address, weth.address]);
        });
        it("reverts before sweepAfter", async () => {
            await expect(contract.connect(owner).sweep(bal.address, ownerAddress)).to.revertedWith("!sweep");
        });
        it("reverts if not owner", async () => {
            const sweepAfter = await contract.sweepAfter();
            await increaseTimeTo(sweepAfter.add(1));
            await expect(contract.connect(outsider).sweep(bal.address, ownerAddress)).to.revertedWith("!owner");
        });
        it("reverts on zero to address", async () => {
            const sweepAfter = await contract.sweepAfter();
            await increaseTimeTo(sweepAfter.add(1));
            await expect(contract.connect(owner).sweep(bal.address, ZERO_ADDRESS)).to.revertedWith("!to");
        });
        it("sends full balance to recipient after sweepAfter", async () => {
            const sweepAfter = await contract.sweepAfter();
            await increaseTimeTo(sweepAfter.add(1));
            const target = await outsider.getAddress();
            await contract.connect(owner).sweep(bal.address, target);
            expect(await bal.balanceOf(contract.address)).eq(ZERO);
            expect(await bal.balanceOf(target)).eq(STAGE2_BAL);
        });
        it("reverts if called before finalize", async () => {
            const fresh = await deployRAura({});
            await expect(fresh.connect(owner).sweep(bal.address, ownerAddress)).to.revertedWith("!finalized");
        });
    });

    describe("setOwner", () => {
        it("rotates admin", async () => {
            const newOwner = await outsider.getAddress();
            await contract.connect(owner).setOwner(newOwner);
            expect(await contract.owner()).eq(newOwner);
        });
        it("reverts on zero", async () => {
            await expect(contract.connect(owner).setOwner(ZERO_ADDRESS)).to.revertedWith("!owner");
        });
        it("reverts if not owner", async () => {
            await expect(contract.connect(outsider).setOwner(aliceAddress)).to.revertedWith("!owner");
        });
    });
});
