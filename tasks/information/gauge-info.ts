/* eslint-disable no-await-in-loop */

import * as fs from "fs";
import * as path from "path";
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { ethers } from "ethers";

import { getSigner } from "../utils";
import { Phase6Deployed } from "scripts/deploySystem";
import { config as mainnetConfig } from "../deploy/mainnet-config";
import { BoosterLite, BoosterLite__factory } from "../../types";

// ================================================================================================
// CONSTANTS
// ================================================================================================

// Contract addresses
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const BOOSTER_LITE_ADDRESS = "0x98Ef32edd24e2c92525E59afc4475C1242a30184";
const MAINNET_POOL_MANAGER = "0xD0521C061958324D06b8915FFDAc3DB22C8Bd687";
const SIDECHAIN_POOL_MANAGER = "0x2B6C227b26Bc0AcE74BB12DA86571179c2c8Bc54";
const GAUGE_CONTROLLER_ADDRESS = "0xC128468b7Ce63eA702C1f104D55A2566b13D3ABD";

// Contract ABIs
const MULTICALL3_ABI = [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)",
];

const GAUGE_CONTROLLER_ABI = [
    "function gauges(uint arg0) external view returns(address)",
    "function n_gauges() external view returns(int128)",
];

const GAUGE_INTERFACE = [
    "function is_killed() external view returns(bool)",
    "function getRecipient() external view returns(address)",
];

const BOOSTER_INTERFACE = [
    "function poolInfo(uint256) external view returns (address lptoken, address token, address gauge, address crvRewards, address stash, bool shutdown)",
];

// Network configuration
const NETWORK_NAMES: NetworkName[] = ["arbitrum", "optimism", "polygon", "gnosis", "base", "avalanche"];
const NETWORK_PROVIDERS = [
    process.env.ARBITRUM_NODE_URL,
    process.env.OPTIMISM_NODE_URL,
    process.env.POLYGON_NODE_URL,
    process.env.GNOSIS_NODE_URL,
    process.env.BASE_NODE_URL,
    process.env.AVALANCHE_NODE_URL,
];

// Batch sizes for different operations
const DEFAULT_BATCH_SIZE = 50;
const GNOSIS_BATCH_SIZE = 10; // Smaller batch size for Gnosis to avoid rate limits

// ================================================================================================
// TYPE DEFINITIONS
// ================================================================================================

type NetworkName = "arbitrum" | "optimism" | "polygon" | "gnosis" | "base" | "avalanche" | "mainnet";

type PoolInfo = {
    pid: number;
    gauge: string;
    isKilled: boolean;
};

type AllGaugeInfoEntry = {
    gaugeAddress: string;
    isKilled: boolean;
    isMainnet: boolean;
    recipient: string;
};

type GaugeInfo = { [key: string]: { [key: string]: PoolInfo } };
type AllGaugeInfo = { [index: number]: AllGaugeInfoEntry };
type IsGaugeKilled = { [gaugeAddress: string]: boolean };

type KilledInfo = { [K in NetworkName]?: { [poolId: string]: PoolInfo } };
type KilledButLiveInfo = {
    [K in NetworkName]?: {
        [poolId: string]: PoolInfo & { isShutdown: boolean };
    };
};
type KilledButLiveLists = { [K in NetworkName]?: number[] };

type ShutdownPoolTx = {
    to: string;
    value: string;
    data: null;
    contractMethod: {
        inputs: Array<{
            internalType: string;
            name: string;
            type: string;
        }>;
        name: string;
        payable: boolean;
    };
    contractInputsValues: {
        _pid: string;
    };
};

// ================================================================================================
// UTILITY FUNCTIONS
// ================================================================================================

/**
 * Batches multiple contract calls using Multicall3 for improved performance
 * @param calls Array of contract calls to batch
 * @param decoder Function to decode the return data
 * @param provider Ethereum provider
 * @param batchSize Number of calls per batch (default: 50)
 * @returns Array of decoded results
 */
