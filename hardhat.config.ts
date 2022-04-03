import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";

import { resolve } from "path";

import { config as dotenvConfig } from "dotenv";
import { HardhatUserConfig } from "hardhat/config";

dotenvConfig({ path: resolve(__dirname, "./.env") });

const chainIds = {
    goerli: 5,
    hardhat: 31337,
    kovan: 42,
    mainnet: 1,
    rinkeby: 4,
    ropsten: 3,
};

// Ensure that we have all the environment variables we need.
// const mnemonic: string | undefined = process.env.MNEMONIC;
// if (!mnemonic) {
//     throw new Error("Please set your MNEMONIC in a .env file");
// }

// const infuraApiKey: string | undefined = process.env.INFURA_API_KEY;
// if (!infuraApiKey) {
//     throw new Error("Please set your INFURA_API_KEY in a .env file");
// }

// function getChainConfig(network: keyof typeof chainIds): NetworkUserConfig {
//     const url: string = "https://" + network + ".infura.io/v3/" + infuraApiKey;
//     return {
//         accounts: {
//             count: 10,
//             mnemonic,
//             path: "m/44'/60'/0'/0",
//         },
//         chainId: chainIds[network],
//         url,
//     };
// }
const compilerSettings = {
    metadata: {
        // Not including the metadata hash
        // https://github.com/paulrberg/solidity-template/issues/31
        bytecodeHash: "none",
    },
    // Disable the optimizer when debugging
    // https://hardhat.org/hardhat-network/#solidity-optimizer-support
    optimizer: {
        enabled: true,
        runs: 800,
    },
};

const config: HardhatUserConfig = {
    defaultNetwork: "hardhat",
    gasReporter: {
        currency: "USD",
        enabled: true,
        excludeContracts: [],
        src: "./contracts",
    },
    networks: {
        hardhat: {
            chainId: chainIds.hardhat,
            allowUnlimitedContractSize: true,
        },
        mainnet: {
            url: process.env.NODE_URL || "https://main-light.eth.linkpool.io",
        },
        kovan: {
            url: process.env.NODE_URL || "",
            gasPrice: 3000000000,
        },
        forking: {
            url: process.env.NODE_URL || "",
        },
        rinkeby: { url: process.env.NODE_URL || "", gasPrice: 3000000000 },
    },
    paths: {
        artifacts: "./artifacts",
        cache: "./cache",
        sources: "./contracts",
        tests: "./test",
    },
    solidity: {
        compilers: [
            {
                version: "0.6.12",
                settings: compilerSettings,
            },
            {
                version: "0.8.11",
                settings: compilerSettings,
            },
        ],
    },
    typechain: {
        outDir: "types/generated",
        target: "ethers-v5",
    },
};

export default config;
