import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { config } from "../tasks/deploy/mainnet-config";
import { deployContract } from "../tasks/utils";
import {
    AuraBalStaker,
    AuraBalStaker__factory,
    AuraBalVault,
    CvxCrvToken,
    ExtraRewardStashScheduler,
    ExtraRewardStashScheduler__factory,
    FeeScheduler,
    FeeScheduler__factory,
    VeBalGrant,
    VeBalGrant__factory,
} from "../types";
import { ExtSystemConfig } from "./deploySystem";

export async function deployAuraBalStaker(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    vault: AuraBalVault,
    auraBal: CvxCrvToken,
    debug = false,
    waitForBlocks = 0,
) {
    return deployContract<AuraBalStaker>(
        hre,
        new AuraBalStaker__factory(signer),
        "AuraBalStaker",
        [vault.address, auraBal.address],
        {},
        debug,
        waitForBlocks,
    );
}

export async function deployFeeScheduler(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
) {
    const results = await config.getAuraBalVault(signer);

    const feeScheduler = await deployContract<FeeScheduler>(
        hre,
        new FeeScheduler__factory(signer),
        "FeeScheduler",
        [config.multisigs.daoMultisig, results.strategy.address, config.addresses.token],
        {},
        debug,
        waitForBlocks,
    );

    return { feeScheduler };
}

export async function deployVeBalGrant(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    extSystem: ExtSystemConfig,
    project: string,
    balancer: string,
    debug = false,
    waitForBlocks = 0,
) {
    const veBalGrant = await deployContract<VeBalGrant>(
        hre,
        new VeBalGrant__factory(signer),
        "VeBalGrant",
        [
            extSystem.weth,
            extSystem.token,
            extSystem.tokenBpt,
            extSystem.votingEscrow,
            extSystem.gaugeController,
            project,
            balancer,
            extSystem.balancerVault,
            extSystem.balancerPoolId,
        ],
        {},
        debug,
        waitForBlocks,
    );

    return {
        veBalGrant,
    };
}
export async function deployExtraRewardStashScheduler(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
) {
    const phase2 = await config.getPhase2(signer);
    const extraRewardStashScheduler = await deployContract<ExtraRewardStashScheduler>(
        hre,
        new ExtraRewardStashScheduler__factory(signer),
        "ExtraRewardStashScheduler",
        [phase2.cvx.address],
        {},
        debug,
        waitForBlocks,
    );
    return { extraRewardStashScheduler };
}
