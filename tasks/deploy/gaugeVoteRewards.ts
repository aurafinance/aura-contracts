import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { logContracts } from "../utils/deploy-utils";
import { chainIds, getSigner } from "../utils";
import { deployContract, logTxDetails, waitForTx } from "../../tasks/utils";
import { config as mainnetConfig } from "../deploy/mainnet-config";
import {
    ChildGaugeVoteRewards__factory,
    ChildStashRewardDistro__factory,
    GaugeVoteRewards__factory,
    StashRewardDistro__factory,
} from "../../types";
import { lzChainIds, sidechainConfigs } from "./sidechain-constants";

const DEBUG = true;

const noDepositGauges = [
    "0xb78543e00712C3ABBA10D0852f6E38FDE2AaBA4d",
    "0x56124eb16441A1eF12A4CCAeAbDD3421281b795A",
    "0x5b79494824Bc256cD663648Ee1Aad251B32693A9",
];

task("deploy:mainnet:gaugeVoteRewards")
    .addParam("wait", "Wait blocks")
    .setAction(async function (taskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);

        const phase2 = await mainnetConfig.getPhase2(deployer);
        const phase6 = await mainnetConfig.getPhase6(deployer);
        const canonical = mainnetConfig.getSidechain(deployer);

        const stashRewardDistro = await deployContract(
            hre,
            new StashRewardDistro__factory(deployer),
            "StashRewardDistro",
            [phase6.booster.address],
            {},
            DEBUG,
            taskArgs.wait,
        );

        const gaugeVoteRewards = await deployContract(
            hre,
            new GaugeVoteRewards__factory(deployer),
            "GaugeVoteRewards",
            [
                phase2.cvx.address,
                canonical.auraProxyOFT.address,
                phase6.booster.address,
                stashRewardDistro.address,
                lzChainIds[chainIds.mainnet],
                mainnetConfig.addresses.lzEndpoint,
            ],
            {},
            DEBUG,
            taskArgs.wait,
        );

        const poolLength = await phase6.booster.poolLength();
        let tx = await gaugeVoteRewards.setPoolIds(0, poolLength);
        await waitForTx(tx, DEBUG, taskArgs.wait);
        await waitForTx(tx, DEBUG, taskArgs.wait);
        await logTxDetails(tx, "setPoolIds");

        for (const gauge of noDepositGauges) {
            tx = await gaugeVoteRewards.setIsNoDepositGauge(gauge, true);
            await waitForTx(tx, DEBUG, taskArgs.wait);
            await logTxDetails(tx, "setIsNoDepositGauge");
        }

        logContracts({ stashRewardDistro, gaugeVoteRewards });
    });

task("deploy:sidechain:gaugeVoteRewards")
    .addParam("wait", "Wait blocks")
    .addParam("sidechainid", "Sidechain ID")
    .setAction(async function (taskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);

        const config = sidechainConfigs[lzChainIds[hre.network.config.chainId]];
        const sidechain = config.getSidechain(deployer);
        const gaugeVoteRewardsContracts = mainnetConfig.getGaugeVoteRewards(deployer);

        const childStashRewardDistro = await deployContract(
            hre,
            new ChildStashRewardDistro__factory(deployer),
            "ChildStashRewardDistro",
            [sidechain.booster.address],
            {},
            DEBUG,
            taskArgs.wait,
        );

        const childGaugeVoteRewards = await deployContract(
            hre,
            new ChildGaugeVoteRewards__factory(deployer),
            "ChildGaugeVoteRewards",
            [sidechain.auraOFT.address, sidechain.booster.address, childStashRewardDistro.address],
            {},
            DEBUG,
            taskArgs.wait,
        );

        let tx = await childGaugeVoteRewards.initialize(config.extConfig.lzEndpoint);
        await waitForTx(tx, DEBUG, taskArgs.wait);
        await logTxDetails(tx, "initialize");

        const poolLength = await sidechain.booster.poolLength();
        tx = await childGaugeVoteRewards.setPoolIds(0, poolLength);
        await waitForTx(tx, DEBUG, taskArgs.wait);
        await logTxDetails(tx, "setPoolIds");

        await childGaugeVoteRewards.setTrustedRemoteAddress(
            lzChainIds[chainIds.mainnet],
            gaugeVoteRewardsContracts.gaugeVoteRewards.address,
        );
    });
