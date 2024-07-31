import axios from "axios";
import { task } from "hardhat/config";
import { BaseContract } from "ethers";
import { JsonRpcProvider } from "@ethersproject/providers";

import { BridgeDelegateSender__factory, SidechainConfig } from "../../types";
import { config as base } from "../deploy/base-config";
import { config as zkevm } from "../deploy/zkevm-config";
import { config as gnosis } from "../deploy/gnosis-config";
import { config as avalanche } from "../deploy/avax-config";
import { config as polygon } from "../deploy/polygon-config";
import { config as arbitrum } from "../deploy/arbitrum-config";
import { config as optimism } from "../deploy/optimism-config";
import { config as fraxtal } from "../deploy/fraxtal-config";
import { chainIds } from "../utils";
import { blockExplorerApi, supportedChains, SupportedChains } from "../utils/etherscanApi";

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
};

async function checkChain(chainId: SupportedChains) {
    console.log(`\n\n${chainNames[chainId]}`);

    // initialize provider and needed values
    const provider = providers[chainId];
    const config = chainConfigs[chainId];
    const multisig = config.multisigs.daoMultisig.toLowerCase();
    // const multiCall = multiCalls[chainId];
    const sideChain = config.getSidechain(provider);
    const view = config.getView(provider);
    const bridging = config.bridging;

    const factories = sideChain.factories;
    delete (sideChain as any)?.factories;
    const l2Sender = BridgeDelegateSender__factory.connect(bridging.l2Sender, provider);
    const contracts = Object.entries({ ...sideChain, ...factories, ...view, l2Sender }).filter(
        ([name, contract]) =>
            // checking that, this item is indeed a contract object
            typeof contract === "object" && name !== "interface" && name !== "provider" && "address" in contract,
    ) as [string, BaseContract][];

    // main loop, for each contracts
    for (const [name, contract] of contracts) {
        // checking if the contract is deployed, i.e. address is not 0x00...00
        if (contract.address === ZERO_ADDRESS) {
            console.log(`\t• ${name} ${_("not deployed")(warn)}`);
            continue;
        }

        // checking the ownership
        console.log(`\t• ${name} ${_(`(${contract.address})`)(gray)}`);
        const owned = "owner" in contract || "operator" in contract;
        if (owned && contract.address) {
            try {
                const ownerFn = "owner" in contract ? "owner" : "operator";
                const owner = await (contract as any)[ownerFn]().then((o: string) => o.toLowerCase());
                const isMultisig = owner === multisig;
                const ownerContract = contracts.find(([, c]) => c.address.toLowerCase() === owner);
                if (isMultisig) console.log(_("\t\t✅ owned by multisig")(ok));
                else if (ownerContract) console.log(_(`\t\t✅ owned by ${ownerContract[0]}`)(ok));
                else if (contract.address === sideChain.keeperMulticall3.address)
                    console.log(_(`\t\t✅ owned by ${owner}`)(ok));
                else console.log(_(`\t\t❌ owner: ${owner}`)(error));
            } catch {
                console.log(_("\t\t• unable to get owner")(warn));
            }
        } else {
            console.log(_("\t\t• not owned")(gray));
        }

        // checking the verification status on block explorer
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

        // checking contract tag on block explorer
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

        await new Promise(resolve => setTimeout(resolve, 5_000)); // sleep 5 seconds to avoid being rate limited
    }
}

task("contract-status").setAction(async () => {
    for (const chainId of supportedChains) {
        if (chainIds.mainnet === chainId) continue;
        await checkChain(chainId);
    }
    console.log("\n");
});
