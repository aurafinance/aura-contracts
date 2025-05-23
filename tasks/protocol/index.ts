import assert from "assert";
import { getContractAddress } from "ethers/lib/utils";
import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { GaugeRewardToken, getGaugePid, getGaugeRewardTokens } from "../utils/auraApi";
import { GaugesDetails, getGaugesDetails } from "../utils/balancerApi";

import { JsonRpcProvider, Provider } from "@ethersproject/providers";
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
import { reduceRewardMultipliers } from "../../scripts/reduceRewardMultipliers";
import _ from "lodash";
import { Vote } from "../snapshot/result";

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

/**
 * Determines the extra reward tokens that need to be added to a pool's stash.
 *
 * This function compares the provided list of extra rewards with the current reward tokens
 * associated with a specific gauge. It filters out tokens that are already added and verifies
 * if the remaining tokens can be added to the pool's stash.
 *
 * @param signerOrProvider - The signer instance used to interact with the blockchain.
 * @param booster - The Booster contract instance used to retrieve pool information.
 * @param gauge - The gauge details containing information about the gauge and its rewards.
 * @param pid - The pool ID associated with the stash.
 * @param extraRewards - An array of extra reward token addresses to be considered for addition.
 * @param gaugeRewardTokens - An array of reward token data associated with the gauge.
 * @returns A promise that resolves to an array of token addresses that need to be added to the stash.
 */
