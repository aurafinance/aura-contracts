import * as fs from "fs";
import * as path from "path";
import { networkLabels, priorityGuagesAddresses, symbolOverrides } from "./constants";

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

export function getGaugeSnapshot() {
    // https://raw.githubusercontent.com/balancer/frontend-v2/develop/src/data/voting-gauges.json
    const savePath = path.resolve(__dirname, "./gauge_snapshot.json");
    return JSON.parse(fs.readFileSync(savePath, "utf-8"));
}

export function getGaugeChoices() {
    // https://raw.githubusercontent.com/balancer/frontend-v2/develop/src/data/voting-gauges.json
    const savePath = path.resolve(__dirname, "./gauge_choices.json");
    return JSON.parse(fs.readFileSync(savePath, "utf-8"));
}

export function saveGaugeChoices(gauges: GaugeChoice[]) {
    fs.writeFileSync(path.resolve(__dirname, "./gauge_choices.json"), JSON.stringify(gauges));
}

export const parseLabel = (gauge: Gauge) => {
    if (gauge.pool.symbol === "veBAL") return "veBAL";

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

    return [networkStr, weightStr, " ", tokenStr].join("");
};

export const sortGaugeList = (gaugeList: Gauge[]) => {
    const gauges = gaugeList.map(gauge => {
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

    const chainOrder = [1, 42161, 137, 10];

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
