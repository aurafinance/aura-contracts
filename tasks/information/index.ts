import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import { getSigner } from "../../tasks/utils";
import { ChefForwarder__factory } from "../../types/generated";
import { config } from "../deploy/mainnet-config";
import { Phase2Deployed } from "scripts/deploySystem";
import { BigNumber as BN, BigNumberish, utils } from "ethers";
import { Proposal, fetchAuraProposals, isAuraBalProposal, isAuraEthProposal } from "./hiddenhandApi";
import * as fs from "fs";
import * as path from "path";

const auraTokenAddress = "0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF";
const chefForwarderAddress = "0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9";
const vlAuraIncentiveAddress = "0x642c59937A62cf7dc92F70Fd78A13cEe0aa2Bd9c";
const veBalIncentiveAddress = "0x7Cdf753b45AB0729bcFe33DC12401E55d28308A9";
const auraEthVeBALId = "0xb355f196c7ab330d85a3a392623204f81c8f2d668baaeda4e78f87c9f50bef04";
const auraBalVeBALId = "0xa2b574c32fbe12ce1e12ebb850253595ef7087671c213241076b924614822a20";
const incentiveScale = BN.from(10).pow(18);

interface Incentive {
    to: string;
    title: string;
    proposal: Proposal;
    amount: BN;
    ratio: number;
}

const truncateNumber = (amount: BN, decimals: number) => Number(utils.formatUnits(amount, decimals)).toFixed(0);
const roundDown = (amount: string) =>
    Number(amount.slice(2)) < 500 ? amount.slice(0, 2) + "000" : amount.slice(0, 2) + "500";

/**
 *  It gets the amount of rewards claimable by the chef forwarder.
 * @param {HardhatRuntime} hre - The Hardhat runtime environment
 * @return {*}  {Promise<Number>}
 */
const getChefClaimableRewards = async (hre: HardhatRuntime): Promise<Number> => {
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
    amount: BN.from(incentive.amount.mul(incentive.ratio).div(100)).mul(incentiveScale),
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

const depositTx = (incentive: Incentive) => {
    console.log(`${incentive.title} hash: ${incentive.proposal.proposalHash} amount: ${incentive.amount}`);
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
task("info:chef:claim").setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
    await getChefClaimableRewards(hre);
});

task("info:hh:incentives")
    .addOptionalParam("auraEthAmount", "Amount of aura eth birb, default is 30000", 30_000, types.int)
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
            .map(depositTx);
        const totalDeposits = depositTsx
            .map(d => BN.from(d.contractInputsValues.amount))
            .reduce((a, b) => a.add(b), BN.from(0));
        console.log("   totalDeposits:", totalDeposits.toString());
        /* -------------------------------------------------------
         * 2.- Generate incentives tx
         * ----------------------------------------------------- */

        const incentivesTransactions = txMeta(
            [].concat(chefClaimTx).concat(auraApprovalTx(totalDeposits)).concat(depositTsx),
        );
        fs.writeFileSync(
            path.resolve(__dirname, "./gnosis_tx_incentives.json"),
            JSON.stringify(incentivesTransactions),
        );
        console.log(`Gnosis tx builder generated at ${__dirname}/gnosis_tx_incentives.json`);
    });
