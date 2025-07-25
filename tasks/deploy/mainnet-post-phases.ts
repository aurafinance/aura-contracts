import { AssetHelpers } from "@balancer-labs/balancer-js";
import { BigNumber, ContractReceipt, ethers } from "ethers";
import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

import { deployAuraClaimZapV3, deployAuraClaimZapV3Swapper } from "../../scripts/deployAuraClaimZapV3";
import {
    deployAuraBalStaker,
    deployWardenQuestScheduler,
    deployKeeperMulticall3,
    deployFeeScheduler,
    deployVeBalGrant,
    deployExtraRewardStashModule,
    deployHHRewardsClaimForwarderModule,
    deployHHChefClaimBriberModule,
    deployAuraLockerModule,
    deployGaugeVoterModule,
} from "../../scripts/deployPeripheral";
import { deployCrvDepositorWrapperSwapper, deployPhase9, Phase2Deployed } from "../../scripts/deploySystem";
import { deployUpgrade01 } from "../../scripts/deployUpgrades";
import { deployFeeTokenHandlerV5, deployFeeForwarder, deployVault } from "../../scripts/deployVault";
import { waitForTx } from "../../tasks/utils";
import { simpleToExactAmount } from "../../test-utils/math";
import {
    AuraMining,
    AuraMining__factory,
    BoosterHelper,
    BoosterHelper__factory,
    ChefForwarder__factory,
    ClaimFeesHelper,
    ClaimFeesHelper__factory,
    GaugeMigrator,
    GaugeMigrator__factory,
    IBalancerPool__factory,
    IBalancerVault__factory,
    IERC20__factory,
    IStablePoolFactory__factory,
    UniswapMigrator,
    UniswapMigrator__factory,
} from "../../types/generated";
import { getSigner } from "../utils";
import { deployContract, logContracts } from "../utils/deploy-utils";
import { config as goerliConfig } from "./goerli-config";
import { config } from "./mainnet-config";

// Configs
const waitForBlocks = 2;
const debug = true;
const SALT = "3333";

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

        const { vault, strategy, feeTokenHandler, auraRewards } = await deployVault(
            conf,
            hre,
            deployer,
            debug,
            tskArgs.wait || waitForBlocks,
        );

        console.log("Vault:", vault.address);
        console.log("Strategy:", strategy.address);
        console.log("USDC Handler:", feeTokenHandler.address);
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

task("deploy:mainnet:auraBalStaker")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const vault = (await config.getAuraBalVault(deployer)).vault;
        const cvxCrv = (await config.getPhase2(deployer)).cvxCrv;

        const staker = await deployAuraBalStaker(hre, deployer, vault, cvxCrv, true, tskArgs.wait);
        console.log("AuraBalStaker:", staker.address);
    });

task("deploy:mainnet:feeScheduler")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const result = await deployFeeScheduler(hre, deployer, debug, tskArgs.wait);
        console.log("FeeScheduler:", result.feeScheduler.address);
    });

task("deploy:mainnet:veBalGrant")
    .addParam("balancer", "Address of balancer")
    .addParam("project", "Address of project")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const balancer = tskArgs.balancer;
        const project = tskArgs.project;
        const result = await deployVeBalGrant(hre, deployer, config.addresses, project, balancer, debug, tskArgs.wait);
        console.log("VeBalGrant:", result.veBalGrant.address);
    });

task("deploy:mainnet:feeTokenHandlerV5")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const result = await deployFeeTokenHandlerV5(config, hre, deployer, debug, tskArgs.wait);
        console.log("FeeToken Handler:", result.feeTokenHandler.address);
    });

task("deploy:mainnet:wardenQuestScheduler")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const result = await deployWardenQuestScheduler(hre, deployer, debug, tskArgs.wait);
        const keeperAddress = "0xcc247cde79624801169475c9ba1f716db3959b8f";

        await result.wardenQuestScheduler.updateAuthorizedKeepers(keeperAddress, true);
        await result.wardenQuestScheduler.updateAuthorizedKeepers(config.multisigs.incentivesMultisig, true);
        await result.wardenQuestScheduler.transferOwnership(config.multisigs.incentivesMultisig);

        console.log("WardenQuestScheduler:", result.wardenQuestScheduler.address);
    });

