import { BigNumber as BN, BigNumberish, ethers, utils } from "ethers";
import { gql, request } from "graphql-request";

import { HardhatRuntime } from "../utils/networkAddressFactory";
interface PaladinQuestGeneric {
    to: string;
    title: string;
    totalBudget: BN;
    rewardToken: string;
    duration: number; // "uint48"
    objective: BigNumberish;
    rewardPerVote: BigNumberish;
    totalRewardAmount: BigNumberish;
    feeAmount: BigNumberish;
    blacklist: string[];
}

export interface PaladinQuestDarkBoard extends PaladinQuestGeneric {
    gauge: string;
}
export interface PaladinQuestWardenScheduler extends PaladinQuestGeneric {
    pid: number;
}

export type PaladinQuest = PaladinQuestDarkBoard | PaladinQuestWardenScheduler;

export interface TokenPrice {
    name: string;
    symbol: string;
    address: string;
    latestUSDPrice: number;
    decimals: number;
}

// Paladin
const darkQuestBoardAddress = "0x609FB23b9EA7CB3eDaF56DB5dAF07C8E94C155De";
const auraTokenAddress = "0xc0c293ce456ff0ed870add98a0828dd4d2903dbf";
const balTokenAddress = "0xba100000625a3754423978a60c9317c58a424e3d";
const auraVoterProxyAddress = "0xaF52695E1bB01A16D33D7194C28C42b10e0Dbec2";
const tetuBalLockerAddress = "0x9cC56Fa7734DA21aC88F6a816aF10C5b898596Ce";

const truncateNumber4D = (amount: BN) => utils.parseEther(utils.formatEther(amount).replace(/(\.\d{4})\d+/, "$1"));
const truncateNumber8D = (amount: BN) => utils.parseEther(utils.formatEther(amount).replace(/(\.\d{8})\d+/, "$1"));

async function getTokenPrices(tokenAddresses: string[]): Promise<TokenPrice[]> {
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
async function getPlatformFee(hre: HardhatRuntime, signer: ethers.Signer) {
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

export const buildPaladinQuest = ({
    title,
    totalBudget,
    gauge = undefined,
    pid = -99,
    to,
    rewardToken,
    duration,
    blacklist,
    platformFee,
    auraPrice,
    veBALPrice,
}): PaladinQuest => {
    const questAmounts = calculateQuestAmounts(totalBudget, platformFee);
    const votesAmounts = calculateVotesAmounts(questAmounts.totalRewardAmount, auraPrice, veBALPrice);
    return {
        title,
        totalBudget,
        to,
        gauge,
        pid,
        rewardToken,
        duration,
        objective: votesAmounts.objective,
        rewardPerVote: votesAmounts.rewardPerVote,
        totalRewardAmount: questAmounts.totalRewardAmount,
        feeAmount: questAmounts.feeAmount,
        blacklist,
    };
};

const getQuestDefaults = () => {
    const blacklist = [auraVoterProxyAddress, tetuBalLockerAddress];
    const duration = 2; // 2 WEEKS

    return { to: darkQuestBoardAddress, rewardToken: auraTokenAddress, duration, blacklist };
};

const calculateVeBalPrice = (balPrice: number) => {
    const weeklyEmission = 121929.980212;
    const totalVotes = 9300000;
    const premium = 1.05;
    const dollarEmission = balPrice * weeklyEmission;
    const veBALPrice = (dollarEmission / totalVotes) * premium;
    return Number(veBALPrice.toFixed(5));
};

export const getPaladinConf = async (hre: HardhatRuntime, signer: ethers.Signer) => {
    const platformFee = await getPlatformFee(hre, signer); //Current value is 400

    // const prices = await getTokenPricesMock([balTokenAddress, auraTokenAddress]);
    const prices = await getTokenPrices([balTokenAddress, auraTokenAddress]);
    const balPrice = prices.find(tp => tp.address === balTokenAddress).latestUSDPrice;
    const auraPrice = prices.find(tp => tp.address === auraTokenAddress).latestUSDPrice;
    const veBALPrice = calculateVeBalPrice(balPrice);
    const paladinConf = { ...getQuestDefaults(), platformFee, auraPrice, veBALPrice };

    return paladinConf;
};
