import * as fs from "fs";
import * as path from "path";
import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import { getSigner } from "../../tasks/utils";
import { Phase2Deployed } from "scripts/deploySystem";
import { config } from "../deploy/mainnet-config";
import { chunk } from "lodash";
import { Contract } from "ethers";

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

const shutdownPool = (pid: string) => ({
    to: "0xf843F61508Fc17543412DE55B10ED87f4C28DE50",
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

const shutdownSystems = () => [
    {
        to: "0xdc274F4854831FED60f9Eca12CaCbD449134cF67",
        value: "0",
        data: null,
        contractMethod: {
            inputs: [],
            name: "shutdownSystem",
            payable: false,
        },
        contractInputsValues: null,
    },
    {
        to: "0xFa838Af70314135159b309bf27f1DbF1F954eC34",
        value: "0",
        data: null,
        contractMethod: {
            inputs: [],
            name: "shutdownSystem",
            payable: false,
        },
        contractInputsValues: null,
    },
];

const updateOperator = (operator: string) => [
    {
        to: "0xaF52695E1bB01A16D33D7194C28C42b10e0Dbec2",
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                {
                    internalType: "address",
                    name: "_operator",
                    type: "address",
                },
            ],
            name: "setOperator",
            payable: false,
        },
        contractInputsValues: {
            _operator: operator,
        },
    },
    {
        to: "0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF",
        value: "0",
        data: null,
        contractMethod: {
            inputs: [],
            name: "updateOperator",
            payable: false,
        },
        contractInputsValues: null,
    },
];

const addPools = (gauges: Array<string>) =>
    gauges.map(gauge => ({
        to: "0xB58Eb197c35157E6F3351718C4C387D284562BE5",
        value: "0",
        data: null,
        contractMethod: {
            inputs: [
                {
                    internalType: "address",
                    name: "_gauge",
                    type: "address",
                },
            ],
            name: "addPool",
            payable: false,
        },
        contractInputsValues: {
            _gauge: gauge,
        },
    }));

task("shutdown:generate", "Generates txs file to shutdown all the system").setAction(async function (
    _: TaskArguments,
    hre: HardhatRuntime,
) {
    const signer = await getSigner(hre);

    // Get pools to shutdown
    const phase2: Phase2Deployed = await config.getPhase2(signer);
    const poolLength = await phase2.booster.poolLength();

    // shutdown pools
    const pools = (
        await Promise.all(
            Array(poolLength.toNumber())
                .fill(null)
                .map(async (_, i) => {
                    const poolInfo = await phase2.booster.poolInfo(i);
                    return { ...poolInfo, pid: i };
                }),
        )
    ).filter(pool => !pool.shutdown);

    const poolsChunks = chunk(pools, Math.ceil(pools.length / 3));

    const phase1Pools = poolsChunks[2];
    const phase2Pools = poolsChunks[1];
    const phase3Pools = poolsChunks[0]; // Reverse order the chunks so stETH pool is last

    /* -------------------------------------------------------
     * Phase 1 (1/3) pools
     * ----------------------------------------------------- */
    const shutdownPhase1PoolsTransactions = phase1Pools.map(pool => shutdownPool(pool.pid.toString()));
    const shutdownPhase1PoolsTransaction = txMeta(shutdownPhase1PoolsTransactions);
    fs.writeFileSync(
        path.resolve(__dirname, "./gnosis_tx_1_shutdown_phase_1_pools.json"),
        JSON.stringify(shutdownPhase1PoolsTransaction),
    );

    /* -------------------------------------------------------
     * Phase 2 (2/3) pools
     * ----------------------------------------------------- */
    const shutdownPhase2PoolsTransactions = phase2Pools.map(pool => shutdownPool(pool.pid.toString()));
    const shutdownPhase2PoolsTransaction = txMeta(shutdownPhase2PoolsTransactions);
    fs.writeFileSync(
        path.resolve(__dirname, "./gnosis_tx_2_shutdown_phase_2_pools.json"),
        JSON.stringify(shutdownPhase2PoolsTransaction),
    );

    /* -------------------------------------------------------
     * Phase 3 (3/3) pools
     * ----------------------------------------------------- */
    const shutdownPhase3PoolsTransactions = phase3Pools.map(pool => shutdownPool(pool.pid.toString()));
    const shutdownPhase3PoolsTransaction = txMeta(shutdownPhase3PoolsTransactions);
    fs.writeFileSync(
        path.resolve(__dirname, "./gnosis_tx_3_shutdown_phase_3_pools.json"),
        JSON.stringify(shutdownPhase3PoolsTransaction),
    );

    /* -------------------------------------------------------
     * Phase 4 Shutdown system
     * ----------------------------------------------------- */
    const shutdownSystemTransactions = shutdownSystems();
    const updateOperatorTransactions = updateOperator("0xA57b8d98dAE62B26Ec3bcC4a365338157060B234");
    const addInitialPoolsTransactions = addPools([
        "0x275df57d2b23d53e20322b4bb71bf1dcb21d0a00",
        "0x0312aa8d0ba4a1969fddb382235870bf55f7f242",
        "0xa6325e799d266632d347e41265a69af111b05403",
    ]);
    const shutdownSystemTransaction = txMeta([
        ...shutdownSystemTransactions,
        ...updateOperatorTransactions,
        ...addInitialPoolsTransactions,
    ]);
    fs.writeFileSync(
        path.resolve(__dirname, "./gnosis_tx_4_shutdown_systems.json"),
        JSON.stringify(shutdownSystemTransaction),
    );

    /* -------------------------------------------------------
     * Phase DEV All
     * ----------------------------------------------------- */
    const allTransactions = [
        ...shutdownPhase1PoolsTransactions,
        ...shutdownPhase2PoolsTransactions,
        ...shutdownPhase3PoolsTransactions,
        ...shutdownSystemTransactions,
        ...updateOperatorTransactions,
        ...addInitialPoolsTransactions,
    ];
    const allTransaction = txMeta(allTransactions);
    fs.writeFileSync(path.resolve(__dirname, "./gnosis_tx_DEV_all.json"), JSON.stringify(allTransaction));
});

