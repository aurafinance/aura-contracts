import { chainIds } from "../../tasks/utils/networkAddressFactory";
import { config as goerliConfig } from "./goerli-config";
import { config as mainnetConfig } from "./mainnet-config";
import { config as gnosisConfig } from "./gnosis-config";
import { config as goerliSidechainConfig } from "./goerliSidechain-config";
import { config as arbitrumConfig } from "./arbitrum-config";
import { config as optimismConfig } from "./optimism-config";
import { config as polygonConfig } from "./polygon-config";

export const sideChains = [
    chainIds.optimism,
    chainIds.arbitrum,
    chainIds.arbitrumGoerli,
    chainIds.polygon,
    chainIds.gnosis,
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
    [chainIds.optimism]: chainIds.mainnet,
    [chainIds.arbitrumGoerli]: chainIds.goerli,
    [chainIds.polygon]: chainIds.mainnet,
    [chainIds.gnosis]: chainIds.mainnet,
    // For fork mode
    [chainIds.hardhat]: chainIds.mainnet,
};

export const lzChainIds = {
    [chainIds.mainnet]: 101,
    [chainIds.polygon]: 109,
    [chainIds.arbitrum]: 110,
    [chainIds.optimism]: 111,
    [chainIds.goerli]: 10121,
    [chainIds.gnosis]: 145,
    [chainIds.arbitrumGoerli]: 10143,
    [chainIds.optimism]: 111,
    // For fork mode
    [chainIds.hardhat]: 110,
};

export const canonicalConfigs = {
    [chainIds.goerli]: goerliConfig,
    [chainIds.mainnet]: mainnetConfig,
    // For fork mode
    [chainIds.hardhat]: mainnetConfig,
};

export const sidechainConfigs = {
    [chainIds.goerli]: goerliSidechainConfig,
    [chainIds.gnosis]: gnosisConfig,
    [chainIds.arbitrum]: arbitrumConfig,
    [chainIds.optimism]: optimismConfig,
    [chainIds.polygon]: polygonConfig,
    // For fork mode
    [chainIds.hardhat]: arbitrumConfig,
};
