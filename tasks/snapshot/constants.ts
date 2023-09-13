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
    chainIds.base,
    chainIds.optimism,
    chainIds.avalanche,
    chainIds.zkevm,
    chainIds.gnosis,
    chainIds.polygon,
    chainIds.arbitrum,
];

export const networkLabels = {
    [chainIds.base]: "b",
    [chainIds.optimism]: "o",
    [chainIds.avalanche]: "av",
    [chainIds.zkevm]: "z",
    [chainIds.gnosis]: "g",
    [chainIds.polygon]: "p",
    [chainIds.arbitrum]: "a",
};

export const symbolOverrides = {
    "0x9559aaa82d9649c7a7b220e7c461d2e74c9a3593": "StaFi rETH",
    "0xd103dd49b8051a09b399a52e9a8ab629392de2fb": "p-Gyroe WMATIC/stMATIC",
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
    // Removed but not killed yet 2rd August
    "0x33BcAa8A390e6DcF2f18AE5fDd9e38fD248219eB",
    "0x6AF7bCA454f3C8165225Ed46FD4d78cc90E81fAA",
    "0x1d157Cf1F1339864A3C291D1Bbe786d6Ee682434",
    "0x70c6A653e273523FADfB4dF99558737906c230c6",
    "0xC764B55852F8849Ae69923e45ce077A576bF9a8d",
    "0x11Ff498C7c2A29fc4638BF45D9fF995C3297fcA5",
    "0x9fB7D6dCAC7b6aa20108BaD226c35B85A9e31B63",
    "0x21b2Ef3DC22B7bd4634205081c667e39742075E2",
    "0xcB2c2AF6c3E88b4a89aa2aae1D7C8120EEe9Ad0e",
    "0x3B6A85B5e1e6205ebF4d4eabf147D10e8e4bf0A5",
    "0x39cEEbb561a65216A4B776ea752d3137e9d6C0F0",
    "0x6b641e334f63f0D882538Fe189efC0702d961696",
    "0x47D7269829Ba9571D98Eb6DDc34e9C8f1A4C327f",
    "0x416d15C36c6DaAd2b9410B79aE557e6F07DcB642",
    "0xBAdF0c8702B7Cb06bBEC351d18071804759e312c",
    "0xecF0a26a290cbf3DDBAB7eC5Fb44Ef5A294cAc18",
    "0x8204b749B808818DEb7957DbD030ceEA44D1FE18",
    "0xacE0D479040231e3c6b17479cFd4444182d521d4",
    // Duplicate gauges
    "0x455f20c54b5712a84454468c7831f7c431aeEB1C",
].map(x => x.toLowerCase());
