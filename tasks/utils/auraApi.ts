import { gql, request } from "graphql-request";
import { chainIds } from "./networkAddressFactory";
type GaugePid = {
    id: string;
    pool: {
        id: string;
    };
};
type GaugeRewardToken = {
    id: number;
    gauge: { id: string };
    rewardData: [{ token: { id: string } }];
};

const SIDECHAIN_URI = " https://api.thegraph.com/subgraphs/name/aurafinance/aura-finance";
const subgraphUrls = {
    [chainIds.mainnet]: `https://graph.data.aura.finance/subgraphs/name/aura/aura-mainnet-v2-1`,
    [chainIds.arbitrum]: `${SIDECHAIN_URI}-arbitrum`,
    [chainIds.gnosis]: `${SIDECHAIN_URI}-gnosis-chain`,
    [chainIds.optimism]: `${SIDECHAIN_URI}-optimism`,
    [chainIds.polygon]: `${SIDECHAIN_URI}-polygon`,
};
export async function getGaugePid(gaugeAddresses: string[]): Promise<GaugePid[]> {
    const endpoint = "https://graph.data.aura.finance/subgraphs/name/aura/aura-mainnet-v2-1";
    const query = gql`
        query GetGaugePid($gaugeAddresses: [String!]!) {
            gauges(where: { id_in: $gaugeAddresses }) {
                id
                pool {
                    id
                }
            }
        }
    `;
    // Define the query variables
    const variables = { gaugeAddresses };

    try {
        // Make the GraphQL request
        const response = await request<{ gauges: Array<GaugePid> }>(endpoint, query, variables);
        return response.gauges;
    } catch (error) {
        console.error("GraphQL request error:", error);
        return [];
    }
}

export async function getGaugeRewardTokens(chainId: number, gaugeAddresses: string[]): Promise<GaugeRewardToken[]> {
    const endpoint = subgraphUrls[chainId];
    const query = gql`
        query getGaugeRewardTokens($gaugeAddresses: [String!]!) {
            pools(where: { gauge_in: $gaugeAddresses }) {
                id
                gauge {
                    id
                }
                rewardData {
                    token {
                        id
                    }
                }
            }
        }
    `;
    // Define the query variables
    const variables = { gaugeAddresses };

    try {
        // Make the GraphQL request
        const response = await request<{ pools: Array<GaugeRewardToken> }>(endpoint, query, variables);
        return response.pools;
    } catch (error) {
        console.error("GraphQL request error:", error);
        return [];
    }
}
