import { Signer } from "ethers";
import { SidechainDeployed } from "scripts/deploySidechain";

export interface SidechainNaming {
    coordinatorName: string;
    coordinatorSymbol: string;
    tokenFactoryNamePostfix: string;
}

export interface ExtSidechainConfig {
    token: string;
    tokenBpt: string;
    minter: string;
    canonicalChainId: number;
    sidechainLzChainId: number;
    lzEndpoint: string;
    create2Factory: string;
    // phase 2
    gauge?: string;
}

export interface SidechainMultisigConfig {
    daoMultisig: string;
}

export interface SidechainConfig {
    chainId: number,
    multisigs: SidechainMultisigConfig;
    naming: SidechainNaming;
    extConfig: ExtSidechainConfig;
    getSidechain?: (s: Signer) => SidechainDeployed;
}
