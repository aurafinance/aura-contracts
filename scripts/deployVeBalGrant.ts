import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { VeBalGrant, VeBalGrant__factory } from "../types";
import { deployContract } from "../tasks/utils";
import { config } from "../tasks/deploy/mainnet-config";

export async function deployVeBalGrant(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    project: string,
    balancer: string,
    debug = false,
    waitForBlocks = 0,
) {
    const { addresses, multisigs } = config;

    const veBalGrant = await deployContract<VeBalGrant>(
        hre,
        new VeBalGrant__factory(signer),
        "VeBalGrant",
        [
            addresses.weth,
            addresses.token,
            addresses.tokenBpt,
            addresses.votingEscrow,
            addresses.gaugeController,
            project,
            balancer,
            addresses.balancerVault,
            addresses.balancerPoolId,
        ],
        {},
        debug,
        waitForBlocks,
    );

    return {
        veBalGrant,
    };
}
