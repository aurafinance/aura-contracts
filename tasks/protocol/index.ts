import assert from "assert";
import { getContractAddress } from "ethers/lib/utils";
import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getGaugePid, getGaugeRewardTokens } from "../utils/auraApi";
import { GaugesDetails, getGaugesDetails } from "../utils/balancerApi";

import { JsonRpcProvider } from "@ethersproject/providers";
import chalk from "chalk";
import { ethers, Signer } from "ethers";
import { table } from "table";
import { compareAddresses, getGaugeChoices } from "../../tasks/snapshot/utils";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import {
    Booster,
    BoosterLite,
    ChildGaugeVoteRewards,
    ExtraRewardStashV3__factory,
    GaugeVoteRewards,
    KeeperMulticall3__factory,
    MockVoting__factory,
} from "../../types";
import { canonicalConfigs, lzChainIds, sidechainConfigs } from "../deploy/sidechain-constants";
import { chainIds, chainNames, getJsonProviderByChainName, getSigner, waitForTx } from "../utils";
import {
    boosterOwnerLiteTxsBuilder,
    buildSafeTx,
    extraRewardStashModuleTxsBuilder,
    gaugeVoterTxsBuilder,
    l2PoolManagerProxyTxsBuilder,
    poolFeeManagerProxyTxsBuilder,
    writeSafeTxFile,
} from "./safe";

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const PUBLIC_MULTICALL_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const gaugeControllerAbi = [
    "function gauges(uint arg0) external view returns(address)",
    "function get_gauge_weight(address gauge) external view returns(uint256)",
];
const debug = false;
const log = (level: string, ...args) => {
    if (debug) console[level](...args);
};

const gaugeTypesSupported = [
    "Ethereum",
    "Polygon",
    "Arbitrum",
    "Optimism",
    "Gnosis",
    "Base",
    "ZkEvm",
    "Avalanche",
    "Fraxtal",
];

