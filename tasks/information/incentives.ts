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
import {
    fetchAuraProposals,
    getHiddenHandConf,
    Incentive,
    isARBAuraBalwstEthProposal,
    isAuraBalProposal,
    isAuraEthProposal,
} from "./hiddenhandApi";
import {
    buildPaladinQuest,
    getPaladinConf,
    PaladinQuest,
    PaladinQuestDarkBoard,
    PaladinQuestWardenScheduler,
} from "./paladinApi";
import { buildSafeTx } from "../../tasks/protocol";

const auraTokenAddress = "0xc0c293ce456ff0ed870add98a0828dd4d2903dbf";
const chefForwarderAddress = "0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9";

// Hidden hands
const hhIncentiveVaultAddress = "0xE00fe722e5bE7ad45b1A16066E431E47Df476CeC";
const vlAuraIncentiveAddress = "0xcbf242f20d183b4116c22dd5e441b9ae15b0d35a";
const veBalIncentiveAddress = "0x45Bc37b18E73A42A4a826357a8348cDC042cCBBc";
const auraEthVeBALId = "0xb355f196c7ab330d85a3a392623204f81c8f2d668baaeda4e78f87c9f50bef04";
const auraBalVeBALId = "0xa2b574c32fbe12ce1e12ebb850253595ef7087671c213241076b924614822a20";
const scale = BN.from(10).pow(18);
// With precision of only 4 decimals
const fractionToBN = (fraction: number) => scale.mul((fraction * 1000).toString().split(".")[0]).div(1000);

// Paladin
const auraBalStableGaugeAddress = "0x0312AA8D0BA4a1969Fddb382235870bF55f7f242";
const aura50Eth50GaugeAddress = "0x275dF57d2B23d53e20322b4bb71Bf1dCb21D0A00";
const wardenQuestSchedulerAddress = "0x3FCB0Cc19C41E9D2DB3b9764032CD457bAA2fb47";

// -------------------------------------------------------- //

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
        txBuilderVersion: "1.16.0",
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
const auraApprovalTx = (amount: BN, spender: string) => ({
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
        spender: spender,
        amount: amount.toString(),
    },
});
const depositIncentiveERC20Tx = (incentive: Incentive) => {
    console.log(
        `${incentive.title} hash: ${incentive.proposal.proposalHash} amount: ${utils.formatEther(
            incentive.amount,
        )} maxTokensPerVote: ${utils.formatEther(incentive.maxTokensPerVote ?? 0)}`,
    );
    return {
        to: incentive.to,
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                { internalType: "bytes32", name: "_proposal", type: "bytes32" },
                { internalType: "address", name: "_token", type: "address" },
                { internalType: "uint256", name: "_amount", type: "uint256" },
                { internalType: "uint256", name: "_maxTokensPerVote", type: "uint256" },
                { internalType: "uint256", name: "_periods", type: "uint256" },
            ],
            name: "depositBribe",
            payable: false,
        },
        contractInputsValues: {
            _proposal: incentive.proposal.proposalHash,
            _token: auraTokenAddress,
            _amount: incentive.amount.toString(),
            _maxTokensPerVote: incentive.maxTokensPerVote ? incentive.maxTokensPerVote.toString() : "0",
            _periods: incentive.periods.toString(),
        },
    };
};
const createWardenSchedulerQuestTx = (quest: PaladinQuestWardenScheduler) => {
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
                { internalType: "uint256", name: "pid", type: "uint256" },
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
            pid: quest.pid.toString(),
            objective: quest.objective.toString(),
            rewardPerVote: quest.rewardPerVote.toString(),
            totalRewardAmount: quest.totalRewardAmount.toString(),
            feeAmount: quest.feeAmount.toString(),
            blacklist: `[${quest.blacklist.join(`,`)}]`,
        },
    };
};
const createDarkQuestBoardTx = (quest: PaladinQuestDarkBoard) => {
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
            duration: quest.duration.toString(),
            objective: quest.objective.toString(),
            rewardPerVote: quest.rewardPerVote.toString(),
            totalRewardAmount: quest.totalRewardAmount.toString(),
            feeAmount: quest.feeAmount.toString(),
            blacklist: `["${quest.blacklist.join(`","`)}"]`,
        },
    };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateIncentivesTxBuilderFile(
    fileName: string,
    quests: PaladinQuest[],
    { veBALPrice, to },
    createQuestFnTx: any,
) {
    /* -------------------------------------------------------
     * 1.- Calculate amounts and prepare deposits (ids, scales)
     * ----------------------------------------------------- */

    const createQuestTxs = quests.filter(i => BN.from(i.totalRewardAmount).gt(0)).map(createQuestFnTx);
    const totalDeposits = quests.map(q => q.totalBudget).reduce((prev, curr) => prev.add(curr), BN.from(0));
    console.log(`Total Aura: ${utils.formatEther(totalDeposits)} calculated $/veBAL: ${veBALPrice}`);
    /* -------------------------------------------------------
     * 2.- Generate incentives tx
     * ----------------------------------------------------- */
    const txMetadata = {
        name: "Incentives",
        description: "Incentives",
        createdFromSafeAddress: "0x21AED3a7A1c34Cd88B8A39DbDAE042bEfbf947ff",
    };
    const txs = [].concat(chefClaimTx).concat(auraApprovalTx(totalDeposits, to)).concat(createQuestTxs);
    const incentivesTransactions = buildSafeTx(txMetadata)(txs);
    fs.writeFileSync(path.resolve(__dirname, `./${fileName}.json`), JSON.stringify(incentivesTransactions));
    console.log(`Gnosis tx builder generated at ${__dirname}/${fileName}.json`);
}