async function batchMulticalls<T>(
    calls: Array<{ target: string; callData: string }>,
    decoder: (returnData: string) => T,
    provider: ethers.providers.Provider,
    batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<T[]> {
    const results: T[] = [];
    const multicallContract = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);

    console.log(`Processing ${calls.length} calls in batches of ${batchSize}...`);

    for (let i = 0; i < calls.length; i += batchSize) {
        const batch = calls.slice(i, i + batchSize);
        const multicallCalls = batch.map(call => ({
            target: call.target,
            allowFailure: false,
            callData: call.callData,
        }));

        try {
            const response = await multicallContract.aggregate3(multicallCalls);
            const batchResults = response.map((result: any) => decoder(result.returnData));
            results.push(...batchResults);

            if (i % (batchSize * 5) === 0) {
                console.log(`Processed ${Math.min(i + batchSize, calls.length)}/${calls.length} calls...`);
            }
        } catch (error) {
            console.error(`Multicall batch failed for indices ${i} to ${i + batch.length - 1}:`, error);
            // Fallback to individual calls if multicall fails
            console.log(`Falling back to individual calls for batch ${i}...`);
            for (const call of batch) {
                try {
                    const result = await provider.call({
                        to: call.target,
                        data: call.callData,
                    });
                    results.push(decoder(result));
                } catch (individualError) {
                    console.error(`Individual call failed for ${call.target}:`, individualError);
                    throw individualError;
                }
            }
        }
    }

    console.log(`Completed processing ${results.length} calls`);
    return results;
}

/**
 * Builds a shutdown pool transaction for Safe
 * @param poolManager Address of the pool manager contract
 * @param pid Pool ID to shutdown
 * @returns Formatted transaction for Safe
 */
function buildShutdownPoolTx(poolManager: string, pid: string): ShutdownPoolTx {
    return {
        to: poolManager,
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
    };
}

/**
 * Creates Safe transaction metadata
 * @param transactions Array of transactions
 * @returns Safe transaction metadata object
 */
function createTxMeta(transactions: Array<any>) {
    return {
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
    };
}

/**
 * Sorts object keys alphabetically for consistent output
 * @param object Object to sort
 * @returns New object with sorted keys
 */
function sortObjectByKey(object: Record<string, unknown>) {
    return Object.keys(object)
        .sort()
        .reduce((acc, key) => {
            acc[key] = object[key];
            return acc;
        }, {});
}

// ================================================================================================
// FILE OUTPUT FUNCTIONS
// ================================================================================================

/**
 * Generates JSON reports for gauge information
 * @param killed_but_live_info Information about killed but live pools
 * @param killed_info Information about all killed pools
 * @param info All pool information
 * @param all_gauge_info All gauge information
 */
function generateJsonReports(
    killed_but_live_info: KilledButLiveInfo,
    killed_info: KilledInfo,
    info: GaugeInfo,
    all_gauge_info: AllGaugeInfo,
) {
    fs.writeFileSync(
        path.resolve(__dirname, "./killed_but_live_info.json"),
        JSON.stringify(sortObjectByKey(killed_but_live_info), null, 4),
    );

    fs.writeFileSync(
        path.resolve(__dirname, "./killed_info.json"),
        JSON.stringify(sortObjectByKey(killed_info), null, 4),
    );

    fs.writeFileSync(path.resolve(__dirname, "./all_info.json"), JSON.stringify(sortObjectByKey(info), null, 4));

    fs.writeFileSync(path.resolve(__dirname, "./all_gauge_info.json"), JSON.stringify(all_gauge_info, null, 4));
}

/**
 * Writes shutdown transactions to files for Safe
 * @param shutdownTransactions Array of shutdown transactions
 * @param networkName Name of the network
 */
