import { chainIds } from "../../tasks/utils";

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

export const validNetworks = [
    chainIds.mainnet,
    chainIds.arbitrum,
    chainIds.avalanche,
    chainIds.base,
    chainIds.fraxtal,
    chainIds.gnosis,
    chainIds.optimism,
    chainIds.polygon,
    chainIds.zkevm,
];

export const networkLabels = {
    [chainIds.base]: "b",
    [chainIds.optimism]: "o",
    [chainIds.avalanche]: "av",
    [chainIds.zkevm]: "z",
    [chainIds.gnosis]: "g",
    [chainIds.polygon]: "p",
    [chainIds.arbitrum]: "a",
    [chainIds.fraxtal]: "f",
};

export const symbolOverrides = {
    "0x9559aaa82d9649c7a7b220e7c461d2e74c9a3593": "StaFi rETH",
    "0xd103dd49b8051a09b399a52e9a8ab629392de2fb": "p-Gyroe WMATIC/stMATIC",
    "0xa2f8bd6b95a0cb9094206075504cd0ed1cc717be": "Gyroe GHO/USDC (0xa2)",
    "0x80aef246f9926b52622f4e74cdc7acb5c4344ffe": "Gyroe GHO/USDC (0x80)",
    "0xa4daa3498677d655e359b0fc83ebdbd8dbf76a50": "a-ComposableStable StaFi rETH/WETH",
    "0x9e965252d1b294af358a232933a65bd30645c34c": "a-Gyroe wstETH/GYD (0x9e)",
    "0xc11442cdbe8901b36aeb7be7f3f95b6a8ade394e": "a-Gyroe wstETH/GYD (0xc1)",
    "0xf21fa4fb30ca6eafdf567a02aad92e49d6d0752d": "Gyroe USDC/GYD (0xf2)",
    "0x9c1a157cf8b242f67b3c950eda9a30b320bde9cd": "Gyroe USDC/GYD (0x9c)",
    "0xfc7d964f1676831d8105506b1f0c3b3e2b55c467": "Gyroe USDC/GYD (0xfc)",
};

export const priorityGuagesAddresses = [
    "0xb78543e00712C3ABBA10D0852f6E38FDE2AaBA4d", // veBAL
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
    "0xd1177e2157a7fd6a0484b79f8e50e8a9305f8063", // tetuBAL
    "0xf6a814ed60653cb0e36da247b01e6309318328d4", // tetuBAL
    // Duplicate gauges
    "0x455f20c54b5712a84454468c7831f7c431aeEB1C",
    // rETH migration 29 feb 2024
    "0x00b9bcd17cb049739d25fd7f826caa2e23b05620",
    "0x49f530b45ae792cdf5cbd5d25c5a9b9e59c6c3b8",
    "0x56c0626e6e3931af90ebb679a321225180d4b32b",
].map(x => x.toLowerCase());
