import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer, BigNumber } from "ethers";
import { AuraRedemption, AuraRedemption__factory, MockERC20, MockERC20__factory } from "../../types/generated";
import { deployContract } from "../../tasks/utils";
import { simpleToExactAmount } from "../../test-utils/math";
import { getTimestamp, increaseTimeTo } from "../../test-utils/time";
import { ZERO, ZERO_ADDRESS } from "../../test-utils/constants";

const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

describe("AuraRedemption (Contract A)", () => {
    let accounts: Signer[];
    let deployer: Signer;
    let deployerAddress: string;
    let owner: Signer;
    let ownerAddress: string;
    let alice: Signer;
    let aliceAddress: string;
    let outsider: Signer;

    let aura: MockERC20;
    let bal: MockERC20;
    let weth: MockERC20;
    let usdc: MockERC20;

    const REDEEMABLE_AURA_SUPPLY = simpleToExactAmount(50_000_000); // 50M AURA
    const BAL_FUND = simpleToExactAmount(1_000_000);
    const WETH_FUND = simpleToExactAmount(500);
    const USDC_FUND = simpleToExactAmount(2_000_000, 6);

    let expiry: BigNumber;
    let contract: AuraRedemption;

    const deployMock = async (name: string, symbol: string, dec: number, to: string, amt: BigNumber) =>
        deployContract<MockERC20>(
            hre,
            new MockERC20__factory(deployer),
            name,
            [name, symbol, dec, to, amt.div(simpleToExactAmount(1, dec))],
            {},
            false,
        );

    const deployRedemption = async (args: { aura?: string; supply?: BigNumber; expiry?: BigNumber; owner?: string }) =>
        deployContract<AuraRedemption>(
            hre,
            new AuraRedemption__factory(deployer),
            "AuraRedemption",
            [
                "Redeemed AURA",
                "rAURA",
                args.aura ?? aura.address,
                args.supply ?? REDEEMABLE_AURA_SUPPLY,
                args.expiry ?? expiry,
                args.owner ?? ownerAddress,
            ],
            {},
            false,
        );

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        owner = accounts[1];
        alice = accounts[2];
        outsider = accounts[3];

        deployerAddress = await deployer.getAddress();
        ownerAddress = await owner.getAddress();
        aliceAddress = await alice.getAddress();
    });

    beforeEach(async () => {
        // deploy basket + AURA, mint AURA to alice so she can redeem.
        aura = await deployMock("AURA", "AURA", 18, deployerAddress, simpleToExactAmount(100_000_000));
        bal = await deployMock("BAL", "BAL", 18, deployerAddress, BAL_FUND);
        weth = await deployMock("WETH", "WETH", 18, deployerAddress, WETH_FUND);
        usdc = await deployMock("USDC", "USDC", 6, deployerAddress, USDC_FUND);

        await aura.transfer(aliceAddress, simpleToExactAmount(1_000_000));

        const now = await getTimestamp();
        expiry = now.add(60 * 60 * 24 * 365); // +365 days

        contract = await deployRedemption({});

        // fund the contract.
        await bal.transfer(contract.address, BAL_FUND);
        await weth.transfer(contract.address, WETH_FUND);
        await usdc.transfer(contract.address, USDC_FUND);
    });

    describe("constructor", () => {
        it("reverts on zero aura", async () => {
            await expect(deployRedemption({ aura: ZERO_ADDRESS })).to.revertedWith("!aura");
        });
        it("reverts on zero supply", async () => {
            await expect(deployRedemption({ supply: ZERO })).to.revertedWith("!supply");
        });
        it("reverts on non-future expiry", async () => {
            const now = await getTimestamp();
            await expect(deployRedemption({ expiry: now })).to.revertedWith("!expiry");
        });
        it("reverts on zero owner", async () => {
            await expect(deployRedemption({ owner: ZERO_ADDRESS })).to.revertedWith("!owner");
        });
        it("stores immutables", async () => {
            expect(await contract.aura()).eq(aura.address);
            expect(await contract.REDEEMABLE_AURA_SUPPLY()).eq(REDEEMABLE_AURA_SUPPLY);
            expect(await contract.expiry()).eq(expiry);
            expect(await contract.owner()).eq(ownerAddress);
            expect(await contract.finalized()).eq(false);
            expect(await contract.name()).eq("Redeemed AURA");
            expect(await contract.symbol()).eq("rAURA");
        });
    });

    describe("finalize", () => {
        it("reverts if not owner", async () => {
            await expect(contract.connect(outsider).finalize([bal.address])).to.revertedWith("!owner");
        });
        it("reverts on empty token list", async () => {
            await expect(contract.connect(owner).finalize([])).to.revertedWith("!tokens");
        });
        it("reverts if a token is the zero address", async () => {
            await expect(contract.connect(owner).finalize([ZERO_ADDRESS])).to.revertedWith("!token");
        });
        it("reverts if a token is aura", async () => {
            await expect(contract.connect(owner).finalize([aura.address])).to.revertedWith("!token");
        });
        it("reverts on duplicate token", async () => {
            await expect(contract.connect(owner).finalize([bal.address, bal.address])).to.revertedWith("dup");
        });
        it("reverts if a token has zero balance", async () => {
            const empty = await deployMock("EMPTY", "EMPTY", 18, deployerAddress, ZERO);
            await expect(contract.connect(owner).finalize([empty.address])).to.revertedWith("!funded");
        });
        it("succeeds, sets allocations, emits Finalized", async () => {
            const tx = await contract.connect(owner).finalize([bal.address, weth.address, usdc.address]);
            const rcpt = await tx.wait();
            const event = rcpt.events?.find(e => e.event === "Finalized");
            expect(event, "Finalized event missing").to.exist;
            expect(event!.args!.tokens).to.deep.eq([bal.address, weth.address, usdc.address]);
            expect(event!.args!.allocations.map((x: BigNumber) => x.toString())).to.deep.eq([
                BAL_FUND.toString(),
                WETH_FUND.toString(),
                USDC_FUND.toString(),
            ]);

            expect(await contract.finalized()).eq(true);
            expect(await contract.redeemableTokensLength()).eq(3);
            expect(await contract.redeemableTokens(0)).eq(bal.address);
            expect(await contract.redeemableTokenAllocation(bal.address)).eq(BAL_FUND);
            expect(await contract.redeemableTokenAllocation(weth.address)).eq(WETH_FUND);
            expect(await contract.redeemableTokenAllocation(usdc.address)).eq(USDC_FUND);
        });
        it("cannot finalize twice", async () => {
            await contract.connect(owner).finalize([bal.address]);
            await expect(contract.connect(owner).finalize([weth.address])).to.revertedWith("finalized");
        });
    });

    describe("redeem", () => {
        beforeEach(async () => {
            await contract.connect(owner).finalize([bal.address, weth.address, usdc.address]);
        });

        it("reverts if not finalized", async () => {
            const fresh = await deployRedemption({});
            await expect(fresh.connect(alice).redeem(simpleToExactAmount(1))).to.revertedWith("!finalized");
        });
        it("reverts on zero amount", async () => {
            await expect(contract.connect(alice).redeem(0)).to.revertedWith("!amount");
        });
        it("reverts after expiry", async () => {
            await increaseTimeTo(expiry.add(1));
            await aura.connect(alice).approve(contract.address, simpleToExactAmount(1));
            await expect(contract.connect(alice).redeem(simpleToExactAmount(1))).to.revertedWith("expired");
        });
        it("burns AURA, mints 1:1 rAURA, pays pro-rata basket", async () => {
            // Alice redeems 1% of REDEEMABLE_AURA_SUPPLY = 500k AURA.
            const amount = REDEEMABLE_AURA_SUPPLY.div(100);
            await aura.connect(alice).approve(contract.address, amount);

            const rauraBefore = await contract.balanceOf(aliceAddress);
            const balBefore = await bal.balanceOf(aliceAddress);
            const wethBefore = await weth.balanceOf(aliceAddress);
            const usdcBefore = await usdc.balanceOf(aliceAddress);
            const burnBefore = await aura.balanceOf(BURN_ADDRESS);

            const tx = await contract.connect(alice).redeem(amount);
            const rcpt = await tx.wait();

            // Pro-rata = 1% of each fund amount.
            const expBal = BAL_FUND.div(100);
            const expWeth = WETH_FUND.div(100);
            const expUsdc = USDC_FUND.div(100);

            expect((await bal.balanceOf(aliceAddress)).sub(balBefore)).eq(expBal);
            expect((await weth.balanceOf(aliceAddress)).sub(wethBefore)).eq(expWeth);
            expect((await usdc.balanceOf(aliceAddress)).sub(usdcBefore)).eq(expUsdc);

            // AURA went to dead.
            expect((await aura.balanceOf(BURN_ADDRESS)).sub(burnBefore)).eq(amount);

            // rAURA minted 1:1.
            expect((await contract.balanceOf(aliceAddress)).sub(rauraBefore)).eq(amount);

            const event = rcpt.events?.find(e => e.event === "Redeemed");
            expect(event!.args!.user).eq(aliceAddress);
            expect(event!.args!.burned).eq(amount);
            expect(event!.args!.payouts.map((x: BigNumber) => x.toString())).to.deep.eq([
                expBal.toString(),
                expWeth.toString(),
                expUsdc.toString(),
            ]);
        });
        it("two redeemers split basket in proportion", async () => {
            await aura.transfer(await outsider.getAddress(), simpleToExactAmount(200_000));
            const aliceAmt = REDEEMABLE_AURA_SUPPLY.div(200); // 0.5%
            const outAmt = REDEEMABLE_AURA_SUPPLY.div(500); // 0.2%

            await aura.connect(alice).approve(contract.address, aliceAmt);
            await aura.connect(outsider).approve(contract.address, outAmt);

            await contract.connect(alice).redeem(aliceAmt);
            await contract.connect(outsider).redeem(outAmt);

            expect(await bal.balanceOf(aliceAddress)).eq(BAL_FUND.div(200));
            expect(await bal.balanceOf(await outsider.getAddress())).eq(BAL_FUND.div(500));
        });
    });

    describe("sweep", () => {
        beforeEach(async () => {
            await contract.connect(owner).finalize([bal.address, weth.address, usdc.address]);
        });
        it("reverts before expiry", async () => {
            await expect(contract.connect(owner).sweep(bal.address, ownerAddress)).to.revertedWith("!expired");
        });
        it("reverts if not owner", async () => {
            await increaseTimeTo(expiry.add(1));
            await expect(contract.connect(outsider).sweep(bal.address, ownerAddress)).to.revertedWith("!owner");
        });
        it("reverts on zero to address", async () => {
            await increaseTimeTo(expiry.add(1));
            await expect(contract.connect(owner).sweep(bal.address, ZERO_ADDRESS)).to.revertedWith("!to");
        });
        it("sends full balance to recipient after expiry", async () => {
            await increaseTimeTo(expiry.add(1));
            const target = await outsider.getAddress();
            const tx = await contract.connect(owner).sweep(bal.address, target);
            expect(await bal.balanceOf(contract.address)).eq(ZERO);
            expect(await bal.balanceOf(target)).eq(BAL_FUND);
            await expect(tx).to.emit(contract, "Swept").withArgs(bal.address, target, BAL_FUND);
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
