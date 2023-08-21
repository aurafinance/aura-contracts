/* eslint-disable no-await-in-loop */
import { getSigner } from "../utils";
import { table } from "table";
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { sidechainConfigs } from "../deploy/sidechain-constants";
import { config as mainnetConfig } from "../deploy/mainnet-config";
import { ethers } from "ethers";

task("gauge:voter:metrics:mainnet").setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const deployer = await getSigner(hre);

    const startEpoch = 2798;

    const pendingRewards = {};
    const epochStats = {};

    //Mainnet Contracts
    pendingRewards["mainnet"] = [];
    const gaugeVoterPhase = await mainnetConfig.getGaugeVoteRewards(deployer);
    const gaugeVoteRewards = gaugeVoterPhase.gaugeVoteRewards;
    const stashRewardDistro = gaugeVoterPhase.stashRewardDistro;

    const currentEpoch = Number(await stashRewardDistro.getCurrentEpoch());
    const cvx = (await mainnetConfig.getPhase2(deployer)).cvx.address;
    const phase6 = await mainnetConfig.getPhase6(deployer);
    const poolLength = Number(await phase6.booster.poolLength());

    console.log(table([["Mainnet Pools"]]));
    const mainnetRows = [
        [
            ["pid"],
            ["epoch"],
            ["token"],
            ["gauge"],
            ["weight"],
            ["pid set?"],
            ["is no deposit?"],
            ["amount pending"],
            ["is processed?"],
            ["overdue?"],
        ],
    ];

    let poolNotSet = 0;
    const overduePerEpochPools = {};
    const overduePerEpochTotals = {};

    for (let j = 0; j < poolLength; j++) {
        const poolInfo = await phase6.booster.poolInfo(j);
        const gauge = poolInfo.gauge;
        const pid = await gaugeVoteRewards.getPoolId(gauge);

        if (!pid.isSet) {
            poolNotSet += 1;
        }

        if (!poolInfo.shutdown) {
            for (let i = startEpoch; i <= currentEpoch; i++) {
                if (j == 0) {
                    overduePerEpochPools[i] = 0;
                    overduePerEpochTotals[i] = 0;
                }

                const pending = Number(await stashRewardDistro.getFunds(i, j, cvx));
                let overdue = false;

                if (pending > 0 && i != currentEpoch) {
                    overdue = true;
                    overduePerEpochPools[i] += 1;
                    overduePerEpochTotals[i] += pending;
                }

                //Query Gauge Voter
                const weight = await gaugeVoteRewards.getWeightByEpoch(i, gauge);
                const isProcessed = await gaugeVoteRewards.isProcessed(i, gauge);
                const noDepositGauge = await gaugeVoteRewards.isNoDepositGauge(gauge);

                const poolData = {
                    pid: j.toString(),
                    epoch: i.toString(),
                    token: cvx,
                    gauge: gauge,
                    weight: Number(weight).toString(),
                    pidSet: pid.isSet.toString(),
                    noDeposit: noDepositGauge.toString(),
                    amountPending: pending.toString(),
                    isProcessed: isProcessed.toString(),
                    overdue: overdue.toString(),
                };
                pendingRewards["mainnet"].push([poolData]);

                mainnetRows.push([
                    [poolData.pid],
                    [poolData.epoch],
                    [poolData.token],
                    [poolData.gauge],
                    [poolData.weight],
                    [poolData.pidSet],
                    [poolData.noDeposit],
                    [poolData.amountPending],
                    [poolData.isProcessed],
                    [poolData.overdue],
                ]);
            }
        }
    }

    console.log(table(mainnetRows));

    //Meta Stats
    console.log(table([["Mainnet Meta Stats"]]));

    const mainnetMetaRows = [];
    const rewardPerEpoch = await gaugeVoteRewards.rewardPerEpoch();
    mainnetMetaRows.push([["rewardPerEpoch"], [rewardPerEpoch]]);
    mainnetMetaRows.push([["Pools Not Set"], [poolNotSet]]);

    for (let i = startEpoch; i <= currentEpoch; i++) {
        const totalWeight = await gaugeVoteRewards.getTotalWeight(i);
        epochStats[i] = {
            epoch: i,
            totalWeight: totalWeight,
        };
        mainnetMetaRows.push([["Epoch " + i + " overdue pools"], [overduePerEpochPools[i]]]);
        mainnetMetaRows.push([["Epoch " + i + " overdue total"], [overduePerEpochTotals[i]]]);
        mainnetMetaRows.push([["Epoch " + i + " total weight"], [Number(totalWeight)]]);
    }

    console.log(table(mainnetMetaRows));

    //Meta Stats
    console.log(table([["Mainnet Misc."]]));

    const mainnetMiscRows = [];

    const distributor = await gaugeVoteRewards.distributor();

    mainnetMiscRows.push([["Distributor"], [distributor]]);
    mainnetMiscRows.push([["lzEndpoint"], [await gaugeVoteRewards.lzEndpoint()]]);

    const chainIds = [109, 110, 111, 145];
    for (let i = 0; i < chainIds.length; i++) {
        const chainId = chainIds[i];
        const trustedRemote = await gaugeVoteRewards.trustedRemoteLookup(chainId);

        mainnetMiscRows.push([["trustedRemote " + chainId], [trustedRemote]]);
    }

    console.log(table(mainnetMiscRows));
});

