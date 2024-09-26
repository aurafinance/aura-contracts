import { gql, request } from "graphql-request";
interface TokenPricesResult {
    tokens: Array<TokenPrice>;
}

type GaugeType = {
    id: number;
    name: string;
};
type RootGauge = {
    id: string;
    chain: string;
    recipient: string;
    isKilled: boolean;
};
type LiquidityGauge = {
    id: string;
    symbol: string;
    isKilled: boolean;
};
export type GaugesDetails = {
    id: string;
    address: string;
    type: GaugeType;
    rootGauge?: RootGauge;
    liquidityGauge?: LiquidityGauge;
};
interface GetGaugesDetailsResult {
    gauges: Array<GaugesDetails>;
}
export interface TokenPrice {
    name: string;
    symbol: string;
    address: string;
    latestUSDPrice: number;
    decimals: number;
}
const debug = false;

export async function getTokenPrices(tokenAddresses: string[]): Promise<TokenPrice[]> {
    const endpoint = "https://api.studio.thegraph.com/query/75376/balancer-v2/version/latest";
    const query = gql`
        query GetTokenPrice($tokenAddresses: [String!]!) {
            tokens(where: { address_in: $tokenAddresses }) {
                name
                symbol
                address
                latestUSDPrice
                decimals
            }
        }
    `;

    // Define the query variables
    const variables = {
        tokenAddresses: tokenAddresses,
    };

    try {
        // Make the GraphQL request
        const response = await request<TokenPricesResult>(endpoint, query, variables);
        tokenAddresses.forEach((_, i) => {
            console.log(`Token ${response.tokens[i].symbol}, latestUSDPrice: ${response.tokens[i].latestUSDPrice}`);
        });

        return response.tokens;
    } catch (error) {
        console.error("GraphQL request error:", error);
        return [];
    }
}
export async function getTokenPricesMock(tokenAddresses: string[]): Promise<TokenPrice[]> {
    return [
        {
            name: "BAL",
            symbol: "BAL",
            address: tokenAddresses[0],
            latestUSDPrice: 4.88,
            decimals: 18,
        },
        {
            name: "AURA",
            symbol: "AURA",
            address: tokenAddresses[1],
            latestUSDPrice: 1.71,
            decimals: 18,
        },
    ];
}
function normalizeChainName(gauge: GaugesDetails): GaugesDetails {
    if (gauge.rootGauge && gauge.rootGauge.chain === "PolygonZkEvm") {
        gauge.rootGauge.chain = "ZkEvm";
    }
    return gauge;
}
export async function getGaugesDetails(gaugeAddresses: string[]): Promise<GaugesDetails[]> {
    const endpoint = "https://api.studio.thegraph.com/query/75376/balancer-gauges/version/latest/";
    const query = gql`
        query GetGaugesDetails($gaugeAddresses: [String!]!) {
            gauges(first: 200, where: { address_in: $gaugeAddresses }) {
                id
                address
                type {
                    id
                    name
                }
                rootGauge {
                    id
                    chain
                    recipient
                    isKilled
                }
                liquidityGauge {
                    id
                    symbol
                    isKilled
                }
            }
        }
    `;

    // Define the query variables
    const variables = {
        gaugeAddresses: gaugeAddresses,
    };

    try {
        // Make the GraphQL request
        const response = await request<GetGaugesDetailsResult>(endpoint, query, variables);
        if (debug) {
            response.gauges.forEach(gauge => {
                console.log(
                    `Gauge ${gauge.address}, chain: ${gauge.rootGauge?.chain ?? gauge.type.name}, recipient: ${
                        gauge.rootGauge?.recipient
                    }, symbol: ${gauge.liquidityGauge?.symbol}`,
                );
            });
        }

        return response.gauges.map(normalizeChainName);
    } catch (error) {
        console.error("GraphQL request error:", error);
        return [];
    }
}
export const calculateVeBalPrice = (balPrice: number) => {
    const weeklyEmission = 121929.980212;
    const totalVotes = 7900000;
    const premium = 0.8;
    const dollarEmission = balPrice * weeklyEmission;
    const veBALPrice = (dollarEmission / totalVotes) * premium;
    console.log(
        `Calculate veBal: weeklyEmission [${weeklyEmission}] totalVotes [${totalVotes}] balPrice [${balPrice}] veBALPrice [${veBALPrice}]`,
    );
    return Number(veBALPrice.toFixed(5));
};