async function getExtraRewardsToAdd(
    signerOrProvider: Signer | Provider,
    booster: Booster | BoosterLite,
    gauge: GaugesDetails,
    pid: number,
    extraRewards: string[],
    gaugeRewardTokens: GaugeRewardToken[],
    gaugeAddressPath: string = "address",
): Promise<string[]> {
    const setStashExtraRewards = [];
    const currentGrt = gaugeRewardTokens.filter(grt => compareAddresses(grt.gauge.id, _.get(gauge, gaugeAddressPath)));
    const currentGaugeRewardTokens = [
        ...currentGrt.flatMap(grt => grt.rewardData.map(rd => rd.token.id.toLowerCase())),
    ];

    const extraRewardsToAdd = extraRewards
        .map(s => s.toLowerCase())
        .filter(extraReward => !currentGaugeRewardTokens.includes(extraReward));

    const poolInfo = await booster.poolInfo(pid);
    for (let j = 0; j < extraRewardsToAdd.length; j++) {
        const tokenAddress = extraRewards[j];
        const tokenNotAdded = await verifyTokenNotAddedToPool(signerOrProvider, poolInfo.stash, tokenAddress);
        if (tokenNotAdded) {
            setStashExtraRewards.push(tokenAddress);
        }
    }
    return setStashExtraRewards;
}

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
    let previouslyAddedPid = initialPid;
    console.log(`Initial pid ${initialPid}`);

    const keeperTxPerPool = [];
    const invalidGauges = [];
    const gaugesToProcess = gaugesDetails.filter(gauge => !gauge.rootGauge); // Only mainnet gauges
    const tableInfo: MainnetAddPoolTableInfo = {};
    const defaultTableInfo: MainnetAddPoolTableInfoRecord = {
        pid: 0,
        addPool: false, // keeper
        setStashExtraReward: [], // keeper
        setIsNoDepositGauge: false, // multisig
        setDstChainId: "NO", // multisig
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

        // Gauge already added, verify if extra rewards are set and the poolId is set on gauge voter
        if (gaugeExist) {
            invalidGauges.push(gauge.address);

            const gaugePids = await getGaugePid(chainId, [gauge.address]);
            const pid = Number(gaugePids[0].pool.id);
            tableInfo[gauge.address].pid = pid;

            // Check if  extra rewards need to be added
            const extraRewardsToAdd = await getExtraRewardsToAdd(
                deployer,
                booster,
                gauge,
                pid,
                extraRewards,
                gaugeRewardTokens,
            );
            if (extraRewardsToAdd.length > 0) {
                tableInfo[gauge.address].setStashExtraReward = extraRewardsToAdd;
                keeperTxPerPool.push(
                    extraRewardsToAdd.map(tokenAddress => {
                        log(
                            "warn",
                            `${chainName} Gauge ${gauge.address} pid ${pid} missing reward token ${tokenAddress}`,
                        );
                        return extraRewardStashModuleTxBuilder.setStashExtraReward(pid, tokenAddress);
                    }),
                );
            }

            // Check if the poolId is set on gauge voter
            const getDstChainId = await gaugeVoteRewards.getDstChainId(gauge.address);
            if (getDstChainId === 0) {
                previouslyAddedPid = Math.min(previouslyAddedPid, pid);
                tableInfo[gauge.address].setDstChainId = chainNameToLzChainId("mainnet") + "";
                console.warn(`${chainName} Gauge ${gauge.address} pid ${pid} was not set on gauge voter`);
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
    previouslyAddedPid = Math.min(previouslyAddedPid, initialPid);
    if (previouslyAddedPid < finalPid) {
        keeperTxPerPool.push(gaugeVoterTxBuilder.setPoolIds(previouslyAddedPid, finalPid));
    }
    if (invalidGauges.length > 0) {
        log("log", `${chainName} ignored gauges ${invalidGauges.length} out of ${gaugesToProcess.length}`);
        log("log", `${chainName} ignored gauges ${invalidGauges}`);
    }

    // Mainnet txs of sidechain gauges
    const multisigTxPerPool = [];
    const sidechainGauges = gaugesDetails.filter(gauge => !!gauge.rootGauge);
    const notDepositGauges = sidechainGauges.filter(gauge => !onlySupportedChains(gauge.rootGauge.chain));
    const depositGauges = sidechainGauges.filter(gauge => onlySupportedChains(gauge.rootGauge.chain));

    multisigTxPerPool.push(
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
    );

    const transactions = [...keeperTxPerPool, ...multisigTxPerPool];
    // Table output
    printGaugeStatusTable(tableInfo, chainName);

    const safeTx = buildSafeTx({
        chainId: `${chainId}`,
        name: "Add pool",
        description: "Add pool",
        createdFromSafeAddress: canonicalConfig.multisigs.daoMultisig,
    })(transactions);

    return { fileName, safeTx, transactions };
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
            const pid = Number(gaugePids[0].pool.id);
            const poolInfo = await booster.poolInfo(pid);
            invalidGauges.push(gauge.address);
            tableInfo[gauge.address].pid = pid;
            log(
                "warn",
                `${chainName} Root gauge already added ${gauge.address} recipient ${gauge.rootGauge.recipient} `,
            );

            // Check if  extra rewards need to be added
            const extraRewardsToAdd = await getExtraRewardsToAdd(
                jsonProvider,
                booster,
                gauge,
                pid,
                extraRewards,
                gaugeRewardTokens,
                "rootGauge.recipient",
            );

            if (extraRewardsToAdd.length > 0) {
                tableInfo[gauge.address].setStashExtraReward = extraRewardsToAdd;
                txPerPool.push(
                    extraRewardsToAdd.map(tokenAddress => {
                        log(
                            "warn",
                            `${chainName} Gauge  ${gauge.rootGauge.recipient} pid ${pid} missing reward token ${tokenAddress}`,
                        );
                        return boosterOwnerLiteTxBuilder.setStashExtraReward(poolInfo.stash, tokenAddress);
                    }),
                );
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
    return { fileName, safeTx, transactions };
}

async function verifyTokenNotAddedToPool(signerOrProvider: Signer | Provider, stashAddress: string, token: string) {
    const stash = ExtraRewardStashV3__factory.connect(stashAddress, signerOrProvider);
    const tokenCount = (await stash.tokenCount()).toNumber();
    for (let j = 0; j < tokenCount; j++) {
        const tokenAddress = await stash.tokenList(j);
        if (compareAddresses(tokenAddress, token)) {
            return false;
        }
    }
    return true;
}

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

//  yarn task protocol:add-pool  --network mainnet  --voting false --gauges 0xD5417ACb575c799cEB373f85AdF100C7cD84C8c8,
task("protocol:add-pool")
    .addParam("gauges", "String with gauges to add separated by `,`")
    .addOptionalParam(
        "voting",
        "If it is voting mode, setIsNoDepositGauge, setDstChainId, setExtraRewards",
        false,
        types.boolean,
    )
    .addOptionalParam("txsfile", "If true, it saves the txs to a file", true, types.boolean)
    .setDescription(
        "Generate tx builder file to add pools to contracts to add pools, set extra rewards, setIsNoDepositGauge, setDstChainId",
    )
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
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

        const txs = {};

        const gaugesChains = gaugesDetails
            .map(chainNameFromGaugeDetails)
            .filter(onlySupportedChains)
            .reduce(onlyDifferent, "")
            .split(",")
            .filter(s => s !== "");
        // Generate Files
        if (gaugesChains.includes("Ethereum") || tskArgs.voting) {
            // Pass all gauges without filter to mainnet, to verify if setIsNoDepositGauge, setDstChainId is needed.
            const { fileName, safeTx, transactions } = await addPoolToMainnet(
                deployer,
                "Ethereum",
                chainId,
                gaugesDetails,
            );
            txs[chainIds.mainnet] = transactions;
            if (tskArgs.txsfile) writeSafeTxFile(safeTx, fileName);
        }

        const sideChains = gaugesChains.filter(chain => chain !== "Ethereum");
        for (let i = 0; i < sideChains.length; i++) {
            const sideChainName = sideChains[i];
            const gaugesToProcess = gaugesDetails.filter(gauge => gauge.rootGauge?.chain === sideChainName);
            try {
                const { fileName, safeTx, transactions } = await addPoolToSidechain(
                    sideChainName,
                    chainIds[sideChainName.toLowerCase()],
                    gaugesToProcess,
                );
                txs[chainIds[sideChainName.toLowerCase()]] = transactions;
                if (tskArgs.txsfile) writeSafeTxFile(safeTx, fileName);
            } catch (error) {
                console.error(`Error processing side chain ${sideChainName}:`, error);
            }
        }

        return { chainTransactions: txs };
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

task("protocol:gaugeVoter-getPoolIds")
    .addOptionalParam("debug", "Debug mode is on ", false, types.boolean)
    .setDescription("Get the pool latest pool ids not set on the gauge voter")
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

task("protocol:gaugeVoter-voteGaugeWeights-tx").setAction(async function (
    tskArgs: TaskArguments,
    hre: HardhatRuntimeEnvironment,
) {
    const signer = await getSigner(hre);

    // Get gauge voter votes for the latest snapshot proposal
    const { votes }: { votes: Vote[] } = await hre.run("snapshot:result", { debug: "false", format: "table" });
    // Generate the tx builder file with the votes
    const gauges = votes.map(v => v.gauge.address);
    const weights = votes.map(v => v.voteWeight);

    const { chainTransactions: transactions } = await hre.run("protocol:add-pool", {
        gauges: gauges.join(","),
        voting: true,
        txsfile: false,
    });
    // Generate the tx builder file  per chain
    // Mainnet includes GaugeVoter configurations, new add pools ,  GaugeVoter voteGaugeWeight
    const { gaugeVoteRewards } = await getGaugeVoterContracts(hre, chainIds.mainnet, signer);
    const voteGaugeWeightTxs = gaugeVoterTxsBuilder(gaugeVoteRewards.address).voteGaugeWeight(gauges, weights);
    const canonicalConfig = canonicalConfigs[chainIds.mainnet];
    const mainnetTxs = [voteGaugeWeightTxs];
    // Only if transactions[chainIds.mainnet] is not empty insert it as first element on mainnetTxs
    if (transactions[chainIds.mainnet] && transactions[chainIds.mainnet].length > 0) {
        mainnetTxs.unshift(...transactions[chainIds.mainnet]);
    }

    const safeTx = buildSafeTx({
        chainId: `${chainIds.mainnet}`,
        name: "gaugeVoter-voteGaugeWeights",
        description: "gaugeVoter-voteGaugeWeights",
        createdFromSafeAddress: canonicalConfig.multisigs.daoMultisig,
    })(mainnetTxs);
    writeSafeTxFile(safeTx, `gnosis_tx_gaugeVoter-${chainNames[chainIds.mainnet]}`);

    // Sidechain txs
    const sidechains = Object.keys(transactions).filter(chainId => chainId !== chainIds.mainnet.toString());
    for (let i = 0; i < sidechains.length; i++) {
        const chainId = Number(sidechains[i]);
        const chainName = chainNames[chainId];
        const sidechainConfig = sidechainConfigs[chainId];
        const sideChainTxs = transactions[chainId];

        if (!sideChainTxs || sideChainTxs.length == 0) continue;

        const safeTx = buildSafeTx({
            chainId: `${chainId}`,
            name: `Add pools-${chainName}`,
            description: "Add pools and configure gauge voter",
            createdFromSafeAddress: sidechainConfig.multisigs.daoMultisig,
        })(sideChainTxs);
        writeSafeTxFile(safeTx, `gnosis_tx_gaugeVoter-${chainName}`);
    }
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
task("protocol:keeper:l2:setStashExtraReward")
    .addParam("pids", "String with pids to add separated by `,`")
    .addParam("tokens", "String with tokens to add separated by `,`")
    .addParam("wait", "Wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const pids = tskArgs.pids.split(",") as string[];
        const tokens = tskArgs.tokens.split(",") as string[];
        assert(pids.length > 0, `Gauges size is not correct ${tskArgs.gauges}`);
        assert(pids.length === tokens.length, `Tokens size is not correct ${tskArgs.tokens}`);
        const chainId = hre.network.config.chainId;
        const config = sidechainConfigs[chainId];
        const sidechain = config.getSidechain(deployer);

        const extraRewards = [];
        // Verify if the pool already handler the token
        for (let i = 0; i < pids.length; i++) {
            const pid = pids[i];
            const token = tokens[i];
            const poolInfo = await sidechain.booster.poolInfo(pid);
            const tokenNotAdded = await verifyTokenNotAddedToPool(deployer, poolInfo.stash, token);
            if (tokenNotAdded) {
                extraRewards.push({ pid, token });
                console.log(`Token ${token} OK for pool ${pid}`);
            } else {
                console.log(`Token ${token} already added to pool ${pid}`);
            }
        }

        const safeModules = config.getSafeModules(deployer);
        console.log(sidechain.keeperMulticall3.address, "keeperMulticall3");
        const multicall3 = KeeperMulticall3__factory.connect(sidechain.keeperMulticall3.address, deployer);
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
task("protocol:booster:reduceRewardMultiplier").setAction(async function (
    _: TaskArguments,
    hre: HardhatRuntimeEnvironment,
) {
    await reduceRewardMultipliers(hre);
});
