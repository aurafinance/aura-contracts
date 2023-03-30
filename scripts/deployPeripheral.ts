import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { AuraBalStaker, AuraBalStaker__factory, AuraBalVault, CvxCrvToken } from "../types";
import { deployContract } from "../tasks/utils";

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
