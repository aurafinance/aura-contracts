/* eslint-disable no-await-in-loop */
import { getSigner } from "../utils";

import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { config } from "../deploy/polygon-config";
import { ethers } from "ethers";

import pos from "@maticnetwork/maticjs";

task("sidechain:polygon:bridge")
    .addParam("txhash", "L2 TXN Hash of the bridge withdrawal")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const withdrawTxHash = tskArgs.txhash;

        const polygonProvider = new ethers.providers.JsonRpcProvider(process.env.OPTIMISM_NODE_URL);

        const options = {
            network: "ethereum",
            version: "v1",
            maticProvider: polygonProvider,
            parentProvider: deployer,
        };

        // console.log(Matic);

        const maticClient = new pos.POSClient();
        maticClient.init(options);
        const event = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
        const tx = await maticClient.exitUtil.buildPayloadForExit(withdrawTxHash, event, false);

        console.log(tx);

        // console.log(pos)

        // const withdrawTxHash = tskArgs.txhash;

        // const customProvider = new ethers.providers.JsonRpcProvider(process.env.OPTIMISM_NODE_URL);
        // const receipt = await customProvider.getTransactionReceipt(withdrawTxHash);

        // const deployer = await getSigner(hre);

        // const CCM = new CrossChainMessenger({
        //     l1ChainId: 1,
        //     l1SignerOrProvider: deployer,
        //     l2ChainId: 10,
        //     l2SignerOrProvider: process.env.OPTIMISM_NODE_URL,
        //     bedrock: true,
        // });

        // const message = await CCM.toCrossChainMessage(receipt);
        // const status = await CCM.getMessageStatus(message);

        // if (status == MessageStatus.STATE_ROOT_NOT_PUBLISHED) {
        //     console.log("State root not yet published, please wait around an hour from withdrawal");
        // } else if (status == MessageStatus.READY_TO_PROVE) {
        //     console.log("Posting Proof");
        //     const prove = await CCM.proveMessage(message);
        //     console.log(prove);
        // } else if (status == MessageStatus.IN_CHALLENGE_PERIOD) {
        //     console.log("Message is in 7 day dispute period");
        // } else if (status == MessageStatus.READY_FOR_RELAY) {
        //     console.log("Triggering Withdrawal");
        //     const withdraw = await CCM.finalizeMessage(message);
        //     console.log(withdraw);
        // } else if (status == MessageStatus.RELAYED) {
        //     console.log("Message already withdrawn");
        // }
    });
