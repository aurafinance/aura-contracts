export interface SidechainAddresses {
    lzEndpoint: string;
    token: string;
    daoMultisig: string;
    minter: string;
    create2Factory: string;
}

const addresses: SidechainAddresses = {
    // LayerZero endpoint
    lzEndpoint: "0x0000000000000000000000000000000000000000",
    // BAL token
    daoMultisig: "0x0000000000000000000000000000000000000000",
    // TODO: these are mainnet values
    minter: "0x239e55F427D44C3cc793f49bFB507ebe76638a2b",
    token: "0xba100000625a3754423978a60c9317c58a424e3D",
    create2Factory: "0x0000000000000000000000000000000000000000",
};

export interface SidechainNaming {
    coordinatorName: string;
    coordinatorSymbol: string;
    tokenFactoryNamePostfix: string;
}

const naming: SidechainNaming = {
    coordinatorName: "Aura",
    coordinatorSymbol: "AURA",
    tokenFactoryNamePostfix: " Aura Deposit",
};

export interface ExtSidechainConfig {
    canonicalChainId: number;
}

export const config = {
    addresses,
    naming,
    extConfig: {
        canonicalChainId: 101, // Ethereum Mainnet see: https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
    },
};
