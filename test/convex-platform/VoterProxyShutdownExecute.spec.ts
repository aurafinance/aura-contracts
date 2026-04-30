import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer, BigNumber } from "ethers";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    AuraBalRedemption,
    AuraBalRedemption__factory,
    AuraRedemption,
    AuraRedemption__factory,
    AuraToken,
    Booster,
    BoosterOwner,
    CrvDepositor,
    CvxCrvToken,
    MockERC20,
    MockERC20__factory,
    PoolManagerSecondaryProxy,
    PoolManagerV3,
    RAuraRedemption,
    RAuraRedemption__factory,
    VoterProxy,
    WindDownCoordinator,
    WindDownCoordinator__factory,
} from "../../types/generated";
import { deployContract } from "../../tasks/utils";
import { simpleToExactAmount } from "../../test-utils/math";
import { getTimestamp, increaseTimeTo } from "../../test-utils/time";
import { impersonateAccount } from "../../test-utils/fork";
import { ONE_DAY, ONE_YEAR, ZERO } from "../../test-utils/constants";

const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const TREASURY_ADDRESS = "0xfc78f8e1Af80A3bF5A1783BB59eD2d1b10f78cA9";
const DUST_TOLERANCE = BigNumber.from(2);
const AURABAL_BPS = 9000; // 90% of BPT goes to auraBAL holders, 10% to rAURA.
const BPS_DENOMINATOR = 10_000;

const expectWithinTolerance = (actual: BigNumber, expected: BigNumber, tolerance: BigNumber) => {
    const lowerBound = expected.gt(tolerance) ? expected.sub(tolerance) : ZERO;
    expect(actual.gte(lowerBound)).eq(true);
    expect(actual.lte(expected.add(tolerance))).eq(true);
};

