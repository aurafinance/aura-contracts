import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer, BigNumber } from "ethers";
import { AuraBalRedemption, AuraBalRedemption__factory, MockERC20, MockERC20__factory } from "../../types/generated";
import { deployContract } from "../../tasks/utils";
import { simpleToExactAmount } from "../../test-utils/math";
import { increaseTimeTo } from "../../test-utils/time";
import { ZERO, ZERO_ADDRESS } from "../../test-utils/constants";

const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

describe("AuraBalRedemption (Contract C)", () => {
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

    let auraBal: MockERC20;
    let bal: MockERC20;
    let weth: MockERC20;

    let contract: AuraBalRedemption;

    // auraBAL supply universe used for the snapshot denominator at finalize.
    const AURABAL_SUPPLY = simpleToExactAmount(2_000_000);
    const ALICE_AURABAL = simpleToExactAmount(200_000); // 10% of supply
    const BOB_AURABAL = simpleToExactAmount(100_000); // 5% of supply

    const STAGE2_BAL = simpleToExactAmount(900_000);
    const STAGE2_WETH = simpleToExactAmount(450);

    const SWEEP_DELAY = 60 * 60 * 24 * 365;

    const deployMock = async (name: string, dec: number, to: string, amount: BigNumber) =>
        deployContract<MockERC20>(
            hre,
            new MockERC20__factory(deployer),
            name,
            [name, name, dec, to, amount.div(simpleToExactAmount(1, dec))],
            {},
            false,
        );

    const deployAuraBalRedemption = async (args: { auraBal?: string; delay?: number; owner?: string }) =>
        deployContract<AuraBalRedemption>(
            hre,
            new AuraBalRedemption__factory(deployer),
            "AuraBalRedemption",
            [args.auraBal ?? auraBal.address, args.delay ?? SWEEP_DELAY, args.owner ?? ownerAddress],
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
        auraBal = await deployMock("auraBAL", 18, deployerAddress, AURABAL_SUPPLY);
        bal = await deployMock("BAL", 18, deployerAddress, STAGE2_BAL);
        weth = await deployMock("WETH", 18, deployerAddress, STAGE2_WETH);

        await auraBal.transfer(aliceAddress, ALICE_AURABAL);
        await auraBal.transfer(bobAddress, BOB_AURABAL);

        contract = await deployAuraBalRedemption({});

        // Fund Stage 2 basket.
        await bal.transfer(contract.address, STAGE2_BAL);
        await weth.transfer(contract.address, STAGE2_WETH);
    });

    describe("constructor", () => {
        it("reverts on zero auraBal", async () => {
            await expect(deployAuraBalRedemption({ auraBal: ZERO_ADDRESS })).to.revertedWith("!auraBal");
        });
        it("reverts on zero delay", async () => {
            await expect(deployAuraBalRedemption({ delay: 0 })).to.revertedWith("!delay");
        });
        it("reverts on zero owner", async () => {
            await expect(deployAuraBalRedemption({ owner: ZERO_ADDRESS })).to.revertedWith("!owner");
        });
        it("stores immutables", async () => {
            expect(await contract.auraBal()).eq(auraBal.address);
            expect(await contract.SWEEP_DELAY()).eq(SWEEP_DELAY);
            expect(await contract.owner()).eq(ownerAddress);
            expect(await contract.finalized()).eq(false);
            expect(await contract.REDEEMABLE_AURABAL_SUPPLY()).eq(ZERO);
            expect(await contract.sweepAfter()).eq(ZERO);
        });
    });

    describe("finalize", () => {
        it("reverts if not owner", async () => {
            await expect(contract.connect(outsider).finalize([bal.address])).to.revertedWith("!owner");
        });
        it("reverts on empty tokens", async () => {
            await expect(contract.connect(owner).finalize([])).to.revertedWith("!tokens");
        });
        it("reverts on token == auraBal", async () => {
            await expect(contract.connect(owner).finalize([auraBal.address])).to.revertedWith("!token");
        });
        it("reverts on duplicate", async () => {
            await expect(contract.connect(owner).finalize([bal.address, bal.address])).to.revertedWith("dup");
        });
        it("reverts on zero-balance token", async () => {
            const empty = await deployMock("EMPTY", 18, deployerAddress, ZERO);
            await expect(contract.connect(owner).finalize([empty.address])).to.revertedWith("!funded");
        });
        it("snapshots auraBAL totalSupply + balances, sets sweepAfter, emits Finalized", async () => {
            const tx = await contract.connect(owner).finalize([bal.address, weth.address]);
            const rcpt = await tx.wait();
            const now = BigNumber.from((await ethers.provider.getBlock(rcpt.blockNumber)).timestamp);

            expect(await contract.finalized()).eq(true);
            expect(await contract.REDEEMABLE_AURABAL_SUPPLY()).eq(AURABAL_SUPPLY);
            expect(await contract.sweepAfter()).eq(now.add(SWEEP_DELAY));
            expect(await contract.redeemableTokenAllocation(bal.address)).eq(STAGE2_BAL);
            expect(await contract.redeemableTokenAllocation(weth.address)).eq(STAGE2_WETH);

            const event = rcpt.events?.find(e => e.event === "Finalized");
            expect(event!.args!.snapshotSupply).eq(AURABAL_SUPPLY);
        });
        it("cannot finalize twice", async () => {
            await contract.connect(owner).finalize([bal.address]);
            await expect(contract.connect(owner).finalize([weth.address])).to.revertedWith("finalized");
        });
    });

    describe("redeem", () => {
        beforeEach(async () => {
            await contract.connect(owner).finalize([bal.address, weth.address]);
        });
        it("reverts if not finalized", async () => {
            const fresh = await deployAuraBalRedemption({});
            await expect(fresh.connect(alice).redeem(1)).to.revertedWith("!finalized");
        });
        it("reverts on zero amount", async () => {
            await expect(contract.connect(alice).redeem(0)).to.revertedWith("!amount");
        });
        it("burns auraBAL and pays pro-rata basket (no receipt)", async () => {
            // Alice has 10% of AURABAL_SUPPLY. She redeems the full 10% → should get 10% of basket.
            await auraBal.connect(alice).approve(contract.address, ALICE_AURABAL);

            const balBefore = await bal.balanceOf(aliceAddress);
            const wethBefore = await weth.balanceOf(aliceAddress);
            const burnBefore = await auraBal.balanceOf(BURN_ADDRESS);

            const tx = await contract.connect(alice).redeem(ALICE_AURABAL);
            const rcpt = await tx.wait();

            const expBal = STAGE2_BAL.mul(ALICE_AURABAL).div(AURABAL_SUPPLY);
            const expWeth = STAGE2_WETH.mul(ALICE_AURABAL).div(AURABAL_SUPPLY);

            expect((await bal.balanceOf(aliceAddress)).sub(balBefore)).eq(expBal);
            expect((await weth.balanceOf(aliceAddress)).sub(wethBefore)).eq(expWeth);
            expect((await auraBal.balanceOf(BURN_ADDRESS)).sub(burnBefore)).eq(ALICE_AURABAL);

            const event = rcpt.events?.find(e => e.event === "Redeemed");
            expect(event!.args!.user).eq(aliceAddress);
            expect(event!.args!.auraBalBurned).eq(ALICE_AURABAL);
        });
        it("un-redeemed auraBAL leaves proportional dust", async () => {
            // Only alice redeems → 10%. Remaining 90% is dust until sweep.
            await auraBal.connect(alice).approve(contract.address, ALICE_AURABAL);
            await contract.connect(alice).redeem(ALICE_AURABAL);

            const expectedRemainingBal = STAGE2_BAL.sub(STAGE2_BAL.mul(ALICE_AURABAL).div(AURABAL_SUPPLY));
            expect(await bal.balanceOf(contract.address)).eq(expectedRemainingBal);
        });
    });

    describe("sweep", () => {
        beforeEach(async () => {
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
            const fresh = await deployAuraBalRedemption({});
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