function writeShutdownTransactionsToFile(shutdownTransactions: Array<ShutdownPoolTx>, networkName: string) {
    const batchSize = 15;
    for (let i = 0; i < shutdownTransactions.length; i += batchSize) {
        const batch = shutdownTransactions.slice(i, i + batchSize);
        const shutdownTransaction = createTxMeta(batch);
        const batchFileName =
            batch.length === shutdownTransactions.length
                ? `${networkName}_shutdown.json`
                : `${networkName}_shutdown_batch_${Math.floor(i / batchSize) + 1}.json`;
        console.log(`Writing ${batchFileName} with ${batch.length} transactions`);
        if (batch.length > 0) {
            fs.writeFileSync(
                path.resolve(__dirname, "./" + batchFileName),
                JSON.stringify(shutdownTransaction, null, 4),
            );
        }
    }
}

// ================================================================================================
// CORE LOGIC FUNCTIONS
// ================================================================================================

/**
 * Collects gauge information from Balancer's Gauge Controller
 * @param deployer Signer for mainnet interactions
 * @returns Object containing all gauge info and killed gauge mapping
 */
async function collectBalancerGaugeInfo(deployer: ethers.Signer): Promise<{
    all_gauge_info: AllGaugeInfo;
    is_gauge_killed: IsGaugeKilled;
}> {
    console.log("📊 Collecting Balancer gauge information...");

    const gaugeControllerContract = new ethers.Contract(GAUGE_CONTROLLER_ADDRESS, GAUGE_CONTROLLER_ABI);
    const n_gauges = Number(await gaugeControllerContract.connect(deployer).n_gauges());

    const all_gauge_info: AllGaugeInfo = {};
    const is_gauge_killed: IsGaugeKilled = {};

    console.log(`Processing ${n_gauges} gauges with multicall optimization...`);

    // Step 1: Batch get all gauge addresses
    const gaugeAddressCalls = [];
    for (let i = 0; i < n_gauges; i++) {
        const iface = new ethers.utils.Interface(GAUGE_CONTROLLER_ABI);
        gaugeAddressCalls.push({
            target: GAUGE_CONTROLLER_ADDRESS,
            callData: iface.encodeFunctionData("gauges", [i]),
        });
    }

    const gaugeAddresses = await batchMulticalls(
        gaugeAddressCalls,
        (returnData: string) => {
            const iface = new ethers.utils.Interface(GAUGE_CONTROLLER_ABI);
            return iface.decodeFunctionResult("gauges", returnData)[0];
        },
        deployer.provider!,
        DEFAULT_BATCH_SIZE,
    );

    // Step 2: Batch get gauge info (is_killed and getRecipient)
    const gaugeInfoCalls = [];
    const gaugeInterfaceObj = new ethers.utils.Interface(GAUGE_INTERFACE);

    for (let i = 0; i < gaugeAddresses.length; i++) {
        const gaugeAddress = gaugeAddresses[i];

        gaugeInfoCalls.push({
            target: gaugeAddress,
            callData: gaugeInterfaceObj.encodeFunctionData("is_killed", []),
            index: i,
            type: "is_killed",
        });

        gaugeInfoCalls.push({
            target: gaugeAddress,
            callData: gaugeInterfaceObj.encodeFunctionData("getRecipient", []),
            index: i,
            type: "getRecipient",
        });
    }

    // Process gauge info calls with failure handling
    const batchSize = DEFAULT_BATCH_SIZE;
    for (let i = 0; i < gaugeInfoCalls.length; i += batchSize) {
        const batch = gaugeInfoCalls.slice(i, i + batchSize);
        const multicallContract = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, deployer.provider);

        const multicallCalls = batch.map(call => ({
            target: call.target,
            allowFailure: true, // Allow failures for getRecipient on mainnet gauges
            callData: call.callData,
        }));

        try {
            const response = await multicallContract.aggregate3(multicallCalls);

            for (let j = 0; j < response.length; j++) {
                const result = response[j];
                const call = batch[j];
                const gaugeIndex = call.index;
                const gaugeAddress = gaugeAddresses[gaugeIndex];

                if (!all_gauge_info[gaugeIndex]) {
                    all_gauge_info[gaugeIndex] = {
                        gaugeAddress: gaugeAddress,
                        isKilled: false,
                        isMainnet: true,
                        recipient: gaugeAddress,
                    };
                }

                if (result.success) {
                    if (call.type === "is_killed") {
                        const isKilled = gaugeInterfaceObj.decodeFunctionResult("is_killed", result.returnData)[0];
                        all_gauge_info[gaugeIndex].isKilled = isKilled;
                    } else if (call.type === "getRecipient") {
                        const recipient = gaugeInterfaceObj.decodeFunctionResult("getRecipient", result.returnData)[0];
                        all_gauge_info[gaugeIndex].recipient = recipient;
                        all_gauge_info[gaugeIndex].isMainnet = false;
                    }
                }
            }
        } catch (error) {
            console.error(`Multicall batch failed for gauge info:`, error);
            throw error;
        }
    }

    // Build the is_gauge_killed mapping
    for (const gaugeInfo of Object.values(all_gauge_info)) {
        is_gauge_killed[gaugeInfo.recipient] = gaugeInfo.isKilled;
    }

    console.log(`✅ Processed ${Object.keys(all_gauge_info).length} gauges successfully`);
    return { all_gauge_info, is_gauge_killed };
}

