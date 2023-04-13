import { ExtSidechainConfig, SidechainAddresses, SidechainConfig, SidechainNaming } from "./sidechain-types";

const addresses: SidechainAddresses = {
    lzEndpoint: "0x6aB5Ae6822647046626e83ee6dB8187151E1d5ab", // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#arbitrum-goerli-testnet
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4", // Aura deployer EOA
    minter: "0xFa6B857cC17740A946c9eb85C1a6896f2e0Be98E", // Mock minter
    token: "0xb78C0D130Dc07BA909eD5F6828Abd5EA183B12BC", // Mock token
    create2Factory: "0x2E1ADE7233e886D8041Fd7c3b87523F3DDC2169D",
};

const naming: SidechainNaming = {
    coordinatorName: "Aura",
    coordinatorSymbol: "AURA",
    tokenFactoryNamePostfix: " Aura Deposit",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101, // Ethereum Mainnet see: https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
};

export const config: SidechainConfig = {
    addresses,
    naming,
    extConfig,
};