// Types
type MainnetAddPoolTableInfoRecord = {
    addPool: boolean;
    setStashExtraReward: string[];
    setIsNoDepositGauge: boolean;
    setDstChainId: string;
    // Gauge choice
    pid?: number;
    label?: string;
    address?: string;
};
type MainnetAddPoolTableInfo = {
    [id: string]: MainnetAddPoolTableInfoRecord;
};
type SidechainAddPoolTableInfoRecord = {
    addPool: boolean;
    setStashExtraReward: string[];
    // Gauge choice
    pid?: number;
    label?: string;
    address?: string;
    recipient?: string;
};
type SidechainAddPoolTableInfo = {
    [id: string]: SidechainAddPoolTableInfoRecord;
};

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
) {
    console.log("--------------------------------------------------------------------");
    console.log(`------ addPoolToMainnet ${chainName} chainId: ${chainId} no gauges: ${gaugesDetails.length} ------`);
    console.log("--------------------------------------------------------------------");

    const canonicalConfig = canonicalConfigs[chainId];
    assert(!!canonicalConfig, `Local config for chain ID ${chainId} not found`);
    const fileName = `gnosis_tx_${chainName}-add-pools`;
    const { cvx } = await canonicalConfig.getPhase2(deployer);
    const { booster } = await canonicalConfig.getPhase6(deployer);
    const { poolFeeManagerProxy } = await canonicalConfig.getPhase9(deployer);
    const { gaugeVoteRewards } = canonicalConfig.getGaugeVoteRewards(deployer);
    const { extraRewardStashModule } = canonicalConfig.getSafeModules(deployer);

    const gaugeControllerContract = new ethers.Contract(
        canonicalConfig.addresses.gaugeController,
        gaugeControllerAbi,
        deployer,
    );
    const gaugeVoterTxBuilder = gaugeVoterTxsBuilder(gaugeVoteRewards.address);
    const feeManagerProxyTxBuilder = poolFeeManagerProxyTxsBuilder(poolFeeManagerProxy.address);
    const extraRewardStashModuleTxBuilder = extraRewardStashModuleTxsBuilder(extraRewardStashModule.address);

    const initialPid = (await booster.poolLength()).toNumber();
    console.log(`Initial pid ${initialPid}`);

    const keeperTxPerPool = [];
    const invalidGauges = [];
    const gaugesToProcess = gaugesDetails.filter(gauge => !gauge.rootGauge); // Only mainnet gauges
    const tableInfo: MainnetAddPoolTableInfo = {};
    const defaultTableInfo: MainnetAddPoolTableInfoRecord = {
        pid: 0,
        addPool: false, // keeper
        setStashExtraReward: [], // keeper
        setIsNoDepositGauge: false, // multisg
        setDstChainId: "NO", // multisg
    };
    const gaugeList = getGaugeChoices();
    const extraRewards = [cvx.address];
    const gaugeRewardTokens = await getGaugeRewardTokens(
        chainId,
        gaugesDetails.map(gauge => gauge.address),
    );

    for (let index = 0; index < gaugesToProcess.length; index++) {
        const gauge = gaugesToProcess[index];

        const gaugeChoice = gaugeList.find(gc => compareAddresses(gc.address, gauge.address));
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

        // Gauge already added, verify if extra rewards are set
        if (gaugeExist) {
            invalidGauges.push(gauge.address);

            const gaugePids = await getGaugePid(chainId, [gauge.address]);
            const pid = Number(gaugePids[0].pool.id);
            tableInfo[gauge.address].pid = pid;

            const currentGrt = gaugeRewardTokens.filter(grt => compareAddresses(grt.gauge.id, gauge.address));
            const currentGaugeRewardTokens = [
                ...currentGrt.flatMap(grt => grt.extraRewards.map(rd => rd.token.id.toLowerCase())),
            ];

            const extraRewardsToAdd = extraRewards
                .map(s => s.toLowerCase())
                .filter(extraReward => !currentGaugeRewardTokens.includes(extraReward));

            for (let j = 0; j < extraRewardsToAdd.length; j++) {
                keeperTxPerPool.push(extraRewardStashModuleTxBuilder.setStashExtraReward(pid, extraRewards[j]));
                tableInfo[gauge.address] = {
                    ...tableInfo[gauge.address],
                    setStashExtraReward: tableInfo[gauge.address].setStashExtraReward.concat(extraRewards[j]),
                };
                log("warn", `${chainName} Gauge ${gauge.address} pid ${pid} missing reward token ${extraRewards[j]}`);
            }

            continue;
        }
        // Gauge does not exist in the booster
        const weight = Number(await gaugeControllerContract.get_gauge_weight(gauge.address));
        if (weight <= 0) {
            invalidGauges.push(gauge.address);
            console.warn(`WARNING ${chainName} Gauge must have weight ${gauge.address}`);
            continue;
        }
        const pid = initialPid + index - invalidGauges.length;

        const txPerPool = [
            feeManagerProxyTxBuilder.addPool(gauge.address),
            extraRewardStashModuleTxBuilder.setStashExtraReward(pid, cvx.address),
        ];
        tableInfo[gauge.address] = {
            ...tableInfo[gauge.address],
            addPool: true,
            setStashExtraReward: [].concat(extraRewards),
        };
        keeperTxPerPool.push(...txPerPool);
    }
    const finalPid = initialPid + gaugesToProcess.length - invalidGauges.length;
    if (initialPid < finalPid) {
        keeperTxPerPool.push(gaugeVoterTxBuilder.setPoolIds(initialPid, finalPid));
    }
    if (invalidGauges.length > 0) {
        log("log", `${chainName} ignored gauges ${invalidGauges.length} out of ${gaugesToProcess.length}`);
        log("log", `${chainName} ignored gauges ${invalidGauges}`);
    }

    // Mainnet txs of sidechain gauges
    let multisigTxPerPool = [];
    const sidechainGauges = gaugesDetails.filter(gauge => !!gauge.rootGauge);
    const notDepositGauges = sidechainGauges.filter(gauge => !onlySupportedChains(gauge.rootGauge.chain));
    const depositGauges = sidechainGauges.filter(gauge => onlySupportedChains(gauge.rootGauge.chain));

    multisigTxPerPool = [
        ...(await asyncFilter<GaugesDetails>(notDepositGauges, isNoDepositGaugeNotSet(gaugeVoteRewards))).map(gauge => {
            const gaugeChoice = gaugeList.find(gc => compareAddresses(gc.address, gauge.address));
            tableInfo[gauge.address] = {
                ...{ label: gauge.address, address: gauge.address },
                ...gaugeChoice,
                ...defaultTableInfo,
                setIsNoDepositGauge: true,
            };
            return gaugeVoterTxBuilder.setIsNoDepositGauge(gauge.address);
        }),
        ...(await asyncFilter<GaugesDetails>(depositGauges, isDestChainIdNotSet(gaugeVoteRewards))).map(gauge => {
            const gaugeChoice = gaugeList.find(gc => compareAddresses(gc.address, gauge.address));
            tableInfo[gauge.address] = {
                ...{ label: gauge.address, address: gauge.address },
                ...gaugeChoice,
                ...defaultTableInfo,
                setDstChainId: chainNameToLzChainId(gauge.rootGauge.chain) + "",
            };
            return gaugeVoterTxBuilder.setDstChainId([gauge.address], chainNameToLzChainId(gauge.rootGauge.chain));
        }),
    ];

    const transactions = [...keeperTxPerPool, ...multisigTxPerPool];
    // Table output
    printGaugeStatusTable(tableInfo, chainName);

    const safeTx = buildSafeTx({
        chainId: `${chainId}`,
        name: "Add pool",
        description: "Add pool",
        createdFromSafeAddress: canonicalConfig.multisigs.daoMultisig,
    })(transactions);

    return { fileName, safeTx };
}