/**
 * Collects pool information for a specific sidechain network
 * @param providerUrl RPC URL for the network
 * @param networkName Name of the network
 * @param is_gauge_killed Mapping of gauge addresses to killed status
 * @returns Network-specific pool information
 */
async function collectSidechainPoolInfo(
    providerUrl: string,
    networkName: NetworkName,
    is_gauge_killed: IsGaugeKilled,
): Promise<{
    info: { [key: string]: PoolInfo };
    killed_info: { [key: string]: PoolInfo };
    killed_but_live_info: { [key: string]: PoolInfo & { isShutdown: boolean } };
    killed_but_live_lists: number[];
}> {
    console.log(`🔗 Processing sidechain: ${networkName}`);

    const customProvider = new ethers.providers.JsonRpcProvider(providerUrl);
    const booster: BoosterLite = BoosterLite__factory.connect(BOOSTER_LITE_ADDRESS, customProvider);

    const poolLength = await booster.poolLength();
    const info: { [key: string]: PoolInfo } = {};
    const killed_info: { [key: string]: PoolInfo } = {};
    const killed_but_live_info: { [key: string]: PoolInfo & { isShutdown: boolean } } = {};
    const killed_but_live_lists: number[] = [];

    console.log(`Processing ${poolLength} pools for ${networkName} with multicall optimization...`);

    try {
        // Batch all poolInfo calls for this network
        const poolInfoCalls = [];
        const boosterIface = new ethers.utils.Interface(BOOSTER_INTERFACE);

        for (let i = 0; i < Number(poolLength); i++) {
            poolInfoCalls.push({
                target: BOOSTER_LITE_ADDRESS,
                callData: boosterIface.encodeFunctionData("poolInfo", [i]),
            });
        }

        const poolInfoResults = await batchMulticalls(
            poolInfoCalls,
            (returnData: string) => {
                return boosterIface.decodeFunctionResult("poolInfo", returnData);
            },
            customProvider,
            networkName === "gnosis" ? GNOSIS_BATCH_SIZE : DEFAULT_BATCH_SIZE,
        );

        // Process results
        for (let i = 0; i < poolInfoResults.length; i++) {
            const poolInfo = poolInfoResults[i];
            const isKilled = is_gauge_killed[poolInfo.gauge];

            console.log(`${networkName} Pid ${i}, gauge ${poolInfo.gauge} killed: ${isKilled}`);

            info[i] = { pid: i, gauge: poolInfo.gauge, isKilled: isKilled };

            if (isKilled) {
                killed_info[i] = { pid: i, gauge: poolInfo.gauge, isKilled: isKilled };

                if (!poolInfo.shutdown) {
                    killed_but_live_lists.push(i);
                    killed_but_live_info[i] = {
                        pid: i,
                        gauge: poolInfo.gauge,
                        isKilled: isKilled,
                        isShutdown: poolInfo.shutdown,
                    };
                }
            }
        }
    } catch (error) {
        console.error(`❌ Error processing ${networkName}:`, error);
        throw error;
    }

    console.log(`✅ Completed ${networkName}: ${Object.keys(info).length} pools processed`);
    return { info, killed_info, killed_but_live_info, killed_but_live_lists };
}

