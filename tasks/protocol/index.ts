import assert from "assert";
import { getContractAddress } from "ethers/lib/utils";
import * as fs from "fs";
import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import * as path from "path";
import { getGaugePid, getGaugeRewardTokens } from "../utils/auraApi";
import { GaugesDetails, getGaugesDetails } from "../utils/balancerApi";

import { JsonRpcProvider } from "@ethersproject/providers";
import { Signer, ethers } from "ethers";
import { table } from "table";
import { GaugeVoteRewards } from "types";
import { getGaugeChoices } from "../../tasks/snapshot/utils";
import { canonicalConfigs, lzChainIds, sidechainConfigs } from "../deploy/sidechain-constants";
import { chainIds, getSigner } from "../utils";
import chalk from "chalk";

const debug = false;
type SafeTxCreation = {
    chainId?: string;
    name?: string;
    description?: string;
    createdFromSafeAddress?: string;
};
type SafeTxFile = {
    version: string;
    chainId: string;
    createdAt: number;
    meta: {
        name: string;
        description: string;
        txBuilderVersion: string;
        createdFromSafeAddress: string;
        createdFromOwnerAddress: string;
        checksum: string;
    };
    transactions: any[];
};
/* ---------------------------------------------------------------
     * Tx Builder  
    --------------------------------------------------------------- */

export const buildSafeTx =
    (params: SafeTxCreation) =>
    (transactions: Array<any>): SafeTxFile => ({
        version: "1.0",
        chainId: params.chainId ?? "1",
        createdAt: Date.now(),
        meta: {
            name: params.name ?? "Transactions Batch",
            description: params.description ?? "",
            txBuilderVersion: "1.16.2",
            createdFromSafeAddress: params.createdFromSafeAddress ?? "0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0",
            createdFromOwnerAddress: "",
            checksum: "",
        },
        transactions,
    });

const addPool = (poolManager: string, gauge: string) => ({
    to: poolManager,
    value: "0",
    data: null,
    contractMethod: {
        inputs: [
            {
                name: "_gauge",
                type: "address",
                internalType: "address",
            },
        ],
        name: "addPool",
        payable: false,
    },
    contractInputsValues: {
        _gauge: gauge,
    },
});
const setRewardMultiplier = (booster: string, rewardContract: string) => ({
    to: booster,
    value: "0",
    data: null,
    contractMethod: {
        inputs: [
            { name: "rewardContract", type: "address", internalType: "address" },
            { name: "multiplier", type: "uint256", internalType: "uint256" },
        ],
        name: "setRewardMultiplier",
        payable: false,
    },
    contractInputsValues: {
        rewardContract: rewardContract,
        multiplier: "4000",
    },
});
const setStashExtraReward = (boosterOwnerSecondary: string, pid: number, token: string) => ({
    to: boosterOwnerSecondary,
    value: "0",
    data: null,
    contractMethod: {
        inputs: [
            { name: "_pid", type: "uint256", internalType: "uint256" },
            { name: "_token", type: "address", internalType: "address" },
        ],
        name: "setStashExtraReward",
        payable: false,
    },
    contractInputsValues: {
        _pid: `${pid}`,
        _token: token,
    },
});
const setStashExtraRewardSidechain = (boosterOwner: string, stash: string, token: string) => ({
    to: boosterOwner,
    value: "0",
    data: null,
    contractMethod: {
        inputs: [
            { name: "_stash", type: "address", internalType: "address" },
            { name: "_token", type: "address", internalType: "address" },
        ],
        name: "setStashExtraReward",
        payable: false,
    },
    contractInputsValues: {
        _stash: stash,
        _token: token,
    },
});
const setPoolIds = (gaugeVoteRewards: string, start: number, end: number) => ({
    to: gaugeVoteRewards,
    value: "0",
    data: null,
    contractMethod: {
        inputs: [
            { name: "start", type: "uint256", internalType: "uint256" },
            { name: "end", type: "uint256", internalType: "uint256" },
        ],
        name: "setPoolIds",
        payable: false,
    },
    contractInputsValues: {
        start: `${start}`,
        end: `${end}`,
    },
});
const setIsNoDepositGauge = (gaugeVoteRewards: string, gauge: string, isNoDeposit = true) => ({
    to: gaugeVoteRewards,
    value: "0",
    data: null,
    contractMethod: {
        inputs: [
            {
                name: "_gauge",
                type: "address",
                internalType: "address",
            },
            {
                name: "_isNoDeposit",
                type: "bool",
                internalType: "bool",
            },
        ],
        name: "setIsNoDepositGauge",
        payable: false,
    },
    contractInputsValues: {
        _gauge: gauge,
        _isNoDeposit: `${isNoDeposit}`,
    },
});
const setDstChainId = (gaugeVoteRewards: string, gauges: string[], dstChainId: number) => ({
    to: gaugeVoteRewards,
    value: "0",
    data: null,
    contractMethod: {
        inputs: [
            {
                name: "_gauges",
                type: "address[]",
                internalType: "address[]",
            },
            {
                name: "_dstChainId",
                type: "uint16",
                internalType: "uint16",
            },
        ],
        name: "setDstChainId",
        payable: false,
    },
    contractInputsValues: {
        _gauges: `[${gauges}]`,
        _dstChainId: `${dstChainId}`,
    },
});
function writeSafeTxFile(safeTx: SafeTxFile, fileName: string) {
    if (safeTx.transactions.length > 0) {
        const filePath = path.resolve(__dirname, `./${fileName}.json`);
        console.log("File generated", filePath);
        fs.writeFileSync(filePath, JSON.stringify(safeTx, null, 4));
    }
}

