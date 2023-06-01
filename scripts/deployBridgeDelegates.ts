import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    BridgeDelegateReceiver,
    BridgeDelegateReceiver__factory,
    BridgeDelegateSender,
    GnosisBridgeSender,
    GnosisBridgeSender__factory,
    SimpleBridgeDelegateSender,
    SimpleBridgeDelegateSender__factory,
} from "../types";
import { deployContract } from "../tasks/utils";
import { ExtSystemConfig } from "./deploySystem";
import { CanonicalPhase1Deployed } from "./deploySidechain";

export interface SimplyBridgeDelegateDeployed {
    bridgeDelegateSender: BridgeDelegateSender;
    bridgeDelegateReceiver: BridgeDelegateReceiver;
}

export async function deploySimpleBridgeSender(
    hre: HardhatRuntimeEnvironment,
    config: ExtSystemConfig,
    deployer: Signer,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<{ bridgeDelegateSender: SimpleBridgeDelegateSender }> {
    const bridgeDelegateSender = await deployContract<SimpleBridgeDelegateSender>(
        hre,
        new SimpleBridgeDelegateSender__factory(deployer),
        "SimpleBridgeDelegateSender",
        [config.token],
        {},
        debug,
        waitForBlocks,
    );

    return { bridgeDelegateSender };
}

export async function deploySimpleBridgeReceiver(
    hre: HardhatRuntimeEnvironment,
    canonical: CanonicalPhase1Deployed,
    srcChainId: number,
    deployer: Signer,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<{ bridgeDelegateReceiver: BridgeDelegateReceiver }> {
    const bridgeDelegateReceiver = await deployContract<BridgeDelegateReceiver>(
        hre,
        new BridgeDelegateReceiver__factory(deployer),
        "BridgeDelegateReceiver",
        [canonical.l1Coordinator.address, srcChainId],
        {},
        debug,
        waitForBlocks,
    );

    return { bridgeDelegateReceiver };
}

/**
 * Deploy simple bridge delegate used for testing
 */
export async function deploySimpleBridgeDelegates(
    hre: HardhatRuntimeEnvironment,
    config: ExtSystemConfig,
    canonical: CanonicalPhase1Deployed,
    srcChainId: number,
    deployer: Signer,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<SimplyBridgeDelegateDeployed> {
    const { bridgeDelegateSender } = await deploySimpleBridgeSender(hre, config, deployer, debug, waitForBlocks);
    const { bridgeDelegateReceiver } = await deploySimpleBridgeReceiver(
        hre,
        canonical,
        srcChainId,
        deployer,
        debug,
        waitForBlocks,
    );

    return { bridgeDelegateSender, bridgeDelegateReceiver };
}

export async function deployGnosisBridgeSender(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    bridge: string,
    token: string,
    debug = false,
    waitForBlocks = 0,
): Promise<GnosisBridgeSender> {
    const bridgeDelegate = await deployContract<GnosisBridgeSender>(
        hre,
        new GnosisBridgeSender__factory(deployer),
        "GnosisBridgeSender",
        [bridge, token],
        {},
        debug,
        waitForBlocks,
    );
    return bridgeDelegate;
}
