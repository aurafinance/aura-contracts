/* eslint-disable no-await-in-loop */
import * as fs from "fs";
import { getSigner } from "../utils";

import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { ethers } from "ethers";

import { Phase6Deployed } from "scripts/deploySystem";
import { config as mainnetConfig } from "../deploy/mainnet-config";
import { BoosterLite, BoosterLite__factory } from "../../types";

task("info:gauges:killed-gauges", "Gets the TVL for each pool added to the booster").setAction(async function (
    tskArgs: TaskArguments,
    hre: HardhatRuntimeEnvironment,
) {
    const deployer = await getSigner(hre);
    const info = {};
    const killed_info = {};
    const killed_but_live_info = {};

    const boosterLite = "0x98Ef32edd24e2c92525E59afc4475C1242a30184";

    const providers = [
        process.env.ARBITRUM_NODE_URL,
        process.env.OPTIMISM_NODE_URL,
        process.env.POLYGON_NODE_URL,
        process.env.GNOSIS_NODE_URL,
    ];

    const names = ["arbitrum", "optimism", "polygon", "gnosis"];
    const gaugeInterface = [
        "function is_killed() external view returns(bool)",
        "function getRecipient() external view returns(address)",
    ];

    /*
     * Gather information related to gauges on balancer
     */

    const gaugControllerAddress = "0xC128468b7Ce63eA702C1f104D55A2566b13D3ABD";
    const gaugeControllerAbi = [
        "function gauges(uint arg0) external view returns(address)",
        "function n_gauges() external view returns(int128)",
    ];

    const gaugeControllerContract = new ethers.Contract(gaugControllerAddress, gaugeControllerAbi);

    const n_gauges = Number(await gaugeControllerContract.connect(deployer).n_gauges());

    const all_gauge_info = {};
    const is_gauge_killed = {};

    for (let i = 0; i < n_gauges; i++) {
        const gaugeAddress = await gaugeControllerContract.connect(deployer).gauges(i);
        const gaugeContract = new ethers.Contract(gaugeAddress, gaugeInterface);
        const isKilled = await gaugeContract.connect(deployer).is_killed();

        let isMainnet = true;
        let recipient = gaugeAddress;
        try {
            recipient = await gaugeContract.connect(deployer).getRecipient();
            isMainnet = false;
        } catch (e) {
            // console.log(e);
        }

        all_gauge_info[i] = {
            gaugeAddress: gaugeAddress,
            isKilled: isKilled,
            isMainnet: isMainnet,
            recipient: recipient,
        };

        is_gauge_killed[recipient] = isKilled;

        console.log(i, n_gauges);
    }

    fs.writeFileSync("all_gauge_info.json", JSON.stringify(all_gauge_info));

    /*
     * Gather information related to sidechain aura pools
     */

    for (let p = 0; p < providers.length; p++) {
        const customProvider = new ethers.providers.JsonRpcProvider(providers[p]);
        const name = names[p];

        const booster: BoosterLite = BoosterLite__factory.connect(boosterLite, customProvider);

        const poolLength = await booster.poolLength();

        info[name] = {};
        killed_info[name] = {};
        killed_but_live_info[name] = {};

        for (let i = 0; i < Number(poolLength); i++) {
            console.log(name, i, poolLength);
            const poolInfo = await booster.poolInfo(i);
            const isKilled = is_gauge_killed[poolInfo.gauge];

            info[name][i] = { pid: i, gauge: poolInfo.gauge, isKilled: isKilled };

            if (isKilled) {
                killed_info[name][i] = { pid: i, gauge: poolInfo.gauge, isKilled: isKilled };

                if (!poolInfo.shutdown) {
                    killed_but_live_info[name][i] = {
                        pid: i,
                        gauge: poolInfo.gauge,
                        isKilled: isKilled,
                        isShutdown: poolInfo.shutdown,
                    };
                }
            }
        }
    }

    /*
     * Gather information related to mainnet aura pools
     */

    const phase6: Phase6Deployed = await mainnetConfig.getPhase6(deployer);

    const poolLength = await phase6.booster.poolLength();
    const name = "mainnet";

    info[name] = {};
    killed_info[name] = {};
    killed_but_live_info[name] = {};

    for (let i = 0; i < Number(poolLength); i++) {
        console.log(name, i, poolLength);
        const poolInfo = await phase6.booster.poolInfo(i);

        const gaugeContract = new ethers.Contract(poolInfo.gauge, gaugeInterface);
        const isKilled = await gaugeContract.connect(deployer).is_killed();
        info[name][i] = { pid: i, gauge: poolInfo.gauge, isKilled: isKilled };

        if (isKilled) {
            killed_info[name][i] = { pid: i, gauge: poolInfo.gauge, isKilled: isKilled };

            if (!poolInfo.shutdown) {
                killed_but_live_info[name][i] = {
                    pid: i,
                    gauge: poolInfo.gauge,
                    isKilled: isKilled,
                    isShutdown: poolInfo.shutdown,
                };
            }
        }
    }

    console.log(info);
    console.log(killed_info);
    console.log(killed_but_live_info);

    fs.writeFileSync("killed_but_live_info.json", JSON.stringify(killed_but_live_info));
    fs.writeFileSync("killed_info.json", JSON.stringify(killed_info));
    fs.writeFileSync("all_info.json", JSON.stringify(info));
});