const gaugeTypesSupported = ["Ethereum", "Polygon", "Arbitrum", "Optimism", "Gnosis", "Base", "ZkEvm", "Avalanche"]; // TODO Fraxtal
const opAddress = "0x4200000000000000000000000000000000000042";

/* ---------------------------------------------------------------
     * Helpers 
    --------------------------------------------------------------- */
const formatBool = (b: boolean, str?: string) => {
    return (b ? chalk.bgGreen.black : chalk.bgBlack.white)(` ${str || (b ? "YES" : "NO")} `);
};
const formatDstChainId = (str: string) => {
    return (str !== "NO" ? chalk.bgGreen.black : chalk.bgBlack.white)(` ${str} `);
};

const onlySupportedChains = (chainName: string): boolean => gaugeTypesSupported.includes(chainName);
const chainNameFromGaugeDetails = (gauge: GaugesDetails): string => {
    if (gauge.rootGauge) {
        return gauge.rootGauge.chain === "PolygonZkEvm" ? "ZkEvm" : gauge.rootGauge.chain;
    }
    return gauge.type.name;
};
const asyncFilter = async <T>(arr: Array<T>, predicate: (arg: T) => Promise<boolean>) =>
    Promise.all(arr.map(predicate)).then(results => arr.filter((_v, index) => results[index]));
const onlyDifferent = (prev: string, curr: string): string => (prev.includes(curr) ? prev : `${prev},${curr}`);
const isDestChainIdNotSet = (gaugeVoteRewards: GaugeVoteRewards) => async (gauge: GaugesDetails) =>
    0 === (await gaugeVoteRewards.getDstChainId(gauge.address));
const isNoDepositGaugeNotSet = (gaugeVoteRewards: GaugeVoteRewards) => async (gauge: GaugesDetails) =>
    (await gaugeVoteRewards.isNoDepositGauge(gauge.address)) === false;
const chainNameToLzChainId = (chainName: string) => {
    chainName === "PolygonZkEvm" ? "zkevm" : chainName;
    return lzChainIds[chainIds[chainName.toLowerCase()]];
};

