import { BigNumber as BN, BigNumberish, ethers, utils } from "ethers";
import { gql, request } from "graphql-request";

import { HardhatRuntime } from "../utils/networkAddressFactory";

export interface PaladinQuest {
    to: string;
    title: string;
    totalBudget: BN;
    gauge: string;
    rewardToken: string;
    duration: number; // "uint48"
    objective: BigNumberish;
    rewardPerVote: BigNumberish;
    totalRewardAmount: BigNumberish;
    feeAmount: BigNumberish;
    blacklist: string[];
}
export interface TokenPrice {
    name: string;
    symbol: string;
    address: string;
    latestUSDPrice: number;
    decimals: number;
}

// Paladin
const darkQuestBoardAddress = "0x609FB23b9EA7CB3eDaF56DB5dAF07C8E94C155De";
const truncateNumber4D = (amount: BN) => utils.parseEther(utils.formatEther(amount).replace(/(\.\d{4})\d+/, "$1"));
const truncateNumber8D = (amount: BN) => utils.parseEther(utils.formatEther(amount).replace(/(\.\d{8})\d+/, "$1"));

export async function getTokenPrices(tokenAddresses: string[]): Promise<TokenPrice[]> {
    const endpoint = "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v2";
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
        const response = await request(endpoint, query, variables);
        tokenAddresses.forEach((_, i) => {
            console.log(`Token ${response.tokens[i].symbol}, latestUSDPrice: ${response.tokens[i].latestUSDPrice}`);
        });

        return response.tokens;
    } catch (error) {
        console.error("GraphQL request error:", error);
        return [];
    }
}
export async function getPlatformFee(hre: HardhatRuntime, signer: ethers.Signer) {
    const darkQuestBoardABI = ["function platformFee() external view returns(uint256)"];
    const darkQuestBoard = new hre.ethers.Contract(darkQuestBoardAddress, darkQuestBoardABI);
    const platformFee = await darkQuestBoard.connect(signer).platformFee();
    return platformFee;
}
export async function getTokenPricesMock(tokenAddresses: string[]): Promise<TokenPrice[]> {
    return [
        {
            name: "BAL",
            symbol: "BAL",
            address: tokenAddresses[0],
            latestUSDPrice: 5.14,
            decimals: 18,
        },
        {
            name: "AURA",
            symbol: "AURA",
            address: tokenAddresses[1],
            latestUSDPrice: 1.7,
            decimals: 18,
        },
    ];
}

export const calculateQuestAmounts = (totalBudget: BN, platformFee: BN) => {
    const pcBase = 100;
    const platformFeePc = platformFee.toNumber() / pcBase + pcBase;
    let totalRewardAmount: BigNumberish = totalBudget.mul(1).mul(pcBase).div(platformFeePc);
    totalRewardAmount = truncateNumber8D(totalRewardAmount);
    const feeAmount = totalBudget.sub(totalRewardAmount);
    if (!totalBudget.eq(totalRewardAmount.add(feeAmount))) throw Error("Error calculating quests amounts");
    return { totalRewardAmount, feeAmount };
};

export const calculateVotesAmounts = (totalRewardAmount: BN, auraPrice: number, veBALPrice: number, duration = 2) => {
    const scale = BN.from(10).pow(18);
    const rewardPerVote = ethers.utils.parseEther((veBALPrice / auraPrice).toFixed(4)); // 0.0425
    const objective = truncateNumber4D(totalRewardAmount.div(duration).mul(scale).div(rewardPerVote));
    return { objective, rewardPerVote };
};
