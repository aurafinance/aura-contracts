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
    // Removed but not killed - final migration round 11th May
    "0xC02b1b15888277B54Fb4903ef3Dedf4881a8c73A", // o-stg/bb-rf-aUSDC
    "0x78F50cF01a2Fd78f04da1D9ACF14a51487eC0347", // o-IB/rETH
    "0xeC6BA3d9D9045997552155599E6Cc89aA08Ffd76", // o-wstETH/LDO
    "0x8B815a11D0D9eeeE6861D1C5510d6FAA2C6e3fEb", // o-bbrfaUSD
    "0x97a92eDcDD4176B1495bF5DA6D9547537A53ED72", // o-rETH/bbrfaUSD/bbrfOP
    "0xb8F91FF8Cd5005f6274B6c2292CF3CCCdBCF32b7", // o-bbrfaUSD/beets/rETH/bbrfBAL
    "0xa26B3523227e300Ff8eCA69CD3b0bdcbd2Db0313", // o-wstETH/bbrfaUSD/bbrfaWBTC
    "0x74CE2247eC3f0b87BA0737497e3Db8873c184267", // o-wstETH/bbrfaWETH
    "0x6823DcA6D70061F2AE2AAA21661795A2294812bF", // a-BAL/WETH
    "0x709E5d6258aa97F12f3167844CB858696c16F39A", // a-vst/dai/usdt/usdc
    "0xd863DA50435D9FCf75008f00e49fFd0722291d94", // a-weth/vsta
    "0xa3E3B2C9C7A04894067F106938cA81e279bC3831", // p-rbw/weth
    "0xfb0265841C49A6b19D70055E596b212B0dA3f606", // o-weth/rETH
    "0x19ff30f9B2d32bfb0F21f2DB6c6A3A8604Eb8C2B", // a-RDNT/WETH
    "0x519cCe718FCD11AC09194CFf4517F12D263BE067", // a-wstETH/weth
    "0x5b0C1b84566708Dd391Ae0FecE1a32e33682EE3d", // a-bbrfgUSD
    "0x359EA8618c405023Fc4B98dAb1B01F373792a126", // a-wbtc/weth/usdc
    "0x5A7f39435fD9c381e4932fa2047C9a5136A5E3E7", // a-bb-DAI+/bb-USD+
    "0x68EBB057645258Cc62488fD198A0f0fa3FD6e8fb", // a-MAGIC/USDC
    "0xad2632513bFd805A63aD3e38D24EE10835877d41", // a-bbaweth/rETH
    "0x74d3aa5F9A2863DC22f6cF9c5faaca4E1fc86F75", // a-bbaweth/wstETH
    "0xb2102335Ea09E0476F886Ef7a4e77170235c408E", // a-bbaUSD
    "0x87F678f4F84e5665e1A85A22392fF5A84adC22cD", // p-bbawmatic/maticX
    "0xBD734b38F2dc864fe00DF51fc4F17d310eD7dA4D", // p-bbawmatic/stMATIC
    "0x1E0C21296bF29EE2d56e0abBDfbBEdF2530A7c9A", // p-tetu/usdc
    "0x90437a1D2F6C0935Dd6056f07f05C068f2A507F9", // p-sphere/wmatic
    "0x21a3De9292569F599e4cf83c741862705bf4f108", // p-usdc/wusdr
    "0x28D4FE67c68d340fe66CfbCBe8e2cd279d8AA6dD", // p-bbtUSD
    "0x88D07558470484c03d3bb44c3ECc36CAfCF43253", // p-wbtc/usdc/weth
    "0x0DB3F34d07682B7C61B0B72D02a26CD3cBDBBdd0", // p-jEUR/PAR
    "0xcF5938cA6d9F19C73010c7493e19c02AcFA8d24D", // p-20weth-80bal/tetuBAL
    "0xA5A0B6598B90d214eAf4d7a6b72d5a89C3b9A72c", // p-wmatic/usdc/weth/bal
    "0xD762F3C30A17222C0b8d25aFE1F1dCEC9816F15B", // p-tetuQI/QI
    "0xEd510769CCf53eA14388Fc9d6E98EDa5b1a5BAC8", // p-thx/stMATIC
    "0xe42382D005A620FaaA1B82543C9c04ED79Db03bA", // p-xSGD/USDC
    "0x6a08FD22bd3B10a8EB322938FCaa0A1B025BF3b3", // p-wmatic/ankrMATIC
    "0x43E4bE3A89985c4f1fCB4c2D3bd7e6E0C5df42D3", // p-tngbl/usdc
    "0x3bEEB803124bf0553B1d54301BA18368c74483c6", // p-jEUR/agEUR
    "0x9649d14f2b3300Edf690C96fbCb25eDC4B52Ea05", // p-sd/maticX
    "0x304a75f78C96767a814c36Aaa74d622ECf875d36", // p-wstETH/bbaweth
    "0x8D7d227746eE06D2532903D6EF1F69D80647C0E7", // p-bbaUSD
].map(x => x.toLowerCase());