async function addPoolToMainnet(
    deployer: Signer,
    chainName: string,
    chainId: number,
    gaugesDetails: Array<GaugesDetails>,
    voting = false,
) {
    console.log("--------------------------------------------------------------------");
    console.log(`------ addPoolToMainnet ${chainName} chainId: ${chainId} no gauges: ${gaugesDetails.length} ------`);
    console.log("--------------------------------------------------------------------");

    const canonicalConfig = canonicalConfigs[chainId];
    assert(!!canonicalConfig, `Local config for chain ID ${chainId} not found`);
    const fileName = `gnosis_tx_${chainName}-add-pools`;
    const { cvx } = await canonicalConfig.getPhase2(deployer);
    const { booster, factories } = await canonicalConfig.getPhase6(deployer);
    const { poolManagerV4, boosterOwnerSecondary } = await canonicalConfig.getPhase8(deployer);
    const { gaugeVoteRewards } = canonicalConfig.getGaugeVoteRewards(deployer);
    const gaugeControllerAbi = [
        "function gauges(uint arg0) external view returns(address)",
        "function get_gauge_weight(address gauge) external view returns(uint256)",
    ];
    const gaugeControllerContract = new ethers.Contract(
        canonicalConfig.addresses.gaugeController,
        gaugeControllerAbi,
        deployer,
    );

    const initialPid = (await booster.poolLength()).toNumber();
    const initialRewardFactoryNonce = await deployer.provider.getTransactionCount(factories.rewardFactory.address);

    const mainnetTxPerPool = [];
    const invalidGauges = [];
    const gaugesToProcess = gaugesDetails.filter(gauge => !gauge.rootGauge);
    const tableInfo = {};
    const defaultTableInfo = {
        addPool: false,
        setRewardMultiplier: false,
        setStashExtraReward: false,
        setIsNoDepositGauge: false,
        setDstChainId: "NO",
    };
    const gaugeList = getGaugeChoices();
    const extraRewards = [cvx.address];
    const gaugeRewardTokens = await getGaugeRewardTokens(
        chainId,
        gaugesDetails.map(gauge => gauge.address),
    );
    for (let index = 0; index < gaugesToProcess.length; index++) {
        const gauge = gaugesToProcess[index];
        const gaugeChoice = gaugeList.find(gc => gc.address.toLowerCase() === gauge.address.toLowerCase());
        tableInfo[gauge.address] = { ...gaugeChoice, ...defaultTableInfo };

        // Verify the pool should be added or not
        if (!gauge.liquidityGauge) {
            invalidGauges.push(gauge.address);
            console.warn(`WARNING ${chainName}  setIsNoDepositGauge[${gauge.address}]`);
            tableInfo[gauge.address].setIsNoDepositGauge = true;
            continue;
        }
        if (gauge.liquidityGauge.isKilled) {
            invalidGauges.push(gauge.address);
            console.warn(`WARNING ${chainName} Gauge is killed ${gauge.address}`);
            continue;
        }
        const gaugeExist = await booster.gaugeMap(gauge.address);

        if (gaugeExist) {
            invalidGauges.push(gauge.address);
            const gaugePids = await getGaugePid(chainId, [gauge.address]);
            const poolInfo = await booster.poolInfo(gaugePids[0].pool.id);
            const rewardMultiplier = await booster.getRewardMultipliers(poolInfo.crvRewards);
            if (debug)
                console.warn(
                    `WARNING ${chainName} Gauge already added ${gauge.address} with rewardMultiplier: ${rewardMultiplier}`,
                );

            if (voting) {
                const currentGrt = gaugeRewardTokens.filter(
                    grt => grt.gauge.id.toLowerCase() === gauge.address.toLowerCase(),
                );
                const currentGaugeRewardTokens = [
                    ...currentGrt.flatMap(grt => grt.rewardData.map(rd => rd.token.id.toLowerCase())),
                ];
                const txPerPool = [];
                for (let j = 0; j < extraRewards.length; j++) {
                    const extraReward = extraRewards.map(t => t.toLowerCase())[j];
                    if (!currentGaugeRewardTokens.includes(extraReward)) {
                        // Add missing reward token
                        txPerPool.push(
                            setStashExtraReward(
                                boosterOwnerSecondary.address,
                                Number(gaugePids[0].pool.id),
                                extraRewards[j],
                            ),
                        );
                        tableInfo[gauge.address] = {
                            ...tableInfo[gauge.address],
                            setStashExtraReward: true,
                        };
                        if (debug)
                            console.warn(
                                `${chainName} Gauge ${gauge.address} pid ${currentGrt[0]?.id} missing reward token ${extraReward}`,
                            );
                    }
                }
                mainnetTxPerPool.push(...txPerPool);
            }
            continue;
        }

        const weight = Number(await gaugeControllerContract.get_gauge_weight(gauge.address));
        if (weight <= 0) {
            invalidGauges.push(gauge.address);
            console.warn(`WARNING ${chainName} Gauge must have weight ${gauge.address}`);
            continue;
        }
        const pid = initialPid + index - invalidGauges.length;
        const rewardFactoryNonce = initialRewardFactoryNonce + index - invalidGauges.length;

        const rewardContract = getContractAddress({ from: factories.rewardFactory.address, nonce: rewardFactoryNonce });

        const txPerPool = [
            addPool(poolManagerV4.address, gauge.address),
            setRewardMultiplier(booster.address, rewardContract),
            setStashExtraReward(boosterOwnerSecondary.address, pid, cvx.address),
        ];
        tableInfo[gauge.address] = {
            ...tableInfo[gauge.address],
            addPool: true,
            setRewardMultiplier: true,
            setStashExtraReward: true,
        };
        mainnetTxPerPool.push(...txPerPool);
    }
    const finalPid = initialPid + gaugesToProcess.length - invalidGauges.length;
    if (initialPid < finalPid) {
        mainnetTxPerPool.push(setPoolIds(gaugeVoteRewards.address, initialPid, finalPid));
    }
    if (invalidGauges.length > 0) {
        if (debug) {
            console.log(`${chainName} ignored gauges ${invalidGauges.length} out of ${gaugesToProcess.length}`);
            console.log(`${chainName} ignored gauges ${invalidGauges}`);
        }
    }

    // Mainnet txs of sidechain gauges
    let sidechainTxs = [];
    if (voting) {
        const sidechainGauges = gaugesDetails.filter(gauge => !!gauge.rootGauge);
        const notDepositGauges = sidechainGauges.filter(gauge => !onlySupportedChains(gauge.rootGauge.chain));
        const depositGauges = sidechainGauges.filter(gauge => onlySupportedChains(gauge.rootGauge.chain));

        sidechainTxs = [
            ...(await asyncFilter<GaugesDetails>(notDepositGauges, isNoDepositGaugeNotSet(gaugeVoteRewards))).map(
                gauge => {
                    const gaugeChoice = gaugeList.find(gc => gc.address.toLowerCase() === gauge.address.toLowerCase());
                    tableInfo[gauge.address] = {
                        ...{ label: gauge.address, address: gauge.address },
                        ...gaugeChoice,
                        ...defaultTableInfo,
                        setIsNoDepositGauge: true,
                    };
                    return setIsNoDepositGauge(gaugeVoteRewards.address, gauge.address);
                },
            ),
            ...(await asyncFilter<GaugesDetails>(depositGauges, isDestChainIdNotSet(gaugeVoteRewards))).map(gauge => {
                const gaugeChoice = gaugeList.find(gc => gc.address.toLowerCase() === gauge.address.toLowerCase());
                tableInfo[gauge.address] = {
                    ...{ label: gauge.address, address: gauge.address },
                    ...gaugeChoice,
                    ...defaultTableInfo,
                    setDstChainId: chainNameToLzChainId(gauge.rootGauge.chain),
                };
                return setDstChainId(
                    gaugeVoteRewards.address,
                    [gauge.address],
                    chainNameToLzChainId(gauge.rootGauge.chain),
                );
            }),
        ];
    }

    const transactions = [...mainnetTxPerPool, ...sidechainTxs];
    // Table output
    const tableData = [
        [
            `${chainName} Gauge`,
            "Address",
            "addPool",
            "setRewardMultiplier",
            "setStashExtraReward",
            "setIsNoDepositGauge",
            "setDstChainId",
        ],
        ...Object.keys(tableInfo).map(k => {
            const info = tableInfo[k];
            return [
                info.label ?? k,
                info.address ?? k,
                formatBool(info.addPool),
                formatBool(info.setRewardMultiplier),
                formatBool(info.setStashExtraReward),
                formatBool(info.setIsNoDepositGauge),
                formatDstChainId(info.setDstChainId),
            ];
        }),
    ];
    console.log(table(tableData));

    const safeTx = buildSafeTx({
        chainId: `${chainId}`,
        name: "Add pool",
        description: "Add pool",
        createdFromSafeAddress: canonicalConfig.multisigs.daoMultisig,
    })(transactions);
    return { fileName, safeTx };
}
async function addPoolToSidechain(
    chainName: string,
    chainId: number,
    gaugesDetails: Array<GaugesDetails>,
    voting = false,
) {
    console.log("--------------------------------------------------------------------");
    console.log(`------addPoolToSidechain ${chainName} chainId: ${chainId} no gauges: ${gaugesDetails.length} ------`);
    console.log("--------------------------------------------------------------------");
    // process.env.ARBITRUM_NODE_URL,
    // process.env.OPTIMISM_NODE_URL,
    // process.env.POLYGON_NODE_URL,
    // process.env.GNOSIS_NODE_URL,
    // process.env.BASE_NODE_URL,
    // process.env.ZKEVM_NODE_URL,
    // process.env.AVALANCHE_NODE_URL,
    // process.env.FRAXTAL_NODE_URL,
    const REMOTE_NODE_URL = `${chainName.toUpperCase()}_NODE_URL`;
    const remoteNodeUrl = process.env[`${REMOTE_NODE_URL}`];
    assert(remoteNodeUrl.length > 0, `${REMOTE_NODE_URL} not set`);
    const jsonProvider = new JsonRpcProvider(remoteNodeUrl);
    await jsonProvider.ready;

    const fileName = `gnosis_tx_${chainName}-add-pools`;
    const sidechainConfig = sidechainConfigs[chainId];
    assert(sidechainConfig, `Local config for chain ID ${chainId} not found`);
    const gaugeRewardTokens = await getGaugeRewardTokens(
        chainId,
        gaugesDetails.map(gauge => gauge.rootGauge.recipient),
    );

    const { poolManager, booster, boosterOwner, childGaugeVoteRewards, auraOFT, factories } =
        sidechainConfig.getSidechain(jsonProvider);
    const initialPid = (await booster.poolLength()).toNumber();
    const initialNonce = await jsonProvider.getTransactionCount(factories.proxyFactory.address);
    const allTxPerPool = [];
    const invalidGauges = [];
    const extraRewards = chainId === chainIds.optimism && voting ? [auraOFT.address, opAddress] : [auraOFT.address];
    let addPools = 0;
    const tableInfo = {};
    const defaultTableInfo = {
        addPool: false,
        setStashExtraReward: [],
    };

    for (let index = 0; index < gaugesDetails.length; index++) {
        const gauge = gaugesDetails[index];
        const txPerPool = [];
        const gaugeList = getGaugeChoices();
        const gaugeChoice = gaugeList.find(gc => gc.address.toLowerCase() === gauge.address.toLowerCase());
        tableInfo[gauge.address] = {
            ...{ label: gauge.address, address: gauge.address },
            ...gaugeChoice,
            recipient: gauge.rootGauge.recipient,
            ...defaultTableInfo,
        };

        const gaugeExist = await booster.gaugeMap(gauge.rootGauge.recipient);
        if (gaugeExist) {
            const gaugePids = await getGaugePid(chainId, [gauge.rootGauge.recipient]);
            const poolInfo = await booster.poolInfo(gaugePids[0].pool.id);

            invalidGauges.push(gauge.address);
            if (debug)
                console.warn(
                    `${chainName} Root gauge already added ${gauge.address} recipient ${gauge.rootGauge.recipient} `,
                );

            if (voting) {
                const currentGrt = gaugeRewardTokens.filter(
                    grt => grt.gauge.id.toLowerCase() === gauge.rootGauge.recipient.toLowerCase(),
                );
                const currentGaugeRewardTokens = [
                    ...currentGrt.flatMap(grt => grt.rewardData.map(rd => rd.token.id.toLowerCase())),
                ];

                for (let j = 0; j < extraRewards.length; j++) {
                    const extraReward = extraRewards.map(t => t.toLowerCase())[j];
                    if (!currentGaugeRewardTokens.includes(extraReward)) {
                        // Add missing reward token
                        txPerPool.push(
                            setStashExtraRewardSidechain(boosterOwner.address, poolInfo.stash, extraRewards[j]),
                        );
                        tableInfo[gauge.address] = {
                            ...tableInfo[gauge.address],
                            setStashExtraReward: [...tableInfo[gauge.address].setStashExtraReward, extraRewards[j]],
                        };
                        console.warn(
                            `${chainName} Gauge ${gauge.rootGauge.recipient} pid ${currentGrt[0]?.id} missing reward token ${extraReward}`,
                        );
                    }
                }
            }
        } else {
            // verify if it needs to set extra rewards
            txPerPool.push(addPool(poolManager.address, gauge.rootGauge.recipient));
            const nonce = initialNonce + addPools;
            const stashContract = getContractAddress({ from: factories.proxyFactory.address, nonce: nonce });
            for (let j = 0; j < extraRewards.length; j++) {
                txPerPool.push(setStashExtraRewardSidechain(boosterOwner.address, stashContract, extraRewards[j]));
                tableInfo[gauge.address] = {
                    ...tableInfo[gauge.address],
                    setStashExtraReward: [...tableInfo[gauge.address].setStashExtraReward, extraRewards[j]],
                };
            }

            addPools++;
            tableInfo[gauge.address] = { ...tableInfo[gauge.address], addPool: true };
        }
        allTxPerPool.push(...txPerPool);
    }
    const finalPid = initialPid + gaugesDetails.length - invalidGauges.length;
    if (initialPid < finalPid) {
        allTxPerPool.push(setPoolIds(childGaugeVoteRewards.address, initialPid, finalPid));
    }
    if (invalidGauges.length > 0) {
        console.log(`${chainName} ignored gauges ${invalidGauges.length} out of ${gaugesDetails.length}`);
        if (debug) console.log(`${chainName} ignored gauges ${invalidGauges}`);
    }

    const transactions = [...allTxPerPool];
    const tableData = [
        [`${chainName} Gauge`, "Root address", "Recipient address", "addPool", "setStashExtraReward"],
        ...Object.keys(tableInfo).map(k => {
            const info = tableInfo[k];
            return [
                info.label,
                info.address,
                info.recipient,
                formatBool(info.addPool),
                info.setStashExtraReward.join(`\n`),
            ];
        }),
    ];
    console.log(table(tableData));
    const safeTx = buildSafeTx({
        chainId: `${chainId}`,
        name: "Add pool",
        description: "Add pool",
        createdFromSafeAddress: sidechainConfig.multisigs.daoMultisig,
    })(transactions);
    return { fileName, safeTx };
}

