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
    // Removed as a part of https://forum.balancer.fi/t/bip-189-great-migration-wave-2/4408
    "0xb34d43Ada4105Ff71e89b8B22a8B9562E78f01E3",
    "0x285cBA395e3Acb82A42758638fA85da9936016a4",
    "0x3d5F0520267FE92FFf52B847FAC3204554552f99",
    "0xD9Ea099D62526e670aef2BD680599FC48c409f3c",
    "0xC9Cd2B2D8744eB1E5F224612Bd7DBe7BB7d99b5A",
    // Removed in relation to Euler hack
    "0xD65979f15cfB52E9a6a4f8DEA34c69c1568EA4A8", // ComposableStable bb-e-USDC/bb-e-FRAX
    "0xf53f2fEE2A34f7f8d1BFe1B774A95Cc79C121B34", // ComposableStable bb-e-USDT/bb-e-USDC/bb-e-DAI
    "0x623F3Dbc761B46F64aE7951700Dd7724cB7d6075", // 50/50 bb-euler-USD-BPT/wstETH
    "0x38727B907046818135c9a865D5C40BE6cd1c0514", // 50/50 TEMPLE/bb-euler-USD-BPT
    "0xE96924D293b9e2961f9763cA058E389D27341D3d", // 50/50 bb-euler-USD-BPT/rETH
    "0x5FbEAa96c9D8d0e839780433aA0B3B4d35b049d8", // ComposableStable bb-euler-USD-BPT/DOLA
    "0xA9A63971c55c132aF0e6B39a081e604F07f4e234", // ComposableStable bb-a-TUSD/bb-euler-USD-BPT
].map(x => x.toLowerCase());
