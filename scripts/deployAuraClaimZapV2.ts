import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { AuraClaimZapV2, AuraClaimZapV2__factory } from "../types";
import { deployContract, waitForTx } from "../tasks/utils";
import { config } from "../tasks/deploy/mainnet-config";

export async function deployAuraClaimZapV2(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
) {
    const phase2 = await config.getPhase2(signer);
    const { addresses } = config;

    const claimZapV2 = await deployContract<AuraClaimZapV2>(
        hre,
        new AuraClaimZapV2__factory(signer),
        "AuraClaimZapV2",
        [
            addresses.token,
            phase2.cvx.address,
            phase2.cvxCrv.address,
            phase2.crvDepositorWrapper.address,
            phase2.cvxCrvRewards.address,
            phase2.cvxLocker.address,
        ],
        {},
        debug,
        waitForBlocks,
    );

    return {
        claimZapV2,
    };
}
