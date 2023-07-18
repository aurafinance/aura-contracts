/* eslint-disable no-await-in-loop */
import { getSigner } from "../utils";

import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { config } from "../deploy/polygon-config";
import { ethers } from "ethers";

task("sidechain:polygon:bridge")
    .addParam("txhash", "L2 TXN Hash of the bridge withdrawal")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const withdrawTxHash = tskArgs.txhash;

        const mainnetBridge = "0xA0c68C638235ee32657e8f720a23ceC1bFc77C77";
        const baseURL = "https://proof-generator.polygon.technology/api/v1/matic/exit-payload/";
        const event = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
        const eventSignature = "?eventSignature="


        const axios = require("axios").create({
            baseURL,
        });

        const withdrawalData = await axios.get(withdrawTxHash + eventSignature + event, {
            params: { limit: 100, offset: 0 },
        });


        if(withdrawalData.data.message == "Payload generation success"){
            const proof = withdrawalData.data.result;
            const abi = ["function exit(bytes inputData)"];
    
            const bridgeContract = new ethers.Contract(mainnetBridge, abi);
            await bridgeContract.connect(deployer).exit(proof);
        }
    });
