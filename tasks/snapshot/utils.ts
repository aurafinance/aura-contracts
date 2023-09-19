import { getAddress } from "ethers/lib/utils";
import * as fs from "fs";
import request, { gql } from "graphql-request";
import * as path from "path";
import { chainIds } from "../../tasks/utils";
import { networkLabels, priorityGuagesAddresses, symbolOverrides, validNetworks } from "./constants";

export interface Gauge {
    pool: {
        symbol: string;
        poolType: string;
        tokens: {
            weight: string;
            symbol: string;
            address: string;
        }[];
    };
    network: number;
    address: string;
}

export interface GaugeChoice {
    label: string;
    address: string;
}

export const compareAddresses = (a: string, b: string): boolean => {
    return a.toLowerCase() === b.toLowerCase();
};

export async function getGaugeSnapshot() {
    const balanceApiUrl = "https://api-v3.balancer.fi/";
    const query = gql`
        query VeBalGetVotingList {
            veBalGetVotingList {
                id
                address
                chain
                type
                symbol
                gauge {
                    address
                    isKilled
                    relativeWeightCap
                    addedTimestamp
                }
                tokens {
                    address
                    logoURI
                    symbol
                    weight
                }
            }
        }
    `;

    const nameToChainId = (name: string): number => {
        switch (name) {
            case "MAINNET":
                return chainIds.mainnet;
            case "BASE":
                return chainIds.base;
            case "OPTIMISM":
                return chainIds.optimism;
            case "AVALANCHE":
                return chainIds.avalanche;
            case "ZKEVM":
                return chainIds.zkevm;
            case "GNOSIS":
                return chainIds.gnosis;
            case "POLYGON":
                return chainIds.polygon;
            case "ARBITRUM":
                return chainIds.arbitrum;
        }
    };

    const resp = await request(balanceApiUrl, query);
    const data = resp.veBalGetVotingList.map((row: any) => ({
        address: row.gauge.address,
        network: nameToChainId(row.chain),
        isKilled: row.gauge.isKilled,
        addedTimestamp: row.gauge.addedTimestamp,
        relativeWeightCap: row.gauge.relativeWeightCap,
        pool: {
            id: row.id,
            address: row.address,
            poolType:
                row.type === "UNKNOWN"
                    ? ""
                    : row.type
                          .toLowerCase()
                          .split("_")
                          .map((str: string) => str.charAt(0).toUpperCase() + str.slice(1))
                          .join(""),
            symbol: row.symbol,
            tokens: row.tokens.map((token: any) => ({
                address: token.address,
                weight: token.weight,
                symbol: token.symbol,
            })),
        },
    }));

    return data;
}

export function getGaugeChoices(): Array<GaugeChoice> {
    // https://raw.githubusercontent.com/balancer/frontend-v2/develop/src/data/voting-gauges.json
    const savePath = path.resolve(__dirname, "./gauge_choices.json");
    return JSON.parse(fs.readFileSync(savePath, "utf-8"));
}

export function saveGaugeChoices(gauges: GaugeChoice[]) {
    fs.writeFileSync(path.resolve(__dirname, "./gauge_choices.json"), JSON.stringify(gauges));
}

export const parseLabel = (gauge: Gauge) => {
    if (getAddress(gauge.address) === getAddress("0xb78543e00712C3ABBA10D0852f6E38FDE2AaBA4d")) return "veBAL";
    if (getAddress(gauge.address) === getAddress("0x56124eb16441A1eF12A4CCAeAbDD3421281b795A")) return "veLIT";
    if (getAddress(gauge.address) === getAddress("0x5b79494824Bc256cD663648Ee1Aad251B32693A9")) return "veUSH";

    if (symbolOverrides[gauge.address.toLowerCase()]) return symbolOverrides[gauge.address.toLowerCase()];

    const networkStr = networkLabels[gauge.network] ? `${networkLabels[gauge.network]}-` : "";
    const weightStr =
        gauge.pool.poolType === "Weighted"
            ? gauge.pool.tokens.map(token => Math.floor(Number(token.weight) * 100)).join("/")
            : gauge.pool.poolType;

    const tokenStr = gauge.pool.tokens
        .map(token => symbolOverrides[token.address.toLowerCase()] || token.symbol)
        .join("/");
    if (gauge.pool.poolType === "StablePhantom") {
        return [networkStr, tokenStr].join("");
    }

    return networkStr + [weightStr, tokenStr].filter(Boolean).join(" ").trim();
};

export const sortGaugeList = (gaugeList: Gauge[]) => {
    const gauges = gaugeList.map(gauge => {
        if (getAddress(gauge.address) === getAddress("0x0312AA8D0BA4a1969Fddb382235870bF55f7f242")) {
            // auraBAL gauge
            return { ...gauge, pool: { ...gauge.pool, tokens: [gauge.pool.tokens[1], gauge.pool.tokens[0]] } };
        }

        // Deal with stable pools
        if (gauge.pool.tokens[0].weight === "null") {
            return gauge;
        }

        // Deal with WETH 50/50 pools
        const hasWeth = gauge.pool.tokens.some(token => token.symbol === "WETH");
        const is5050 = gauge.pool.tokens.filter(token => token.weight === "0.5").length == 2;
        if (hasWeth && is5050) {
            const tokens = gauge.pool.tokens.sort(a => (a.symbol === "WETH" ? 1 : -1));
            return { ...gauge, pool: { ...gauge.pool, tokens } };
        }

        // Sort all other pools by descending weight eg 80/20
        const tokens = gauge.pool.tokens.sort((a, b) => Number(b.weight) - Number(a.weight));
        return { ...gauge, pool: { ...gauge.pool, tokens } };
    });

    const chainOrder = [
        chainIds.mainnet,
        chainIds.arbitrum,
        chainIds.polygon,
        chainIds.optimism,
        chainIds.gnosis,
        chainIds.zkevm,
        chainIds.base,
        chainIds.avalanche,
    ];

    if (chainOrder.length !== validNetworks.length) {
        throw Error("Chain order wrong length");
    }

    const networkOrder = chainOrder.reduce((acc, chainId) => {
        return [...acc, ...gauges.filter(g => g.network === chainId)];
    }, []);

    const priorityGuages = priorityGuagesAddresses.map(addr =>
        gauges.find(g => g.address.toLowerCase() === addr.toLowerCase()),
    );
    return [...priorityGuages, ...networkOrder.filter(x => !priorityGuagesAddresses.includes(x.address.toLowerCase()))];
};

export const ordinalSuffix = (i: number) => {
    const j = i % 10;
    const k = i % 100;
    if (j == 1 && k != 11) {
        return i + "st";
    }
    if (j == 2 && k != 12) {
        return i + "nd";
    }
    if (j == 3 && k != 13) {
        return i + "rd";
    }
    return i + "th";
};
