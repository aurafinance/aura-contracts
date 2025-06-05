import axios from "axios";
import { chainIds } from "../utils";

export const supportedChains = [
    chainIds.arbitrum,
    chainIds.optimism,
    chainIds.polygon,
    chainIds.gnosis,
    chainIds.base,
    chainIds.zkevm,
    chainIds.avalanche,
] as const;

export type SupportedChains = typeof supportedChains[number];

export const blockExplorer: Record<SupportedChains, string> = {
    [chainIds.mainnet]: "etherscan.io",
    [chainIds.arbitrum]: "arbiscan.io",
    [chainIds.optimism]: "optimistic.etherscan.io",
    [chainIds.polygon]: "polygonscan.com",
    [chainIds.gnosis]: "gnosisscan.io",
    [chainIds.base]: "basescan.org",
    [chainIds.zkevm]: "zkevm.polygonscan.com",
    [chainIds.avalanche]: "snowtrace.io",
    [chainIds.fraxtal]: "fraxscan.com",
};

export const blockExplorerApi: Record<SupportedChains, string> = {
    [chainIds.mainnet]: "api.etherscan.io",
    [chainIds.arbitrum]: "api.arbiscan.io",
    [chainIds.optimism]: "api-optimistic.etherscan.io",
    [chainIds.polygon]: "api.polygonscan.com",
    [chainIds.gnosis]: "api.gnosisscan.io",
    [chainIds.base]: "api.basescan.org",
    [chainIds.zkevm]: "api-zkevm.polygonscan.com",
    [chainIds.avalanche]: "api.routescan.io/v2/network/mainnet/evm/43114/etherscan",
    [chainIds.fraxtal]: "api.fraxscan.com",
};
interface AccountTxsResponse {
    status: string;
    message: string;
    result: EtherscanTransaction[];
}
type AccountTxsRequest = { chainId: number; address: string; startblock: number; endblock: number; apiKey: string };
export interface EtherscanTransaction {
    blockNumber: number;
    timeStamp: number;
    hash: string;
    nonce: number;
    blockHash: string;
    transactionIndex: number;
    from: string;
    to: string;
    value: string;
    gas: number;
    gasPrice: number;
    isError: string;
    txreceipt_status: string;
    input: string;
    contractAddress: string;
    cumulativeGasUsed: number;
    gasUsed: number;
    confirmations: number;
    methodId: string;
    functionName: string;
}

export async function getAccountTxs(params: AccountTxsRequest): Promise<AccountTxsResponse> {
    const { chainId, address, apiKey, startblock, endblock } = params;
    const url = `https://${blockExplorerApi[chainId]}/api?module=account&action=txlist&address=${address}&sort=asc&startblock=${startblock}&endblock=${endblock}&apiKey=${apiKey}`;

    try {
        // Fetch data from the URL
        const response = await axios.get<AccountTxsResponse>(url);
        const jsonData = response.data;

        // Check if the JSON object contains the result field
        if (!jsonData.result) {
            throw new Error("Invalid JSON response: missing result field");
        }
        return jsonData;
    } catch (error) {
        console.error("Error fetching txs", error);
        throw error;
    }
}