task("gauge:voter:metrics:sidechain").setAction(async function (
    tskArgs: TaskArguments,
    hre: HardhatRuntimeEnvironment,
) {
    const deployer = await getSigner(hre);

    const mainnetGaugeVoterPhase = await mainnetConfig.getGaugeVoteRewards(deployer);
    const mainnetGaugeVoteRewards = mainnetGaugeVoterPhase.gaugeVoteRewards;

    //Map All Gauges to return a map of gauge to recipient
    const { recipientToGauge } = await extractGaugeRecipientMappings(deployer);

    const providers = [
        process.env.ARBITRUM_NODE_URL,
        process.env.OPTIMISM_NODE_URL,
        process.env.POLYGON_NODE_URL,
        process.env.GNOSIS_NODE_URL,
    ];

    const names = ["arbitrum", "optimism", "polygon", "gnosis"];

    const chainIds = [42161, 10, 137, 100];
    const startEpoch = 2798;

    const pendingRewards = {};

    for (const n in names) {
        const chain = names[n];

        console.log(table([[chain]]));

        const sidechainRows = [
            [
                ["pid"],
                ["epoch"],
                ["token"],
                ["recipient"],
                ["gauge"],
                ["weight"],
                ["pid set?"],
                ["is no deposit?"],
                ["amount pending"],
                ["amount to send"],
                ["amount sent"],
                ["is processed?"],
                ["overdue?"],
            ],
        ];

        pendingRewards[chain] = [];

        const provider = new ethers.providers.JsonRpcProvider(providers[n]);
        const sidechainSigner = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        const sidechainConfig = sidechainConfigs[chainIds[n]];

        const gaugeVoterPhase = await sidechainConfig.getSidechain(sidechainSigner);
        const gaugeVoteRewards = gaugeVoterPhase.childGaugeVoteRewards;
        const stashRewardDistro = gaugeVoterPhase.stashRewardDistro;

        const currentEpoch = Number(await stashRewardDistro.getCurrentEpoch());
        const sidechain = await sidechainConfig.getSidechain(sidechainSigner);
        const cvx = sidechain.auraOFT.address;
        const poolLength = Number(await sidechain.booster.poolLength());

        let poolNotSet = 0;
        const overduePerEpochPools = {};
        const overduePerEpochTotals = {};
        const epochSentTotals = {};
        const epochSendTotals = {};

        for (let j = 0; j < poolLength; j++) {
            const poolInfo = await sidechain.booster.poolInfo(j);
            const gauge = poolInfo.gauge;
            const pid = await gaugeVoteRewards.getPoolId(gauge);

            if (!pid.isSet) {
                poolNotSet += 1;
            }

            if (!poolInfo.shutdown) {
                try {
                    for (let i = startEpoch; i <= currentEpoch; i++) {
                        if (j == 0) {
                            overduePerEpochPools[i] = 0;
                            overduePerEpochTotals[i] = 0;
                            epochSentTotals[i] = 0;
                            epochSendTotals[i] = 0;
                        }

                        const pending = Number(await stashRewardDistro.getFunds(i, j, cvx));
                        let overdue = false;

                        if (pending > 0 && i != currentEpoch) {
                            overdue = true;
                            overduePerEpochPools[i] += 1;
                            overduePerEpochTotals[i] += pending;
                        }

                        //Query Gauge Voter

                        const amountToSendByEpoch = await gaugeVoteRewards.getAmountToSendByEpoch(i, gauge);
                        const amountToBeSentByEpoch = await gaugeVoteRewards.getAmountToSendByEpoch(i, gauge);

                        epochSentTotals[i] += Number(amountToBeSentByEpoch);
                        epochSendTotals[i] += Number(amountToSendByEpoch);

                        //Query Gauge Voter
                        const mainnetGauge = recipientToGauge[gauge];
                        const weight = await mainnetGaugeVoteRewards.getWeightByEpoch(i, mainnetGauge);
                        const isProcessed = await mainnetGaugeVoteRewards.isProcessed(i, mainnetGauge);
                        const noDepositGauge = await mainnetGaugeVoteRewards.isNoDepositGauge(mainnetGauge);

                        const data = {
                            pid: j,
                            epoch: i,
                            token: cvx,
                            recipient: gauge,
                            gauge: mainnetGauge,
                            weight: Number(weight),
                            pidSet: pid.isSet,
                            noDeposit: noDepositGauge,
                            amountPending: pending,
                            amountToSend: Number(amountToSendByEpoch),
                            amountToBeSentByEpoch: Number(amountToBeSentByEpoch),
                            isProcessed: isProcessed,
                            overdue: overdue,
                        };

                        pendingRewards[chain].push(data);

                        sidechainRows.push([
                            [data.pid],
                            [data.epoch],
                            [data.token],
                            [data.recipient],
                            [data.gauge],
                            [data.weight],
                            [data.pidSet],
                            [data.noDeposit],
                            [data.amountPending],
                            [data.amountToSend],
                            [data.amountToBeSentByEpoch],
                            [data.isProcessed],
                            [data.overdue],
                        ]);
                    }
                } catch {
                    console.log("");
                }
            }
        }

        console.log(table(sidechainRows));

        //Meta Stats
        console.log(table([[chain + " Meta Stats"]]));

        const sidechainMetaRows = [];
        sidechainMetaRows.push([["Pools Not Set"], [poolNotSet]]);

        for (let i = startEpoch; i <= currentEpoch; i++) {
            sidechainMetaRows.push([["Epoch " + i + " sent totals"], [epochSentTotals[i]]]);
            sidechainMetaRows.push([["Epoch " + i + " send total"], [epochSendTotals[i]]]);
            sidechainMetaRows.push([["Epoch " + i + " overdue pools"], [overduePerEpochPools[i]]]);
            sidechainMetaRows.push([["Epoch " + i + " overdue total"], [overduePerEpochTotals[i]]]);
        }

        console.log(table(sidechainMetaRows));

        //Meta Stats
        console.log(table([[chain + " Misc."]]));

        const sidechainMiscRows = [];

        const distributor = await gaugeVoteRewards.distributor();

        sidechainMiscRows.push([["Distributor"], [distributor]]);
        sidechainMiscRows.push([["lzEndpoint"], [await gaugeVoteRewards.lzEndpoint()]]);

        const lzChainIds = [101];
        for (let i = 0; i < lzChainIds.length; i++) {
            const chainId = lzChainIds[i];
            const trustedRemote = await gaugeVoteRewards.trustedRemoteLookup(chainId);

            sidechainMiscRows.push([["trustedRemote " + chainId], [trustedRemote]]);
        }

        console.log(table(sidechainMiscRows));
    }
});