//  yarn task protocol:add-pool  --network mainnet  --voting false --gauges 0xD5417ACb575c799cEB373f85AdF100C7cD84C8c8,
task("protocol:add-pool")
    .addParam("gauges", "String with gauges to add separated by `,`")
    .addOptionalParam(
        "voting",
        "If it is voting mode, setIsNoDepositGauge, setDstChainId, setExtraRewards",
        false,
        types.boolean,
    )
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        // Only runs on mainnet, sidechain data is gathered via JSON providers
        const chainId = chainIds.mainnet;

        const gauges: Array<string> = tskArgs.gauges.split(",");
        assert(gauges.length > 0, `Gauges size is not correct ${tskArgs.gauges}`);

        const gaugesDetails: Array<GaugesDetails> = await getGaugesDetails(gauges);
        if (gaugesDetails.length != gauges.length) {
            console.warn(`WARNING Gauges found ${gaugesDetails.length} out of ${gauges.length}`);
            const gds = gaugesDetails.map(gd => gd.address.toLowerCase());

            console.warn(
                `WARNING Gauges are missing ${gauges.map(g => g.toLowerCase()).filter(g => !gds.includes(g))}`,
            );
        }

        const gaugesChains = gaugesDetails
            .map(chainNameFromGaugeDetails)
            .filter(onlySupportedChains)
            .reduce(onlyDifferent, "")
            .split(",")
            .filter(s => s !== "");
        // Generate Files
        if (gaugesChains.includes("Ethereum") || tskArgs.voting) {
            // Pass all gauges without filter to mainnet, to verify if setIsNoDepositGauge, setDstChainId is needed.
            const { fileName, safeTx } = await addPoolToMainnet(
                deployer,
                "Ethereum",
                chainId,
                gaugesDetails,
                tskArgs.voting,
            );
            writeSafeTxFile(safeTx, fileName);
        }
        const sideChains = gaugesChains.filter(chain => chain !== "Ethereum");
        for (let i = 0; i < sideChains.length; i++) {
            const sideChainName = sideChains[i];
            const gaugesToProcess = gaugesDetails.filter(gauge => gauge.rootGauge?.chain === sideChainName);
            const { fileName, safeTx } = await addPoolToSidechain(
                sideChainName,
                chainIds[sideChainName.toLowerCase()],
                gaugesToProcess,
                tskArgs.voting,
            );
            writeSafeTxFile(safeTx, fileName);
        }
    });

