/* eslint-disable no-await-in-loop */
import { ethers } from "ethers";
import { JsonRpcProvider } from "@ethersproject/providers";
import assert from "assert";
import { BigNumber } from "ethers";
import { formatEther } from "ethers/lib/utils";
import { table } from "table";
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { ERC20__factory, SimpleBridgeDelegateSender__factory } from "../../types";

import { SidechainViewDeployed, CanonicalViewDeployed } from "../../scripts/deploySidechain";
import { canonicalChains, canonicalConfigs, lzChainIds, sidechainConfigs } from "../deploy/sidechain-constants";
import { chainIds, getSigner } from "../utils";
import { fullScale } from "../../test-utils/constants";
import chalk from "chalk";
import { time } from "console";

import { CrossChainMessenger, MessageStatus } from "@eth-optimism/sdk";
import { SendEvent } from "types/generated/SimpleBridgeDelegateSender";

task("sidechain:metrics:bridge").setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const deployer = await getSigner(hre);

    const providers = [
        process.env.ARBITRUM_NODE_URL,
        // process.env.OPTIMISM_NODE_URL,
        // process.env.POLYGON_NODE_URL,
        // process.env.GNOSIS_NODE_URL,
    ];

    const names = [
        "arbitrum",
        // "optimism",
        // "polygon",
        //  "gnosis"
    ];

    const chainIds = [
        42161,
        // 10,
        // 137,
        // 100
    ];

    const data = {};
    const allBridges = [];

    for (const n in names) {
        data[names[n]] = [];
        const customProvider = new ethers.providers.JsonRpcProvider(providers[n]);
        const config = sidechainConfigs[chainIds[n]];
        const l2sender = config.bridging.l2Sender;

        const l2SenderContract = SimpleBridgeDelegateSender__factory.connect(l2sender, customProvider);

        let eventFilter = l2SenderContract.filters.Send();
        let events = await l2SenderContract.queryFilter(eventFilter);

        for (const e in events) {
            const event = events[e];

            const timestamp = (await customProvider.getBlock(event.blockNumber)).timestamp;
            let status;

            if (names[n] == "optimism") {
                status = await getOptimismStatus(customProvider, event, deployer);
            }

            let eventData = {
                chain: names[n],
                txn: event.transactionHash,
                block: event.blockNumber,
                timestamp: timestamp,
                to: event.args.to,
                amount: Number(event.args.amount) / 1e18,
                status: status,
            };

            data[names[n]].push(eventData);
            allBridges.push(eventData);
        }

        console.log(allBridges);
    }
});
async function getOptimismStatus(
    customProvider: ethers.providers.JsonRpcProvider,
    event: SendEvent,
    deployer: ethers.Signer,
) {
    const receipt = await customProvider.getTransactionReceipt(event.transactionHash);

    const CCM = new CrossChainMessenger({
        l1ChainId: 1,
        l1SignerOrProvider: deployer,
        l2ChainId: 10,
        l2SignerOrProvider: process.env.OPTIMISM_NODE_URL,
        bedrock: true,
    });

    const message = await CCM.toCrossChainMessage(receipt);
    const status = await CCM.getMessageStatus(message);

    let newStatus;

    if (status == MessageStatus.STATE_ROOT_NOT_PUBLISHED) {
        newStatus = "State root not yet published";
    } else if (status == MessageStatus.READY_TO_PROVE) {
        newStatus = "Ready to Prove";
    } else if (status == MessageStatus.IN_CHALLENGE_PERIOD) {
        newStatus = "In 7 day dispute period";
    } else if (status == MessageStatus.READY_FOR_RELAY) {
        newStatus = "Ready to Withdraw";
    } else if (status == MessageStatus.RELAYED) {
        newStatus = "Withdraw Successful";
    }

    return newStatus;
}