/**
 * Collects pool information for mainnet
 * @param deployer Signer for mainnet interactions
 * @returns Mainnet pool information
 */
async function collectMainnetPoolInfo(deployer: ethers.Signer): Promise<{
    info: { [key: string]: PoolInfo };
    killed_info: { [key: string]: PoolInfo };
    killed_but_live_info: { [key: string]: PoolInfo & { isShutdown: boolean } };
    killed_but_live_lists: number[];
}> {
    console.log("🏠 Processing mainnet pools...");

    const phase6: Phase6Deployed = await mainnetConfig.getPhase6(deployer);
    const poolLength = await phase6.booster.poolLength();

    const info: { [key: string]: PoolInfo } = {};
    const killed_info: { [key: string]: PoolInfo } = {};
    const killed_but_live_info: { [key: string]: PoolInfo & { isShutdown: boolean } } = {};
    const killed_but_live_lists: number[] = [];

    console.log(`Processing ${poolLength} pools for mainnet with multicall optimization...`);

    // Step 1: Batch all poolInfo calls
    const poolInfoCalls = [];
    const boosterIface = new ethers.utils.Interface(BOOSTER_INTERFACE);

    for (let i = 0; i < Number(poolLength); i++) {
        poolInfoCalls.push({
            target: phase6.booster.address,
            callData: boosterIface.encodeFunctionData("poolInfo", [i]),
        });
    }

    const poolInfoResults = await batchMulticalls(
        poolInfoCalls,
        (returnData: string) => {
            return boosterIface.decodeFunctionResult("poolInfo", returnData);
        },
        deployer.provider!,
        DEFAULT_BATCH_SIZE,
    );

    // Step 2: Batch all gauge is_killed calls
    const gaugeKilledCalls = [];
    const mainnetGaugeIface = new ethers.utils.Interface(GAUGE_INTERFACE);

    for (let i = 0; i < poolInfoResults.length; i++) {
        const poolInfo = poolInfoResults[i];
        gaugeKilledCalls.push({
            target: poolInfo.gauge,
            callData: mainnetGaugeIface.encodeFunctionData("is_killed", []),
            poolIndex: i,
        });
    }

    const gaugeKilledResults = await batchMulticalls(
        gaugeKilledCalls,
        (returnData: string) => {
            return mainnetGaugeIface.decodeFunctionResult("is_killed", returnData)[0];
        },
        deployer.provider!,
        DEFAULT_BATCH_SIZE,
    );

    // Process results
    for (let i = 0; i < poolInfoResults.length; i++) {
        const poolInfo = poolInfoResults[i];
        const isKilled = gaugeKilledResults[i];

        console.log(`mainnet Pid ${i}, gauge ${poolInfo.gauge} killed: ${isKilled}`);

        info[i] = { pid: i, gauge: poolInfo.gauge, isKilled: isKilled };

        if (isKilled) {
            killed_info[i] = { pid: i, gauge: poolInfo.gauge, isKilled: isKilled };

            if (!poolInfo.shutdown) {
                killed_but_live_lists.push(i);
                killed_but_live_info[i] = {
                    pid: i,
                    gauge: poolInfo.gauge,
                    isKilled: isKilled,
                    isShutdown: poolInfo.shutdown,
                };
            }
        }
    }

    console.log(`✅ Completed mainnet: ${Object.keys(info).length} pools processed`);
    return { info, killed_info, killed_but_live_info, killed_but_live_lists };
}

