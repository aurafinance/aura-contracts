import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { deployContract } from "../utils/deploy-utils";
import { getSigner } from "../utils";
import { Phase2Deployed } from "../../scripts/deploySystem";
import { config } from "./mainnet-config";
import {
    UniswapMigrator,
    UniswapMigrator__factory,
    BoosterHelper,
    BoosterHelper__factory,
    ClaimFeesHelper,
    ClaimFeesHelper__factory,
    GaugeMigrator,
    GaugeMigrator__factory,
    AuraMining,
    AuraMining__factory,
} from "../../types/generated";
import { deployUpgrade01 } from "../../scripts/deployUpgrades";
import { deployVault } from "../../scripts/deployVault";

const waitForBlocks = 2;
const debug = true;

// Deployments after the initial deployment script
task("deploy:mainnet:feeCollector").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const { getPhase2, addresses } = config;

    const phase2: Phase2Deployed = await getPhase2(deployer);
    const claimFeesHelper = await deployContract<ClaimFeesHelper>(
        hre,
        new ClaimFeesHelper__factory(deployer),
        "ClaimFeesHelper",
        [phase2.booster.address, phase2.voterProxy.address, addresses.feeDistribution],
        {},
        debug,
        waitForBlocks,
    );

    console.log("update claimFeesHelper address to:", claimFeesHelper.address);
});

task("deploy:mainnet:boosterHelper").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const { getPhase2, addresses } = config;

    const phase2: Phase2Deployed = await getPhase2(deployer);
    const boosterHelper = await deployContract<BoosterHelper>(
        hre,
        new BoosterHelper__factory(deployer),
        "BoosterHelper",
        [phase2.booster.address, addresses.token],
        {},
        debug,
        waitForBlocks,
    );

    console.log("update boosterHelper address to:", boosterHelper.address);
});

task("deploy:mainnet:gaugeMigrator").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const { getPhase2 } = config;
    const phase2: Phase2Deployed = await getPhase2(deployer);
    const constructorArguments = [phase2.booster.address];
    const gaugeMigrator = await deployContract<GaugeMigrator>(
        hre,
        new GaugeMigrator__factory(deployer),
        "GaugeMigrator",
        constructorArguments,
        {},
        debug,
        waitForBlocks,
    );

    console.log("update gaugeMigrator address to:", gaugeMigrator.address);
});

task("deploy:mainnet:uniswapMigrator").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const { addresses } = config;
    const constructorArguments = [
        addresses.balancerPoolFactories.weightedPool,
        addresses.balancerVault,
        addresses.balancerGaugeFactory,
        addresses.uniswapRouter,
        addresses.sushiswapRouter,
        addresses.balancerPoolOwner,
    ];
    const uniswapMigrator = await deployContract<UniswapMigrator>(
        hre,
        new UniswapMigrator__factory(deployer),
        "UniswapMigrator",
        constructorArguments,
        {},
        debug,
        waitForBlocks,
    );

    console.log("update uniswapMigrator address to:", uniswapMigrator.address);
});

task("deploy:mainnet:boosterSecondary").setAction(async function (_: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    const {
        extraRewardStashV3: newStashImpl,
        poolManagerV4,
        boosterOwnerSecondary,
    } = await deployUpgrade01(hre, deployer, debug, waitForBlocks);

    console.log("update newStashImpl address to:", newStashImpl.address);
    console.log("update poolManagerV4 address to:", poolManagerV4.address);
    console.log("update boosterOwnerSecondary address to:", boosterOwnerSecondary.address);
});

task("deploy:mainnet:auraMining").setAction(async function (_: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const auraMining = await deployContract<AuraMining>(
        hre,
        new AuraMining__factory(deployer),
        "AuraMining",
        [],
        {},
        debug,
        waitForBlocks,
    );
    console.log("update auraMining address to:", auraMining.address);
});

task("deploy:mainnet:vault")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);

        const { vault, strategy, bbusdHandler, auraRewards } = await deployVault(
            config,
            hre,
            deployer,
            debug,
            tskArgs.wait || waitForBlocks,
        );

        console.log("Vault:", vault.address);
        console.log("Strategy:", strategy.address);
        console.log("BBUSD Handler:", bbusdHandler.address);
        console.log("AuraRewards:", auraRewards.address);
    });