// function that sorts tableInfo by its pid value
function sortTableInfoByPid(tableInfo: MainnetAddPoolTableInfo | SidechainAddPoolTableInfo) {
    return Object.fromEntries(
        Object.entries(tableInfo).sort(([, a], [, b]) => {
            return a.pid - b.pid;
        }),
    );
}

function printGaugeStatusTable(tableInfo: MainnetAddPoolTableInfo, chainName: string) {
    const tableInfoOnlyYes = Object.fromEntries(
        Object.entries(sortTableInfoByPid(tableInfo)).filter(
            ([, info]) =>
                info.addPool ||
                info.setStashExtraReward.length > 0 ||
                info.setIsNoDepositGauge ||
                info.setDstChainId !== "NO",
        ),
    );
    if (Object.keys(tableInfoOnlyYes).length > 0) {
        const tableData = [
            [
                `${chainName} Gauge`,
                "Address",
                "pid",
                "addPool",
                "setStashExtraReward",
                "setIsNoDepositGauge",
                "setDstChainId",
            ],
            ...Object.keys(tableInfoOnlyYes).map(k => {
                const info = tableInfoOnlyYes[k];
                return [
                    info.label ?? k,
                    info.address ?? k,
                    info.pid ?? 0,
                    formatBool(info.addPool),
                    info.setStashExtraReward.join(`\n`),
                    formatBool(info.setIsNoDepositGauge),
                    formatDstChainId(info.setDstChainId),
                ];
            }),
        ];
        console.log(table(tableData));
    } else {
        console.log(`${chainName} Gauge : N/A`);
    }
}