task("info:chef:claim").setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
    await getChefClaimableRewards(hre);
});

task("create:hh:incentives")
    .addOptionalParam("auraEthAmount", "Amount of aura eth incentive, default is 25_500", 25_500, types.int)
    .addOptionalParam("auraEthVlRatio", "Vl Aura ratio, default is 0", 0, types.int)
    .addOptionalParam("auraBalVlRatio", "Vl Aura ratio, default is 0", 0, types.int)
    .addOptionalParam("auraEthVeBalRatio", "VeBal ratio, default is 100", 100, types.int)
    .addOptionalParam("auraBalVeBalRatio", "VeBal ratio, default is 100", 100, types.int)
    .addOptionalParam(
        "auraBalwstEthAmount",
        "Amount of a-55/45 auraBAL/wstETH incentives, default is 6_825",
        6_825,
        types.int,
    )
    .setAction(async function (taskArgs: TaskArguments, __hre: HardhatRuntime) {
        const { auraEthAmount, auraEthVlRatio, auraBalVlRatio, auraEthVeBalRatio, auraBalVeBalRatio } = taskArgs;
        const { auraBalwstEthAmount } = taskArgs;

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const chefClaimableRewards = (await getChefClaimableRewards(__hre)).valueOf();
        const maxAuraBalAmount = 43225 < chefClaimableRewards ? 43225 : chefClaimableRewards;
        const auraBalAmount = BN.from(maxAuraBalAmount - auraBalwstEthAmount);
        const hhAuraProposals = await fetchAuraProposals();

        if (hhAuraProposals.length < 3) throw new Error("No proposals found");
        const auraEthProposal = hhAuraProposals.find(isAuraEthProposal);
        const auraBalProposal = hhAuraProposals.find(isAuraBalProposal);
        const auraBalwstEthProposal = hhAuraProposals.find(isARBAuraBalwstEthProposal);

        const conf = await getHiddenHandConf();

        const veBalMaxTokensPerVote = fractionToBN(conf.veBALPrice / conf.auraPrice);
        console.log(" veBalMaxTokensPerVote:", veBalMaxTokensPerVote.toString());
        const incentives: Incentive[] = [
            {
                title: "1. aura/eth vlAURA",
                to: vlAuraIncentiveAddress,
                proposal: auraEthProposal,
                amount: BN.from(auraEthAmount),
                ratio: auraEthVlRatio,
                maxTokensPerVote: BN.from(0),
                periods: 1,
            },
            {
                title: "2. auraBAL  vlAURA",
                to: vlAuraIncentiveAddress,
                proposal: auraBalProposal,
                amount: BN.from(auraBalAmount),
                ratio: auraBalVlRatio,
                maxTokensPerVote: BN.from(0),
                periods: 1,
            },
            {
                title: "3. aura/eth veBAL ",
                to: veBalIncentiveAddress,
                proposal: { ...auraEthProposal, proposalHash: auraEthVeBALId },
                amount: BN.from(auraEthAmount),
                ratio: auraEthVeBalRatio,
                maxTokensPerVote: veBalMaxTokensPerVote,
                periods: 2,
            },
            {
                title: "4. auraBAL  veBAL ",
                to: veBalIncentiveAddress,
                proposal: { ...auraBalProposal, proposalHash: auraBalVeBALId },
                amount: BN.from(auraBalAmount),
                ratio: auraBalVeBalRatio,
                maxTokensPerVote: veBalMaxTokensPerVote,
                periods: 2,
            },
            {
                title: "5. a-55/45 auraBAL/wstETH vlAURA",
                to: vlAuraIncentiveAddress,
                proposal: auraBalwstEthProposal,
                amount: BN.from(auraBalwstEthAmount),
                ratio: 100,
                periods: 1,
            },
        ];
        /* -------------------------------------------------------
         * 1.- Calculate amounts and prepare deposits (ids, scales)
         * ----------------------------------------------------- */

        const depositTsx = incentives
            .map(scaleIncentiveAmount)
            .filter(i => i.amount.gt(0))
            .map(depositIncentiveERC20Tx);
        const totalDeposits = depositTsx
            .map(d => BN.from(d.contractInputsValues._amount))
            .reduce((a, b) => a.add(b), BN.from(0));
        console.log("   totalDeposits:", utils.formatEther(totalDeposits));
        /* -------------------------------------------------------
         * 2.- Generate incentives tx
         * ----------------------------------------------------- */
        const incentivesTransactions = txMeta(
            [].concat(chefClaimTx).concat(auraApprovalTx(totalDeposits, hhIncentiveVaultAddress)).concat(depositTsx),
        );
        fs.writeFileSync(
            path.resolve(__dirname, "./gnosis_tx_hh_incentives.json"),
            JSON.stringify(incentivesTransactions, null, 4),
        );
        console.log(`Gnosis tx builder generated at ${__dirname}/gnosis_tx_hh_incentives.json`);
    });

