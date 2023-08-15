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

task("sidechain:metrics:bridge").setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const deployer = await getSigner(hre);

    const providers = [
        process.env.ARBITRUM_NODE_URL,
        process.env.OPTIMISM_NODE_URL,
        process.env.POLYGON_NODE_URL,
        // process.env.GNOSIS_NODE_URL,
    ];

    const names = [
        "arbitrum",
        "optimism",
        "polygon",
        //  "gnosis"
    ];

    const chainIds = [
        42161, 10, 137,
        // 100
    ];

    const data = {};

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

            data[names[n]].push({
                txn: event.transactionHash,
                block: event.blockNumber,
                timestamp: timestamp,
                to: event.args.to,
                amount: Number(event.args.amount) / 1e18,
                status: "sent",
            });
        }

        console.log(data);
    }
});