task("deploy:mainnet:keeperMulticall3")
    .addParam("owner", "Address of balancer")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const result = await deployKeeperMulticall3(hre, deployer, tskArgs.owner, tskArgs.wait);
        console.log("KeeperMulticall3:", result.keeperMulticall3.address);
    });

task("deploy:mainnet:poolFeeManagerProxy")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const phase6 = await config.getPhase6(deployer);
        const phase8 = await config.getPhase8(deployer);
        const result = await deployPhase9(
            hre,
            deployer,
            config.addresses,
            { ...phase6, ...phase8 },
            config.multisigs,
            SALT,
            debug,
            tskArgs.wait,
        );

        logContracts(result as unknown as { [key: string]: { address: string } });
    });

task("deploy:mainnet:extraRewardStashModule")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const phase2 = await config.getPhase2(deployer);
        const phase8 = await config.getPhase8(deployer);
        const GHO_ADDRESS = "0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f";
        const result = await deployExtraRewardStashModule(
            hre,
            deployer,
            config.multisigs,
            { boosterOwnerSecondary: phase8.boosterOwnerSecondary },
            [phase2.cvx.address, GHO_ADDRESS],
            debug,
            tskArgs.wait,
        );

        logContracts(result as unknown as { [key: string]: { address: string } });
    });

task("deploy:mainnet:HHRewardsClaimForwarderModule")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const phase2 = await config.getPhase2(deployer);
        const phaseGaugeVoter = config.getGaugeVoteRewards(deployer);
        const contracts = { ...phase2, ...phaseGaugeVoter };

        const result = await deployHHRewardsClaimForwarderModule(
            hre,
            deployer,
            config.multisigs,
            {
                cvx: contracts.cvx,
                stashRewardDistro: contracts.stashRewardDistro,
            },
            debug,
            tskArgs.wait,
        );

        logContracts(result);
    });
task("deploy:mainnet:HHChefClaimBriberModule")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const phase2 = await config.getPhase2(deployer);
        const contracts = {
            ...phase2,
            chefForwarder: ChefForwarder__factory.connect("0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9", deployer),
        };

        const result = await deployHHChefClaimBriberModule(
            hre,
            deployer,
            config.multisigs,
            {
                cvx: contracts.cvx,
                chefForwarder: contracts.chefForwarder,
            },
            debug,
            tskArgs.wait,
        );

        logContracts(result);
    });
task("deploy:mainnet:AuraLockerModule")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const phase2 = await config.getPhase2(deployer);

        const result = await deployAuraLockerModule(
            hre,
            deployer,
            config.multisigs,
            { cvxLocker: phase2.cvxLocker },
            debug,
            tskArgs.wait,
        );

        logContracts(result);
    });
task("deploy:mainnet:GaugeVoterModule")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const phase = config.getGaugeVoteRewards(deployer);
        const result = await deployGaugeVoterModule(
            hre,
            deployer,
            config.multisigs,
            { gaugeVoter: phase.gaugeVoteRewards },
            debug,
            tskArgs.wait,
        );
        logContracts(result);
    });

task("deploy:mainnet:deployCrvDepositorWrapperSwapper")
    .addOptionalParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const phase2 = await config.getPhase2(deployer);
        const { crvDepositorWrapperSwapper } = await deployCrvDepositorWrapperSwapper(
            hre,
            deployer,
            phase2,
            config.addresses,
            debug,
            tskArgs.wait || waitForBlocks,
        );
        logContracts({ crvDepositorWrapperSwapper });
    });

task("deploy:mainnet:deployAuraClaimZapV3Swapper")
    .addOptionalParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const vault = (await config.getAuraBalVault(deployer)).vault;
        const contracts = config.getPostPhases(deployer);
        const { claimZapV3: claimZapV3 } = await deployAuraClaimZapV3Swapper(
            config,
            hre,
            deployer,
            {
                vault: vault.address,
                crvDepositorWrapper: contracts.crvDepositorWrapperSwapper.address,
            },
            debug,
            tskArgs.wait || waitForBlocks,
        );
        logContracts({ claimZapV3 });
    });
