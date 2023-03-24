import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { VeBalGrant, VeBalGrant__factory } from "../types";
import { deployContract } from "../tasks/utils";
import { ExtSystemConfig } from "./deploySystem";

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
