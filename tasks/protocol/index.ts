import assert from "assert";
import { getContractAddress } from "ethers/lib/utils";
import * as fs from "fs";
import * as path from "path";
import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getGaugePid, getGaugeRewardTokens } from "../utils/auraApi";
import { GaugesDetails, getGaugesDetails } from "../utils/balancerApi";

import { JsonRpcProvider } from "@ethersproject/providers";
import { Signer, ethers } from "ethers";
import { GaugeVoteRewards } from "types";
import { canonicalConfigs, lzChainIds, sidechainConfigs } from "../deploy/sidechain-constants";
import { chainIds, getSigner } from "../utils";

type SafeTxCreation = {
    chainId?: string;
    name?: string;
    description?: string;
    createdFromSafeAddress?: string;
};
export const buildSafeTx = (params: SafeTxCreation) => (transactions: Array<any>) => ({
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
const gaugeTypesSupported = ["Ethereum", "Polygon", "Arbitrum", "Optimism", "Gnosis"];
const opAddress = "0x4200000000000000000000000000000000000042";

const onlySupportedChains = (chainName: string): boolean => gaugeTypesSupported.includes(chainName);
const chainNameFromGaugeDetails = (gauge: GaugesDetails): string => gauge.rootGauge?.chain ?? gauge.type.name;
const asyncFilter = async <T>(arr: Array<T>, predicate: (arg: T) => Promise<boolean>) =>
    Promise.all(arr.map(predicate)).then(results => arr.filter((_v, index) => results[index]));
const onlyDifferent = (prev: string, curr: string): string => (prev.includes(curr) ? prev : `${prev},${curr}`);
const isDestChainIdNotSet = (gaugeVoteRewards: GaugeVoteRewards) => async (gauge: GaugesDetails) =>
    0 === (await gaugeVoteRewards.getDstChainId(gauge.address));
const isNoDepositGaugeNotSet = (gaugeVoteRewards: GaugeVoteRewards) => async (gauge: GaugesDetails) =>
    (await gaugeVoteRewards.isNoDepositGauge(gauge.address)) === false;
const chainNameToLzChainId = (chainName: string) => lzChainIds[chainIds[chainName.toLowerCase()]];

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
    for (let index = 0; index < gaugesToProcess.length; index++) {
        const gauge = gaugesToProcess[index];
        // Verify the pool should be added or not
        if (gauge.liquidityGauge.isKilled) {
            invalidGauges.push(gauge.address);
            console.warn(`WARNING ${chainName} Gauge is killed ${gauge.address}`);
            continue;
        }
        const gaugeExist = await booster.gaugeMap(gauge.address);
        if (gaugeExist) {
            invalidGauges.push(gauge.address);
            const gaugePids = await getGaugePid([gauge.address]);
            const poolInfo = await booster.poolInfo(gaugePids[0].pool.id);
            const rewardMultiplier = await booster.getRewardMultipliers(poolInfo.crvRewards);
            console.warn(
                `WARNING ${chainName} Gauge already added ${gauge.address} with rewardMultiplier: ${rewardMultiplier}`,
            );
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
        mainnetTxPerPool.push(...txPerPool);
    }
    const finalPid = initialPid + gaugesToProcess.length - invalidGauges.length;
    if (initialPid < finalPid) {
        mainnetTxPerPool.push(setPoolIds(gaugeVoteRewards.address, initialPid, finalPid));
    }
    if (invalidGauges.length > 0) {
        console.log(`${chainName} ignored gauges ${invalidGauges.length} out of ${gaugesToProcess.length}`);
        // console.log(`${chainName} ignored gauges ${invalidGauges}`);
    }

    // Mainnet txs of sidechain gauges
    let sidechainTxs = [];
    if (voting) {
        const sidechainGauges = gaugesDetails.filter(gauge => !!gauge.rootGauge);
        const notDepositGauges = sidechainGauges.filter(gauge => !onlySupportedChains(gauge.rootGauge.chain));
        const depositGauges = sidechainGauges.filter(gauge => onlySupportedChains(gauge.rootGauge.chain));

        sidechainTxs = [
            ...(await asyncFilter<GaugesDetails>(notDepositGauges, isNoDepositGaugeNotSet(gaugeVoteRewards))).map(
                gauge => setIsNoDepositGauge(gaugeVoteRewards.address, gauge.address),
            ),
            ...(await asyncFilter<GaugesDetails>(depositGauges, isDestChainIdNotSet(gaugeVoteRewards))).map(gauge =>
                setDstChainId(gaugeVoteRewards.address, [gauge.address], chainNameToLzChainId(gauge.rootGauge.chain)),
            ),
        ];
    }

    const transactions = [...mainnetTxPerPool, ...sidechainTxs];

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
    let addedRewards = 0;

    for (let index = 0; index < gaugesDetails.length; index++) {
        const gauge = gaugesDetails[index];
        const txPerPool = [];

        const gaugeExist = await booster.gaugeMap(gauge.rootGauge.recipient);
        if (gaugeExist) {
            invalidGauges.push(gauge.address);
            console.warn(
                `${chainName} Root gauge already added ${gauge.address} recipient ${gauge.rootGauge.recipient} `,
            );

            const currentGrt = gaugeRewardTokens.filter(
                grt => grt.gauge.id.toLowerCase() === gauge.rootGauge.recipient.toLowerCase(),
            );
            const currentGaugeRewardTokens = [
                ...currentGrt.flatMap(grt => grt.rewardData.map(rd => rd.token.id.toLowerCase())),
            ];
            if (voting) {
                for (let j = 0; j < extraRewards.length; j++) {
                    const extraReward = extraRewards.map(t => t.toLowerCase())[j];
                    if (!currentGaugeRewardTokens.includes(extraReward)) {
                        // Add missing reward token
                        const nonce = initialNonce + addedRewards;
                        const stashContract = getContractAddress({
                            from: factories.proxyFactory.address,
                            nonce: nonce,
                        });
                        txPerPool.push(
                            setStashExtraRewardSidechain(boosterOwner.address, stashContract, extraRewards[j]),
                        );
                        addedRewards++;
                        console.warn(
                            `${chainName} Gauge ${gauge.rootGauge.recipient} pid ${currentGrt[0]?.id} missing reward token ${extraReward}`,
                        );
                    }
                }
            }
        } else {
            txPerPool.push(addPool(poolManager.address, gauge.rootGauge.recipient));
            // verify if it needs to set extra rewards
            for (let j = 0; j < extraRewards.length; j++) {
                const nonce = initialNonce + addedRewards;
                const stashContract = getContractAddress({ from: factories.proxyFactory.address, nonce: nonce });
                txPerPool.push(setStashExtraRewardSidechain(boosterOwner.address, stashContract, extraRewards[j]));
                addedRewards++;
            }
        }
        allTxPerPool.push(...txPerPool);
    }
    const finalPid = initialPid + gaugesDetails.length - invalidGauges.length;
    if (initialPid < finalPid) {
        allTxPerPool.push(setPoolIds(childGaugeVoteRewards.address, initialPid, finalPid));
    }
    if (invalidGauges.length > 0) {
        console.log(`${chainName} ignored gauges ${invalidGauges.length} out of ${gaugesDetails.length}`);
        console.log(`${chainName} ignored gauges ${invalidGauges}`);
    }

    const transactions = [...allTxPerPool];

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
        "If it is voting mode, setIsNotDepositGauge, setDstChainId, setExtraRewards",
        false,
        types.boolean,
    )
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        // Only runs on mainnet, sidechain data is gathered via JSON providers
        const chainId = 1;

        const gauges = tskArgs.gauges.split(",");
        assert(gauges.length > 0, `Gauges size is not correct ${tskArgs.gauges}`);

        const gaugesDetails: Array<GaugesDetails> = await getGaugesDetails(gauges);
        if (gaugesDetails.length != gauges.length) {
            console.warn(`WARNING Gauges found ${gaugesDetails.length} out of ${gauges.length}`);
        }

        const gaugesChains = gaugesDetails
            .map(chainNameFromGaugeDetails)
            .filter(onlySupportedChains)
            .reduce(onlyDifferent, "")
            .split(",")
            .filter(s => s !== "");
        // Generate Files
        if (gaugesChains.includes("Ethereum") || tskArgs.voting) {
            // Pass all gauges without filter to mainnet, to verify if setIsNotDepositGauge, setDstChainId is needed.
            const { fileName, safeTx } = await addPoolToMainnet(
                deployer,
                "Ethereum",
                chainId,
                gaugesDetails,
                tskArgs.voting,
            );
            const filePath = path.resolve(__dirname, `./${fileName}.json`);
            console.log("File generated", filePath);
            fs.writeFileSync(filePath, JSON.stringify(safeTx, null, 4));
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
            const filePath = path.resolve(__dirname, `./${fileName}.json`);
            console.log("File generated", filePath);
            fs.writeFileSync(filePath, JSON.stringify(safeTx, null, 4));
        }
    });