task("addpools:generate", "Add pools to booster").setAction(async function (_: TaskArguments, hre: HardhatRuntime) {
    const signer = await getSigner(hre);

    // Get pools to shutdown
    const { booster: boosterV1 } = await config.getPhase2(signer);
    const { booster: boosterV2 } = await config.getPhase6(signer);

    const phase1 = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, "./gnosis_tx_1_shutdown_phase_1_pools.json"), "utf8"),
    );
    const phase2 = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, "./gnosis_tx_2_shutdown_phase_2_pools.json"), "utf8"),
    );
    const phase3 = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, "./gnosis_tx_3_shutdown_phase_3_pools.json"), "utf8"),
    );

    const pools1 = phase1.transactions.map((tx: any) => tx.contractInputsValues._pid);
    const pools2 = phase2.transactions.map((tx: any) => tx.contractInputsValues._pid);
    const pools3 = phase3.transactions.map((tx: any) => tx.contractInputsValues._pid);

    const pools = [...pools1, ...pools2, ...pools3];

    const gaugesV2 = await Promise.all(
        Array((await boosterV2.poolLength()).toNumber())
            .fill(null)
            .map(async (_, pid) => {
                const poolInfo = await boosterV2.poolInfo(pid);
                return poolInfo.gauge;
            }),
    );

    console.log("Existing pools:", gaugesV2.length, gaugesV2);

    const gauges = (
        await Promise.all(
            pools.map(async pid => {
                const poolInfo = await boosterV1.poolInfo(pid);
                const gauge = new Contract(
                    poolInfo.gauge,
                    [
                        "function symbol() external view returns (string memory)",
                        "function is_killed() external view returns (bool)",
                    ],
                    signer,
                );
                const gaugeSymbol = await gauge.symbol();

                if (await gauge.is_killed()) {
                    console.log("Gauge killed:", gaugeSymbol, poolInfo.gauge);
                    return false;
                }

                if (gaugesV2.map(x => x.toLowerCase()).includes(poolInfo.gauge.toLowerCase())) {
                    console.log("Already added pool:", gaugeSymbol, poolInfo.gauge);
                    return false;
                } else {
                    console.log("Gauge added:", gaugeSymbol.padEnd(48, " "), poolInfo.gauge);
                    return poolInfo.gauge;
                }
            }),
        )
    ).filter(Boolean) as string[];

    console.log("Gauges:", gauges.length);

    const chunks = chunk(gauges, 3);

    for (let i = 0; i < chunks.length; i++) {
        const tx = txMeta(addPools(chunks[i]));
        fs.writeFileSync(path.resolve(__dirname, `gnosis_tx_${i}_add_new_pools.json`), JSON.stringify(tx));
    }
});