async function addPoolToSidechain(chainName: string, chainId: number, gaugesDetails: Array<GaugesDetails>) {
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

    const jsonProvider = await getJsonProviderByChainName(chainName);
    const fileName = `gnosis_tx_${chainName}-add-pools`;
    const sidechainConfig = sidechainConfigs[chainId];
    assert(sidechainConfig, `Local config for chain ID ${chainId} not found`);
    const gaugeRewardTokens = await getGaugeRewardTokens(
        chainId,
        gaugesDetails.map(gauge => gauge.rootGauge.recipient),
    );

    const { booster, boosterOwner, childGaugeVoteRewards, auraOFT, factories, l2PoolManagerProxy } =
        sidechainConfig.getSidechain(jsonProvider);
    if (chainIds.avalanche == chainId || chainIds.gnosis == chainId) await sleep(1000);
    const initialPid = (await booster.poolLength()).toNumber();
    console.log(`Initial pid ${initialPid}`);

    const initialNonce = await jsonProvider.getTransactionCount(factories.proxyFactory.address);
    const allTxPerPool = [];
    const invalidGauges = [];
    const extraRewards = [auraOFT.address];
    const gaugeVoterTxBuilder = gaugeVoterTxsBuilder(childGaugeVoteRewards.address);
    const l2PoolManagerProxyTxBuilder = l2PoolManagerProxyTxsBuilder(l2PoolManagerProxy.address);
    const boosterOwnerLiteTxBuilder = boosterOwnerLiteTxsBuilder(boosterOwner.address);

    let addPools = 0;
    const tableInfo: SidechainAddPoolTableInfo = {};

    const defaultTableInfo = {
        pid: 0,
        addPool: false,
        setStashExtraReward: [],
    };

    for (let index = 0; index < gaugesDetails.length; index++) {
        if (chainIds.avalanche == chainId || chainIds.gnosis == chainId) await sleep(1000);
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
            const pid = gaugePids[0].pool.id;
            const poolInfo = await booster.poolInfo(pid);
            invalidGauges.push(gauge.address);
            tableInfo[gauge.address].pid = Number(pid);
            log(
                "warn",
                `${chainName} Root gauge already added ${gauge.address} recipient ${gauge.rootGauge.recipient} `,
            );

            const currentGrt = gaugeRewardTokens.filter(grt =>
                compareAddresses(grt.gauge.id, gauge.rootGauge.recipient),
            );
            const currentGaugeRewardTokens = [
                ...currentGrt.flatMap(grt => grt.extraRewards.map(rd => rd.token.id.toLowerCase())),
            ];

            for (let j = 0; j < extraRewards.length; j++) {
                const extraReward = extraRewards.map(t => t.toLowerCase())[j];
                if (!currentGaugeRewardTokens.includes(extraReward) && extraReward === auraOFT.address.toLowerCase()) {
                    txPerPool.push(boosterOwnerLiteTxBuilder.setStashExtraReward(poolInfo.stash, extraRewards[j]));
                    tableInfo[gauge.address] = {
                        ...tableInfo[gauge.address],
                        setStashExtraReward: [...tableInfo[gauge.address].setStashExtraReward, extraRewards[j]],
                    };
                    console.warn(
                        `${chainName} Gauge ${gauge.rootGauge.recipient} pid ${pid} missing reward token ${extraReward}`,
                    );
                }
            }
        } else {
            // verify if it needs to set extra rewards
            txPerPool.push(l2PoolManagerProxyTxBuilder.ownerAddPool(gauge.rootGauge.recipient));
            const nonce = initialNonce + addPools;
            const stashContract = getContractAddress({ from: factories.proxyFactory.address, nonce: nonce });
            for (let j = 0; j < extraRewards.length; j++) {
                txPerPool.push(boosterOwnerLiteTxBuilder.setStashExtraReward(stashContract, extraRewards[j]));
                tableInfo[gauge.address] = {
                    ...tableInfo[gauge.address],
                    setStashExtraReward: [...tableInfo[gauge.address].setStashExtraReward, extraRewards[j]],
                    pid: initialPid + addPools,
                };
            }

            addPools++;
            tableInfo[gauge.address] = { ...tableInfo[gauge.address], addPool: true };
        }
        allTxPerPool.push(...txPerPool);
    }
    const finalPid = initialPid + gaugesDetails.length - invalidGauges.length;
    if (initialPid < finalPid) {
        allTxPerPool.push(gaugeVoterTxBuilder.setPoolIds(initialPid, finalPid));
    }
    if (invalidGauges.length > 0) {
        console.log(`${chainName} ignored gauges ${invalidGauges.length} out of ${gaugesDetails.length}`);
        log("log", `${chainName} ignored gauges ${invalidGauges}`);
    }

    const transactions = [...allTxPerPool];
    const tableInfoOnlyYes = Object.fromEntries(
        Object.entries(sortTableInfoByPid(tableInfo)).filter(
            ([, info]) => info.addPool || info.setStashExtraReward.length > 0,
        ),
    );
    if (Object.keys(tableInfoOnlyYes).length > 0) {
        const tableData = [
            [`${chainName} Gauge`, "Root address", "Recipient address", "Pid", "addPool", "setStashExtraReward"],
            ...Object.keys(tableInfoOnlyYes).map(k => {
                const info = tableInfoOnlyYes[k];
                return [
                    info.label,
                    info.address,
                    info.recipient,
                    info.pid,
                    formatBool(info.addPool),
                    info.setStashExtraReward.join(`\n`),
                ];
            }),
        ];
        console.log(table(tableData));
    }
    const safeTx = buildSafeTx({
        chainId: `${chainId}`,
        name: "Add pool",
        description: "Add pool",
        createdFromSafeAddress: sidechainConfig.multisigs.daoMultisig,
    })(transactions);
    return { fileName, safeTx };
}

