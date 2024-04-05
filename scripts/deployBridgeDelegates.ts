import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    ArbitrumBridgeSender,
    ArbitrumBridgeSender__factory,
    BridgeDelegateReceiver,
    BridgeDelegateReceiver__factory,
    BridgeDelegateSender,
    GnosisBridgeSender,
    GnosisBridgeSender__factory,
    OptimismBridgeSender,
    OptimismBridgeSender__factory,
    PolygonBridgeSender,
    PolygonBridgeSender__factory,
    SidechainConfig,
    SimpleBridgeDelegateSender,
    SimpleBridgeDelegateSender__factory,
    ZkevmBridgeSender,
    ZkevmBridgeSender__factory,
    OftWithFeeBridgeSender__factory,
    OftWithFeeBridgeSender,
} from "../types";
import { deployContract } from "../tasks/utils";
import { CanonicalPhase1Deployed } from "./deploySidechain";

export interface SimplyBridgeDelegateDeployed {
    bridgeDelegateSender: BridgeDelegateSender;
    bridgeDelegateReceiver: BridgeDelegateReceiver;
}

export async function deploySimpleBridgeSender(
    hre: HardhatRuntimeEnvironment,
    config: SidechainConfig,
    deployer: Signer,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<{ bridgeDelegateSender: SimpleBridgeDelegateSender }> {
    const bridgeDelegateSender = await deployContract<SimpleBridgeDelegateSender>(
        hre,
        new SimpleBridgeDelegateSender__factory(deployer),
        "SimpleBridgeDelegateSender",
        [config.extConfig.token],
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

export async function deployPolygonBridgeSender(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    token: string,
    debug = false,
    waitForBlocks = 0,
): Promise<PolygonBridgeSender> {
    const bridgeDelegate = await deployContract<PolygonBridgeSender>(
        hre,
        new PolygonBridgeSender__factory(deployer),
        "PolygonBridgeSender",
        [token],
        {},
        debug,
        waitForBlocks,
    );
    return bridgeDelegate;
}

export async function deployArbitrumBridgeSender(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    gatewayRouter: string,
    token: string,
    l1Token: string,
    debug = false,
    waitForBlocks = 0,
): Promise<ArbitrumBridgeSender> {
    const bridgeDelegate = await deployContract<ArbitrumBridgeSender>(
        hre,
        new ArbitrumBridgeSender__factory(deployer),
        "ArbitrumBridgeSender",
        [gatewayRouter, token, l1Token],
        {},
        debug,
        waitForBlocks,
    );

    return bridgeDelegate;
}

export async function deployOptimismBridgeSender(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    standardBridge: string,
    token: string,
    l1Token: string,
    debug = false,
    waitForBlocks = 0,
): Promise<OptimismBridgeSender> {
    const bridgeDelegate = await deployContract<OptimismBridgeSender>(
        hre,
        new OptimismBridgeSender__factory(deployer),
        "OptimismBridgeSender",
        [standardBridge, token, l1Token],
        {},
        debug,
        waitForBlocks,
    );

    return bridgeDelegate;
}

export async function deployZkevmBridgeSender(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    standardBridge: string,
    token: string,
    debug = false,
    waitForBlocks = 0,
): Promise<ZkevmBridgeSender> {
    const bridgeDelegate = await deployContract<ZkevmBridgeSender>(
        hre,
        new ZkevmBridgeSender__factory(deployer),
        "ZkevmBridgeSender",
        [standardBridge, token],
        {},
        debug,
        waitForBlocks,
    );

    return bridgeDelegate;
}

export async function deployOftWithFeeBridgeSender(
    hre: HardhatRuntimeEnvironment,
    config: SidechainConfig,
    deployer: Signer,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<{ bridgeDelegateSender: OftWithFeeBridgeSender }> {
    const bridgeDelegateSender = await deployContract<OftWithFeeBridgeSender>(
        hre,
        new OftWithFeeBridgeSender__factory(deployer),
        "OftBridgeDelegateSender",
        [config.extConfig.token, config.extConfig.canonicalChainId],
        {},
        debug,
        waitForBlocks,
    );

    return { bridgeDelegateSender };
}
