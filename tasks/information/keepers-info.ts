import fs from "fs-extra";
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import path from "path";
import { EtherscanTransaction, getAccountTxs } from "../utils/etherscanApi";

function jsonToCsv(data: any[]) {
    const header = Object.keys(data[0]);
    const replacer = (__key, value) => (value === null ? "" : value); // specify how you want to handle null values here

    const csv = [
        header.join(","), // header row first

        ...data.map(row => header.map(fieldName => JSON.stringify(row[fieldName], replacer)).join(",")),
    ].join("\r\n");
    return csv;
}

task("keepers-txs")
    .addParam("address", "Account address to retrieve txs")
    .addParam("startblock", "Start block to fetch")
    .addParam("endblock", "End block to fetch")
    .addParam("apikey", "The ether scan api key")
    .addParam("chainid", "The chain id")
    .setAction(async (tskArgs: TaskArguments, __hre: HardhatRuntimeEnvironment) => {
        const accountTxs = await getAccountTxs({
            address: tskArgs.address,
            startblock: tskArgs.startblock,
            endblock: tskArgs.endblock,
            apiKey: tskArgs.apikey,
            chainId: tskArgs.chainid,
        });

        const result = mapMulticallTxs(accountTxs.result);
        const csv = jsonToCsv(result);
        const fileName = `txs-${tskArgs.chainid}-${tskArgs.address}`;
        fs.writeFileSync(path.resolve(__dirname, `./${fileName}.csv`), csv, "utf8");
    });
function mapMulticallTxs(result: EtherscanTransaction[]) {
    // const multicallFns = {
    //     "0x5bbf64ce": "aggregate3Funded",
    //     "0x82ad56cb": "aggregate3",
    //     "0x174dea71": "aggregate3Value",
    // };

    const functionFullNameMap = {
        "0xcc956f3f": "Booster.earmarkRewards",
        "0x7979426b": "Booster.earmarkRewards",
        "0x6f9a7fe0": "Booster.processIdleRewards",
        "0x3e8b83e3": "Booster.processIdleRewards",
        "0x00b46b40": "Booster.processIdleRewards",
        "0xddc63262": "AuraBalVault.harvest",
        "0x0f8d1d28": "AuraBalProxy.harvest",
        "0xa52c101e": "BridgeSender.send",
        "0x3d58350d": "BridgeDelegateReceiver.settleFeeDebt",
        "0x32a67687": "GaugeVoteRewards.processGaugeRewards",
        "0x6be4621c": "GaugeVoteRewards.processSideChainGaugeRewards",
        "0x805d665b": "GaugeVoteRewards.setDstChainId",
        "0xbfad96ba": "GaugeVoteRewards.voteGaugeWeight",
        "0xf43a9b45": "GaugeVoteRewards.setIsNoDepositGauge",
        "0x57fb8345": "OmniVotingEscrowAdaptor.sendUserBalance",
        "0x7806d98d": "StashRewardDistro.queueRewards",
        "0xd914cd4b": "PoolManager.addPool",
        "0x91c05b0b": "AuraStakingProxy.distribute",
        "0x6aa12577": "AuraDistributor.distributeAura",
        "0x8f052d4d": "ClaimFeesHelper.claimFees",
        "0xccaa2d11": "ZkevmBridge.claimAsset",
        "0x3805550f": "PolygonBridge.exit",
        "0x3f7658fd": "GnosisBridge.executeSignatures",
        "0x08635a95": "ArbitrumOutbox.executeTransaction",
        "0xb2ea75cc": "BoosterOwnerSecondary.setStashExtraReward",
        "0x1caf4b2f": "CrvDepositor.lockCurve",
        "0xbeb5fc579115071764c7423a4f12edde41f106ed-0x4870496f": "OptimismPortal.proveWithdrawalTransaction",
        "0xbeb5fc579115071764c7423a4f12edde41f106ed-0x8c3152e9": "OptimismPortal.finalizeWithdrawalTransaction",
        "0x49048044d57e1c92a77f79988d21fa8faf74e97e-0x4870496f": "BasePortal.proveWithdrawalTransaction",
        "0x49048044d57e1c92a77f79988d21fa8faf74e97e-0x8c3152e9": "BasePortal.finalizeWithdrawalTransaction",
        "0x36cb65c1967a0fb0eee11569c51c2f2aa1ca6f6d-0x4870496f": "BasePortal.proveWithdrawalTransaction",
        "0x36cb65c1967a0fb0eee11569c51c2f2aa1ca6f6d-0x8c3152e9": "BasePortal.finalizeWithdrawalTransaction",
        "0x21AED3a7A1c34Cd88B8A39DbDAE042bEfbf947ff": "AuraVotes.incentives",
        "0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9": "AuraVotes.incentives", // Chef forwarder
        "0x1f4f47f8b55ccd4e3b674db90e4277b7073fde27": "AuraVotes.executor",
        "0xad9992f3631028cef19e6d6c31e822c5bc2442cc": "BalancerVotes.executor",
    };

    return result.map(tx => {
        const txf = { ...tx, functionFullName: functionFullNameMap[tx.methodId] ?? "unknown" };
        delete txf.confirmations;
        // -- Special cases
        if (txf.functionFullName === "unknown") {
            // Same signature different address
            if (functionFullNameMap[`${tx.to}-${tx.methodId}`]) {
                txf.functionFullName = functionFullNameMap[`${tx.to}-${tx.methodId}`];
                return txf;
            }
            if (functionFullNameMap[`${tx.to}`]) {
                txf.functionFullName = functionFullNameMap[`${tx.to}`];
                return txf;
            }

            // Via multi call
            // if (Object.keys(multicallFns).includes(txf.methodId)) {
            const entries = Object.entries(functionFullNameMap);
            for (const [key, value] of entries) {
                const method = key.replace("0x", "");
                if (txf.input.includes(method)) {
                    txf.functionFullName = value;
                    break;
                }
            }
            // }
        }
        return txf;
    });
}
