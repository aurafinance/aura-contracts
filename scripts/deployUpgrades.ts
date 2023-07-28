import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { config } from "../tasks/deploy/mainnet-config";
import { deployContract } from "../tasks/utils";
import { ExtraRewardStashV3, ExtraRewardStashV3__factory } from "../types";
import { deployPhase8 } from "./deploySystem";

export async function deployUpgrade01(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
) {
    const { addresses, multisigs } = config;
    const phase6 = await config.getPhase6(signer);

    const extraRewardStashV3 = await deployContract<ExtraRewardStashV3>(
        hre,
        new ExtraRewardStashV3__factory(signer),
        "ExtraRewardStashV3",
        [addresses.token],
        {},
        debug,
        waitForBlocks,
    );

    const phase8 = await deployPhase8(hre, signer, phase6, multisigs, debug, waitForBlocks);
    return {
        extraRewardStashV3,
        ...phase8,
    };
}
