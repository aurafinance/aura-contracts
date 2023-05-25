import { BigNumber as BN, utils } from "ethers";
import * as fs from "fs";
import { task, types } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import * as path from "path";
import { Phase2Deployed } from "scripts/deploySystem";

import { ChefForwarder__factory } from "../../types/generated";
import { config } from "../deploy/mainnet-config";
import { getSigner } from "../utils";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import { fetchAuraProposals, isAuraBalProposal, isAuraEthProposal, Incentive } from "./hiddenhandApi";
import {
    calculateQuestAmounts,
    calculateVotesAmounts,
    getPlatformFee,
    getTokenPrices,
    PaladinQuest,
} from "./paladinApi";

const auraTokenAddress = "0xc0c293ce456ff0ed870add98a0828dd4d2903dbf";
const balTokenAddress = "0xba100000625a3754423978a60c9317c58a424e3d";

const chefForwarderAddress = "0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9";
const vlAuraIncentiveAddress = "0x642c59937A62cf7dc92F70Fd78A13cEe0aa2Bd9c";
const veBalIncentiveAddress = "0x7Cdf753b45AB0729bcFe33DC12401E55d28308A9";
const auraEthVeBALId = "0xb355f196c7ab330d85a3a392623204f81c8f2d668baaeda4e78f87c9f50bef04";
const auraBalVeBALId = "0xa2b574c32fbe12ce1e12ebb850253595ef7087671c213241076b924614822a20";
const scale = BN.from(10).pow(18);

// Paladin
const darkQuestBoardAddress = "0x609FB23b9EA7CB3eDaF56DB5dAF07C8E94C155De";
const auraBalStableGaugeAddress = "0x0312AA8D0BA4a1969Fddb382235870bF55f7f242";
const aura50Eth50GaugeAddress = "0x275dF57d2B23d53e20322b4bb71Bf1dCb21D0A00";
const auraVoterProxyAddress = "0xaF52695E1bB01A16D33D7194C28C42b10e0Dbec2";
const tetuBalLockerAddress = "0x9cC56Fa7734DA21aC88F6a816aF10C5b898596Ce";

const truncateNumber = (amount: BN, decimals: number) => Number(utils.formatUnits(amount, decimals)).toFixed(0);

const roundDown = (amount: string) =>
    Number(amount.slice(2)) < 500 ? amount.slice(0, 2) + "000" : amount.slice(0, 2) + "500";

/**
 *  It gets the amount of rewards claimable by the chef forwarder.
 * @param {HardhatRuntime} hre - The Hardhat runtime environment
 * @return {*}  {Promise<number>}
 */
const getChefClaimableRewards = async (hre: HardhatRuntime): Promise<number> => {
    const signer = await getSigner(hre);
    const phase2: Phase2Deployed = await config.getPhase2(signer);
    const chefForwarder = ChefForwarder__factory.connect(chefForwarderAddress, signer);

    if (hre.network.name !== "hardhat") throw new Error("!Only task:fork");
    process.env.IMPERSONATE = await chefForwarder.briber();

    const briberSigner = await getSigner(hre);
    const tx = await chefForwarder.connect(briberSigner).claim(phase2.cvx.address);
    const receipt = await tx.wait();
    const event = receipt.events?.find(e => e.address === phase2.chef.address);
    const rewardAmount = BN.from(event.data);
    // round down to NN000 or NN500 only
    const roundedDown = roundDown(truncateNumber(rewardAmount, 18));
    console.log(`RewardPaid amount ${utils.formatEther(rewardAmount)}, rounded down ${roundedDown}`);

    process.env.IMPERSONATE = undefined;
    return Number(roundedDown);
};

const scaleIncentiveAmount = (incentive: Incentive) => ({
    ...incentive,
    amount: BN.from(incentive.amount.mul(incentive.ratio).div(100)).mul(scale),
});
const txMeta = (transactions: Array<any>) => ({
    version: "1.0",
    chainId: "1",
    createdAt: Date.now(),
    meta: {
        name: "Incentives",
        description: "",
        txBuilderVersion: "1.13.3",
        createdFromSafeAddress: "0x21AED3a7A1c34Cd88B8A39DbDAE042bEfbf947ff",
        createdFromOwnerAddress: "",
        checksum: "0x6d8250468836cc9b24a5a2380ec1ceecece70ab3f66eed3e68bf2a4ca05d3d90",
    },
    transactions,
});

