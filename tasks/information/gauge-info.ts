/* eslint-disable no-await-in-loop */
import * as fs from "fs";
import * as path from "path";
import { getSigner } from "../utils";

import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { ethers } from "ethers";

import { Phase6Deployed } from "scripts/deploySystem";
import { config as mainnetConfig } from "../deploy/mainnet-config";
import { BoosterLite, BoosterLite__factory } from "../../types";

type GaugeInfo = { [key: string]: { [key: string]: { pid: number; gauge: string; isKilled: boolean } } };
task("info:gauges:killed-gauges", "Generates txs to shutdown pools which gauges is killed")
    .addParam("safedata", "Generate Safe TX Builder Data")
    .addParam("savelogs", "save logs to file system")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const generateSafeData = Boolean(tskArgs.safedata);
        const generateLogs = Boolean(tskArgs.savelogs);

        const info: GaugeInfo = {};
        const killed_info = {};
        const killed_but_live_info = {};
        const killed_but_live_lists = {};

        const boosterLite = "0x98Ef32edd24e2c92525E59afc4475C1242a30184";

        // Index of providers and names must match.
        const providers = [
            process.env.ARBITRUM_NODE_URL,
            process.env.OPTIMISM_NODE_URL,
            process.env.POLYGON_NODE_URL,
            process.env.GNOSIS_NODE_URL,
            process.env.BASE_NODE_URL,
            process.env.ZKEVM_NODE_URL,
            process.env.AVALANCHE_NODE_URL,
            process.env.FRAXTAL_NODE_URL,
        ];

        const names = ["arbitrum", "optimism", "polygon", "gnosis", "base", "zkevm", "avalanche", "fraxtal"];

        const gaugeInterface = [
            "function is_killed() external view returns(bool)",
            "function getRecipient() external view returns(address)",
        ];

        /*
         * Gather information related to gauges on balancer
         */

        const gaugeControllerAddress = "0xC128468b7Ce63eA702C1f104D55A2566b13D3ABD";
        const gaugeControllerAbi = [
            "function gauges(uint arg0) external view returns(address)",
            "function n_gauges() external view returns(int128)",
        ];

        const gaugeControllerContract = new ethers.Contract(gaugeControllerAddress, gaugeControllerAbi);

        const n_gauges = Number(await gaugeControllerContract.connect(deployer).n_gauges());

        const all_gauge_info = {};
        const is_gauge_killed = {};

        const batchSize = 20; // Adjust batch size as needed
        for (let batchStart = 0; batchStart < n_gauges; batchStart += batchSize) {
            const batchEnd = Math.min(batchStart + batchSize, n_gauges);
            const batchPromises = [];

            for (let i = batchStart; i < batchEnd; i++) {
                batchPromises.push(
                    (async () => {
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

                        console.log(`Pid ${i}, gauge ${gaugeAddress} killed: ${isKilled}`, n_gauges);
                    })(),
                );
            }

            await Promise.all(batchPromises);
        }

        /*
         * Gather information related to sidechain aura pools
         */

        await Promise.all(
            providers.map(async (providerUrl, p) => {
                const customProvider = new ethers.providers.JsonRpcProvider(providerUrl);
                const name = names[p];

                const booster: BoosterLite = BoosterLite__factory.connect(boosterLite, customProvider);

                const poolLength = await booster.poolLength();

                info[name] = {};
                killed_info[name] = {};
                killed_but_live_info[name] = {};
                killed_but_live_lists[name] = [];
                try {
                    for (let i = 0; i < Number(poolLength); i++) {
                        if (name === "gnosis") {
                            // Avoid Too many queued requests error
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        }

                        const poolInfo = await booster.poolInfo(i);

                        const isKilled = is_gauge_killed[poolInfo.gauge];

                        console.log(
                            `${name} Pid ${i}, gauge ${poolInfo.gauge} killed: ${isKilled}`,
                            poolLength.toString(),
                        );

                        info[name][i] = { pid: i, gauge: poolInfo.gauge, isKilled: isKilled };

                        if (isKilled) {
                            killed_info[name][i] = { pid: i, gauge: poolInfo.gauge, isKilled: isKilled };

                            if (!poolInfo.shutdown) {
                                killed_but_live_lists[name].push(i);
                                killed_but_live_info[name][i] = {
                                    pid: i,
                                    gauge: poolInfo.gauge,
                                    isKilled: isKilled,
                                    isShutdown: poolInfo.shutdown,
                                };
                            }
                        }
                    }
                } catch (error) {
                    console.log("--------------", name, "--------------");
                    console.log(name, "error", error);
                    console.log("--------------", name, "--------------");
                }
            }),
        );

        /*
         * Gather information related to mainnet aura pools
         */

        const phase6: Phase6Deployed = await mainnetConfig.getPhase6(deployer);

        const poolLength = await phase6.booster.poolLength();
        const name = "mainnet";

        info[name] = {};
        killed_info[name] = {};
        killed_but_live_info[name] = {};
        killed_but_live_lists[name] = [];

        for (let batchStart = 0; batchStart < Number(poolLength); batchStart += batchSize) {
            const batchEnd = Math.min(batchStart + batchSize, Number(poolLength));
            const batchPromises = [];

            for (let i = batchStart; i < batchEnd; i++) {
                batchPromises.push(
                    (async () => {
                        const poolInfo = await phase6.booster.poolInfo(i);

                        const gaugeContract = new ethers.Contract(poolInfo.gauge, gaugeInterface);
                        const isKilled = await gaugeContract.connect(deployer).is_killed();

                        console.log(
                            `${name} Pid ${i}, gauge ${poolInfo.gauge} killed: ${isKilled}`,
                            poolLength.toString(),
                        );

                        info[name][i] = { pid: i, gauge: poolInfo.gauge, isKilled: isKilled };

                        if (isKilled) {
                            killed_info[name][i] = { pid: i, gauge: poolInfo.gauge, isKilled: isKilled };

                            if (!poolInfo.shutdown) {
                                killed_but_live_lists[name].push(i);
                                killed_but_live_info[name][i] = {
                                    pid: i,
                                    gauge: poolInfo.gauge,
                                    isKilled: isKilled,
                                    isShutdown: poolInfo.shutdown,
                                };
                            }
                        }
                    })(),
                );
            }

            await Promise.all(batchPromises);
        }

        // console.log(info);
        // console.log(killed_info);
        // console.log(killed_but_live_info);

        // sort info keys alphabetically
        const sortObjectByKey = object =>
            Object.keys(object)
                .sort()
                .reduce((acc, key) => {
                    acc[key] = info[key];
                    return acc;
                }, {});

        /*
         * Generate Safe TX Json
         */
        if (generateLogs) {
            fs.writeFileSync(
                path.resolve(__dirname, "./killed_but_live_info.json"),
                JSON.stringify(sortObjectByKey(killed_but_live_info), null, 4),
            );

            fs.writeFileSync(
                path.resolve(__dirname, "./killed_info.json"),
                JSON.stringify(sortObjectByKey(killed_info), null, 4),
            );

            fs.writeFileSync(
                path.resolve(__dirname, "./all_info.json"),
                JSON.stringify(sortObjectByKey(info), null, 4),
            );

            fs.writeFileSync(path.resolve(__dirname, "./all_gauge_info.json"), JSON.stringify(all_gauge_info, null, 4));
        }

        /*
         * Generate Safe TX Json
         */
        if (generateSafeData) {
            names.push("mainnet");
            const mainnetPoolManager = "0xD0521C061958324D06b8915FFDAc3DB22C8Bd687";
            const sidechainPoolManager = "0x2B6C227b26Bc0AcE74BB12DA86571179c2c8Bc54";

            for (const n in names) {
                const name = names[n];
                let poolManager = sidechainPoolManager;

                if (name === "mainnet") {
                    poolManager = mainnetPoolManager;
                }

                const poolsToKill = killed_but_live_lists[name];

                const shutdownDeadPoolsTransactions = poolsToKill.map(pool =>
                    shutdownPool(poolManager, pool.toString()),
                );
                const shutdownDeadPoolsTransaction = txMeta(shutdownDeadPoolsTransactions);
                fs.writeFileSync(
                    path.resolve(__dirname, "./" + name + "_shutdown.json"),
                    JSON.stringify(shutdownDeadPoolsTransaction, null, 4),
                );
            }
        }
    });

const txMeta = (transactions: Array<any>) => ({
    version: "1.0",
    chainId: "1",
    createdAt: Date.now(),
    meta: {
        name: "Shutdown",
        description: "",
        txBuilderVersion: "1.11.1",
        createdFromSafeAddress: "0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0",
        createdFromOwnerAddress: "",
        checksum: "0x535dc9a33e2c5aa0b638ad6a1d80b5278dc00b69d52110b5d4c2b268c40f698b",
    },
    transactions,
});

const shutdownPool = (to: string, pid: string) => ({
    to: to,
    value: "0",
    data: null,
    contractMethod: {
        inputs: [
            {
                internalType: "uint256",
                name: "_pid",
                type: "uint256",
            },
        ],
        name: "shutdownPool",
        payable: false,
    },
    contractInputsValues: {
        _pid: pid,
    },
});
