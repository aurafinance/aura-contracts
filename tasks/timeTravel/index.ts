import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { HardhatRuntime } from "../utils/networkAddressFactory";

task("timeTravel")
    .addParam("duration", "Length of time travel")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
        const { ethers } = hre;

        let blocknumber = await ethers.provider.getBlockNumber();
        let block = await ethers.provider.getBlock(blocknumber);
        console.log("current timestamp:", block.timestamp);

        const rewardDuration = parseInt(taskArgs.duration) || 86400;

        // suppose the current block has a timestamp of 01:00 PM
        await ethers.provider.send("evm_increaseTime", [rewardDuration]);
        await ethers.provider.send("evm_mine");

        blocknumber = await ethers.provider.getBlockNumber();
        block = await ethers.provider.getBlock(blocknumber);
        console.log("new timestamp:", block.timestamp);
    });