async function verifyTokenNotAddedToPool(deployer: Signer, stashAddress: string, token: string) {
    const stash = ExtraRewardStashV3__factory.connect(stashAddress, deployer);
    const tokenCount = (await stash.tokenCount()).toNumber();
    for (let j = 0; j < tokenCount; j++) {
        const tokenAddress = await stash.tokenList(j);
        if (compareAddresses(tokenAddress, token)) {
            return false;
        }
    }
    return true;
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
            const { fileName, safeTx } = await addPoolToMainnet(deployer, "Ethereum", chainId, gaugesDetails);
            writeSafeTxFile(safeTx, fileName);
        }

        const sideChains = gaugesChains.filter(chain => chain !== "Ethereum");
        for (let i = 0; i < sideChains.length; i++) {
            const sideChainName = sideChains[i];
            const gaugesToProcess = gaugesDetails.filter(gauge => gauge.rootGauge?.chain === sideChainName);
            try {
                const { fileName, safeTx } = await addPoolToSidechain(
                    sideChainName,
                    chainIds[sideChainName.toLowerCase()],
                    gaugesToProcess,
                );
                writeSafeTxFile(safeTx, fileName);
            } catch (error) {
                console.log("error with ", sideChainName);
            }
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
        const gaugeVoterTxBuilder = gaugeVoterTxsBuilder(gaugeVoteRewards.address);

        const transactions = gaugesDetails.map(gauge =>
            gaugeVoterTxBuilder.setIsNoDepositGauge(gauge.address, tskArgs.value),
        );
        const safeTx = buildSafeTx({
            chainId: `${chainId}`,
            name: "setIsNoDepositGauge",
            description: "setIsNoDepositGauge ",
            createdFromSafeAddress: canonicalConfig.multisigs.daoMultisig,
        })(transactions);

        writeSafeTxFile(safeTx, fileName);
    });

async function getGaugeVoteRewardsLatestPid(
    booster: Booster | BoosterLite,
    gaugeVoteRewards: GaugeVoteRewards | ChildGaugeVoteRewards,
) {
    const finalPid = await booster.poolLength();
    let initialPid = finalPid;
    // Set pool ids per batch of max 20
    for (let i = 1; i < 20; i++) {
        const pid = finalPid.sub(i);
        const poolInfo = await booster.poolInfo(pid);
        const poolId = await gaugeVoteRewards.getPoolId(poolInfo.gauge);
        if (poolId.isSet) break;
        initialPid = pid;
    }
    return { initialPid, finalPid };
}

