import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { AuraClaimZapV2, AuraClaimZapV2__factory } from "../types";
import { deployContract, waitForTx } from "../tasks/utils";
import { DEAD_ADDRESS } from "../test-utils/constants";
import { config } from "../tasks/deploy/mainnet-config";

export async function deployAuraClaimZapV2(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
) {
    const phase2 = await config.getPhase2(signer);
    const phase4 = await config.getPhase4(signer);
    const phase6 = await config.getPhase6(signer);
    const { addresses } = config;
    const claimZapV2 = await deployContract<AuraClaimZapV2>(
        hre,
        new AuraClaimZapV2__factory(signer),
        "AuraClaimZapV2",
        [
            addresses.token,
            phase2.cvx.address,
            phase2.cvxCrv.address,
            phase4.crvDepositorWrapper.address,
            phase6.cvxCrvRewards.address,
            phase4.cvxLocker.address,
            DEAD_ADDRESS, //TODO: swap for an actual address of a compoundoor
        ],
        {},
        debug,
        waitForBlocks,
    );

    return {
        claimZapV2,
    };
}
