/* eslint-disable no-await-in-loop */
import { getSigner } from "../utils";

import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { config } from "../deploy/polygon-config";
import { ethers } from "ethers";

task("sidechain:polygon:bridge")
    .addParam("txhash", "L2 TXN Hash of the bridge withdrawal")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const mainnetBridge = "0x2a3DD3EB832aF982ec71669E178424b10Dca2EDe";
        const baseURL = "https://bridge-api.zkevm-rpc.com";

        const axios = require("axios").create({
            baseURL,
        });

        const merkleProofString = "/merkle-proof";
        const getClaimsFromAcc = "/withdrawals/";

        const bridges = await axios.get(getClaimsFromAcc + config.bridging.l2Sender, {
            params: { limit: 100, offset: 0 },
        });
        console.log(bridges);

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