const getGaugeVoterContracts = async (hre, chainId: number, signer: Signer) => {
    const chainName = chainNames[chainId];
    switch (chainId) {
        case chainIds.mainnet: {
            const canonicalConfig = canonicalConfigs[chainId];
            const { booster } = await canonicalConfig.getPhase6(signer);
            const { gaugeVoteRewards } = canonicalConfig.getGaugeVoteRewards(signer);
            return { booster, gaugeVoteRewards };
        }
        default: {
            let signerOrProvider: Signer | JsonRpcProvider = signer;
            if (hre.network.config.chainId !== chainId) {
                signerOrProvider = await getJsonProviderByChainName(chainName);
            }
            const sidechainConfig = sidechainConfigs[chainId];
            const sidechain = sidechainConfig.getSidechain(signerOrProvider);
            const { booster, childGaugeVoteRewards } = sidechain;
            return { booster, gaugeVoteRewards: childGaugeVoteRewards };
        }
    }
};
task("protocol:gaugeVoter-getPoolIds")
    .addOptionalParam("debug", "Debug mode is on ", false, types.boolean)
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        // Only runs on mainnet, sidechain data is gathered via JSON providers
        // const chainId = chainIds.mainnet;

        const supportedChainIds = [
            chainIds.mainnet,
            chainIds.arbitrum,
            chainIds.avalanche,
            chainIds.optimism,
            chainIds.base,
            chainIds.fraxtal,
            chainIds.gnosis,
            chainIds.optimism,
            chainIds.polygon,
            chainIds.zkevm,
        ];
        const tableInfo = [];

        for (let index = 0; index < supportedChainIds.length; index++) {
            const chainId = supportedChainIds[index];
            const chainName = chainNames[chainId];
            const { booster, gaugeVoteRewards } = await getGaugeVoterContracts(hre, chainId, deployer);
            const { initialPid, finalPid } = await getGaugeVoteRewardsLatestPid(booster, gaugeVoteRewards);
            if (initialPid.lt(finalPid)) {
                tableInfo.push([
                    chainName,
                    formatDstChainId(initialPid.toString()),
                    formatDstChainId(finalPid.toString()),
                ]);
            } else if (tskArgs.debug) {
                tableInfo.push([chainName, formatDstChainId("NO"), formatDstChainId("NO")]);
            }
        }

        const tableData = [[`Chain`, "initialPid", "finalPid"], ...tableInfo];

        console.log(table(tableData));
    });

// yarn task:fork protocol:gaugeVoter-setPoolIds --initial 226 --final 229 --wait 0
task("protocol:gaugeVoter-setPoolIds")
    .addParam("initial", "The initial pid")
    .addParam("final", "The final pid")
    .addParam("wait", "Wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const chainId = hre.network.config.chainId;
        const { gaugeVoteRewards } = await getGaugeVoterContracts(hre, chainId, deployer);
        const tx = await gaugeVoteRewards.setPoolIds(tskArgs.initial, tskArgs.final);
        await waitForTx(tx, true, tskArgs.wait);
    });

task("protocol:keeper:voteForGauge")
    .addParam("gauges", "String with gauges to add separated by `,`")
    .addParam("wait", "Wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const gauges = tskArgs.gauges.split(",");
        assert(gauges.length > 0, `Gauges size is not correct ${tskArgs.gauges}`);
        const canonicalConfig = canonicalConfigs[hre.network.config.chainId];

        const voting = MockVoting__factory.connect(canonicalConfig.addresses.gaugeController, deployer);
        for (let i = 0; i < gauges.length; i++) {
            const tx = await voting.vote_for_gauge_weights(gauges[i], 1);
            await waitForTx(tx, true, tskArgs.wait);
        }
    });

task("protocol:keeper:l1:addPool")
    .addParam("gauges", "String with gauges to add separated by `,`")
    .addParam("wait", "Wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const gauges = tskArgs.gauges.split(",") as string[];
        assert(gauges.length > 0, `Gauges size is not correct ${tskArgs.gauges}`);
        const canonicalConfig = canonicalConfigs[hre.network.config.chainId];
        const phase6 = await canonicalConfig.getPhase6(deployer);
        const phase9 = await canonicalConfig.getPhase9(deployer);
        const gaugeVoter = canonicalConfig.getGaugeVoteRewards(deployer);
        const multicall3 = KeeperMulticall3__factory.connect(PUBLIC_MULTICALL_ADDRESS, deployer);

        const poolLength = (await phase6.booster.poolLength()).toNumber();

        const addPoolTxs = gauges.map(gauge => ({
            target: phase9.poolFeeManagerProxy.address,
            allowFailure: false,
            callData: phase9.poolFeeManagerProxy.interface.encodeFunctionData("addPool", [gauge]),
        }));

        const tx = await multicall3.aggregate3([
            ...addPoolTxs,
            {
                target: gaugeVoter.gaugeVoteRewards.address,
                allowFailure: false,
                callData: gaugeVoter.gaugeVoteRewards.interface.encodeFunctionData("setPoolIds", [
                    poolLength,
                    poolLength + gauges.length,
                ]),
            },
        ]);
        await waitForTx(tx, true, tskArgs.wait);
    });