async function extractGaugeRecipientMappings(deployer: ethers.Signer) {
    const gaugeInterface = [
        "function is_killed() external view returns(bool)",
        "function getRecipient() external view returns(address)",
    ];

    const gaugControllerAddress = "0xC128468b7Ce63eA702C1f104D55A2566b13D3ABD";
    const gaugeControllerAbi = [
        "function gauges(uint arg0) external view returns(address)",
        "function n_gauges() external view returns(int128)",
    ];

    const gaugeControllerContract = new ethers.Contract(gaugControllerAddress, gaugeControllerAbi);

    const n_gauges = Number(await gaugeControllerContract.connect(deployer).n_gauges());

    const gaugeToRecipient = {};
    const recipientToGauge = {};

    for (let i = 0; i < n_gauges; i++) {
        const gaugeAddress = await gaugeControllerContract.connect(deployer).gauges(i);
        const gaugeContract = new ethers.Contract(gaugeAddress, gaugeInterface);
        let recipient = gaugeAddress;
        try {
            recipient = await gaugeContract.connect(deployer).getRecipient();
        } catch (e) {
            // console.log(e);
        }

        gaugeToRecipient[gaugeAddress] = recipient;
        recipientToGauge[recipient] = gaugeAddress;
    }

    return { recipientToGauge, gaugeToRecipient };
}