task("create:hh:arb:incentives", "Generates tx builder for a-55/45 auraBAL/wstETH")
    .addOptionalParam(
        "auraBalwstEthAmount",
        "Amount of a-55/45 auraBAL/wstETH incentives, default is 7_500",
        7_500,
        types.int,
    )
    .setAction(async function (taskArgs: TaskArguments, __: HardhatRuntime) {
        const { auraBalwstEthAmount } = taskArgs;
        const hhAuraProposals = await fetchAuraProposals();

        if (hhAuraProposals.length < 2) throw new Error("No proposals found");
        const auraBalwstEthProposal = hhAuraProposals.find(isARBAuraBalwstEthProposal);

        const incentives = [
            {
                title: "1. a-55/45 auraBAL/wstETH",
                to: vlAuraIncentiveAddress,
                proposal: auraBalwstEthProposal,
                amount: BN.from(auraBalwstEthAmount),
                ratio: 100,
                periods: 1,
            },
        ];
        /* -------------------------------------------------------
         * 1.- Calculate amounts and prepare deposits (ids, scales)
         * ----------------------------------------------------- */

        const depositTsx = incentives
            .map(scaleIncentiveAmount)
            .filter(i => i.amount.gt(0))
            .map(depositIncentiveERC20Tx);
        const totalDeposits = depositTsx
            .map(d => BN.from(d.contractInputsValues._amount))
            .reduce((a, b) => a.add(b), BN.from(0));
        console.log("   totalDeposits:", utils.formatEther(totalDeposits));
        /* -------------------------------------------------------
         * 2.- Generate incentives tx
         * ----------------------------------------------------- */

        const incentivesTransactions = txMeta(
            [].concat(auraApprovalTx(totalDeposits, hhIncentiveVaultAddress)).concat(depositTsx),
        );
        fs.writeFileSync(
            path.resolve(__dirname, "./gnosis_tx_hh_arb_incentives.json"),
            JSON.stringify(incentivesTransactions),
        );
        console.log(`Gnosis tx builder generated at ${__dirname}/gnosis_tx_hh_arb_incentives.json`);
    });

