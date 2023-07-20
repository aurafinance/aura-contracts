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

export const validNetworks = [1, 10, 42161, 137, 100, 1101];

export const networkLabels = { 137: "p", 42161: "a", 10: "o", 100: "g", 1101: "z" };

export const symbolOverrides = {
    "0x9559aaa82d9649c7a7b220e7c461d2e74c9a3593": "StaFi rETH",
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
    // Removed but not killed yet 17th Jul 2023
    // https://forum.balancer.fi/t/bip-356-kill-affected-csp-and-weighted-pool-gauges/4971
    "0xA2a9Ebd6f4dEA4802083F2C8D08066A4e695e64B",
    "0x0052688295413b32626D226a205b95cDB337DE86",
    "0x5f838591A5A8048F0E4C4c7fCca8fD9A25BF0590",
    "0x8eeB783A4A67f626c6E3952AAeD0D6b104AaC85f",
    "0xDd3b4161D2a4c609884E20Ed71b4e85BE44572E6",
    "0x082AACfaf4db8AC0642CBED50df732D3C309E679",
    "0x4944b07977A42C15c6a06CF4e204e24c60564104",
    "0xB5044FD339A7b858095324cC3F239C212956C179",
    "0x54BeFB03BB58687cDE09cd082Bd78410e309D8C7",
    "0x48799A2B0b9ec11E4fa158c781AD8bFAbB892D58",
].map(x => x.toLowerCase());