const chefClaimTx = {
    to: chefForwarderAddress,
    value: "0",
    data: null,
    contractMethod: {
        inputs: [{ internalType: "address", name: "token", type: "address" }],
        name: "claim",
        payable: false,
    },
    contractInputsValues: {
        token: auraTokenAddress,
    },
};
const auraApprovalTx = (amount: BN) => ({
    to: auraTokenAddress,
    value: "0",
    data: null,
    contractMethod: {
        inputs: [
            { internalType: "address", name: "spender", type: "address" },
            { internalType: "uint256", name: "amount", type: "uint256" },
        ],
        name: "approve",
        payable: false,
    },
    contractInputsValues: {
        spender: "0x9DDb2da7Dd76612e0df237B89AF2CF4413733212",
        amount: amount.toString(),
    },
});
const depositBribeERC20Tx = (incentive: Incentive) => {
    console.log(
        `${incentive.title} hash: ${incentive.proposal.proposalHash} amount: ${utils.formatEther(incentive.amount)}`,
    );
    return {
        to: incentive.to,
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                { internalType: "bytes32", name: "proposal", type: "bytes32" },
                { internalType: "address", name: "token", type: "address" },
                { internalType: "uint256", name: "amount", type: "uint256" },
            ],
            name: "depositBribeERC20",
            payable: false,
        },
        contractInputsValues: {
            proposal: incentive.proposal.proposalHash,
            token: auraTokenAddress,
            amount: incentive.amount.toString(),
        },
    };
};
const createQuestTx = (quest: PaladinQuest) => {
    console.log(
        `${quest.title} totalBudget: ${utils.formatEther(quest.totalBudget)} Fixed Reward: ${utils.formatEther(
            quest.rewardPerVote,
        )} AURA/veBAL`,
    );
    return {
        to: quest.to,
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                { internalType: "address", name: "gauge", type: "address" },
                { internalType: "address", name: "rewardToken", type: "address" },
                { internalType: "uint48", name: "duration", type: "uint48" },
                { internalType: "uint256", name: "objective", type: "uint256" },
                { internalType: "uint256", name: "rewardPerVote", type: "uint256" },
                { internalType: "uint256", name: "totalRewardAmount", type: "uint256" },
                { internalType: "uint256", name: "feeAmount", type: "uint256" },
                { internalType: "address[]", name: "blacklist", type: "address[]" },
            ],
            name: "createQuest",
            payable: false,
        },
        contractInputsValues: {
            gauge: quest.gauge,
            rewardToken: quest.rewardToken,
            duration: quest.duration,
            objective: quest.objective.toString(),
            rewardPerVote: quest.rewardPerVote.toString(),
            totalRewardAmount: quest.totalRewardAmount.toString(),
            feeAmount: quest.feeAmount.toString(),
            blacklist: `[${quest.blacklist.join(",")}]`,
        },
    };
};

task("info:chef:claim").setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
    await getChefClaimableRewards(hre);
});

