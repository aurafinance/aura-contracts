import axios from "axios";
import { task, types } from "hardhat/config";
import { BaseContract } from "ethers";
import { JsonRpcProvider } from "@ethersproject/providers";

import {
    BridgeDelegateSender__factory,
    KeeperMulticall3__factory,
    SidechainConfig,
    SidechainPhaseDeployed,
} from "../../types";
import { config as base } from "../deploy/base-config";
import { config as zkevm } from "../deploy/zkevm-config";
import { config as gnosis } from "../deploy/gnosis-config";
import { config as avalanche } from "../deploy/avax-config";
import { config as polygon } from "../deploy/polygon-config";
import { config as arbitrum } from "../deploy/arbitrum-config";
import { config as optimism } from "../deploy/optimism-config";
import { config as fraxtal } from "../deploy/fraxtal-config";
import { config as mainnet } from "../deploy/mainnet-config";

import { chainIds } from "../utils";
import { blockExplorer, blockExplorerApi, supportedChains, SupportedChains } from "../utils/etherscanApi";
import { compareAddresses } from "../snapshot/utils";

type CheckOptions = {
    ownership: boolean;
    keeper: boolean;
    verified: boolean;
    tagged: boolean;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Minimal color logging for terminal
function rgb(hex: string) {
    const valid = /^(bg)?#[a-fA-F0-9]{6}$/.test(hex);
    if (!valid) return "";
    const isBg = hex.startsWith("bg");
    const r = parseInt(hex.slice(isBg ? 3 : 1, isBg ? 5 : 3), 16);
    const g = parseInt(hex.slice(isBg ? 5 : 3, isBg ? 7 : 5), 16);
    const b = parseInt(hex.slice(isBg ? 7 : 5, isBg ? 9 : 7), 16);
    return `\x1b[${isBg ? 48 : 38};2;${r};${g};${b}m`;
}
function _(value: unknown) {
    return (color1?: string, color2?: string) => {
        const encodedColor1 = color1 ? rgb(color1) : "";
        const encodedColor2 = color2 ? rgb(color2) : "";
        return `${encodedColor1}${encodedColor2}${value}\x1b[0m`;
    };
}
const gray = "#808080";
const warn = "#ffa012";
const error = "#ff2600";
const ok = "#55ff00";

const chainConfigs: Record<SupportedChains, SidechainConfig> = {
    [chainIds.arbitrum]: arbitrum,
    [chainIds.optimism]: optimism,
    [chainIds.polygon]: polygon,
    [chainIds.gnosis]: gnosis,
    [chainIds.base]: base,
    [chainIds.zkevm]: zkevm,
    [chainIds.avalanche]: avalanche,
    [chainIds.fraxtal]: fraxtal,
};
const chainNames: Record<SupportedChains, string> = {
    [chainIds.arbitrum]: "🔵 Arbitrum",
    [chainIds.optimism]: "🔴 Optimism",
    [chainIds.polygon]: "🟣 Polygon",
    [chainIds.gnosis]: "🟢 Gnosis",
    [chainIds.base]: "⚪ Base",
    [chainIds.zkevm]: "🟪 zkEvm",
    [chainIds.avalanche]: "🔺 Avalanche",
    [chainIds.fraxtal]: "🔳 Fraxtal",
    [chainIds.mainnet]: "⚫ Mainnet",
};

const providers: Record<SupportedChains, JsonRpcProvider> = {
    [chainIds.arbitrum]: new JsonRpcProvider(process.env.ARBITRUM_NODE_URL, chainIds.arbitrum),
    [chainIds.optimism]: new JsonRpcProvider(process.env.OPTIMISM_NODE_URL, chainIds.optimism),
    [chainIds.polygon]: new JsonRpcProvider(process.env.POLYGON_NODE_URL, chainIds.polygon),
    [chainIds.gnosis]: new JsonRpcProvider(process.env.GNOSIS_NODE_URL, chainIds.gnosis),
    [chainIds.base]: new JsonRpcProvider(process.env.BASE_NODE_URL, chainIds.base),
    [chainIds.zkevm]: new JsonRpcProvider(process.env.ZKEVM_NODE_URL, chainIds.zkevm),
    [chainIds.avalanche]: new JsonRpcProvider(process.env.AVALANCHE_NODE_URL, chainIds.avalanche),
    [chainIds.fraxtal]: new JsonRpcProvider(process.env.FRAXTAL_NODE_URL, chainIds.fraxtal),
    [chainIds.mainnet]: new JsonRpcProvider(process.env.MAINNET_NODE_URL, chainIds.mainnet),
};

const isOwnable = (contract: BaseContract) => "owner" in contract || "operator" in contract;
const isKeeperRole = (contract: BaseContract) =>
    "authorizedKeepers" in contract ||
    "authorizedHarvesters" in contract ||
    "distributors" in contract ||
    "distributor" in contract;
async function setTimeoutForChain(chainId: number) {
    if (chainNames[chainId] === "gnosis") {
        // Avoid Too many queued requests error
        await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

async function checkContractTagging(chainId: number, contract: BaseContract) {
    const response2 = await axios.get(`https://${blockExplorer[chainId]}/address/${contract.address}`, {
        responseType: "document",
        headers: {
            // faking browser user agent: some explorers prevent scraping by checking user agent
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
        },
    });
    const result2 = response2.data as string;
    if (result2.includes("https://aura.finance")) {
        console.log(_("\t\t✅ tagged on block explorer")(ok));
    } else {
        console.log(_("\t\t❌ not tagged on block explorer")(error));
    }
}

async function checkContractVerification(chainId: number, contract: BaseContract) {
    const response = await axios.get(
        `https://${blockExplorerApi[chainId]}/api?module=contract&action=getabi&address=${contract.address}`,
    );
    const result = response.data;
    if (
        result.result === "Max rate limit reached, please use API Key for higher rate limit" ||
        response.status !== 200
    ) {
        console.log(_("\t\t• unable to check verification status, rate limit reached")(warn));
    } else if (result.result === "Contract source code not verified") {
        console.log(_("\t\t❌ not verified on block explorer")(error));
    } else {
        console.log(_("\t\t✅ verified on block explorer")(ok));
    }
}

async function checkContractOwnership(
    contract: BaseContract,
    multisig: string,
    contracts: [string, BaseContract][],
    noCheckContracts: string[] = [],
) {
    const ownerProperty = "owner" in contract ? "owner" : "operator";
    try {
        const owner = await (await contract[ownerProperty]()).toLowerCase();
        const isMultisig = owner === multisig;
        const ownerContract = contracts.find(([, c]) => compareAddresses(c.address, owner));
        if (isMultisig) console.log(_("\t\t✅ owned by multisig")(ok));
        else if (ownerContract) console.log(_(`\t\t✅ owned by ${ownerContract[0]}`)(ok));
        else if (noCheckContracts.some(addr => compareAddresses(contract.address, addr))) {
            // If the contract is keeper multicall the ownership is ok  not be an issue
            console.log(_(`\t\t✅ owned by ${owner}`)(ok));
        } else {
            console.log(_(`\t\t❌ not owned by multisig ${owner}`)(error));
        }
    } catch (error) {
        console.log(_(`\t\t• unable to get owner ${ownerProperty}`)(warn));
        console.error(error);
    }
}
async function checkContractKeeperRole(
    contract: BaseContract,
    authorizedKeeper: string,
    keeperMulticall3Address: string,
) {
    // Get contract name
    const dedicatedMsgSender = "0x9b8e2E8892ea40A8D1167bbBa2F221D68060BFeF";
    const isKeeperMulticall = compareAddresses(contract.address, keeperMulticall3Address);
    const authorizedKeeperAddress = isKeeperMulticall ? dedicatedMsgSender : authorizedKeeper;
    const keeperProperties = ["authorizedKeepers", "authorizedHarvesters", "distributors", "distributor"];
    const keeperProperty = keeperProperties.find(prop => prop in contract);

    if (!keeperProperty) {
        console.log(_("\t\t• no keeper role property found")(warn));
        return;
    }
    try {
        if (!authorizedKeeper) console.log(_(`\t\t❌ keeper not configured`)(error));

        if (keeperProperty === "distributor") {
            const distributor = await await contract[keeperProperty]();
            if (compareAddresses(distributor, authorizedKeeperAddress)) {
                console.log(_(`\t\t✅ keeper authorized ${authorizedKeeperAddress}`)(ok));
            } else {
                console.log(_(`\t\t❌ keeper not authorized ${authorizedKeeperAddress}`)(error));
            }
            return;
        }

        const isAuthorizedKeeper = await await contract[keeperProperty](authorizedKeeperAddress);

        if (isAuthorizedKeeper) console.log(_(`\t\t✅ keeper authorized ${authorizedKeeperAddress}`)(ok));
        else console.log(_(`\t\t❌ keeper not authorized ${authorizedKeeperAddress}`)(error));
    } catch (error) {
        console.log(_(`\t\t• unable to get keeper ${keeperProperty}`)(warn));
        console.error(error);
    }
}

async function checkChain(chainId: number, options: CheckOptions) {
    console.log(`\n\n${chainNames[chainId]}`);

    // initialize provider and needed values
    const provider = providers[chainId];
    const isMainnet = chainId === chainIds.mainnet;
    const config = isMainnet ? mainnet : chainConfigs[chainId as SupportedChains];
    const multisig = config.multisigs.daoMultisig.toLowerCase();
    const sideChain = config.getSidechain(provider);
    const safeModules = config.getSafeModules(provider);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let contractEntries: Record<string, any> = { ...sideChain, ...safeModules };
    let keeperMulticallAddress: string | undefined;
    let noCheckContracts: string[] = [];

    if (isMainnet) {
        const mainnetConfig = config as typeof mainnet;
        keeperMulticallAddress = mainnetConfig.multisigs.defender?.keeperMulticall3?.toLowerCase();
        const vault = await mainnetConfig.getAuraBalVault(provider);
        const keeperMulticall3 = KeeperMulticall3__factory.connect(
            "0x817F426B5a79599464488eCCf82c3F54b9330E15",
            provider,
        );
        contractEntries = { ...contractEntries, ...vault, keeperMulticall3 };
        noCheckContracts = [keeperMulticallAddress].filter(Boolean) as string[];
    } else {
        const sidechainConfig = config as SidechainConfig;
        const view = sidechainConfig.getView(provider);
        const bridging = sidechainConfig.bridging;
        const sidechainPhase = sideChain as SidechainPhaseDeployed;
        const factories = sidechainPhase.factories;
        delete (sidechainPhase as SidechainPhaseDeployed)?.factories;
        const l2Sender = BridgeDelegateSender__factory.connect(bridging.l2Sender, provider);
        contractEntries = { ...contractEntries, ...factories, ...view, l2Sender };
        keeperMulticallAddress = sidechainConfig.multisigs.defender?.toLowerCase();
        noCheckContracts = [sidechainPhase.keeperMulticall3.address];
    }

    const contracts = Object.entries(contractEntries).filter(
        ([name, contract]) =>
            // checking that, this item is indeed a contract object
            typeof contract === "object" && name !== "interface" && name !== "provider" && "address" in contract,
    ) as [string, BaseContract][];

    // main loop, for each contracts
    for (const [name, contract] of contracts) {
        try {
            // checking if the contract is deployed, i.e. address is not 0x00...00
            if (contract.address === ZERO_ADDRESS) {
                console.log(`\t• ${name} ${_("not deployed")(warn)}`);
                continue;
            }

            // checking the ownership
            console.log(`\t• ${name} ${_(`(${contract.address})`)(gray)}`);
            const owned = isOwnable(contract);
            if (owned && contract.address && options.ownership) {
                await checkContractOwnership(contract, multisig, contracts, noCheckContracts);
            } else {
                console.log(_("\t\t• not owned")(gray));
            }

            if (isKeeperRole(contract) && contract.address && options.keeper) {
                const sidechainPhase = sideChain as SidechainPhaseDeployed;
                await checkContractKeeperRole(
                    contract,
                    keeperMulticallAddress,
                    isMainnet ? keeperMulticallAddress : sidechainPhase.keeperMulticall3.address,
                );
            }

            // For L2Coordinator, we must check that l2Coordinator.bridgeDelegate() is not 0x00...00
            if (!isMainnet) {
                const sidechainPhase = sideChain as SidechainPhaseDeployed;
                if (contract.address === sidechainPhase.l2Coordinator.address) {
                    const bridgeDelegate = await sidechainPhase.l2Coordinator.bridgeDelegate();
                    if (bridgeDelegate === ZERO_ADDRESS) {
                        console.log(_("\t\t❌ bridgeDelegate is not set")(error));
                    } else {
                        console.log(_("\t\t✅ bridgeDelegate is set")(ok));
                    }
                }
            }

            // checking the verification status on block explorer
            if (options.verified) {
                await checkContractVerification(chainId, contract);
                await setTimeoutForChain(chainId);
            }
            // checking contract tag on block explorer
            if (options.tagged) {
                await checkContractTagging(chainId, contract);
                await setTimeoutForChain(chainId);
            }
        } catch {
            console.error(`Error checking ${chainNames[chainId]} ${name}`);
            await new Promise(resolve => setTimeout(resolve, 5_000)); // sleep 5 seconds to avoid being rate limited
        }
    }
}

// npx hardhat --config tasks.config.ts contract-status
task("contract-status")
    .addOptionalParam("ownership", "Check ownership status", true, types.boolean)
    .addOptionalParam("keeper", "Check authorized keeper status", true, types.boolean)
    .addOptionalParam("verified", "Check verified status", false, types.boolean)
    .addOptionalParam("tagged", "Check tagged status", false, types.boolean)
    .setAction(async tskArgs => {
        const options: CheckOptions = {
            ownership: tskArgs.ownership,
            keeper: tskArgs.keeper,
            verified: tskArgs.verified,
            tagged: tskArgs.tagged,
        };
        for (const chainId of [...supportedChains, chainIds.mainnet]) {
            await checkChain(chainId, options);
        }
        // Mainnet
        // AuraBalVault Multicall
        console.log("\n");
    });