describe("Full wind-down (Stages 0 / 1 / 2)", () => {
    let accounts: Signer[];
    let deployer: Signer;
    let daoMultisig: Signer;
    let deployerAddress: string;
    let alice: Signer;
    let aliceAddress: string;
    let bob: Signer;
    let bobAddress: string;
    let sleepy: Signer;
    let sleepyAddress: string;
    let treasury: Signer;
    let outsider: Signer;

    let mocks: DeployMocksResult;
    let cvx: AuraToken;
    let cvxCrv: CvxCrvToken;
    let crvDepositor: CrvDepositor;
    let voterProxy: VoterProxy;
    let booster: Booster;
    let boosterOwner: BoosterOwner;
    let poolManager: PoolManagerV3;
    let poolManagerSecondaryProxy: PoolManagerSecondaryProxy;

    // Stage 0 treasury basket.
    let treasuryUsdc: MockERC20;
    let treasuryWeth: MockERC20;
    const TREASURY_USDC_FUND = simpleToExactAmount(2_000_000, 6);
    const TREASURY_WETH_FUND = simpleToExactAmount(500);

    let auraRedemption: AuraRedemption;
    let rAuraRedemption: RAuraRedemption;
    let auraBalRedemption: AuraBalRedemption;
    let coordinator: WindDownCoordinator;

    const REDEEMABLE_AURA_SUPPLY = simpleToExactAmount(10_000_000);
    const ALICE_AURA = simpleToExactAmount(1_000_000); // 10%
    const BOB_AURA = simpleToExactAmount(400_000); //  4%
    const SLEEPY_AURA = simpleToExactAmount(100_000); //  1%

    const ALICE_AURABAL = simpleToExactAmount(100_000);
    const BOB_AURABAL = simpleToExactAmount(49_000);
    const SLEEPY_AURABAL = simpleToExactAmount(1_000);

    const SWEEP_DELAY = ONE_YEAR;
    let auraExpiry: BigNumber;

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        alice = accounts[5];
        bob = accounts[6];
        outsider = accounts[7];
        sleepy = accounts[8];

        deployerAddress = await deployer.getAddress();
        aliceAddress = await alice.getAddress();
        bobAddress = await bob.getAddress();
        sleepyAddress = await sleepy.getAddress();

        mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[1], accounts[2], accounts[3]);
        daoMultisig = await ethers.getSigner(multisigs.daoMultisig);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        const phase2 = await deployPhase2(
            hre,
            deployer,
            phase1,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.connect(daoMultisig).setProtectPool(false);
        const contracts = await deployPhase4(hre, deployer, phase3, mocks.addresses);

        cvx = contracts.cvx;
        cvxCrv = contracts.cvxCrv;
        crvDepositor = contracts.crvDepositor;
        voterProxy = contracts.voterProxy;
        booster = contracts.booster;
        boosterOwner = contracts.boosterOwner;
        poolManager = contracts.poolManager;
        poolManagerSecondaryProxy = contracts.poolManagerSecondaryProxy;

        const treasuryAccount = await impersonateAccount(TREASURY_ADDRESS);
        treasury = treasuryAccount.signer;

        const boosterSigner = await impersonateAccount(booster.address);
        await cvx.connect(boosterSigner.signer).mint(aliceAddress, ALICE_AURA);
        await cvx.connect(boosterSigner.signer).mint(bobAddress, BOB_AURA);
        await cvx.connect(boosterSigner.signer).mint(sleepyAddress, SLEEPY_AURA);

        const depositorSigner = await impersonateAccount(crvDepositor.address);
        await cvxCrv.connect(depositorSigner.signer).mint(aliceAddress, ALICE_AURABAL);
        await cvxCrv.connect(depositorSigner.signer).mint(bobAddress, BOB_AURABAL);
        await cvxCrv.connect(depositorSigner.signer).mint(sleepyAddress, SLEEPY_AURABAL);

        treasuryUsdc = await deployContract<MockERC20>(
            hre,
            new MockERC20__factory(deployer),
            "USDC",
            ["USDC", "USDC", 6, TREASURY_ADDRESS, TREASURY_USDC_FUND.div(simpleToExactAmount(1, 6))],
            {},
            false,
        );
        treasuryWeth = await deployContract<MockERC20>(
            hre,
            new MockERC20__factory(deployer),
            "WETH",
            ["WETH", "WETH", 18, TREASURY_ADDRESS, TREASURY_WETH_FUND.div(simpleToExactAmount(1))],
            {},
            false,
        );
    });

    // ──────────────────────────────────────────────────────────────────────
    // Stage 0 — deploy redemption contracts (treasury = owner), fund, finalize, redeem
    // ──────────────────────────────────────────────────────────────────────

    it("Stage 0: deploys AuraRedemption (owner = treasury)", async () => {
        const now = await getTimestamp();
        auraExpiry = now.add(ONE_DAY.mul(100)); // 100 days

        auraRedemption = await deployContract<AuraRedemption>(
            hre,
            new AuraRedemption__factory(deployer),
            "AuraRedemption",
            ["Redeemed AURA", "rAURA", cvx.address, REDEEMABLE_AURA_SUPPLY, auraExpiry, TREASURY_ADDRESS],
            {},
            false,
        );

        expect(await auraRedemption.owner()).eq(TREASURY_ADDRESS);
    });

    it("Stage 0: deploys RAuraRedemption (owner = treasury)", async () => {
        rAuraRedemption = await deployContract<RAuraRedemption>(
            hre,
            new RAuraRedemption__factory(deployer),
            "RAuraRedemption",
            [auraRedemption.address, SWEEP_DELAY, TREASURY_ADDRESS],
            {},
            false,
        );

        expect(await rAuraRedemption.owner()).eq(TREASURY_ADDRESS);
    });

    it("Stage 0: deploys AuraBalRedemption (owner = treasury)", async () => {
        auraBalRedemption = await deployContract<AuraBalRedemption>(
            hre,
            new AuraBalRedemption__factory(deployer),
            "AuraBalRedemption",
            [cvxCrv.address, SWEEP_DELAY, TREASURY_ADDRESS],
            {},
            false,
        );

        expect(await auraBalRedemption.owner()).eq(TREASURY_ADDRESS);
    });

    it("Stage 0: treasury funds AuraRedemption basket", async () => {
        await treasuryUsdc.connect(treasury).transfer(auraRedemption.address, TREASURY_USDC_FUND);
        await treasuryWeth.connect(treasury).transfer(auraRedemption.address, TREASURY_WETH_FUND);
    });

    it("Stage 0: treasury finalizes AuraRedemption", async () => {
        await auraRedemption.connect(treasury).finalize([treasuryUsdc.address, treasuryWeth.address]);
        expect(await auraRedemption.finalized()).eq(true);
    });

    it("Stage 0: alice redeems her AURA", async () => {
        const burntAuraBefore = await cvx.balanceOf(BURN_ADDRESS);
        await cvx.connect(alice).approve(auraRedemption.address, ALICE_AURA);
        await auraRedemption.connect(alice).redeem(ALICE_AURA);

        const expectedUsdc = TREASURY_USDC_FUND.mul(ALICE_AURA).div(REDEEMABLE_AURA_SUPPLY);
        const expectedWeth = TREASURY_WETH_FUND.mul(ALICE_AURA).div(REDEEMABLE_AURA_SUPPLY);
        expect(await treasuryUsdc.balanceOf(aliceAddress)).eq(expectedUsdc);
        expect(await treasuryWeth.balanceOf(aliceAddress)).eq(expectedWeth);
        expect(await auraRedemption.balanceOf(aliceAddress)).eq(ALICE_AURA);
        expect(await cvx.balanceOf(BURN_ADDRESS)).eq(burntAuraBefore.add(ALICE_AURA));
    });

    it("Stage 0: bob redeems his AURA 1/2", async () => {
        const burntAuraBefore = await cvx.balanceOf(BURN_ADDRESS);
        await cvx.connect(bob).approve(auraRedemption.address, BOB_AURA.div(2));
        await auraRedemption.connect(bob).redeem(BOB_AURA.div(2));

        const expectedUsdc = TREASURY_USDC_FUND.mul(BOB_AURA.div(2)).div(REDEEMABLE_AURA_SUPPLY);
        expect(await treasuryUsdc.balanceOf(bobAddress)).eq(expectedUsdc);
        expect(await auraRedemption.balanceOf(bobAddress)).eq(BOB_AURA.div(2));
        expect(await cvx.balanceOf(BURN_ADDRESS)).eq(burntAuraBefore.add(BOB_AURA.div(2)));
    });
    it("Stage 0: bob redeems his AURA 2/2", async () => {
        const burntAuraBefore = await cvx.balanceOf(BURN_ADDRESS);
        await cvx.connect(bob).approve(auraRedemption.address, BOB_AURA.div(2));
        await auraRedemption.connect(bob).redeem(BOB_AURA.div(2));

        const expectedUsdc = TREASURY_USDC_FUND.mul(BOB_AURA).div(REDEEMABLE_AURA_SUPPLY);
        expect(await treasuryUsdc.balanceOf(bobAddress)).eq(expectedUsdc);
        expect(await auraRedemption.balanceOf(bobAddress)).eq(BOB_AURA);
        expect(await cvx.balanceOf(BURN_ADDRESS)).eq(burntAuraBefore.add(BOB_AURA.div(2)));
    });
    it("Stage 0: sleepy redeems his AURA 1/2", async () => {
        const burntAuraBefore = await cvx.balanceOf(BURN_ADDRESS);
        await cvx.connect(sleepy).approve(auraRedemption.address, SLEEPY_AURA.div(2));
        await auraRedemption.connect(sleepy).redeem(SLEEPY_AURA.div(2));

        const expectedUsdc = TREASURY_USDC_FUND.mul(SLEEPY_AURA.div(2)).div(REDEEMABLE_AURA_SUPPLY);
        expect(await treasuryUsdc.balanceOf(sleepyAddress)).eq(expectedUsdc);
        expect(await auraRedemption.balanceOf(sleepyAddress)).eq(SLEEPY_AURA.div(2));
        expect(await cvx.balanceOf(BURN_ADDRESS)).eq(burntAuraBefore.add(SLEEPY_AURA.div(2)));
    });
    // ──────────────────────────────────────────────────────────────────────
    // Stage 1 — shutdown, deploy coordinator, hand over ownership, setOperator
    // ──────────────────────────────────────────────────────────────────────

    it("Stage 1 pre: cannot replace VoterProxy operator while Booster is live", async () => {
        await expect(voterProxy.connect(daoMultisig).setOperator(TREASURY_ADDRESS)).to.revertedWith("needs shutdown");
    });

    it("Stage 1: shuts down every pool, the pool manager, and the Booster", async () => {
        const poolLength = await booster.poolLength();
        for (let i = 0; i < Number(poolLength.toString()); i++) {
            // ⚠️ Deployed Version is different setup ⚠️
            // PoolManager.operator => PoolManagerSecondaryProxy
            // PoolManagerSecondaryProxy.operator => PoolManagerV4
            // PoolManagerV4.operator => PoolFeeManagerProxy
            // PoolFeeManagerProxy.operator => daoMultisig
            // PoolFeeManagerProxy.shutdownPool(), should check if it is not already shutdown.
            const pooolInfo = await booster.poolInfo(i);
            if (pooolInfo.shutdown == true) throw new Error(`Pool ${i} is already shutdown`);
            await poolManager.connect(daoMultisig).shutdownPool(i);
        }
        // ⚠️ Deployed Version is different setup ⚠️
        // PoolFeeManagerProxy.operator => daoMultisig
        await poolManagerSecondaryProxy.connect(daoMultisig).shutdownSystem();

        // ⚠️ Deployed Version is different setup ⚠️
        // boosterOwner.owner => BoosterOwnerSecondary
        // BoosterOwnerSecondary.owner => daoMultisig
        await boosterOwner.connect(daoMultisig).shutdownSystem();

        expect(await booster.isShutdown()).eq(true);
    });

    it("Stage 1: deploys WindDownCoordinator (treasury = owner)", async () => {
        coordinator = await deployContract<WindDownCoordinator>(
            hre,
            new WindDownCoordinator__factory(deployer),
            "WindDownCoordinator",
            [
                voterProxy.address,
                mocks.votingEscrow.address,
                mocks.crvBpt.address,
                auraRedemption.address,
                rAuraRedemption.address,
                auraBalRedemption.address,
                AURABAL_BPS,
                TREASURY_ADDRESS,
            ],
            {},
            false,
        );

        expect(await coordinator.owner()).eq(TREASURY_ADDRESS);
        expect(await coordinator.voterProxy()).eq(voterProxy.address);
        expect(await coordinator.auraBalBps()).eq(AURABAL_BPS);
        expect(await coordinator.stage()).eq(0); // UNSTARTED
    });

    it("Stage 1: treasury transfers redemption-contract ownership to coordinator", async () => {
        await auraRedemption.connect(treasury).setOwner(coordinator.address);
        await rAuraRedemption.connect(treasury).setOwner(coordinator.address);
        await auraBalRedemption.connect(treasury).setOwner(coordinator.address);

        expect(await auraRedemption.owner()).eq(coordinator.address);
        expect(await rAuraRedemption.owner()).eq(coordinator.address);
        expect(await auraBalRedemption.owner()).eq(coordinator.address);
    });

    it("Stage 1: makes the coordinator the VoterProxy operator", async () => {
        await voterProxy.connect(daoMultisig).setOperator(coordinator.address);
        expect(await voterProxy.operator()).eq(coordinator.address);
    });

    it("Stage 1: AuraToken.updateOperator() syncs AURA operator to coordinator", async () => {
        expect(await cvx.operator()).eq(booster.address);
        await cvx.updateOperator();
        expect(await cvx.operator()).eq(coordinator.address);
    });

    it("Stage 1: legacy Booster.rewardClaimed path no longer mints AURA", async () => {
        const boosterSigner = await impersonateAccount(booster.address);
        const before = await cvx.balanceOf(aliceAddress);
        await cvx.connect(boosterSigner.signer).mint(aliceAddress, simpleToExactAmount(1));
        expect(await cvx.balanceOf(aliceAddress)).eq(before);
    });

    it("Stage 1 (belt-and-braces): zeroes the reward multiplier for every rewardClaimed caller", async () => {
        const lockRewards = await booster.lockRewards();
        const rewardContracts: string[] = [lockRewards];
        const poolLength = await booster.poolLength();
        for (let i = 0; i < Number(poolLength.toString()); i++) {
            const pool = await booster.poolInfo(i);
            rewardContracts.push(pool.crvRewards);
        }
        for (const addr of rewardContracts) {
            // ⚠️ Deployed Version is different setup ⚠️
            // booster.feeManager => PoolFeeManagerProxy
            // PoolFeeManagerProxy.operator => daoMultisig
            // PoolFeeManagerProxy.connect(daoMultisig).setRewardMultiplier(addr, 0 )
            await booster.connect(daoMultisig).setRewardMultiplier(addr, 0);
            expect(await booster.getRewardMultipliers(addr)).eq(ZERO);
        }
    });

    // ──────────────────────────────────────────────────────────────────────
    // Stage 2 — coordinator.unlockAndWithdraw + splitAndFinalize, users redeem
    // ──────────────────────────────────────────────────────────────────────

    it("Stage 2 pre: coordinator.unlockAndWithdraw reverts before lock expires", async () => {
        await expect(coordinator.connect(outsider).unlockAndWithdraw()).to.revertedWith("!success");
    });

    it("Stage 2 pre: splitAndFinalize reverts before unlockAndWithdraw", async () => {
        await expect(coordinator.connect(treasury).splitAndFinalize()).to.revertedWith("!stage");
    });

    it("Stage 2: warps past AuraRedemption.expiry and the veBAL unlock", async () => {
        const unlockTime = await mocks.votingEscrow.lockTimes(voterProxy.address);
        const target = unlockTime.gt(auraExpiry) ? unlockTime : auraExpiry;
        await increaseTimeTo(target.add(1));
    });

    it("Stage 2: coordinator.unlockAndWithdraw pulls BPT out of the escrow (permissionless)", async () => {
        const lockedAmount = await mocks.votingEscrow.balanceOf(voterProxy.address);

        // Permissionless — called by outsider, not treasury.
        const tx = await coordinator.connect(outsider).unlockAndWithdraw();

        expect(await mocks.votingEscrow.balanceOf(voterProxy.address)).eq(ZERO);
        expect(await mocks.crvBpt.balanceOf(voterProxy.address)).eq(ZERO);
        expect(await mocks.crvBpt.balanceOf(coordinator.address)).eq(lockedAmount);
        expect(await coordinator.stage()).eq(1); // WITHDRAWN
        await expect(tx).to.emit(coordinator, "Withdrawn").withArgs(lockedAmount);
    });

    it("Stage 2: None should be able to redeem AURA after coordinator.unlockAndWithdraw", async () => {
        const sleepyAura = await cvx.balanceOf(sleepyAddress);
        await cvx.connect(sleepy).approve(auraRedemption.address, sleepyAura);
        await expect(auraRedemption.connect(sleepy).redeem(sleepyAura)).to.revertedWith("expired");
    });

    it("Stage 2: cannot unlockAndWithdraw twice", async () => {
        await expect(coordinator.connect(outsider).unlockAndWithdraw()).to.revertedWith("!stage");
    });

    it("Stage 2 pre: splitAndFinalize reverts if non-owner calls", async () => {
        await expect(coordinator.connect(outsider).splitAndFinalize()).to.revertedWith("!owner");
    });

    it("Stage 2: treasury calls splitAndFinalize — sweeps residuals, splits BPT 90/10, finalizes B and C", async () => {
        const residualUsdc = await treasuryUsdc.balanceOf(auraRedemption.address);
        const residualWeth = await treasuryWeth.balanceOf(auraRedemption.address);
        expect(residualUsdc).gt(ZERO);
        expect(residualWeth).gt(ZERO);

        const totalBpt = await mocks.crvBpt.balanceOf(coordinator.address);
        const expectedAuraBalShare = totalBpt.mul(AURABAL_BPS).div(BPS_DENOMINATOR);
        const expectedRAuraShare = totalBpt.sub(expectedAuraBalShare);

        const tx = await coordinator.connect(treasury).splitAndFinalize();

        // Residuals flowed from A into B.
        expect(await treasuryUsdc.balanceOf(auraRedemption.address)).eq(ZERO);
        expect(await treasuryWeth.balanceOf(auraRedemption.address)).eq(ZERO);
        expect(await treasuryUsdc.balanceOf(rAuraRedemption.address)).eq(residualUsdc);
        expect(await treasuryWeth.balanceOf(rAuraRedemption.address)).eq(residualWeth);

        // BPT split 90/10.
        expect(await mocks.crvBpt.balanceOf(auraBalRedemption.address)).eq(expectedAuraBalShare);
        expect(await mocks.crvBpt.balanceOf(rAuraRedemption.address)).eq(expectedRAuraShare);

        // Both finalized; snapshots recorded.
        expect(await rAuraRedemption.finalized()).eq(true);
        expect(await auraBalRedemption.finalized()).eq(true);
        expect(await rAuraRedemption.REDEEMABLE_RAURA_SUPPLY()).eq(ALICE_AURA.add(BOB_AURA).add(SLEEPY_AURA.div(2)));
        expect(await auraBalRedemption.REDEEMABLE_AURABAL_SUPPLY()).eq(await cvxCrv.totalSupply());

        // Allocations match balances at finalize.
        expect(await rAuraRedemption.redeemableTokenAllocation(mocks.crvBpt.address)).eq(expectedRAuraShare);
        expect(await rAuraRedemption.redeemableTokenAllocation(treasuryUsdc.address)).eq(residualUsdc);
        expect(await rAuraRedemption.redeemableTokenAllocation(treasuryWeth.address)).eq(residualWeth);
        expect(await auraBalRedemption.redeemableTokenAllocation(mocks.crvBpt.address)).eq(expectedAuraBalShare);

        expect(await coordinator.stage()).eq(2); // FINALIZED

        await expect(tx).to.emit(rAuraRedemption, "Finalized");
        await expect(tx).to.emit(auraBalRedemption, "Finalized");
        await expect(tx).to.emit(coordinator, "SplitAndFinalized");
    });

    it("Stage 2: cannot splitAndFinalize twice", async () => {
        await expect(coordinator.connect(treasury).splitAndFinalize()).to.revertedWith("!stage");
    });

    it("Stage 2: alice redeems rAURA for her slice of BPT + residuals", async () => {
        const aliceRaura = await auraRedemption.balanceOf(aliceAddress);
        const rauraSupply = await rAuraRedemption.REDEEMABLE_RAURA_SUPPLY();

        const bptAlloc = await rAuraRedemption.redeemableTokenAllocation(mocks.crvBpt.address);
        const usdcAlloc = await rAuraRedemption.redeemableTokenAllocation(treasuryUsdc.address);
        const wethAlloc = await rAuraRedemption.redeemableTokenAllocation(treasuryWeth.address);

        const expBpt = bptAlloc.mul(aliceRaura).div(rauraSupply);
        const expUsdc = usdcAlloc.mul(aliceRaura).div(rauraSupply);
        const expWeth = wethAlloc.mul(aliceRaura).div(rauraSupply);

        await auraRedemption.connect(alice).approve(rAuraRedemption.address, aliceRaura);
        await rAuraRedemption.connect(alice).redeem(aliceRaura);

        expect(await mocks.crvBpt.balanceOf(aliceAddress)).eq(expBpt);
        expect(
            (await treasuryUsdc.balanceOf(aliceAddress)).sub(
                TREASURY_USDC_FUND.mul(ALICE_AURA).div(REDEEMABLE_AURA_SUPPLY),
            ),
        ).eq(expUsdc);
        expect(
            (await treasuryWeth.balanceOf(aliceAddress)).sub(
                TREASURY_WETH_FUND.mul(ALICE_AURA).div(REDEEMABLE_AURA_SUPPLY),
            ),
        ).eq(expWeth);
        expect(await auraRedemption.balanceOf(BURN_ADDRESS)).eq(aliceRaura);
    });

    it("Stage 2: bob redeems rAURA", async () => {
        const bobRaura = await auraRedemption.balanceOf(bobAddress);
        const rauraSupply = await rAuraRedemption.REDEEMABLE_RAURA_SUPPLY();
        const bptAlloc = await rAuraRedemption.redeemableTokenAllocation(mocks.crvBpt.address);

        const expBpt = bptAlloc.mul(bobRaura).div(rauraSupply);
        const bobBptBefore = await mocks.crvBpt.balanceOf(bobAddress);

        await auraRedemption.connect(bob).approve(rAuraRedemption.address, bobRaura);
        await rAuraRedemption.connect(bob).redeem(bobRaura);

        expect((await mocks.crvBpt.balanceOf(bobAddress)).sub(bobBptBefore)).eq(expBpt);
        expect(await auraRedemption.balanceOf(BURN_ADDRESS)).eq(ALICE_AURA.add(BOB_AURA));
    });

    it("Stage 2: alice redeems auraBAL for her slice of BPT", async () => {
        const supply = await auraBalRedemption.REDEEMABLE_AURABAL_SUPPLY();
        const bptAlloc = await auraBalRedemption.redeemableTokenAllocation(mocks.crvBpt.address);

        const expBpt = bptAlloc.mul(ALICE_AURABAL).div(supply);
        const aliceBptBefore = await mocks.crvBpt.balanceOf(aliceAddress);

        await cvxCrv.connect(alice).approve(auraBalRedemption.address, ALICE_AURABAL);
        await auraBalRedemption.connect(alice).redeem(ALICE_AURABAL);

        expect((await mocks.crvBpt.balanceOf(aliceAddress)).sub(aliceBptBefore)).eq(expBpt);
        expect(await cvxCrv.balanceOf(BURN_ADDRESS)).eq(ALICE_AURABAL);
    });

    it("Stage 2: bob redeems auraBAL", async () => {
        const supply = await auraBalRedemption.REDEEMABLE_AURABAL_SUPPLY();
        const bptAlloc = await auraBalRedemption.redeemableTokenAllocation(mocks.crvBpt.address);

        const expBpt = bptAlloc.mul(BOB_AURABAL).div(supply);
        const bobBptBefore = await mocks.crvBpt.balanceOf(bobAddress);

        await cvxCrv.connect(bob).approve(auraBalRedemption.address, BOB_AURABAL);
        await auraBalRedemption.connect(bob).redeem(BOB_AURABAL);

        expect((await mocks.crvBpt.balanceOf(bobAddress)).sub(bobBptBefore)).eq(expBpt);
        expect(await cvxCrv.balanceOf(BURN_ADDRESS)).eq(ALICE_AURABAL.add(BOB_AURABAL));
    });

    it("Stage 2 post: un-redeemed auraBAL slice stays as sweepable dust", async () => {
        // Deployer's pre-existing auraBAL (minted during phase2 for pool setup) doesn't
        // redeem, so its slice of the BPT remains in the contract until sweep.
        const redeemed = ALICE_AURABAL.add(BOB_AURABAL);
        const supply = await auraBalRedemption.REDEEMABLE_AURABAL_SUPPLY();
        const bptAlloc = await auraBalRedemption.redeemableTokenAllocation(mocks.crvBpt.address);

        const expectedDust = bptAlloc.sub(bptAlloc.mul(redeemed).div(supply));
        const actualDust = await mocks.crvBpt.balanceOf(auraBalRedemption.address);

        expectWithinTolerance(actualDust, expectedDust, DUST_TOLERANCE);
    });
});