task("create:hh:incentives")
    .addOptionalParam("auraEthAmount", "Amount of aura eth incentive, default is 30000", 30_000, types.int)
    .addOptionalParam("auraEthVlRatio", "Vl Aura ratio, default is 100", 100, types.int)
    .addOptionalParam("auraBalVlRatio", "Vl Aura ratio, default is 25", 25, types.int)
    .addOptionalParam("auraEthVeBalRatio", "VeBal ratio, default is 0", 0, types.int)
    .addOptionalParam("auraBalVeBalRatio", "VeBal ratio, default is 75", 75, types.int)
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
        const { auraEthAmount, auraEthVlRatio, auraBalVlRatio, auraEthVeBalRatio, auraBalVeBalRatio } = taskArgs;
        const auraBalAmount = (await getChefClaimableRewards(hre)).valueOf();
        const hhAuraProposals = await fetchAuraProposals();

        if (hhAuraProposals.length != 2) throw new Error("No proposals found");
        const auraEthProposal = hhAuraProposals.find(isAuraEthProposal);
        const auraBalProposal = hhAuraProposals.find(isAuraBalProposal);

        const incentives = [
            {
                title: "1. aura/eth vlAURA",
                to: vlAuraIncentiveAddress,
                proposal: auraEthProposal,
                amount: BN.from(auraEthAmount),
                ratio: auraEthVlRatio,
            },
            {
                title: "2. auraBAL  vlAURA",
                to: vlAuraIncentiveAddress,
                proposal: auraBalProposal,
                amount: BN.from(auraBalAmount),
                ratio: auraBalVlRatio,
            },
            {
                title: "3. aura/eth veBAL ",
                to: veBalIncentiveAddress,
                proposal: { ...auraEthProposal, proposalHash: auraEthVeBALId },
                amount: BN.from(auraEthAmount),
                ratio: auraEthVeBalRatio,
            },
            {
                title: "4. auraBAL  veBAL ",
                to: veBalIncentiveAddress,
                proposal: { ...auraBalProposal, proposalHash: auraBalVeBALId },
                amount: BN.from(auraBalAmount),
                ratio: auraBalVeBalRatio,
            },
        ];
        /* -------------------------------------------------------
         * 1.- Calculate amounts and prepare deposits (ids, scales)
         * ----------------------------------------------------- */

        const depositTsx = incentives
            .map(scaleIncentiveAmount)
            .filter(i => i.amount.gt(0))
            .map(depositBribeERC20Tx);
        const totalDeposits = depositTsx
            .map(d => BN.from(d.contractInputsValues.amount))
            .reduce((a, b) => a.add(b), BN.from(0));
        console.log("   totalDeposits:", utils.formatEther(totalDeposits));
        /* -------------------------------------------------------
         * 2.- Generate incentives tx
         * ----------------------------------------------------- */

        const incentivesTransactions = txMeta(
            [].concat(chefClaimTx).concat(auraApprovalTx(totalDeposits)).concat(depositTsx),
        );
        fs.writeFileSync(
            path.resolve(__dirname, "./gnosis_tx_hh_incentives.json"),
            JSON.stringify(incentivesTransactions),
        );
        console.log(`Gnosis tx builder generated at ${__dirname}/gnosis_tx_hh_incentives.json`);
    });

/**
 * Generates Transaction Builder file to create paladin quest incentives
 * Example :
 *   Input
 *       `yarn task:fork create:paladin:incentives  --aura-eth-amount 40000 --aura-bal-amount 48000`
 *   Output
 *       Token BAL, latestUSDPrice: 5.233117611442983836400985490558274
 *       Token AURA, latestUSDPrice: 1.711854385136804862443685518169823
 *       1. aura/eth veBAL totalBudget: 40000.0 Fixed Reward: 0.0428 AURA/veBAL
 *       2. auraBAL  veBAL totalBudget: 48000.0 Fixed Reward: 0.0428 AURA/veBAL
 *       Total Aura: 88000.0 calculated $/veBAL: 0.07325
 *       Gnosis tx builder generated at .../tasks/information/gnosis_tx_paladin_incentives.json
 *
 */
