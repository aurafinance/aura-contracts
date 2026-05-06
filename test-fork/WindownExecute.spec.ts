import { expect } from "chai";
import { Signer, BigNumber, Contract } from "ethers";
import {
    AuraBalRedemption,
    AuraRedemption,
    AuraToken,
    Booster,
    BoosterOwnerSecondary,
    CrvDepositor,
    CvxCrvToken,
    ERC20,
    ERC20__factory,
    PoolFeeManagerProxy,
    RAuraRedemption,
    VoterProxy,
    WindDownCoordinator,
    MockCurveVoteEscrow,
    MockBalancerPoolToken,
    MockBalancerPoolToken__factory,
    MockCurveVoteEscrow__factory,
    AuraLocker,
} from "../types/generated";
import { simpleToExactAmount } from "../test-utils/math";
import { getTimestamp, increaseTime, increaseTimeTo } from "../test-utils/time";
import { impersonateAccount } from "../test-utils/fork";
import { ONE_DAY, ZERO } from "../test-utils/constants";
import hre, { ethers, network } from "hardhat";
import { config as mainnetConfig } from "../tasks/deploy/mainnet-config";
import { deployWindowPhase1, deployWindowPhase2 } from "../scripts/deployWindown";

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

const isDebug = false;
const BLOCK_NUMBER = 24997359; // May 1, 2026
const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const wethAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
// const aaveAddress = "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9";
const safeAddress = "0x5afe3855358e112b5647b952709e6165e1c1eeee";
const stkAAVEAddress = "0x4da27a545c0c5b758a6ba100e3a049001de870f5";
const safeVested1Address = "0xc0fde70a65c7569fe919be57492228dee8cdb585";
const safeVested2Address = "0xA0b937D5c8E32a80E3a8ed4227CD020221544ee6";
const stkAAVEABI = [
    "function claimRewards(address to,uint256 amount) external returns (uint256)",
    "function cooldown() external",
    "function claimRewardsAndRedeem(address to,uint256 claimAmount,uint256 redeemAmount) external returns (uint256, uint256)",
    "function balanceOf(address account) external view returns (uint256)",
    "function stakerRewardsToClaim(address account) external view returns (uint256)",
];
const safeVestedABI = [
    "function claimVestedTokens(bytes32 vestingId,address beneficiary,uint128 tokensToClaim) public",
    "function calculateVestedAmount(bytes32 vestingId) external view returns (uint128 vestedAmount, uint128 claimedAmount)",
];

