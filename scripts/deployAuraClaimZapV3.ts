import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { AuraClaimZapV3, AuraClaimZapV3__factory } from "../types";
import { deployContract, waitForTx } from "../tasks/utils";

import { ExtSystemConfig, MultisigConfig, Phase2Deployed, Phase4Deployed, Phase6Deployed } from "./deploySystem";

interface DeployConfig {
    addresses: ExtSystemConfig;
    multisigs: MultisigConfig;
    getPhase2: (deployer: Signer) => Promise<Phase2Deployed>;
    getPhase4: (deployer: Signer) => Promise<Phase4Deployed>;
    getPhase6: (deployer: Signer) => Promise<Phase6Deployed>;
}
async function deployAuraClaimZapVN(
    config: DeployConfig,
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    contractsOverride: { [key: string]: string },
    debug = false,
    waitForBlocks = 0,
) {
    const phase2 = await config.getPhase2(signer);
    const phase4 = await config.getPhase4(signer);
    const phase6 = await config.getPhase6(signer);
    const { addresses } = config;
    const claimZapV3 = await deployContract<AuraClaimZapV3>(
        hre,
        new AuraClaimZapV3__factory(signer),
        "AuraClaimZapV3",
        [
            addresses.token,
            phase2.cvx.address,
            phase2.cvxCrv.address,
            contractsOverride.crvDepositorWrapper ?? phase4.crvDepositorWrapper.address,
            phase6.cvxCrvRewards.address,
            phase4.cvxLocker.address,
            contractsOverride.vault,
        ],
        {},
        debug,
        waitForBlocks,
    );

    const tx = await claimZapV3.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);

    return {
        claimZapV3,
    };
}

export async function deployAuraClaimZapV3(
    config: DeployConfig,
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    vault: string,
    debug = false,
    waitForBlocks = 0,
) {
    return deployAuraClaimZapVN(config, hre, signer, { vault }, debug, waitForBlocks);
}

export async function deployAuraClaimZapV3Swapper(
    config: DeployConfig,
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    contractsOverride: { vault: string; crvDepositorWrapper: string },
    debug = false,
    waitForBlocks = 0,
) {
    return deployAuraClaimZapVN(config, hre, signer, contractsOverride, debug, waitForBlocks);
}
