import { gql, request } from "graphql-request";
import { chainIds } from "./networkAddressFactory";
type GaugePid = {
    id: string;
    pool: {
        id: string;
    };
};
export type GaugeRewardToken = {
    id: number;
    gauge: { id: string };
    factoryPoolData: { stash: string };
    rewardData: [{ token: { id: string } }];
};

const SUBGRAPH_URI = "https://api.subgraph.ormilabs.com/api/public/396b336b-4ed7-469f-a8f4-468e1e26e9a8/subgraphs";
const subgraphUrls = {
    [chainIds.mainnet]: `${SUBGRAPH_URI}/aura-finance-mainnet/v0.0.1/`,
    [chainIds.arbitrum]: `${SUBGRAPH_URI}/aura-finance-arbitrum/v0.0.1/`,
    [chainIds.gnosis]: `${SUBGRAPH_URI}/aura-finance-gnosis/v0.0.4/`,
    [chainIds.optimism]: `${SUBGRAPH_URI}/aura-finance-optimism/v0.0.1/`,
    [chainIds.polygon]: `${SUBGRAPH_URI}/aura-finance-polygon/v0.0.1/`,
    [chainIds.base]: `${SUBGRAPH_URI}/aura-finance-base/v0.0.1/`,
    [chainIds.zkevm]: `${SUBGRAPH_URI}/aura-finance-zkevm/v0.0.1/`,
    [chainIds.avalanche]: `${SUBGRAPH_URI}/aura-finance-avalanche/v0.0.1/`,
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
                factoryPoolData {
                    stash
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
