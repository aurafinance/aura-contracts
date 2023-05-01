import { chainIds } from "../../tasks/utils";
import { config as goerliConfig } from "./goerli-config";
import { config as goerliSidechainConfig } from "./goerliSidechain-config";
import { SidechainNaming } from "../../types/sidechain-types";

export const sideChains = [
    chainIds.arbitrum,
    chainIds.arbitrumGoerli,
    chainIds.polygon,
    // Goerli is just use as a sidechain for testing
    chainIds.goerli,
];

export const canonicalChains = [chainIds.goerli, chainIds.mainnet];

export const remoteChainMap = {
    [chainIds.goerli]: chainIds.arbitrumGoerli,
    [chainIds.arbitrum]: chainIds.mainnet,
    [chainIds.arbitrumGoerli]: chainIds.goerli,
    [chainIds.polygon]: chainIds.mainnet,
};

export const lzChainIds = {
    [chainIds.mainnet]: 101,
    [chainIds.arbitrum]: 110,
    [chainIds.goerli]: 10121,
    [chainIds.arbitrumGoerli]: 10143,
};

export const canonicalConfigs = {
    [chainIds.goerli]: goerliConfig,
};

export const sidechainConfigs = {
    [chainIds.goerli]: goerliSidechainConfig,
};

export const sidechainNaming: SidechainNaming = {
    auraOftName: "Aura",
    auraOftSymbol: "AURA",
    auraBalOftName: "Aura BAL",
    auraBalOftSymbol: "auraBAL",
    tokenFactoryNamePostfix: " Aura Deposit",
};
