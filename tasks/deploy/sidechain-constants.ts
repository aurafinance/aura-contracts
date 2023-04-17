import { chainIds } from "../../hardhat.config";
import { config as goerliConfig } from "./goerli-config";
import { config as arbitrumGoerliConfig } from "./arbitrumGoerli-config";

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

export const configs = {
    [chainIds.goerli]: goerliConfig,
    [chainIds.arbitrumGoerli]: arbitrumGoerliConfig,
};

export const canonicalChains = [chainIds.goerli, chainIds.mainnet];
