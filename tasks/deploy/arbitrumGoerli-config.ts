import { Signer } from "ethers";
import { chainIds } from "../../hardhat.config";
import {
    BoosterLite__factory,
    BoosterOwner__factory,
    AuraOFT__factory,
    L2Coordinator__factory,
    PoolManagerLite__factory,
    ProxyFactory__factory,
    RewardFactory__factory,
    StashFactoryV2__factory,
    TokenFactory__factory,
    VoterProxyLite__factory,
    AuraBalOFT__factory,
} from "../../types";
import { ExtSidechainConfig, SidechainConfig, SidechainMultisigConfig } from "../../types/sidechain-types";
import { sidechainNaming } from "./sidechain-constants";

const multisigs: SidechainMultisigConfig = {
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4", // Aura deployer EOA
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 10121, // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#goerli-ethereum-testnet
    sidechainLzChainId: 10143, // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#arbitrum-goerli-testnet
    lzEndpoint: "0x6aB5Ae6822647046626e83ee6dB8187151E1d5ab", // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#arbitrum-goerli-testnet
    minter: "0x0000000000000000000000000000000000000000",
    token: "0x0000000000000000000000000000000000000000",
    create2Factory: "0x0000000000000000000000000000000000000000",
    tokenBpt: "0x0000000000000000000000000000000000000000",
};

export const getSidechain = (signer: Signer) => ({
    voterProxy: VoterProxyLite__factory.connect("0x0000000000000000000000000000000000000000", signer),
    booster: BoosterLite__factory.connect("0x0000000000000000000000000000000000000000", signer),
    boosterOwner: BoosterOwner__factory.connect("0x0000000000000000000000000000000000000000", signer),
    poolManager: PoolManagerLite__factory.connect("0x0000000000000000000000000000000000000000", signer),
    l2Coordinator: L2Coordinator__factory.connect("0x0000000000000000000000000000000000000000", signer),
    auraOFT: AuraOFT__factory.connect("0x0000000000000000000000000000000000000000", signer),
    auraBalOFT: AuraBalOFT__factory.connect("0x0000000000000000000000000000000000000000", signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0x0000000000000000000000000000000000000000", signer),
        stashFactory: StashFactoryV2__factory.connect("0x0000000000000000000000000000000000000000", signer),
        tokenFactory: TokenFactory__factory.connect("0x0000000000000000000000000000000000000000", signer),
        proxyFactory: ProxyFactory__factory.connect("0x0000000000000000000000000000000000000000", signer),
    },
});

export const config: SidechainConfig = {
    chainId: chainIds.arbitrumGoerli,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    getSidechain,
};
