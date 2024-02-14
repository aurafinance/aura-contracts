import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
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
import { BN } from "../../test-utils/math";

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
    });

task("configure:mainnet:gaugeVoteRewards")
    .addParam("wait", "Wait blocks")
    .setAction(async function (taskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const waitForBlocks = taskArgs.wait;

        const { gaugeVoteRewards } = mainnetConfig.getGaugeVoteRewards(deployer);
        let tx = await gaugeVoteRewards.setRewardPerEpoch(BN.from("76500000000000000000000"));
        await waitForTx(tx, DEBUG, waitForBlocks);
        await logTxDetails(tx, "setRewardPerEpoch");

        const setChildGaugeVoteRewards = async (chainId: number) => {
            const lzChainId = lzChainIds[chainId];

            const childGaugeVoteRewardsAddress =
                sidechainConfigs[chainId].getSidechain(deployer).childGaugeVoteRewards.address;
            const tx = await gaugeVoteRewards.setChildGaugeVoteRewards(lzChainId, childGaugeVoteRewardsAddress);
            await waitForTx(tx, DEBUG, waitForBlocks);
            await logTxDetails(tx, `setChildGaugeVoteRewards(${chainId})`);
        };
        const setTrustedRemoteAddress = async (chainId: number) => {
            const lzChainId = lzChainIds[chainId];

            const childGaugeVoteRewardsAddress =
                sidechainConfigs[chainId].getSidechain(deployer).childGaugeVoteRewards.address;
            const tx = await gaugeVoteRewards.setTrustedRemoteAddress(lzChainId, childGaugeVoteRewardsAddress);
            await waitForTx(tx, DEBUG, waitForBlocks);
            await logTxDetails(tx, `setTrustedRemoteAddress(${chainId})`);
        };
        // --------- setChildGaugeVoteRewards ------------- //
        await setChildGaugeVoteRewards(chainIds.arbitrum);
        await setChildGaugeVoteRewards(chainIds.optimism);
        await setChildGaugeVoteRewards(chainIds.base);
        await setChildGaugeVoteRewards(chainIds.gnosis);
        await setChildGaugeVoteRewards(chainIds.polygon);
        await setChildGaugeVoteRewards(chainIds.zkevm);

        // --------- setTrustedRemoteAddress ------------- //
        await setTrustedRemoteAddress(chainIds.arbitrum);
        await setTrustedRemoteAddress(chainIds.optimism);
        await setTrustedRemoteAddress(chainIds.base);
        await setTrustedRemoteAddress(chainIds.gnosis);
        await setTrustedRemoteAddress(chainIds.polygon);
        await setTrustedRemoteAddress(chainIds.zkevm);

        tx = await gaugeVoteRewards.setDistributor("0x817F426B5a79599464488eCCf82c3F54b9330E15"); // KeeperMulticall3
        await waitForTx(tx, DEBUG, waitForBlocks);
        await logTxDetails(tx, "setDistributor");

        // --------- CAN BE DONE LATER ------------- //
        // tx  = await gaugeVoteRewards.setDstChainId()
        // await waitForTx(tx, DEBUG, waitForBlocks);
        // await logTxDetails(tx, "setDstChainId");

        // tx  = await gaugeVoteRewards.transferOwnerShip("0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0") // Aura Protocol Multisig
        // await waitForTx(tx, DEBUG, waitForBlocks);
        // await logTxDetails(tx, "transferOwnerShip");
    });
task("deploy:sidechain:gaugeVoteRewards")
    .addParam("wait", "Wait blocks")
    .setAction(async function (taskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const waitForBlocks = taskArgs.wait;

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
        const gaugeVoteRewardsContracts = mainnetConfig.getGaugeVoteRewards(deployer);

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
        await logTxDetails(tx, `setPoolIds(0,${poolLength.toNumber()})`);

        tx = await childGaugeVoteRewards.setTrustedRemoteAddress(
            lzChainIds[chainIds.mainnet],
            gaugeVoteRewardsContracts.gaugeVoteRewards.address,
        );
        await waitForTx(tx, DEBUG, taskArgs.wait);
        await logTxDetails(tx, "setTrustedRemoteAddress(mainnet)");

        tx = await childGaugeVoteRewards.setDistributor(sidechain.keeperMulticall3.address);
        await waitForTx(tx, DEBUG, taskArgs.wait);
        await logTxDetails(tx, `setDistributor(${sidechain.keeperMulticall3.address})`);

        console.log("config.multisigs.daoMultisig", config.multisigs.daoMultisig);
        // tx  = await childGaugeVoteRewards.transferOwnerShip(config.multisigs.daoMultisig) // Aura Protocol Multisig
        // await waitForTx(tx, DEBUG, waitForBlocks);
        // await logTxDetails(tx, "transferOwnerShip");

        logContracts({ childStashRewardDistro, childGaugeVoteRewards });
    });
