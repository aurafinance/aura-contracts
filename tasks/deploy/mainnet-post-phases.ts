import { BigNumber, ContractReceipt, ethers } from "ethers";
import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { AssetHelpers } from "@balancer-labs/balancer-js";
import { deployContract } from "../utils/deploy-utils";
import { getSigner } from "../utils";
import { Phase2Deployed } from "../../scripts/deploySystem";
import { config } from "./mainnet-config";
import { config as goerliConfig } from "./goerli-config";
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
    IStablePoolFactory__factory,
    IBalancerPool__factory,
    IBalancerVault__factory,
    IERC20__factory,
} from "../../types/generated";
import { deployUpgrade01 } from "../../scripts/deployUpgrades";
import { deployFeeForwarder, deployVault } from "../../scripts/deployVault";
import { deployAuraClaimZapV3 } from "../../scripts/deployAuraClaimZapV3";
import { simpleToExactAmount } from "../../test-utils/math";
import { waitForTx } from "../../tasks/utils";

const waitForBlocks = 2;
const debug = true;

function getPoolAddress(utils: any, receipt: ContractReceipt): string {
    const event = receipt.events.find(e => e.topics[0] === utils.keccak256(utils.toUtf8Bytes("PoolCreated(address)")));
    return utils.hexZeroPad(utils.hexStripZeros(event.topics[1]), 20);
}

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
    const { getPhase2 } = config;

    const phase2: Phase2Deployed = await getPhase2(deployer);
    const boosterHelper = await deployContract<BoosterHelper>(
        hre,
        new BoosterHelper__factory(deployer),
        "BoosterHelper",
        [phase2.booster.address],
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

task("deploy:vault")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);

        const conf = {
            mainnet: config,
            goerli: goerliConfig,
            hardhat: config, // For fork mode
        }[hre.network.name];

        if (!conf) {
            throw Error(`Config for network ${hre.network.name} not found`);
        }

        const { vault, strategy, bbusdHandler, auraRewards } = await deployVault(
            conf,
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

task("deploy:feeForwarder")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);

        const { feeForwarder } = await deployFeeForwarder(config, hre, deployer, debug, tskArgs.wait || waitForBlocks);

        console.log("FeeForwarder:", feeForwarder.address);
    });

task("deploy:goerli:AuraBalStablePool")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const waitForBlocks = tskArgs.wait;
        const deployer = await getSigner(hre);
        const deployerAddress = await deployer.getAddress();
        const phase2 = await goerliConfig.getPhase2(deployer);
        const balHelper = new AssetHelpers(goerliConfig.addresses.weth);

        const [poolTokens, initialBalances] = balHelper.sortTokens(
            [phase2.cvxCrv.address, goerliConfig.addresses.tokenBpt],
            [simpleToExactAmount(1), simpleToExactAmount(1)],
        );
        const poolData = {
            tokens: poolTokens,
            name: `Balancer ${await phase2.cvxCrv.symbol()} Stable Pool`,
            symbol: `B-${await phase2.cvxCrv.symbol()}-STABLE`,
            swapFee: simpleToExactAmount(6, 15),
            ampParameter: 25,
        };
        console.log("poolData:", poolData);

        const poolFactory = IStablePoolFactory__factory.connect(
            goerliConfig.addresses.balancerPoolFactories.stablePool,
            deployer,
        );
        let tx = await poolFactory.create(
            poolData.name,
            poolData.symbol,
            poolData.tokens,
            poolData.ampParameter,
            poolData.swapFee,
            goerliConfig.multisigs.treasuryMultisig,
        );
        const receipt = await waitForTx(tx, debug, waitForBlocks);
        const cvxCrvPoolAddress = getPoolAddress(ethers.utils, receipt);
        console.log("cvxCrvPoolAddress:", cvxCrvPoolAddress);

        const poolId = await IBalancerPool__factory.connect(cvxCrvPoolAddress, deployer).getPoolId();
        console.log("poolId:", poolId);
        const balancerVault = IBalancerVault__factory.connect(goerliConfig.addresses.balancerVault, deployer);

        const crvBpt = IERC20__factory.connect(goerliConfig.addresses.tokenBpt, deployer);

        tx = await phase2.cvxCrv.approve(goerliConfig.addresses.balancerVault, simpleToExactAmount(2));
        await waitForTx(tx, debug, waitForBlocks);
        console.log("Approve cvxCrv");
        tx = await crvBpt.approve(goerliConfig.addresses.balancerVault, simpleToExactAmount(2));
        await waitForTx(tx, debug, waitForBlocks);
        console.log("Approve crvBpt");

        const joinPoolRequest = {
            assets: poolTokens,
            maxAmountsIn: initialBalances as BigNumber[],
            userData: ethers.utils.defaultAbiCoder.encode(
                ["uint256", "uint256[]"],
                [0, initialBalances as BigNumber[]],
            ),
            fromInternalBalance: false,
        };

        tx = await balancerVault.joinPool(
            poolId,
            deployerAddress,
            goerliConfig.multisigs.treasuryMultisig,
            joinPoolRequest,
        );
        await waitForTx(tx, debug, waitForBlocks);
        console.log("Joined pool");
    });

task("deploy:mainnet:auraClaimZapV3")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const vault = (await config.getAuraBalVault(deployer)).vault;
        const { claimZapV3: claimZapV3 } = await deployAuraClaimZapV3(
            config,
            hre,
            deployer,
            vault.address,
            debug,
            tskArgs.wait || waitForBlocks,
        );
        console.log("update claimZapV3 address to:", claimZapV3.address);
    });
