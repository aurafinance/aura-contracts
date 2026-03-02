import { chainIds } from "../utils/networkAddressFactory";

export const INCENTIVE_GAUGES = {
    AURA_WETH_50_50: {
        name: "50/50 AURA/WETH",
        gauge: "0x275dF57d2B23d53e20322b4bb71Bf1dCb21D0A00",
        chainId: chainIds.mainnet,
    },
    AURABAL_BAL_WETH_STABLE: {
        name: "Stable auraBAL/B-80BAL-20WETH",
        gauge: "0x0312AA8D0BA4a1969Fddb382235870bF55f7f242",
        chainId: chainIds.mainnet,
    },
    ARB_AURABAL_WSTETH_55_45: {
        name: "a-55/45 auraBAL/wstETH",
        gauge: "0x175407b4710b5A1cB67a37C76859F17fb2ff6672",
        chainId: chainIds.arbitrum,
    },
} as const;