task("protocol:gaugeVoter-setIsNoDepositGauge")
    .addParam("gauges", "String with gauges to add separated by `,`")
    .addOptionalParam("value", "Prepare txs to invoke GaugeVoter.setIsNoDepositGauge(value)", false, types.boolean)
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        // Only runs on mainnet, sidechain data is gathered via JSON providers
        const chainId = chainIds.mainnet;

        const gauges = tskArgs.gauges.split(",");
        assert(gauges.length > 0, `Gauges size is not correct ${tskArgs.gauges}`);

        const fileName = `gnosis_tx_Ethereum-setIsNoDepositGauge`;
        const gaugesDetails: Array<GaugesDetails> = await getGaugesDetails(gauges);
        if (gaugesDetails.length != gauges.length) {
            console.warn(`WARNING Gauges found ${gaugesDetails.length} out of ${gauges.length}`);
        }
        const canonicalConfig = canonicalConfigs[chainId];
        const { gaugeVoteRewards } = canonicalConfig.getGaugeVoteRewards(deployer);

        const transactions = gaugesDetails.map(gauge =>
            setIsNoDepositGauge(gaugeVoteRewards.address, gauge.address, tskArgs.value),
        );
        const safeTx = buildSafeTx({
            chainId: `${chainId}`,
            name: "setIsNoDepositGauge",
            description: "setIsNoDepositGauge ",
            createdFromSafeAddress: canonicalConfig.multisigs.daoMultisig,
        })(transactions);

        writeSafeTxFile(safeTx, fileName);
    });
