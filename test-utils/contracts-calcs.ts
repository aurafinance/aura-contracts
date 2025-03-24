import { BigNumber } from "ethers";
import { simpleToExactAmount } from "./math";
import { ZERO } from "./constants";
import { AuraToken, Booster, L1Coordinator } from "types";

export const immutables = {
    cvx: {
        EMISSIONS_MAX_SUPPLY: simpleToExactAmount(5, 25),
        INIT_MINT_AMOUNT: simpleToExactAmount(5, 25),
    },
    booster: {
        REWARD_MULTIPLIER_DENOMINATOR: 10000,
        FEE_DENOMINATOR: 10000,
    },
    l1Coordinator: {
        REWARD_MULTIPLIER_DENOMINATOR: 10000,
    },
};

/**
 * Converts a given amount of CRV to CVX based on the current emissions and cliffs.
 *
 * @param cvx - The CVX contract instance.
 * @param crvAmount - The amount of CRV to convert.
 * @returns A promise that resolves to the amount of CVX that can be minted from the given CRV amount.
 *
 * The conversion is based on the current emissions and the total number of cliffs.
 * If the current cliff is less than the total number of cliffs, the function calculates
 * the reduction and the amount of CVX that can be minted. If the calculated amount exceeds
 * the maximum supply, it returns the maximum possible amount.
 *
 * @dev Calculates the amount of cvx auraToken.mint(balAmount) will mint
 */
export async function convertCrvToCvx(cvx: AuraToken, crvAmount: BigNumber) {
    const minterMinted = 0;
    const totalCliffs = BigNumber.from(500);
    const { EMISSIONS_MAX_SUPPLY, INIT_MINT_AMOUNT } = immutables.cvx;
    const reductionPerCliff = EMISSIONS_MAX_SUPPLY.div(totalCliffs);

    const emissionsMinted = (await cvx.totalSupply()).sub(INIT_MINT_AMOUNT).sub(minterMinted);
    const cliff = emissionsMinted.div(reductionPerCliff);

    // e.g. 100 < 500
    if (cliff.lt(totalCliffs)) {
        const reduction = totalCliffs.sub(cliff).mul(5).div(2).add(700);
        let amount = crvAmount.mul(reduction).div(totalCliffs);
        const amtTillMax = EMISSIONS_MAX_SUPPLY.sub(emissionsMinted);
        if (amount > amtTillMax) {
            amount = amtTillMax;
        }
        return amount;
    }
    return ZERO;
}

/**
 * Calculates the distribution of L2 fees for the booster.
 *
 * @param {Booster} booster - The booster contract instance.
 * @param {BigNumber} feeDebt - The total fee debt to be distributed.
 * @returns {Promise<{cvxEligibleForMint: BigNumber, crvLockIncentive: BigNumber, crvStakerIncentive: BigNumber}>}
 * An object containing the following properties:
 * - `cvxEligibleForMint`: The amount of CVX eligible for minting.
 * - `crvLockIncentive`: The amount of CRV allocated as lock incentive.
 * - `crvStakerIncentive`: The amount of CRV allocated as staker incentive.
 */
export async function boosterQueryDistributeL2Fees(
    contracts: { cvx: AuraToken; booster: Booster },
    feeDebt: BigNumber,
): Promise<{
    crvEligibleForMint: BigNumber;
    crvLockIncentive: BigNumber;
    crvStakerIncentive: BigNumber;
    cvxMinted: BigNumber;
}> {
    // Calculate aura to be sent to treasury
    const { FEE_DENOMINATOR, REWARD_MULTIPLIER_DENOMINATOR } = immutables.booster;
    const { cvx, booster } = contracts;

    const lockIncentive = await booster.lockIncentive();
    const stakerIncentive = await booster.stakerIncentive();
    const totalIncentives = lockIncentive.add(stakerIncentive);
    const totalFarmed = feeDebt.mul(FEE_DENOMINATOR).div(totalIncentives);
    const crvEligibleForMint = totalFarmed.sub(feeDebt);

    const crvLockIncentive = feeDebt.mul(lockIncentive).div(totalIncentives);
    const crvStakerIncentive = feeDebt.sub(crvLockIncentive);
    const cvxMinted = await convertCrvToCvx(cvx, crvEligibleForMint);

    return { crvEligibleForMint, crvLockIncentive, crvStakerIncentive, cvxMinted };
}

export async function l1CoordinatorQueryDistributeAura(
    contracts: { l1Coordinator: L1Coordinator; booster: Booster; cvx: AuraToken },
    feeDebt: BigNumber,
) {
    const { REWARD_MULTIPLIER_DENOMINATOR } = immutables.l1Coordinator;
    const { l1Coordinator, booster, cvx } = contracts;

    const { cvxMinted } = await boosterQueryDistributeL2Fees({ booster, cvx }, feeDebt);
    const rewardMultiplier = await l1Coordinator.rewardMultiplier();
    const auraRewardAmount = cvxMinted.mul(rewardMultiplier).div(REWARD_MULTIPLIER_DENOMINATOR);
    const auraTreasuryAmount = cvxMinted.sub(auraRewardAmount);
    return { auraRewardAmount, auraTreasuryAmount };
}
