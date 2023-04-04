import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    AuraBalStaker,
    AuraBalStaker__factory,
    AuraBalVault,
    CvxCrvToken,
    FeeScheduler,
    FeeScheduler__factory,
} from "../types";
import { deployContract } from "../tasks/utils";
import { config } from "../tasks/deploy/mainnet-config";

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
