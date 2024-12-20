import axios from "axios";
import { BigNumber as BN, BigNumberish, ethers } from "ethers";

import { calculateVeBalPrice, getTokenPrices } from "../utils/balancerApi";
import { AxiosResult } from "types/common";

const log = console.log;

const PROPOSALS_URL = "https://api.hiddenhand.finance/proposal/aura";
const REWARDS_URL = "https://api.hiddenhand.finance/reward/0/";

interface Birb {
    symbol: string;
    token: string;
    amount: number;
    chainId: number;
    value: BigNumberish;
}
interface Proposal {
    proposal: number;
    proposalHash: string;
    title: string;
    proposalDeadline: number;
    totalValue: number;
    voteCount: number;
    valuePerVote: number;
    bribes: Array<Birb>;
}

type ClaimMetadata = {
    identifier: string;
    account: string;
    amount: string;
    merkleProof: Array<string>;
};
interface ClaimReward {
    symbol: string;
    name: string;
    token: string;
    decimals: number;
    chainId: number;
    protocol: string;
    claimable: number;
    cumulativeAmount: string;
    value: number;
    activeTimer: number;
    pausedTimer: number;
    claimMetadata: ClaimMetadata;
}
export interface Incentive {
    to: string;
    title: string;
    proposal: Proposal;
    amount: BN;
    maxTokensPerVote?: BN;
    ratio: number;
    periods: number;
}

const auraTokenAddress = "0xc0c293ce456ff0ed870add98a0828dd4d2903dbf";
const balTokenAddress = "0xba100000625a3754423978a60c9317c58a424e3d";

/**
 * Download the latests aura proposals from https://api.hiddenhand.finance/proposal/aura
 *
 * @return {Promise}  -  { Promise<Array<Proposal>>}
 */
export const fetchAuraProposals_ = async (): Promise<Array<Proposal>> => {
    const url = `${PROPOSALS_URL}`;

    log(`fetches hidden hands aura proposals ${url}`);
    const response = await axios.get<AxiosResult<Proposal>>(url);
    if (response.data.error) throw new Error("Unable to retrieve proposals");
    return response.data.data;
};
export const fetchAuraProposals = async (proposalFilter = auraOnlyFilter): Promise<Array<Proposal>> => {
    const url = `${PROPOSALS_URL}`;

    log(`fetches hidden hands aura proposals ${url}`);
    const response = await axios.get<AxiosResult<Proposal>>(url);
    if (response.data.error) throw new Error("Unable to retrieve proposals.");
    if (!validateDeadLine(response.data.data)) throw new Error("Deadline must be in the future.");
    return response.data.data.filter(proposalFilter);
};

export const fetchClaimableRewards = async (claimer: string): Promise<Array<ClaimReward>> => {
    const url = `${REWARDS_URL}${claimer}`;

    log(`fetches hidden hands aura claims ${url}`);
    const response = await axios.get<AxiosResult<ClaimReward>>(url);
    if (response.data.error) throw new Error("Unable to retrieve proposals");
    return response.data.data;
};

export const validateDeadLine = (proposals: Array<Proposal>): boolean => {
    const now = Number.parseInt((new Date().getTime() / 1000).toFixed(0));
    return proposals[0].proposalDeadline > now;
};
export const isAuraBalProposal = (p: Proposal) => p.title == "Stable auraBAL/B-80BAL-20WETH"; // proposal 0x0312aa8d0ba4a1969fddb382235870bf55f7f242
export const isAuraEthProposal = (p: Proposal) => p.title == "50/50 AURA/WETH"; // proposal 0x275df57d2b23d53e20322b4bb71bf1dcb21d0a00
export const isARBAuraBalwstEthProposal = (p: Proposal) => p.title == "a-55/45 auraBAL/wstETH"; //proposal 0x175407b4710b5a1cb67a37c76859f17fb2ff6672

export const notFilter = (__: Proposal) => true;
export const auraOnlyFilter = (p: Proposal) =>
    isAuraBalProposal(p) || isAuraEthProposal(p) || isARBAuraBalwstEthProposal(p);

/**
 * Get the latests market rounds from https://api.hiddenhand.finance/round/market,
 * it returns an array of objects with the following structure:
 *       {
 *           "timestamp": "1735171200",
 *           "data": {
 *               "totalVote": 4958521.586827322,
 *               "emissionValuePerVote": 0.0599651320020154
 *           }
 *       },
 */
const getRoundInfo = async (market: string) => {
    console.log(`fetches hidden hands round info ${market}`);
    const url = `https://api.hiddenhand.finance/round/${market}`;
    return (await axios.get(url)).data;
};

export const getHiddenHandConf = async () => {
    // const prices = await getTokenPricesMock([balTokenAddress, auraTokenAddress]);
    const balancerRoundInfo = await getRoundInfo("balancer");
    const auraRoundInfo = await getRoundInfo("aura");
    const now = Number.parseInt((new Date().getTime() / 1000).toFixed(0));
    const [balancerRound] = balancerRoundInfo.data;
    const [auraRound] = auraRoundInfo.data;

    if (balancerRound.timestamp < now) throw new Error("Round timestamp must be in the future.");
    if (auraRound.timestamp < now) throw new Error("Round timestamp must be in the future.");

    const prices = await getTokenPrices([balTokenAddress, auraTokenAddress]);
    const balPrice = Number.parseFloat(
        prices.find(tp => tp.address === balTokenAddress).latestUSDPrice as unknown as string,
    );
    const auraPrice = Number.parseFloat(
        prices.find(tp => tp.address === auraTokenAddress).latestUSDPrice as unknown as string,
    );
    const veBALPrice = Number.parseFloat(balancerRound.data.emissionValuePerVote);
    const vlAuraPrice = Number.parseFloat(auraRound.data.emissionValuePerVote);

    console.log(
        `Prices: aura [${auraPrice}], bal [${balPrice.toString()}], veBAL [${veBALPrice.toFixed(
            4,
        )}], vlAura [${vlAuraPrice.toFixed(4)}]`,
    );

    return {
        balPrice,
        auraPrice,
        veBALPrice,
        vlAuraPrice,
    };
};

export const calculateVlAuraPrice = (auraPrice: number) => {
    const weeklyEmission = 121929.980212;
    const totalVotes = 7900000;
    const premium = 0.8;
    const dollarEmission = auraPrice * weeklyEmission;
    const vlAuraPrice = (dollarEmission / totalVotes) * premium;
    console.log(
        `Calculate veBal: weeklyEmission [${weeklyEmission}] totalVotes [${totalVotes}] auraPrice [${auraPrice}] vlAuraPrice [${vlAuraPrice}]`,
    );
    return Number(vlAuraPrice.toFixed(5));
};
