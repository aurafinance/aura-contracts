import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { AuraClaimZapV2, AuraClaimZapV2__factory } from "../types";
import { deployContract, waitForTx } from "../tasks/utils";
import { DEAD_ADDRESS } from "../test-utils/constants";
import { config } from "../tasks/deploy/mainnet-config";

import { ExtSystemConfig, MultisigConfig, Phase2Deployed, Phase4Deployed, Phase6Deployed } from "./deploySystem";

interface DeployConfig {
    addresses: ExtSystemConfig;
    multisigs: MultisigConfig;
    getPhase2: (deployer: Signer) => Promise<Phase2Deployed>;
    getPhase4: (deployer: Signer) => Promise<Phase4Deployed>;
    getPhase6: (deployer: Signer) => Promise<Phase6Deployed>;
}

export async function deployAuraClaimZapV2(
    config: DeployConfig,
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    vault: string,
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
            vault,
        ],
        {},
        debug,
        waitForBlocks,
    );

    let tx = await claimZapV2.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);

    return {
        claimZapV2,
    };
}