/**
 * Generates Transaction Builder file to create paladin quest incentives
 * @deprecated @see create:scheduler:incentives
 * Example :
 *   Input
 *       `yarn task:fork create:paladin:incentives  --aura-eth-amount 40000 --aura-bal-amount 40000`
 *   Output
 *       Token BAL, latestUSDPrice: 5.233117611442983836400985490558274
 *       Token AURA, latestUSDPrice: 1.711854385136804862443685518169823
 *       1. aura/eth veBAL totalBudget: 40000.0 Fixed Reward: 0.0428 AURA/veBAL
 *       2. auraBAL  veBAL totalBudget: 40000.0 Fixed Reward: 0.0428 AURA/veBAL
 *       Total Aura: 88000.0 calculated $/veBAL: 0.07325
 *       Gnosis tx builder generated at .../tasks/information/gnosis_tx_paladin_incentives.json
 *
 */
task("create:paladin:incentives")
    .addOptionalParam("auraEthAmount", "Amount of aura/eth incentive, default is 30_000", 30_000, types.int)
    .addOptionalParam("auraBalAmount", "Amount of auraBal incentive, suggested is 40_000", 40_000, types.int)
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
        const signer = await getSigner(hre);
        const auraEthAmount = utils.parseEther(taskArgs.auraEthAmount.toString());
        const auraBalAmount: BN = utils.parseEther(taskArgs.auraBalAmount.toString());

        const paladinConf = await getPaladinConf(hre, signer);
        const buildPaladinQuestFn = ({ title, totalBudget, gauge }): PaladinQuest =>
            buildPaladinQuest({ title, totalBudget, gauge, ...paladinConf });

        const auraWethQuest: PaladinQuest = buildPaladinQuestFn({
            title: "1. aura/eth veBAL",
            totalBudget: auraEthAmount,
            gauge: aura50Eth50GaugeAddress,
        });
        const auraBalQuest: PaladinQuest = buildPaladinQuestFn({
            title: "2. auraBAL  veBAL",
            totalBudget: auraBalAmount,
            gauge: auraBalStableGaugeAddress,
        });

        const quests: Array<PaladinQuest> = [auraWethQuest, auraBalQuest];
        // Generate the file
        generateIncentivesTxBuilderFile("gnosis_tx_paladin_incentives", quests, paladinConf, createDarkQuestBoardTx);
    });

/**
 * Generates Transaction Builder file to create paladin quest incentives via the aura scheduler
 * Example :
 *   Input
 *       `yarn task:fork create:scheduler:incentives  --aura-eth-amount 30000 --aura-bal-amount 40000`
 *   Output
 *       Token BAL, latestUSDPrice: 5.233117611442983836400985490558274
 *       Token AURA, latestUSDPrice: 1.711854385136804862443685518169823
 *       1. aura/eth veBAL totalBudget: 30000.0 Fixed Reward: 0.0518 AURA/veBAL
 *       2. auraBAL  veBAL totalBudget: 40000.0 Fixed Reward: 0.0518 AURA/veBAL
 *       Total Aura: 70000.0 calculated $/veBAL: 0.06135
 *       Safe tx builder generated at .../tasks/information/gnosis_tx_scheduler_incentives.json
 *
 */
task("create:scheduler:incentives")
    .addOptionalParam("auraEthAmount", "Amount of aura/eth incentive, default is 30_000", 30_000, types.int)
    .addOptionalParam("auraBalAmount", "Amount of auraBal incentive, suggested is 40_000", 40_000, types.int)
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
        const signer = await getSigner(hre);
        const auraEthAmount = utils.parseEther(taskArgs.auraEthAmount.toString());
        const auraBalAmount: BN = utils.parseEther(taskArgs.auraBalAmount.toString());

        const paladinConf = await getPaladinConf(hre, signer);
        const buildPaladinQuestFn = ({ title, totalBudget, pid }): PaladinQuest => {
            const q = buildPaladinQuest({ title, totalBudget, pid, ...paladinConf });
            return { ...q, to: wardenQuestSchedulerAddress };
        };

        const auraWethQuest: PaladinQuest = buildPaladinQuestFn({
            title: "1. aura/eth veBAL",
            totalBudget: auraEthAmount,
            pid: 100,
        });
        const auraBalQuest: PaladinQuest = buildPaladinQuestFn({
            title: "2. auraBAL  veBAL",
            totalBudget: auraBalAmount,
            pid: 101,
        });

        const quests: Array<PaladinQuest> = [auraWethQuest, auraBalQuest];
        // Generate the file
        generateIncentivesTxBuilderFile(
            "gnosis_tx_scheduler_incentives",
            quests,
            { ...paladinConf, to: wardenQuestSchedulerAddress },
            createWardenSchedulerQuestTx,
        );
    });
