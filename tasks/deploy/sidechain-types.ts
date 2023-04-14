import { Signer } from "ethers";
import { SidechainDeployed } from "scripts/deploySidechain";

export interface SidechainAddresses {
    lzEndpoint: string;
    token: string;
    daoMultisig: string;
    minter: string;
    create2Factory: string;
}

export interface SidechainNaming {
    coordinatorName: string;
    coordinatorSymbol: string;
    tokenFactoryNamePostfix: string;
}

export interface ExtSidechainConfig {
    canonicalChainId: number;
}

export interface SidechainConfig {
    addresses: SidechainAddresses;
    naming: SidechainNaming;
    extConfig: ExtSidechainConfig;
    getSidechain?: (s: Signer) => SidechainDeployed;
}
