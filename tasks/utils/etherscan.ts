import { HardhatRuntimeEnvironment } from "hardhat/types";

interface VerifyEtherscan {
    address: string;
    contract?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
    constructorArguments?: any[];
    libraries?: {
        [libraryName: string]: string;
    };
}

interface VerifyOptions {
    attempts?: number;
    delayMs?: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const verifyEtherscan = async (
    hre: HardhatRuntimeEnvironment,
    contract: VerifyEtherscan,
    options: VerifyOptions = {},
): Promise<void> => {
    const supportedNetworks = ["mainnet", "goerli", "arbitrum", "arbitrumGoerli"];
    const isSupported =
        supportedNetworks.includes(hre.network.name) &&
        !["tasks-fork.config.ts", "hardhat-fork.config.ts"].includes(hre.hardhatArguments.config);
    if (!isSupported) return;

    const attempts = options.attempts ?? 5;
    const delayMs = options.delayMs ?? 30_000;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            console.log(`Verifying ${contract.address} on Etherscan (attempt ${attempt}/${attempts})`);
            await hre.run("verify:verify", contract);
            return;
        } catch (err) {
            const message = (err as Error)?.message ?? String(err);
            if (/already verified/i.test(message)) {
                console.log(`  ${contract.address} already verified`);
                return;
            }
            if (attempt === attempts) {
                console.error(`  Verification failed after ${attempts} attempts: ${message}`);
                throw err;
            }
            console.warn(`  Attempt ${attempt} failed (${message.split("\n")[0]}); retrying in ${delayMs / 1000}s`);
            await sleep(delayMs);
        }
    }
};
