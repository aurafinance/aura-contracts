export const configs = {
    main: {
        hub: "https://hub.snapshot.org",
        space: "gauges.aurafinance.eth",
    },
    test: {
        hub: "https://testnet.snapshot.org",
        space: "432423532464535344321.eth",
    },
};

export const validNetworks = [1, 10, 42161, 137, 100];

export const networkLabels = { 137: "p", 42161: "a", 10: "o", 100: "g" };

export const symbolOverrides = {
    "0x9559aaa82d9649c7a7b220e7c461d2e74c9a3593": "StaFi rETH",
};

export const priorityGuagesAddresses = [
    "0xe867ad0a48e8f815dc0cda2cdb275e0f163a480b", // veBAL
    "0x0312aa8d0ba4a1969fddb382235870bf55f7f242", // auraBAL-B-80BAL-20WETH
    "0x275df57d2b23d53e20322b4bb71bf1dcb21d0a00", // WETH-AURA
    "0x2e79d6f631177f8e7f08fbd5110e893e1b1d790a", // 33auraBAL-33graviAURA-33WETH
];

export const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

export const removedGauges = [
    "0xDc2Df969EE5E66236B950F5c4c5f8aBe62035df2", // sdBAL
    "0xcF5938cA6d9F19C73010c7493e19c02AcFA8d24D", // tetuBAL
    // Removed but not killed migration
    "0xa6325e799d266632D347e41265a69aF111b05403",
    "0x9703C0144e8b68280b97d9e30aC6f979Dd6A38d7",
    "0x34f33CDaED8ba0E1CEECE80e5f4a73bcf234cfac",
    "0x2C967D6611C60274db45E0BB34c64fb5F504eDE7",
    "0xf7C3B4e1EdcB00f0230BFe03D937e26A5e654fD4",
    // Removed but not killed
    "0x25D6F29429bccCc129d1A3e2a5642C8B929BCC07", // g-bbagUSD
    "0x56A65cC666bfe538c5a031942369F6F63eb42240", // g-bbag USD/WETH/WBTC
    "0xd27671f057e9e72751106fBfbBBB33827D986546", // g-bbag USD/GNO
    "0x3FB2975E00B3dbB97E8315a5ACbFF6B38026FDf3", // g-bbag WETH/GNO
].map(x => x.toLowerCase());