describe("Full wind-down (Stages 0 / 1 / 2)", () => {
    let accounts: Signer[];
    let deployer: Signer;
    let daoMultisig: Signer;
    // let deployerAddress: string;
    let alice: Signer;
    let aliceAddress: string;
    let bob: Signer;
    let bobAddress: string;
    let sleepy: Signer;
    let sleepyAddress: string;
    let treasury: Signer;
    let outsider: Signer;

    let cvx: AuraToken;
    let cvxCrv: CvxCrvToken;
    let crvDepositor: CrvDepositor;
    let voterProxy: VoterProxy;
    let booster: Booster;
    let boosterOwnerSecondary: BoosterOwnerSecondary;
    let poolFeeManagerProxy: PoolFeeManagerProxy;
    let cvxLocker: AuraLocker;

    let mocks: { votingEscrow: MockCurveVoteEscrow; crvBpt: MockBalancerPoolToken };

    // Stage 0 treasury basket.
    let usdc: ERC20;
    let weth: ERC20;
    let aave: ERC20;
    let safe: ERC20;

    let TREASURY_USDC_FUND;
    let TREASURY_WETH_FUND;
    let TREASURY_AAVE_FUND;
    let TREASURY_SAFE_FUND;

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

    let auraExpiry: BigNumber;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: BLOCK_NUMBER,
                    },
                },
            ],
        });

        accounts = await ethers.getSigners();
        deployer = accounts[0];
        alice = accounts[5];
        bob = accounts[6];
        outsider = accounts[7];
        sleepy = accounts[8];

        // deployerAddress = await deployer.getAddress();
        aliceAddress = await alice.getAddress();
        bobAddress = await bob.getAddress();
        sleepyAddress = await sleepy.getAddress();

        daoMultisig = (await impersonateAccount(mainnetConfig.multisigs.daoMultisig)).signer;

        const phase2 = await mainnetConfig.getPhase2(deployer);
        const phase6 = await mainnetConfig.getPhase6(deployer);
        const phase8 = await mainnetConfig.getPhase8(deployer);
        const phase9 = await mainnetConfig.getPhase9(deployer);
        const contracts = { ...phase2, ...phase6, ...phase8, ...phase9 };

        cvx = contracts.cvx;
        cvxCrv = contracts.cvxCrv;
        crvDepositor = contracts.crvDepositor;
        voterProxy = contracts.voterProxy;
        booster = contracts.booster;
        boosterOwnerSecondary = contracts.boosterOwnerSecondary;
        poolFeeManagerProxy = contracts.poolFeeManagerProxy;
        cvxLocker = contracts.cvxLocker;

        expect(booster.address).eq("0xA57b8d98dAE62B26Ec3bcC4a365338157060B234");

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

        usdc = ERC20__factory.connect(usdcAddress, treasury);
        weth = ERC20__factory.connect(wethAddress, treasury);
        aave = ERC20__factory.connect(stkAAVEAddress, treasury);
        safe = ERC20__factory.connect(safeAddress, treasury);

        mocks = {
            crvBpt: MockBalancerPoolToken__factory.connect(mainnetConfig.addresses.tokenBpt, treasury),
            votingEscrow: MockCurveVoteEscrow__factory.connect(mainnetConfig.addresses.votingEscrow, treasury),
        };
    });

    // ──────────────────────────────────────────────────────────────────────
    // Stage 0 — deploy redemption contracts (dao = owner), fund, finalize, redeem
    // ──────────────────────────────────────────────────────────────────────

    it("Stage 0: deploys redemption contracts (owner = dao)", async () => {
        const now = await getTimestamp();
        auraExpiry = now.add(ONE_DAY.mul(100)); // 100 days
        const windownPhase1 = await deployWindowPhase1(
            hre,
            deployer,
            mainnetConfig.multisigs,
            { cvx, cvxCrv },
            { redeemableAuraSupply: REDEEMABLE_AURA_SUPPLY },
            isDebug,
        );

        auraRedemption = windownPhase1.auraRedemption;
        rAuraRedemption = windownPhase1.rAuraRedemption;
        auraBalRedemption = windownPhase1.auraBalRedemption;

        expect(await auraRedemption.owner()).eq(mainnetConfig.multisigs.daoMultisig);
        expect(await rAuraRedemption.owner()).eq(mainnetConfig.multisigs.daoMultisig);
        expect(await auraBalRedemption.owner()).eq(mainnetConfig.multisigs.daoMultisig);
    });
    it.skip("Stage 0: treasury prepare tokens basket", async () => {
        const aaveBalanceBefore = await aave.balanceOf(TREASURY_ADDRESS);
        // AAve - starts cooldown on stkAAVE, then withdraws from Aave Safety Module after cooldown.
        const stkAave = new Contract(stkAAVEAddress, stkAAVEABI, treasury);
        await stkAave.connect(treasury).cooldown();
        await increaseTime(ONE_DAY.mul(2));
        const claimableRewards = await stkAave.stakerRewardsToClaim(TREASURY_ADDRESS);
        const stakedAmount = await stkAave.balanceOf(TREASURY_ADDRESS);
        // console.log(`Staked amount: ${ethers.utils.formatUnits(stakedAmount, 18)} AAVE`);
        // console.log(`Claimable rewards: ${ethers.utils.formatUnits(claimableRewards, 18)} AAVE`);
        await stkAave.connect(treasury).claimRewardsAndRedeem(TREASURY_ADDRESS, claimableRewards, stakedAmount);

        const aaveBalanceAfter = await aave.balanceOf(TREASURY_ADDRESS);
        expect(aaveBalanceAfter).gt(aaveBalanceBefore);
        // console.log(
        //     `Withdrew ${ethers.utils.formatUnits(aaveBalanceAfter.sub(aaveBalanceBefore), 18)} AAVE from Safety Module`,
        // );

        // Safe - claims vested tokens via the Safe's vesting module.
        const safeBalanceBefore = await safe.balanceOf(TREASURY_ADDRESS);

        const safeVested1 = new Contract(safeVested1Address, safeVestedABI, treasury);
        const safeVested2 = new Contract(safeVested2Address, safeVestedABI, treasury);
        const vestingId1 = "0x6507c8985163dd0ff7b952320987940ba2da831fdf7e494d243fa31c59fcb4c8";
        const vestingId2 = "0x191bf5dc9c156274b7d7c95898db147e1c8cfa31df91baadd245ba52470cc2c4";
        const { vestedAmount: vestedAmount1, claimedAmount: claimedAmount1 } = await safeVested1
            .connect(treasury)
            .calculateVestedAmount(vestingId1);

        await safeVested1
            .connect(treasury)
            .claimVestedTokens(vestingId1, TREASURY_ADDRESS, vestedAmount1.sub(claimedAmount1));

        const { vestedAmount: vestedAmount2, claimedAmount: claimedAmount2 } = await safeVested2
            .connect(treasury)
            .calculateVestedAmount(vestingId2);
        await safeVested2
            .connect(treasury)
            .claimVestedTokens(vestingId2, TREASURY_ADDRESS, vestedAmount2.sub(claimedAmount2));

        const safeBalanceAfter = await safe.balanceOf(TREASURY_ADDRESS);
        expect(safeBalanceAfter).gt(safeBalanceBefore);
        // console.log(
        //     `Claimed ${ethers.utils.formatUnits(safeBalanceAfter.sub(safeBalanceBefore), 18)} SAFE from vesting`,
        // );

        // TODO
        // Remove POL funds from Balancer
        // Swaps any dust to USDC or WETH
    });
    it("Stage 0: treasury funds AuraRedemption basket", async () => {
        TREASURY_USDC_FUND = await usdc.balanceOf(TREASURY_ADDRESS);
        TREASURY_WETH_FUND = await weth.balanceOf(TREASURY_ADDRESS);
        TREASURY_AAVE_FUND = await aave.balanceOf(TREASURY_ADDRESS);
        TREASURY_SAFE_FUND = await safe.balanceOf(TREASURY_ADDRESS);

        expect(TREASURY_USDC_FUND).gt(ZERO);
        expect(TREASURY_WETH_FUND).gt(ZERO);
        expect(TREASURY_AAVE_FUND).gt(ZERO);
        expect(TREASURY_SAFE_FUND).gt(ZERO);

        await usdc.connect(treasury).transfer(auraRedemption.address, TREASURY_USDC_FUND);
        await weth.connect(treasury).transfer(auraRedemption.address, TREASURY_WETH_FUND);
        await aave.connect(treasury).transfer(auraRedemption.address, TREASURY_AAVE_FUND);
        await safe.connect(treasury).transfer(auraRedemption.address, TREASURY_SAFE_FUND);
        expect(await usdc.balanceOf(auraRedemption.address)).eq(TREASURY_USDC_FUND);
        expect(await weth.balanceOf(auraRedemption.address)).eq(TREASURY_WETH_FUND);
        expect(await aave.balanceOf(auraRedemption.address)).eq(TREASURY_AAVE_FUND);
        expect(await safe.balanceOf(auraRedemption.address)).eq(TREASURY_SAFE_FUND);
    });

    it("Stage 0: treasury finalizes AuraRedemption", async () => {
        await auraRedemption.connect(daoMultisig).finalize([usdc.address, weth.address, aave.address, safe.address]);
        expect(await auraRedemption.finalized()).eq(true);
    });

    it("Stage 0: alice redeems her AURA", async () => {
        const burntAuraBefore = await cvx.balanceOf(BURN_ADDRESS);
        await cvx.connect(alice).approve(auraRedemption.address, ALICE_AURA);
        await auraRedemption.connect(alice).redeem(ALICE_AURA);

        const expectedUsdc = TREASURY_USDC_FUND.mul(ALICE_AURA).div(REDEEMABLE_AURA_SUPPLY);
        const expectedWeth = TREASURY_WETH_FUND.mul(ALICE_AURA).div(REDEEMABLE_AURA_SUPPLY);
        expect(await usdc.balanceOf(aliceAddress)).eq(expectedUsdc);
        expect(await weth.balanceOf(aliceAddress)).eq(expectedWeth);
        expect(await auraRedemption.balanceOf(aliceAddress)).eq(ALICE_AURA);
        expect(await cvx.balanceOf(BURN_ADDRESS)).eq(burntAuraBefore.add(ALICE_AURA));
    });

    it("Stage 0: bob redeems his AURA 1/2", async () => {
        const burntAuraBefore = await cvx.balanceOf(BURN_ADDRESS);
        await cvx.connect(bob).approve(auraRedemption.address, BOB_AURA.div(2));
        await auraRedemption.connect(bob).redeem(BOB_AURA.div(2));

        const expectedUsdc = TREASURY_USDC_FUND.mul(BOB_AURA.div(2)).div(REDEEMABLE_AURA_SUPPLY);
        expect(await usdc.balanceOf(bobAddress)).eq(expectedUsdc);
        expect(await auraRedemption.balanceOf(bobAddress)).eq(BOB_AURA.div(2));
        expect(await cvx.balanceOf(BURN_ADDRESS)).eq(burntAuraBefore.add(BOB_AURA.div(2)));
    });
    it("Stage 0: bob redeems his AURA 2/2", async () => {
        const burntAuraBefore = await cvx.balanceOf(BURN_ADDRESS);
        await cvx.connect(bob).approve(auraRedemption.address, BOB_AURA.div(2));
        await auraRedemption.connect(bob).redeem(BOB_AURA.div(2));

        const expectedUsdc = TREASURY_USDC_FUND.mul(BOB_AURA).div(REDEEMABLE_AURA_SUPPLY).sub(1);
        expect(await usdc.balanceOf(bobAddress)).eq(expectedUsdc);
        expect(await auraRedemption.balanceOf(bobAddress)).eq(BOB_AURA);
        expect(await cvx.balanceOf(BURN_ADDRESS)).eq(burntAuraBefore.add(BOB_AURA.div(2)));
    });
    it("Stage 0: sleepy redeems his AURA 1/2", async () => {
        const burntAuraBefore = await cvx.balanceOf(BURN_ADDRESS);
        await cvx.connect(sleepy).approve(auraRedemption.address, SLEEPY_AURA.div(2));
        await auraRedemption.connect(sleepy).redeem(SLEEPY_AURA.div(2));

        const expectedUsdc = TREASURY_USDC_FUND.mul(SLEEPY_AURA.div(2)).div(REDEEMABLE_AURA_SUPPLY);
        expect(await usdc.balanceOf(sleepyAddress)).eq(expectedUsdc);
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
            const pooolInfo = await booster.poolInfo(i);
            if (pooolInfo.shutdown == true) continue;
            await poolFeeManagerProxy.connect(daoMultisig).shutdownPool(i);
        }
        await poolFeeManagerProxy.connect(daoMultisig).shutdownSystem();

        await boosterOwnerSecondary.connect(daoMultisig).shutdownSystem();

        expect(await booster.isShutdown()).eq(true);
    });
    it("Stage 1: shuts down aura locker", async () => {
        // Given a user locks aura before shutdown
        const auraBalanceBefore = await cvx.balanceOf(sleepyAddress);
        expect(auraBalanceBefore).gt(ZERO);

        // Lock for two weeks to test that the user can process expired locks immediately after shutdown (no time-lock after shutdown)
        await cvx.connect(sleepy).approve(cvxLocker.address, SLEEPY_AURA);
        await cvxLocker.connect(sleepy).lock(sleepyAddress, SLEEPY_AURA.div(2));

        await increaseTime(ONE_DAY.mul(7));

        await cvxLocker.connect(sleepy).lock(sleepyAddress, SLEEPY_AURA.div(2));

        const auraBalanceAfter = await cvx.balanceOf(sleepyAddress);

        expect(auraBalanceAfter).eq(auraBalanceBefore.sub(SLEEPY_AURA));

        // When the aura locker is shut down
        await cvxLocker.connect(daoMultisig).shutdown();
        expect(await cvxLocker.isShutdown()).eq(true);

        // Then the user should be able to process expired locks immediately and get their tokens back (no time-lock after shutdown)
        await cvxLocker.connect(sleepy).processExpiredLocks(false);

        expect(await cvx.balanceOf(sleepyAddress)).eq(auraBalanceBefore);

        // And new locks should be disallowed
        await cvx.connect(sleepy).approve(cvxLocker.address, SLEEPY_AURA);
        await expect(cvxLocker.connect(sleepy).lock(sleepyAddress, SLEEPY_AURA)).to.revertedWith("shutdown");
        expect(await cvx.balanceOf(sleepyAddress)).eq(auraBalanceBefore);
    });
    it("Stage 1: deploys WindDownCoordinator (daoMultisig = owner)", async () => {
        const windownPhase2 = await deployWindowPhase2(
            hre,
            deployer,
            mainnetConfig.addresses,
            mainnetConfig.multisigs,
            { auraRedemption, rAuraRedemption, auraBalRedemption, voterProxy },
            isDebug,
        );
        coordinator = windownPhase2.coordinator;

        expect(await coordinator.owner()).eq(await daoMultisig.getAddress());
        expect(await coordinator.voterProxy()).eq(voterProxy.address);
        expect(await coordinator.auraBalBps()).eq(AURABAL_BPS);
        expect(await coordinator.stage()).eq(0); // UNSTARTED
    });

    it("Stage 1: daoMultisig transfers redemption-contract ownership to coordinator", async () => {
        await auraRedemption.connect(daoMultisig).setOwner(coordinator.address);
        await rAuraRedemption.connect(daoMultisig).setOwner(coordinator.address);
        await auraBalRedemption.connect(daoMultisig).setOwner(coordinator.address);

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
            await poolFeeManagerProxy.connect(daoMultisig).setRewardMultiplier(addr, 0);
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
        await expect(coordinator.connect(daoMultisig).splitAndFinalize()).to.revertedWith("!stage");
    });

    it("Stage 2: warps past AuraRedemption.expiry and the veBAL unlock", async () => {
        const locked = await mocks.votingEscrow.locked(voterProxy.address);
        const unlockTime = locked[1];
        const target = unlockTime.gt(auraExpiry) ? unlockTime : auraExpiry;
        await increaseTimeTo(target.add(1));
    });

    it("Stage 2: coordinator.unlockAndWithdraw pulls BPT out of the escrow (permissionless)", async () => {
        const locked = await mocks.votingEscrow.locked(voterProxy.address);
        // console.log(
        //     `Locked BPT: ${ethers.utils.formatUnits(locked[0], 18)}, unlock time: ${new Date(
        //         locked[1].toNumber() * 1000,
        //     ).toISOString()}`,
        // );
        const lockedAmount = locked[0];
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

    it("Stage 2: daoMultisig calls splitAndFinalize — sweeps residuals, splits BPT 90/10, finalizes B and C", async () => {
        const residualUsdc = await usdc.balanceOf(auraRedemption.address);
        const residualWeth = await weth.balanceOf(auraRedemption.address);
        expect(residualUsdc).gt(ZERO);
        expect(residualWeth).gt(ZERO);

        const totalBpt = await mocks.crvBpt.balanceOf(coordinator.address);
        const expectedAuraBalShare = totalBpt.mul(AURABAL_BPS).div(BPS_DENOMINATOR);
        const expectedRAuraShare = totalBpt.sub(expectedAuraBalShare);

        const tx = await coordinator.connect(daoMultisig).splitAndFinalize();

        // Residuals flowed from A into B.
        expect(await usdc.balanceOf(auraRedemption.address)).eq(ZERO);
        expect(await weth.balanceOf(auraRedemption.address)).eq(ZERO);
        expect(await usdc.balanceOf(rAuraRedemption.address)).eq(residualUsdc);
        expect(await weth.balanceOf(rAuraRedemption.address)).eq(residualWeth);

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
        expect(await rAuraRedemption.redeemableTokenAllocation(usdc.address)).eq(residualUsdc);
        expect(await rAuraRedemption.redeemableTokenAllocation(weth.address)).eq(residualWeth);
        expect(await auraBalRedemption.redeemableTokenAllocation(mocks.crvBpt.address)).eq(expectedAuraBalShare);

        expect(await coordinator.stage()).eq(2); // FINALIZED

        await expect(tx).to.emit(rAuraRedemption, "Finalized");
        await expect(tx).to.emit(auraBalRedemption, "Finalized");
        await expect(tx).to.emit(coordinator, "SplitAndFinalized");
    });

    it("Stage 2: cannot splitAndFinalize twice", async () => {
        await expect(coordinator.connect(daoMultisig).splitAndFinalize()).to.revertedWith("!stage");
    });

    it("Stage 2: alice redeems rAURA for her slice of BPT + residuals", async () => {
        const aliceRaura = await auraRedemption.balanceOf(aliceAddress);
        const rauraSupply = await rAuraRedemption.REDEEMABLE_RAURA_SUPPLY();

        const bptAlloc = await rAuraRedemption.redeemableTokenAllocation(mocks.crvBpt.address);
        const usdcAlloc = await rAuraRedemption.redeemableTokenAllocation(usdc.address);
        const wethAlloc = await rAuraRedemption.redeemableTokenAllocation(weth.address);

        const expBpt = bptAlloc.mul(aliceRaura).div(rauraSupply);
        const expUsdc = usdcAlloc.mul(aliceRaura).div(rauraSupply);
        const expWeth = wethAlloc.mul(aliceRaura).div(rauraSupply);

        await auraRedemption.connect(alice).approve(rAuraRedemption.address, aliceRaura);
        await rAuraRedemption.connect(alice).redeem(aliceRaura);

        expect(await mocks.crvBpt.balanceOf(aliceAddress)).eq(expBpt);
        expect(
            (await usdc.balanceOf(aliceAddress)).sub(TREASURY_USDC_FUND.mul(ALICE_AURA).div(REDEEMABLE_AURA_SUPPLY)),
        ).eq(expUsdc);
        expect(
            (await weth.balanceOf(aliceAddress)).sub(TREASURY_WETH_FUND.mul(ALICE_AURA).div(REDEEMABLE_AURA_SUPPLY)),
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
