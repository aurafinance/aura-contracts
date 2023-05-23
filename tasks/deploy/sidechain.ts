import { assert } from "chai";
import { ethers, Signer } from "ethers";
import { task, types } from "hardhat/config";
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
    AuraOFT__factory,
    BoosterOwnerLite__factory,
} from "../../types";
import { getSigner } from "../utils/signerFactory";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import {
    deployCanonicalPhase1,
    deployCanonicalPhase2,
    deployCreate2Factory,
    deploySidechainPhase1,
    deploySidechainPhase2,
    setTrustedRemoteCanonicalPhase1,
    setTrustedRemoteCanonicalPhase2,
} from "../../scripts/deploySidechain";
import { waitForTx, chainIds } from "../../tasks/utils";
import { computeCreate2Address, logContracts } from "../utils/deploy-utils";
import {
    canonicalChains,
    canonicalConfigs,
    sidechainConfigs,
    lzChainIds,
    remoteChainMap,
    sideChains,
} from "./sidechain-constants";
import { deploySidechainMocks } from "../../scripts/deploySidechainMocks";
// Configs
import { config as goerliSidechainConfig } from "./goerliSidechain-config";

const debug = true;
const SALT = "shanghai";

/* ----------------------------------------------------------------------------
    Canonical Deployment Tasks
---------------------------------------------------------------------------- */

task("deploy:sidechain:mocks")
    .addParam("wait", "wait for blocks")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const result = await deploySidechainMocks(hre, deployer, 111, debug, tskArgs.wait);

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { addresses, namingConfig, ...contracts } = result;
        logContracts(contracts as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:L1:phase1")
    .addParam("wait", "wait for blocks")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const config = canonicalConfigs[hre.network.config.chainId];

        assert(config, `Config for chain ID ${hre.network.config.chainId} not found`);

        const phase2 = await config.getPhase2(deployer);
        const phase6 = await config.getPhase6(deployer);

        const result = await deployCanonicalPhase1(
            hre,
            deployer,
            config.multisigs,
            config.addresses,
            phase2,
            phase6,
            debug,
            tskArgs.wait,
        );
        logContracts(result as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:L1:phase2")
    .addParam("wait", "wait for blocks")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const config = canonicalConfigs[hre.network.config.chainId];

        assert(config, `Config for chain ID ${hre.network.config.chainId} not found`);

        const phase2 = await config.getPhase2(deployer);
        const vault = await config.getAuraBalVault(deployer);
        const canonicalPhase1 = config.getSidechain(deployer);

        const result = await deployCanonicalPhase2(
            hre,
            deployer,
            config.multisigs,
            config.addresses,
            phase2,
            vault,
            canonicalPhase1,
            debug,
            tskArgs.wait,
        );
        logContracts(result as unknown as { [key: string]: { address: string } });
    });

/* ----------------------------------------------------------------------------
    Sidechain Deployment Tasks
---------------------------------------------------------------------------- */

const sidechainTaskSetup = (
    deployer: Signer,
    network: HardhatRuntimeEnvironment["network"],
    canonicalChainId: number,
    force = false,
) => {
    const sidechainConfig = sidechainConfigs[network.config.chainId];
    const canonicalConfig = canonicalConfigs[canonicalChainId];
    const canonical = canonicalConfig.getSidechain(deployer);

    assert(sidechainConfig, `Sidechain config for chain ID ${network.config.chainId} not found`);

    if (!force) {
        assert(sideChains.includes(network.config.chainId), "Must be sidechain");
        assert(canonicalChains.includes(canonicalChainId), "Must be canonical chain");
        assert(canonicalChainId === remoteChainMap[network.config.chainId], "Incorrect canonical chain ID");
    }

    return { canonical, canonicalConfig, sidechainConfig };
};

