import { Signer } from "ethers";
import { SidechainDeployed } from "scripts/deploySidechain";

export interface SidechainNaming {
    auraOftName: string;
    auraOftSymbol: string;
    auraBalOftName: string;
    auraBalOftSymbol: string;
    tokenFactoryNamePostfix: string;
}

export interface ExtSidechainConfig {
    token: string;
    minter: string;
    canonicalChainId: number;
    lzEndpoint: string;
    create2Factory: string;
    gauge?: string;
}

export interface SidechainMultisigConfig {
    daoMultisig: string;
    pauseGaurdian: string;
}

export interface SidechainBridging {
    l1Receiver: string;
    l2Sender: string;
    nativeBridge: string;
}

export interface SidechainConfig {
    chainId: number;
    multisigs: SidechainMultisigConfig;
    naming: SidechainNaming;
    extConfig: ExtSidechainConfig;
    bridging: SidechainBridging;
    getSidechain?: (s: Signer) => SidechainDeployed;
}
