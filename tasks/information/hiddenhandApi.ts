import axios from "axios";
import { BigNumber as BN, BigNumberish } from "ethers";

const log = console.log;

const URL = "https://api.hiddenhand.finance/proposal/aura";

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
export interface Incentive {
    to: string;
    title: string;
    proposal: Proposal;
    amount: BN;
    ratio: number;
}
interface HiddenHandsProposals {
    error: boolean;
    data: Array<Proposal>;
}

/**
 * Download the latests aura proposals from https://api.hiddenhand.finance/proposal/aura
 *
 * @return {Promise}  -  { Promise<Array<Proposal>>}
 */
export const fetchAuraProposals_ = async (): Promise<Array<Proposal>> => {
    const url = `${URL}`;

    log(`fetches hidden hands aura proposals ${url}`);
    const response = await axios.get<HiddenHandsProposals>(url);
    if (response.data.error) throw new Error("Unable to retrieve proposals");
    return response.data.data;
};
export const validateDeadLine = (proposals: Array<Proposal>): boolean => {
    const now = Number.parseInt((new Date().getTime() / 1000).toFixed(0));
    return proposals[0].proposalDeadline > now;
};
export const isAuraBalProposal = (p: Proposal) => p.proposal == 1 && p.title == "Stable auraBAL/B-80BAL-20WETH";
export const isAuraEthProposal = (p: Proposal) => p.proposal == 2 && p.title == "50/50 AURA/WETH";
export const notFilter = (__: Proposal) => true;
export const auraOnlyFilter = (p: Proposal) => isAuraBalProposal(p) || isAuraEthProposal(p);

export const fetchAuraProposals = async (proposalFilter = auraOnlyFilter): Promise<Array<Proposal>> => {
    const url = `${URL}`;

    log(`fetches hidden hands aura proposals ${url}`);
    const response = await axios.get<HiddenHandsProposals>(url);
    if (response.data.error) throw new Error("Unable to retrieve proposals.");
    if (!validateDeadLine(response.data.data)) throw new Error("Deadline must be in the future.");
    return response.data.data.filter(proposalFilter);
};
