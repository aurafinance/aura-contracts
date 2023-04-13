import { ExtSidechainConfig, SidechainAddresses, SidechainConfig, SidechainNaming } from "./sidechain-types";

const addresses: SidechainAddresses = {
    lzEndpoint: "0x0000000000000000000000000000000000000000",
    daoMultisig: "0x0000000000000000000000000000000000000000",
    minter: "0x0000000000000000000000000000000000000000",
    token: "0x0000000000000000000000000000000000000000",
    create2Factory: "0x0000000000000000000000000000000000000000",
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