task("create:paladin:incentives")
    .addOptionalParam("auraEthAmount", "Amount of aura/eth incentive, default is 40000", 40_000, types.int)
    .addOptionalParam("auraBalAmount", "Amount of auraBal incentive, suggested is 48_000", 0, types.int)
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
        // --------------------- CONFIGURATIONS -------------- //
        // Avoid vlAura, tetuBal to vote
        const blacklist = [auraVoterProxyAddress, tetuBalLockerAddress];
        const duration = 2; // 2 WEEKS
        const calculateVeBalPrice = (balPrice: number) => {
            const weeklyEmission = 121929.980212;
            const totalVotes = 9800000;
            const premium = 1.125;
            const dollarEmission = balPrice * weeklyEmission;
            const veBALPrice = (dollarEmission / totalVotes) * premium;
            return Number(veBALPrice.toFixed(5));
        };
        // -------------------------------------------------------- //

        const signer = await getSigner(hre);
        const auraEthAmount = utils.parseEther(taskArgs.auraEthAmount.toString());
        let auraBalAmount: BN;
        if (taskArgs.auraBalAmount === 0) {
            // No auraBalAmount provided, getting value from chef forwarder claimable rewards
            auraBalAmount = utils.parseEther((await getChefClaimableRewards(hre)).toString());
        } else {
            auraBalAmount = utils.parseEther(taskArgs.auraBalAmount.toString());
        }

        const platformFee = await getPlatformFee(hre, signer); //Current value is 400

        const prices = await getTokenPrices([balTokenAddress, auraTokenAddress]);
        // const prices = await getTokenPricesMock([balTokenAddress, auraTokenAddress]);
        const balPrice = prices.find(tp => tp.address === balTokenAddress).latestUSDPrice;
        const auraPrice = prices.find(tp => tp.address === auraTokenAddress).latestUSDPrice;
        const veBALPrice = calculateVeBalPrice(balPrice);

        const auraEthQuestAmounts = calculateQuestAmounts(auraEthAmount, platformFee);
        const auraEthVotesAmounts = calculateVotesAmounts(auraEthQuestAmounts.totalRewardAmount, auraPrice, veBALPrice);

        const auraBalQuestAmounts = calculateQuestAmounts(auraBalAmount, platformFee);
        const auraBalVotesAmounts = calculateVotesAmounts(auraBalQuestAmounts.totalRewardAmount, auraPrice, veBALPrice);

        const quests: Array<PaladinQuest> = [
            {
                title: "1. aura/eth veBAL",
                totalBudget: auraEthAmount,
                to: darkQuestBoardAddress,
                gauge: aura50Eth50GaugeAddress,
                rewardToken: auraTokenAddress,
                duration: duration,
                objective: auraEthVotesAmounts.objective,
                rewardPerVote: auraEthVotesAmounts.rewardPerVote,
                totalRewardAmount: auraEthQuestAmounts.totalRewardAmount,
                feeAmount: auraEthQuestAmounts.feeAmount,
                blacklist: blacklist,
            },
            {
                title: "2. auraBAL  veBAL",
                totalBudget: auraBalAmount,
                to: darkQuestBoardAddress,
                gauge: auraBalStableGaugeAddress,
                rewardToken: auraTokenAddress,
                duration: duration,
                objective: auraBalVotesAmounts.objective,
                rewardPerVote: auraBalVotesAmounts.rewardPerVote,
                totalRewardAmount: auraBalQuestAmounts.totalRewardAmount,
                feeAmount: auraBalQuestAmounts.feeAmount,
                blacklist: blacklist,
            },
        ];
        // console.log(quests)

        /* -------------------------------------------------------
         * 1.- Calculate amounts and prepare deposits (ids, scales)
         * ----------------------------------------------------- */

        const createQuestTxs = quests.filter(i => BN.from(i.totalRewardAmount).gt(0)).map(createQuestTx);
        const totalDeposits = BN.from(auraEthAmount.add(auraBalAmount));
        console.log(`Total Aura: ${utils.formatEther(totalDeposits)} calculated $/veBAL: ${veBALPrice}`);
        /* -------------------------------------------------------
         * 2.- Generate incentives tx
         * ----------------------------------------------------- */

        const incentivesTransactions = txMeta(
            [].concat(chefClaimTx).concat(auraApprovalTx(totalDeposits)).concat(createQuestTxs),
        );
        fs.writeFileSync(
            path.resolve(__dirname, "./gnosis_tx_paladin_incentives.json"),
            JSON.stringify(incentivesTransactions),
        );
        console.log(`Gnosis tx builder generated at ${__dirname}/gnosis_tx_paladin_incentives.json`);
    });