task("deploy:sidechain:create2Factory")
    .addParam("wait", "wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const waitForBlocks = tskArgs.wait;

        const phase = await deployCreate2Factory(hre, deployer, debug, waitForBlocks);

        const tx = await phase.create2Factory.updateDeployer(await deployer.getAddress(), true);
        await waitForTx(tx, debug);

        logContracts(phase as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:L2:phase1")
    .addParam("wait", "wait for blocks")
    .addParam("canonicalchainid", "Canonical chain ID, eg Eth Mainnet is 1")
    .addParam("force", "Ignore invalid chain IDs for testing", false, types.boolean)
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const canonicalChainId = Number(tskArgs.canonicalchainid);
        const { canonical, sidechainConfig } = sidechainTaskSetup(
            deployer,
            hre.network,
            canonicalChainId,
            tskArgs.force,
        );

        const result = await deploySidechainPhase1(
            hre,
            deployer,
            sidechainConfig.naming,
            sidechainConfig.multisigs,
            sidechainConfig.extConfig,
            canonical,
            canonicalChainId,
            SALT,
            debug,
            tskArgs.wait,
        );

        logContracts(result as unknown as { [key: string]: { address: string } });
        logContracts(result.factories as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:L2:phase2")
    .addParam("wait", "wait for blocks")
    .addParam("canonicalchainid", "Canonical chain ID, eg Eth Mainnet is 1")
    .addParam("force", "Ignore invalid chain IDs for testing", false, types.boolean)
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const canonicalChainId = Number(tskArgs.canonicalchainid);
        const canonicalChainLzId = lzChainIds[canonicalChainId];

        if (!canonicalChainLzId) throw Error("Canonical LZ chain ID not found");

        const { canonical, sidechainConfig } = sidechainTaskSetup(
            deployer,
            hre.network,
            canonicalChainId,
            tskArgs.force,
        );

        const sidechainPhase1 = sidechainConfig.getSidechain(deployer);

        const result = await deploySidechainPhase2(
            hre,
            deployer,
            sidechainConfig.naming,
            sidechainConfig.multisigs,
            sidechainConfig.extConfig,
            canonical,
            sidechainPhase1,
            canonicalChainLzId,
            SALT,
            debug,
            tskArgs.wait,
        );

        logContracts(result as unknown as { [key: string]: { address: string } });
    });

/* ----------------------------------------------------------------------------
    Canonical Configuration Tasks
---------------------------------------------------------------------------- */

const setupCanonicalTask = (
    deployer: Signer,
    network: HardhatRuntimeEnvironment["network"],
    sidechainId: number,
    force = false,
) => {
    assert(canonicalChains.includes(network.config.chainId), "Must be canonical chain");
    assert(sideChains.includes(sidechainId), "Must be sidechain chain");

    const canonicalConfig = canonicalConfigs[network.config.chainId];
    assert(canonicalConfig, `Local config for chain ID ${network.config.chainId} not found`);

    if (!force) {
        assert(Number(sidechainId) === remoteChainMap[network.config.chainId], "Incorrect remote chain ID");
    }

    const sidechainConfig = sidechainConfigs[sidechainId];
    assert(sidechainConfig, `Remote config for chain ID ${sidechainId} not found`);
    const sidechainLzChainId = lzChainIds[sidechainId];
    assert(sidechainLzChainId, "LZ chain ID not found");

    const canonical = canonicalConfig.getSidechain(deployer);
    const remote = sidechainConfig.getSidechain(deployer);

    return { canonical, remote, sidechainLzChainId };
};

task("deploy:sidechain:config:L1:phase1")
    .addParam("wait", "Wait for blocks")
    .addParam("sidechainid", "Remote standard chain ID, eg Eth Mainnet is 1")
    .addParam("force", "Ignore invalid chain IDs for testing", false, types.boolean)
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const sidechainId = Number(tskArgs.sidechainid);
        const { canonical, remote, sidechainLzChainId } = setupCanonicalTask(
            deployer,
            hre.network,
            sidechainId,
            tskArgs.force,
        );

        await setTrustedRemoteCanonicalPhase1(canonical, remote, sidechainLzChainId, debug, tskArgs.wait);
    });

