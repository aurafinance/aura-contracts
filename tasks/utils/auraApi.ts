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
    extraRewards: [{ token: { id: string } }];
};

const SIDECHAIN_URI = "https://subgraph.satsuma-prod.com/36b05229a1f6/1xhub-ltd";
const subgraphUrls = {
    [chainIds.mainnet]: `${SIDECHAIN_URI}/aura-finance-mainnet/api`,
    [chainIds.arbitrum]: `${SIDECHAIN_URI}/aura-finance-arbitrum/api`,
    [chainIds.gnosis]: `${SIDECHAIN_URI}/aura-finance-gnosis/api`,
    [chainIds.optimism]: `${SIDECHAIN_URI}/aura-finance-optimism/api`,
    [chainIds.polygon]: `${SIDECHAIN_URI}/aura-finance-polygon/api`,
    [chainIds.base]: `${SIDECHAIN_URI}/aura-finance-base/api`,
    [chainIds.zkevm]: `${SIDECHAIN_URI}/aura-finance-zkevm/api`,
    [chainIds.avalanche]: `${SIDECHAIN_URI}/aura-finance-avalanche/api`,
    [chainIds.fraxtal]: `https://graph.data.aura.finance/subgraphs/name/aura-finance-fraxtal`,
};
export async function getGaugePid(chainId: number, gaugeAddresses: string[]): Promise<GaugePid[]> {
    const endpoint = subgraphUrls[chainId];
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
                extraRewards {
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
