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

export const validNetworks = [1, 10, 42161, 137];

export const networkLabels = { 137: "p", 42161: "a", 10: "o" };

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
    // Removed as a part of https://forum.balancer.fi/t/bip-177-great-migration-wave-1/4364
    "0x3F0FB52648Eb3981EA598716b7320081d1c8Ba1a", // wstETH/sfrxETH/rETH
    "0x6Eb7CdCd15417ABF120FfE404B9b88141Ca952B7", // rETH/RPL
    "0xb32Ae42524d38be7E7eD9E02b5F9330fCEf07f3F", // rETH/BADGER
    "0xc2c2304E163e1aB53De2eEB08820a0B592bec20B", // LDO/wstETH
    "0x651361a042e0573295dd7f6A84dBD1DA56DAc9D5", // wstETH/bbaUSD
    "0x973fb174Cdf9b1652e4213125a186f66684D899c", // TEMPLE/bbaUSD
    "0xF60B8DAF6825c9fBE5eC073D623B9d47cDa592E8", // rETH/bbaUSD
    "0x89F65570Ac019f86E145c501023e2ef7010D155B", // ACX/wstETH
    // Removed as a part of https://forum.balancer.fi/t/bip-189-great-migration-wave-2/4408
    "0xb34d43Ada4105Ff71e89b8B22a8B9562E78f01E3",
    "0x285cBA395e3Acb82A42758638fA85da9936016a4",
    "0x3d5F0520267FE92FFf52B847FAC3204554552f99",
    "0xD9Ea099D62526e670aef2BD680599FC48c409f3c",
    "0xC9Cd2B2D8744eB1E5F224612Bd7DBe7BB7d99b5A",
].map(x => x.toLowerCase());
