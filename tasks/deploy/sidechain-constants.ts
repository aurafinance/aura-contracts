import { chainIds } from "../../tasks/utils/networkAddressFactory";
import { config as goerliConfig } from "./goerli-config";
import { config as goerliSidechainConfig } from "./goerliSidechain-config";

export const sideChains = [
    chainIds.arbitrum,
    chainIds.arbitrumGoerli,
    chainIds.polygon,
    // Goerli is just use as a sidechain for testing
    chainIds.goerli,
    // For fork mode
    chainIds.hardhat,
];

export const canonicalChains = [
    chainIds.goerli,
    chainIds.mainnet,
    // For fork mode
    chainIds.hardhat,
];

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
    // For fork mode
    [chainIds.hardhat]: goerliConfig,
};

export const sidechainConfigs = {
    [chainIds.goerli]: goerliSidechainConfig,
    // For fork mode
    [chainIds.hardhat]: goerliSidechainConfig,
};
