import { SidechainConfig } from "types";
import { chainIds } from "../../tasks/utils/networkAddressFactory";
import { config as arbitrumConfig } from "./arbitrum-config";
import { config as avaxConfig } from "./avax-config";
import { config as baseConfig } from "./base-config";
import { config as blastSidechainConfig } from "./blast-config";
import { config as gnosisConfig } from "./gnosis-config";
import { config as goerliConfig } from "./goerli-config";
import { config as goerliSidechainConfig } from "./goerliSidechain-config";
import { config as mainnetConfig } from "./mainnet-config";
import { config as optimismConfig } from "./optimism-config";
import { config as polygonConfig } from "./polygon-config";
import { config as zkevmConfig } from "./zkevm-config";
import { config as fraxtalConfig } from "./fraxtal-config";

export const sideChains = [
    chainIds.optimism,
    chainIds.arbitrum,
    chainIds.arbitrumGoerli,
    chainIds.polygon,
    chainIds.gnosis,
    chainIds.zkevm,
    chainIds.blast,
    chainIds.base,
    chainIds.avalanche,
    chainIds.fraxtal,
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
    [chainIds.base]: chainIds.mainnet,
    [chainIds.arbitrumGoerli]: chainIds.goerli,
    [chainIds.polygon]: chainIds.mainnet,
    [chainIds.gnosis]: chainIds.mainnet,
    [chainIds.zkevm]: chainIds.mainnet,
    [chainIds.blast]: chainIds.mainnet,
    [chainIds.avalanche]: chainIds.mainnet,
    [chainIds.fraxtal]: chainIds.mainnet,
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
    [chainIds.base]: 184,
    [chainIds.zkevm]: 158,
    [chainIds.blast]: 243,
    [chainIds.avalanche]: 106,
    [chainIds.fraxtal]: 255,
    // For fork mode
    [chainIds.hardhat]: 106,
};

export const canonicalConfigs = {
    [chainIds.goerli]: goerliConfig,
    [chainIds.mainnet]: mainnetConfig,
    // For fork mode
    [chainIds.hardhat]: mainnetConfig,
};

export const sidechainConfigs = {
    [chainIds.blast]: blastSidechainConfig as SidechainConfig,
    [chainIds.goerli]: goerliSidechainConfig,
    [chainIds.gnosis]: gnosisConfig,
    [chainIds.arbitrum]: arbitrumConfig,
    [chainIds.optimism]: optimismConfig,
    [chainIds.polygon]: polygonConfig,
    [chainIds.base]: baseConfig,
    [chainIds.zkevm]: zkevmConfig,
    [chainIds.avalanche]: avaxConfig,
    [chainIds.fraxtal]: fraxtalConfig,
    // For fork mode
    [chainIds.hardhat]: arbitrumConfig,
};