task("protocol:keeper:l1:setStashExtraReward")
    .addParam("pids", "String with pids to add separated by `,`")
    .addParam("tokens", "String with tokens to add separated by `,`")
    .addParam("wait", "Wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const pids = tskArgs.pids.split(",") as string[];
        const tokens = tskArgs.tokens.split(",") as string[];
        assert(pids.length > 0, `Gauges size is not correct ${tskArgs.gauges}`);
        assert(pids.length === tokens.length, `Tokens size is not correct ${tskArgs.tokens}`);
        const canonicalConfig = canonicalConfigs[hre.network.config.chainId];
        const phase6 = await canonicalConfig.getPhase6(deployer);

        const extraRewards = [];
        // Verify if the pool already handler the token
        for (let i = 0; i < pids.length; i++) {
            const pid = pids[i];
            const token = tokens[i];
            const poolInfo = await phase6.booster.poolInfo(pid);
            const tokenNotAdded = await verifyTokenNotAddedToPool(deployer, poolInfo.stash, token);
            if (tokenNotAdded) {
                extraRewards.push({ pid, token });
                console.log(`Token ${token} OK for pool ${pid}`);
            } else {
                console.log(`Token ${token} already added to pool ${pid}`);
            }
        }

        const safeModules = canonicalConfig.getSafeModules(deployer);
        const multicall3 = KeeperMulticall3__factory.connect(
            canonicalConfig.multisigs.defender.keeperMulticall3,
            deployer,
        );
        console.log(
            `safeModules.extraRewardStashModule.setStashExtraReward(${extraRewards.map(t => t.pid)},${extraRewards.map(
                t => t.token,
            )})`,
        );

        const tx = await multicall3.aggregate3(
            extraRewards.map(({ pid, token }) => ({
                target: safeModules.extraRewardStashModule.address,
                allowFailure: false,
                callData: safeModules.extraRewardStashModule.interface.encodeFunctionData("setStashExtraReward", [
                    pid,
                    token,
                ]),
            })),
        );
        await waitForTx(tx, true, tskArgs.wait);
    });
task("protocol:keeper:l1l2:addPool")
    .addParam("gauges", "String with gauges to add separated by `,`")
    .addParam("dstchainid", "String with layerZero destination chain")
    .addParam("wait", "Wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const gauges = tskArgs.gauges.split(",") as string[];
        const dstChainId = tskArgs.dstchainid;

        assert(gauges.length > 0, `Gauges size is not correct ${tskArgs.gauges}`);

        const chainId = hre.network.config.chainId;
        if (!(chainId === chainIds.mainnet || chainId === chainIds.hardhat))
            throw new Error("This task can only be run on mainnet");

        const canonicalConfig = canonicalConfigs[chainId];
        const config = canonicalConfig.getSidechain(deployer);
        const minDstGas = 250_000;
        const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, minDstGas]);
        const tx = await config.l1PoolManagerProxy.addPools(gauges, dstChainId, ZERO_ADDRESS, adapterParams);

        await waitForTx(tx, true, tskArgs.wait);
    });

task("protocol:keeper:l2l2:addPool")
    .addParam("gauges", "String with gauges to add separated by `,`")
    .addParam("dstchainid", "String with layerZero destination chain")
    .addParam("wait", "Wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const gauges = tskArgs.gauges.split(",") as string[];

        assert(gauges.length > 0, `Gauges size is not correct ${tskArgs.gauges}`);

        const chainId = hre.network.config.chainId;
        // Validate the root gauge  has votes on mainnet
        // Validate the gauge is not already added on the destination chain

        const config = sidechainConfigs[chainId];
        const sidechain = config.getSidechain(deployer);
        for (let i = 0; i < gauges.length; i++) {
            const gauge = gauges[i];
            const tx = await sidechain.l2PoolManagerProxy.addPool(gauge);
            await waitForTx(tx, true, tskArgs.wait);
        }
    });
