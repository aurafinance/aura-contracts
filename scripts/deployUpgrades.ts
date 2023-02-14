import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
    BoosterOwnerSecondary,
    BoosterOwnerSecondary__factory,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    PoolManagerV4,
    PoolManagerV4__factory,
} from "../types";
import { deployContract } from "../tasks/utils";
import { config } from "../tasks/deploy/mainnet-config";

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

    const poolManagerV4 = await deployContract<PoolManagerV4>(
        hre,
        new PoolManagerV4__factory(signer),
        "PoolManagerV4",
        [phase6.poolManagerSecondaryProxy.address, multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );

    const boosterOwnerSecondary = await deployContract<BoosterOwnerSecondary>(
        hre,
        new BoosterOwnerSecondary__factory(signer),
        "BoosterOwnerSecondary",
        [multisigs.daoMultisig, phase6.boosterOwner.address, phase6.booster.address],
        {},
        debug,
        waitForBlocks,
    );

    return {
        extraRewardStashV3,
        boosterOwnerSecondary,
        poolManagerV4,
    };
}
