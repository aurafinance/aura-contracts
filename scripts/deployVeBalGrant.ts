import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { VeBalGrant, VeBalGrant__factory } from "../types";
import { deployContract } from "../tasks/utils";
import { config } from "../tasks/deploy/mainnet-config";

export async function deployVeBalGrant(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
) {
    const { addresses, multisigs } = config;
    const phase6 = await config.getPhase6(signer);

    let bribeMarket = "0x7Cdf753b45AB0729bcFe33DC12401E55d28308A9";

    const veBalGrant = await deployContract<VeBalGrant>(
        hre,
        new VeBalGrant__factory(signer),
        "VeBalGrant",
        [addresses.token],
        {},
        debug,
        waitForBlocks,
    );

    return {
        veBalGrant,
    };
}
