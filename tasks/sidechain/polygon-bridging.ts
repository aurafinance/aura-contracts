/* eslint-disable no-await-in-loop */
import { getSigner } from "../utils";

import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
// import { config } from "../deploy/polygon-config";
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
        await maticClient.init(options);
        const event = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
        const tx = await maticClient.exitUtil.buildPayloadForExit(withdrawTxHash, event, false);

        console.log(tx);
    });
