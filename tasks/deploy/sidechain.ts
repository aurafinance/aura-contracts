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
    CanonicalPhaseDeployed,
    deployCanonicalPhase,
    deployCreate2Factory,
    deploySidechainMocks,
    deploySidechainSystem,
    setTrustedRemoteCanonical,
    setTrustedRemoteSidechain,
    SidechainDeployed,
} from "../../scripts/deploySidechain";
import { waitForTx } from "../../tasks/utils";
import { computeCreate2Address, logContracts } from "../utils/deploy-utils";

import { config as arbitrumGoerliConfig } from "./arbitrumGoerli-config";
import { config as goerliConfig } from "./goerli-config";
import { canonicalChains, configs, lzChainIds, remoteChainMap } from "./sidechain-constants";
import { assert } from "chai";
import { ethers } from "ethers";

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

task("deploy:sidechain:config:L1")
    .addParam("wait", "Wait for blocks")
    .addParam("sidechainid", "Remote standard chain ID, eg Eth Mainnet is 1")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);

        assert(canonicalChains.includes(hre.network.config.chainId), "Must be canonical chain");
        assert(!canonicalChains.includes(tskArgs.sidechainid), "Must NOT be canonical chain");

        const canonicalConfig = configs[hre.network.config.chainId];
        assert(canonicalConfig, `Local config for chain ID ${hre.network.config.chainId} not found`);

        const sidechainId = tskArgs.sidechainid;
        assert(Number(sidechainId) === remoteChainMap[hre.network.config.chainId], "Incorrect remote chain ID");
        const sidechainConfig = configs[sidechainId];
        assert(sidechainConfig, `Remote config for chain ID ${sidechainId} not found`);
        const sidechainLzChainId = lzChainIds[sidechainId];
        assert(sidechainLzChainId, "LZ chain ID not found");

        const canonical: CanonicalPhaseDeployed = canonicalConfig.getSidechain(deployer) as any;
        const remote: SidechainDeployed = sidechainConfig.getSidechain(deployer) as any;

        await setTrustedRemoteCanonical(canonical, remote, sidechainLzChainId);

        // Set LZ config
        const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 200_000]);
        const distributeAuraSelector = ethers.utils.id("distributeAura(uint16)").substring(0, 10);
        const tx = await canonical.auraProxyOFT["setConfig(uint16,bytes4,(bytes,address))"](
            tskArgs.sidechainId,
            distributeAuraSelector,
            [adapterParams, ZERO_ADDRESS] as any,
        );
        await waitForTx(tx, debug, tskArgs.wait);
    });

task("deploy:sidechain:config:L2")
    .addParam("wait", "Wait for blocks")
    .addParam("canonicalchainid", "Canonical chain ID, eg Eth Mainnet is 1")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);

        assert(!canonicalChains.includes(hre.network.config.chainId), "Must NOT be canonical chain");
        assert(canonicalChains.includes(tskArgs.canonicalchainid), "Must be canonical chain");

        const sidechainConfig = configs[hre.network.config.chainId];
        assert(sidechainConfig, `Sidechain config for chain ID ${hre.network.config.chainId} not found`);

        const canonicalChainId = tskArgs.canonicalchainid;
        assert(Number(canonicalChainId) === remoteChainMap[hre.network.config.chainId], "Incorrect canonical chain ID");
        const canonicalConfig = configs[canonicalChainId];
        assert(canonicalConfig, `Canonical config for chain ID ${canonicalChainId} not found`);
        const canonicalLzChainId = lzChainIds[canonicalChainId];
        assert(canonicalLzChainId, "LZ chain ID not found");

        const sidechain: SidechainDeployed = sidechainConfig.getSidechain(deployer) as any;
        const canonical: CanonicalPhaseDeployed = canonicalConfig.getSidechain(deployer) as any;

        await setTrustedRemoteSidechain(canonical, sidechain, canonicalLzChainId);

        // Set LZ config
        const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 600_000]);
        const lockSelector = ethers.utils.id("lock(uint256)").substring(0, 10);
        const tx = await sidechain.l2Coordinator["setConfig(uint16,bytes4,(bytes,address))"](
            tskArgs.canonicalchainid,
            lockSelector,
            [adapterParams, ZERO_ADDRESS] as any,
        );
        await waitForTx(tx, debug, tskArgs.wait);
    });

task("sidechain:addresses")
    .addOptionalParam("chainId", "The chain ID, default arbitrumGoerli")
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
            [],
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

        const boosterAddress = await computeCreate2Address<BoosterLite__factory>(
            addresses.create2Factory,
            new BoosterLite__factory(deployer),
            "BoosterLite",
            [voterProxyAddress],
        );

        // Not a constant address
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

        // Not a constant address
        const stashFactoryAddress = await computeCreate2Address<StashFactoryV2__factory>(
            addresses.create2Factory,
            new StashFactoryV2__factory(deployer),
            "StashFactory",
            [boosterAddress, rewardFactoryAddress, proxyFactoryAddress],
        );

        // Not a constant address
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
            [boosterAddress],
        );

        // Not a constant address
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
