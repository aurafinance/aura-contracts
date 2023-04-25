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
import {
    ExtSidechainConfig,
    SidechainAddresses,
    SidechainConfig,
    SidechainNaming,
    SidechainBridging,
} from "./sidechain-types";

const addresses: SidechainAddresses = {
    lzEndpoint: "0x6aB5Ae6822647046626e83ee6dB8187151E1d5ab", // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#arbitrum-goerli-testnet
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4", // Aura deployer EOA
    minter: "0x0000000000000000000000000000000000000000", // Mock minter
    token: "0x0000000000000000000000000000000000000000", // Mock token
    create2Factory: "0x0000000000000000000000000000000000000000",
};

const naming: SidechainNaming = {
    auraOftName: "Aura",
    auraOftSymbol: "AURA",
    auraBalOftName: "Aura BAL",
    auraBalOftSymbol: "auraBAL",
    tokenFactoryNamePostfix: " Aura Deposit",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 10121, // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#goerli-ethereum-testnet
};

export const bridging: SidechainBridging = {
    l1Receiver: "0x0000000000000000000000000000000000000000",
    l2Sender: "0x0000000000000000000000000000000000000000",
    nativeBridge: "0x0000000000000000000000000000000000000000",
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
    addresses,
    naming,
    extConfig,
    bridging,
    getSidechain,
};
