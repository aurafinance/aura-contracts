import { Provider } from "@ethersproject/providers";
import { Signer } from "ethers";
import {
    SidechainPhase1Deployed,
    SidechainPhase2Deployed,
    SidechainViewDeployed,
    SidechainPhase3Deployed,
    SidechainPhase4Deployed,
} from "scripts/deploySidechain";

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
    balancerVault?: string;
    gauges?: string[];
    gatewayRouter?: string;
}

export interface SidechainMultisigConfig {
    daoMultisig: string;
    pauseGuardian: string;
    defender?: string;
}

export interface SidechainBridging {
    l1Receiver: string;
    l2Sender: string;
    nativeBridge: string;
}

export type SidechainPhaseDeployed = SidechainPhase1Deployed & SidechainPhase2Deployed & SidechainPhase3Deployed& SidechainPhase4Deployed;

export interface SidechainConfig {
    chainId: number;
    whales?: { [key: string]: string };
    multisigs: SidechainMultisigConfig;
    naming: SidechainNaming;
    extConfig: ExtSidechainConfig;
    bridging: SidechainBridging;
    getSidechain?: (s: Signer|Provider) => SidechainPhaseDeployed;
    getView?: (s: Signer) => SidechainViewDeployed;
}