task("deploy:sidechain:config:L1:phase2")
    .addParam("wait", "Wait for blocks")
    .addParam("sidechainid", "Remote standard chain ID, eg Eth Mainnet is 1")
    .addParam("force", "Ignore invalid chain IDs for testing", false, types.boolean)
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const sidechainId = Number(tskArgs.sidechainid);
        const { canonical, remote, sidechainLzChainId } = setupCanonicalTask(
            deployer,
            hre.network,
            sidechainId,
            tskArgs.force,
        );

        await setTrustedRemoteCanonicalPhase2(canonical, remote, sidechainLzChainId, debug, tskArgs.wait);
    });

/* ----------------------------------------------------------------------------
    Helper Tasks
---------------------------------------------------------------------------- */

task("sidechain:addresses")
    .addOptionalParam("chainId", "The chain ID, default arbitrumGoerli")
    .setAction(async function (_: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const configs = {
            [chainIds.goerli]: goerliSidechainConfig,
        };
        const config = configs[hre.network.config.chainId];

        if (!config) {
            throw new Error(`Config for chain ID ${hre.network.config.chainId} not found`);
        }

        const { extConfig, naming, multisigs } = config;

        const voterProxyAddress = await computeCreate2Address<VoterProxyLite__factory>(
            extConfig.create2Factory,
            new VoterProxyLite__factory(deployer),
            "VoterProxyLite",
            [],
        );

        const auraOFTAddress = await computeCreate2Address<AuraOFT__factory>(
            extConfig.create2Factory,
            new AuraOFT__factory(deployer),
            "AuraOFT",
            [naming.auraOftName, naming.auraOftSymbol, extConfig.lzEndpoint, extConfig.canonicalChainId],
        );

        const coordinatorAddress = await computeCreate2Address<L2Coordinator__factory>(
            extConfig.create2Factory,
            new L2Coordinator__factory(deployer),
            "L2Coordinator",
            [extConfig.lzEndpoint, auraOFTAddress, extConfig.canonicalChainId],
        );

        const boosterAddress = await computeCreate2Address<BoosterLite__factory>(
            extConfig.create2Factory,
            new BoosterLite__factory(deployer),
            "BoosterLite",
            [voterProxyAddress],
        );

        // Not a constant address
        const rewardFactoryAddress = await computeCreate2Address<RewardFactory__factory>(
            extConfig.create2Factory,
            new RewardFactory__factory(deployer),
            "RewardFactory",
            [boosterAddress, extConfig.token],
        );

        const tokenFactoryAddress = await computeCreate2Address<TokenFactory__factory>(
            extConfig.create2Factory,
            new TokenFactory__factory(deployer),
            "TokenFactory",
            [boosterAddress, naming.tokenFactoryNamePostfix, naming.auraOftName.toLowerCase()],
        );

        const proxyFactoryAddress = await computeCreate2Address<ProxyFactory__factory>(
            extConfig.create2Factory,
            new ProxyFactory__factory(deployer),
            "ProxyFactory",
            [],
        );

        // Not a constant address
        const stashFactoryAddress = await computeCreate2Address<StashFactoryV2__factory>(
            extConfig.create2Factory,
            new StashFactoryV2__factory(deployer),
            "StashFactory",
            [boosterAddress, rewardFactoryAddress, proxyFactoryAddress],
        );

        // Not a constant address
        const stashV3Address = await computeCreate2Address<ExtraRewardStashV3__factory>(
            extConfig.create2Factory,
            new ExtraRewardStashV3__factory(deployer),
            "ExtraRewardStashV3",
            [extConfig.token],
        );

        const poolManagerAddress = await computeCreate2Address<PoolManagerLite__factory>(
            extConfig.create2Factory,
            new PoolManagerLite__factory(deployer),
            "PoolManagerLite",
            [boosterAddress],
        );

        // Not a constant address
        const boosterOwnerAddress = await computeCreate2Address<BoosterOwnerLite__factory>(
            extConfig.create2Factory,
            new BoosterOwnerLite__factory(deployer),
            "BoosterOwnerLite",
            [multisigs.daoMultisig, poolManagerAddress, boosterAddress, stashFactoryAddress, ZERO_ADDRESS, true],
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
