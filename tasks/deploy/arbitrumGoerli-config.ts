import { Signer } from "ethers";
import {
    BoosterLite__factory,
    BoosterOwner__factory,
    Coordinator__factory,
    PoolManagerLite__factory,
    ProxyFactory__factory,
    RewardFactory__factory,
    StashFactoryV2__factory,
    TokenFactory__factory,
    VoterProxyLite__factory,
} from "types";
import { ExtSidechainConfig, SidechainAddresses, SidechainConfig, SidechainNaming } from "./sidechain-types";

const addresses: SidechainAddresses = {
    lzEndpoint: "0x6aB5Ae6822647046626e83ee6dB8187151E1d5ab", // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#arbitrum-goerli-testnet
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4", // Aura deployer EOA
    minter: "0xFa6B857cC17740A946c9eb85C1a6896f2e0Be98E", // Mock minter
    token: "0xb78C0D130Dc07BA909eD5F6828Abd5EA183B12BC", // Mock token
    create2Factory: "0x3f9d2543bD928380532c869628A514128c40B4aD",
};

const naming: SidechainNaming = {
    coordinatorName: "Aura",
    coordinatorSymbol: "AURA",
    tokenFactoryNamePostfix: " Aura Deposit",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 10121, // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#goerli-ethereum-testnet
};

export const config: SidechainConfig = {
    addresses,
    naming,
    extConfig,
};

export const getDeployment = (signer: Signer) => ({
    voterProxy: VoterProxyLite__factory.connect("0xfdAe5b9b7C98618CD03216D64F9917e16B014BF8", signer),
    booster: BoosterLite__factory.connect("0x8e9b10c65a8eCAC1F3f880675a88B75E31D2E8C0", signer),
    boosterOwner: BoosterOwner__factory.connect("0x0A01A721a4B881ae1B63aE7Ce3076Af6D36eea73", signer),
    poolManager: PoolManagerLite__factory.connect("0x0792e9aab201a002b1c18a7a35d026c6c251cdf1", signer),
    coordinator: Coordinator__factory.connect("0x269a60d7d12e392f6e096c923823c371dea7ce9c", signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0xd0bd843b245bea845411ef118c0a25494692d7c6", signer),
        stashFactory: StashFactoryV2__factory.connect("0xbde6bdf2c16b4407d6b3b983856d7b4253098e4d", signer),
        tokenFactory: TokenFactory__factory.connect("0x0ed6fe0d554d7f38b1224513b53c73bab204316d", signer),
        proxyFactory: ProxyFactory__factory.connect("0xa2f70247addeea9c205477fb73889da8f0d69317", signer),
    },
});
