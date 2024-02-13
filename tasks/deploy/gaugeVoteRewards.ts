import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { deployCreate2Factory } from "../../scripts/deploySidechain";
import { deployContract, logTxDetails, waitForTx } from "../../tasks/utils";
import {
    ChildGaugeVoteRewards,
    ChildGaugeVoteRewards__factory,
    ChildStashRewardDistro,
    ChildStashRewardDistro__factory,
    Create2Factory__factory,
    GaugeVoteRewards__factory,
    StashRewardDistro__factory,
} from "../../types";
import { config as mainnetConfig } from "../deploy/mainnet-config";
import { chainIds, getSigner } from "../utils";
import { deployContractWithCreate2, logContracts } from "../utils/deploy-utils";
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
        await logTxDetails(tx, "setPoolIds");

        for (const gauge of noDepositGauges) {
            tx = await gaugeVoteRewards.setIsNoDepositGauge(gauge, true);
            await waitForTx(tx, DEBUG, taskArgs.wait);
            await logTxDetails(tx, "setIsNoDepositGauge");
        }

        logContracts({ stashRewardDistro, gaugeVoteRewards });

        // GaugeVoteRewards.setRewardPerEpoch(76500000000000000000000)
    });

task("deploy:sidechain:create2Factor")
    .addParam("wait", "wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const waitForBlocks = tskArgs.wait;

        const nonce = await deployer.getTransactionCount();
        console.log("NonceS:", nonce);

        const phase = await deployCreate2Factory(hre, deployer, DEBUG, waitForBlocks);

        const tx = await phase.create2Factory.updateDeployer(await deployer.getAddress(), true);
        await waitForTx(tx, DEBUG);

        logContracts(phase as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:gaugeVoteRewards")
    .addParam("wait", "Wait blocks")
    .setAction(async function (taskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const waitForBlocks = taskArgs.wait;

        const nonce = await deployer.getTransactionCount();
        console.log("NonceS:", nonce);

        // Setup create 2 options
        const salt = "v2"; //Change salt between versions.
        const create2Options = { amount: 0, salt, callbacks: [] };
        const deployOptions = {
            overrides: {},
            create2Options,
            debug: DEBUG,
            waitForBlocks,
        };
        const deployOptionsWithCallbacks = (callbacks: string[]) => ({
            ...deployOptions,
            create2Options: {
                ...create2Options,
                callbacks: [...callbacks],
            },
        });

        const deployerAddress = await deployer.getAddress();
        const config = sidechainConfigs[hre.network.config.chainId];
        const sidechain = config.getSidechain(deployer);

        const create2Factory = Create2Factory__factory.connect(config.extConfig.create2Factory, deployer);

        const childStashRewardDistro = await deployContractWithCreate2<
            ChildStashRewardDistro,
            ChildStashRewardDistro__factory
        >(
            hre,
            create2Factory,
            new ChildStashRewardDistro__factory(deployer),
            "ChildStashRewardDistro",
            [sidechain.booster.address],
            deployOptionsWithCallbacks([]),
        );

        const childGaugeVoteRewardsTransferOwnership =
            ChildGaugeVoteRewards__factory.createInterface().encodeFunctionData("transferOwnership", [deployerAddress]);

        const childGaugeVoteRewards = await deployContractWithCreate2<
            ChildGaugeVoteRewards,
            ChildGaugeVoteRewards__factory
        >(
            hre,
            create2Factory,
            new ChildGaugeVoteRewards__factory(deployer),
            "ChildGaugeVoteRewards",
            [sidechain.auraOFT.address, sidechain.booster.address, childStashRewardDistro.address],
            deployOptionsWithCallbacks([childGaugeVoteRewardsTransferOwnership]),
        );

        let tx = await childGaugeVoteRewards.initialize(config.extConfig.lzEndpoint);
        await waitForTx(tx, DEBUG, taskArgs.wait);
        await logTxDetails(tx, "initialize");

        const poolLength = await sidechain.booster.poolLength();
        tx = await childGaugeVoteRewards.setPoolIds(0, poolLength);
        await waitForTx(tx, DEBUG, taskArgs.wait);
        await logTxDetails(tx, "setPoolIds");

        // await childGaugeVoteRewards.setTrustedRemoteAddress(
        //     lzChainIds[chainIds.mainnet],
        //     gaugeVoteRewardsContracts.gaugeVoteRewards.address,
        // );

        logContracts({ childStashRewardDistro, childGaugeVoteRewards });
    });
