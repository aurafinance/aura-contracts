import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

import {
    VoterProxyLite__factory,
    L2Coordinator__factory,
    BoosterLite__factory,
    RewardFactory__factory,
    TokenFactory__factory,
    ProxyFactory__factory,
    StashFactoryV2__factory,
    ExtraRewardStashV3__factory,
    PoolManagerLite__factory,
    BoosterOwner__factory,
    AuraOFT__factory,
} from "../../types";
import { getSigner } from "../utils";
import { chainIds } from "../../hardhat.config";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import {
    deployCanonicalPhase,
    deployCreate2Factory,
    deploySidechainMocks,
    deploySidechainSystem,
} from "../../scripts/deploySidechain";
import { waitForTx } from "../../tasks/utils";
import { computeCreate2Address, logContracts } from "../utils/deploy-utils";

import { config as arbitrumGoerliConfig } from "./arbitrumGoerli-config";
import { config as goerliConfig } from "./goerli-config";

const debug = true;

task("deploy:sidechain:create2Factory")
    .addParam("wait", "wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const waitForBlocks = tskArgs.wait;

        const phase = await deployCreate2Factory(hre, deployer, debug, waitForBlocks);

        const tx = await phase.create2Factory.updateDeployer(await deployer.getAddress(), true);
        await waitForTx(tx);

        logContracts(phase as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:mocks")
    .addParam("wait", "wait for blocks")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const result = await deploySidechainMocks(hre, deployer, debug, tskArgs.wait);
        logContracts(result as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:L1")
    .addParam("wait", "wait for blocks")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);

        const configs = {
            [chainIds.goerli]: goerliConfig,
            31337: goerliConfig,
            1337: goerliConfig,
        };

        const config = configs[hre.network.config.chainId];

        if (!config) {
            throw new Error(`Config for chain ID ${hre.network.config.chainId} not found`);
        }

        const phase2 = await config.getPhase2(deployer);
        const phase6 = await config.getPhase6(deployer);

        const result = await deployCanonicalPhase(hre, config.addresses, phase2, phase6, deployer, debug, tskArgs.wait);
        logContracts(result as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:L2")
    .addParam("wait", "wait for blocks")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);

        const configs = {
            [chainIds.arbitrumGoerli]: arbitrumGoerliConfig,
            31337: arbitrumGoerliConfig,
            1337: arbitrumGoerliConfig,
        };

        const config = configs[hre.network.config.chainId];

        if (!config) {
            throw new Error(`Config for chain ID ${hre.network.config.chainId} not found`);
        }

        const result = await deploySidechainSystem(
            hre,
            config.naming,
            config.addresses,
            config.extConfig,
            deployer,
            debug,
            tskArgs.wait,
        );

        logContracts(result as unknown as { [key: string]: { address: string } });
        logContracts(result.factories as unknown as { [key: string]: { address: string } });
    });

task("sidechain:addresses")
    .addParam("chainId", "The chain ID")
    .setAction(async function (_: TaskArguments, hre) {
        const deployer = await getSigner(hre);

        const configs = {
            [chainIds.arbitrumGoerli]: arbitrumGoerliConfig,
        };

        const config = configs[hre.network.config.chainId];

        if (!config) {
            throw new Error(`Config for chain ID ${hre.network.config.chainId} not found`);
        }

        const { addresses, extConfig, naming } = arbitrumGoerliConfig;

        const voterProxyAddress = await computeCreate2Address<VoterProxyLite__factory>(
            addresses.create2Factory,
            new VoterProxyLite__factory(deployer),
            "VoterProxyLite",
            [addresses.minter, addresses.token],
        );

        const auraOFTAddress = await computeCreate2Address<AuraOFT__factory>(
            addresses.create2Factory,
            new AuraOFT__factory(deployer),
            "AuraOFT",
            [naming.coordinatorName, naming.coordinatorSymbol, addresses.lzEndpoint, extConfig.canonicalChainId],
        );

        const coordinatorAddress = await computeCreate2Address<L2Coordinator__factory>(
            addresses.create2Factory,
            new L2Coordinator__factory(deployer),
            "L2Coordinator",
            [addresses.lzEndpoint, auraOFTAddress, extConfig.canonicalChainId],
        );

        const cvxTokenAddress = coordinatorAddress;

        const boosterAddress = await computeCreate2Address<BoosterLite__factory>(
            addresses.create2Factory,
            new BoosterLite__factory(deployer),
            "BoosterLite",
            [voterProxyAddress, cvxTokenAddress, addresses.token],
        );

        const rewardFactoryAddress = await computeCreate2Address<RewardFactory__factory>(
            addresses.create2Factory,
            new RewardFactory__factory(deployer),
            "RewardFactory",
            [boosterAddress, addresses.token],
        );

        const tokenFactoryAddress = await computeCreate2Address<TokenFactory__factory>(
            addresses.create2Factory,
            new TokenFactory__factory(deployer),
            "TokenFactory",
            [boosterAddress, naming.tokenFactoryNamePostfix, naming.coordinatorSymbol.toLowerCase()],
        );

        const proxyFactoryAddress = await computeCreate2Address<ProxyFactory__factory>(
            addresses.create2Factory,
            new ProxyFactory__factory(deployer),
            "ProxyFactory",
            [],
        );

        const stashFactoryAddress = await computeCreate2Address<StashFactoryV2__factory>(
            addresses.create2Factory,
            new StashFactoryV2__factory(deployer),
            "StashFactory",
            [boosterAddress, rewardFactoryAddress, proxyFactoryAddress],
        );

        const stashV3Address = await computeCreate2Address<ExtraRewardStashV3__factory>(
            addresses.create2Factory,
            new ExtraRewardStashV3__factory(deployer),
            "ExtraRewardStashV3",
            [addresses.token],
        );

        const poolManagerAddress = await computeCreate2Address<PoolManagerLite__factory>(
            addresses.create2Factory,
            new PoolManagerLite__factory(deployer),
            "PoolManagerLite",
            [boosterAddress, addresses.daoMultisig],
        );

        const boosterOwnerAddress = await computeCreate2Address<BoosterOwner__factory>(
            addresses.create2Factory,
            new BoosterOwner__factory(deployer),
            "BoosterOwner",
            [addresses.daoMultisig, poolManagerAddress, boosterAddress, stashFactoryAddress, ZERO_ADDRESS, true],
        );

        const deployed = {
            voterProxyAddress,
            coordinatorAddress,
            boosterAddress,
            tokenFactoryAddress,
            proxyFactoryAddress,
            stashFactoryAddress,
            stashV3Address,
            poolManagerAddress,
            boosterOwnerAddress,
        };

        Object.keys(deployed).forEach(key => {
            console.log(`${key}:`.padEnd(24, " "), deployed[key]);
        });
    });
