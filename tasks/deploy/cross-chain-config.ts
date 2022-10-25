export const config = {
    // Goerli
    5: {
        l2Coordinators: [{ chainId: 10143, address: "0x0000000000000000000000000000000000000000" }],
        booster: "0x2ad214dA65effA92159057957E50994440E99A1b",
        cvxLocker: "0x1e5B33222977642Bf64EC80846BBF83A016727A0",
        token: "0xfA8449189744799aD2AcE7e0EBAC8BB7575eff47",
        cvx: "0xFf3653ee692F541efB7c2214D72FE05A7A6EC01f",
        lzEndpoint: "0xbfD2135BFfbb0B5378b56643c2Df8a87552Bfa23",
    },
    // Arbitrum Goerli
    421613: {
        canonicalChainId: 10121,
        lzEndpoint: "0x6aB5Ae6822647046626e83ee6dB8187151E1d5ab",
        minter: "", // Deployed as a mock in the mock deployment task
        token: "", // Deployed as a mock in the mock deployment task
        naming: {
            tokenFactoryNamePostfix: "Rubarb",
            cvxSymbol: "RUBARB",
            cvxName: "Rubarb",
        },
    },
};