// ================================================================================================
// MAIN TASK DEFINITION
// ================================================================================================

task("info:gauges:killed-gauges", "Generates txs to shutdown pools which gauges is killed")
    .addParam("safedata", "Generate Safe TX Builder Data")
    .addParam("savelogs", "save logs to file system")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const startTime = Date.now();
        const deployer = await getSigner(hre);
        const generateSafeData = Boolean(tskArgs.safedata);
        const generateLogs = Boolean(tskArgs.savelogs);

        console.log("🚀 Starting optimized gauge info collection...");

        const info: GaugeInfo = {};
        const killed_info: KilledInfo = {};
        const killed_but_live_info: KilledButLiveInfo = {};
        const killed_but_live_lists: KilledButLiveLists = {};

        // ========================================================================
        // STEP 1: Collect Balancer Gauge Information
        // ========================================================================
        const { all_gauge_info, is_gauge_killed } = await collectBalancerGaugeInfo(deployer);

        // ========================================================================
        // STEP 2: Process All Sidechain Networks
        // ========================================================================
        await Promise.all(
            NETWORK_PROVIDERS.map(async (providerUrl, index) => {
                if (!providerUrl) {
                    console.warn(`⚠️  Skipping ${NETWORK_NAMES[index]} - no provider URL configured`);
                    return;
                }

                const networkName = NETWORK_NAMES[index];
                const result = await collectSidechainPoolInfo(providerUrl, networkName, is_gauge_killed);

                info[networkName] = result.info;
                killed_info[networkName] = result.killed_info;
                killed_but_live_info[networkName] = result.killed_but_live_info;
                killed_but_live_lists[networkName] = result.killed_but_live_lists;
            }),
        );

        // ========================================================================
        // STEP 3: Process Mainnet
        // ========================================================================
        const mainnetResult = await collectMainnetPoolInfo(deployer);
        const networkName = "mainnet";

        info[networkName] = mainnetResult.info;
        killed_info[networkName] = mainnetResult.killed_info;
        killed_but_live_info[networkName] = mainnetResult.killed_but_live_info;
        killed_but_live_lists[networkName] = mainnetResult.killed_but_live_lists;

        // ========================================================================
        // STEP 4: Generate Output Files
        // ========================================================================
        if (generateLogs) {
            console.log("📝 Generating JSON reports...");
            generateJsonReports(killed_but_live_info, killed_info, info, all_gauge_info);
        }

        if (generateSafeData) {
            console.log("🔒 Generating Safe transaction files...");
            const allNetworks = [...NETWORK_NAMES, "mainnet"];

            for (const network of allNetworks) {
                const poolManager = network === "mainnet" ? MAINNET_POOL_MANAGER : SIDECHAIN_POOL_MANAGER;
                const poolsToKill = killed_but_live_lists[network] || [];

                if (poolsToKill.length > 0) {
                    const shutdownTransactions: Array<ShutdownPoolTx> = poolsToKill.map(pool =>
                        buildShutdownPoolTx(poolManager, pool.toString()),
                    );
                    writeShutdownTransactionsToFile(shutdownTransactions, network);
                } else {
                    console.log(`ℹ️  No pools to shutdown for ${network}`);
                }
            }
        }

        // ========================================================================
        // STEP 5: Performance Summary
        // ========================================================================
        const endTime = Date.now();
        const executionTime = (endTime - startTime) / 1000;
        console.log(`🎉 Optimization complete! Total execution time: ${executionTime.toFixed(2)}s`);
        console.log(`📊 Processed gauges across ${NETWORK_NAMES.length + 1} networks using multicall batching`);

        // Summary statistics
        const totalKilledButLive = Object.values(killed_but_live_lists).reduce(
            (sum, list) => sum + (list?.length || 0),
            0,
        );
        console.log(`🎯 Found ${totalKilledButLive} pools requiring shutdown across all networks`);
    });
