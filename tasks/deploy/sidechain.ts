import { assert } from "chai";
import { ethers, Signer } from "ethers";
import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

import {
    deployArbitrumBridgeSender,
    deployOptimismBridgeSender,
    deploySimpleBridgeReceiver,
    deploySimpleBridgeReceiver,
    deploPolygonBridgeSender,
} from "../../scripts/deployBridgeDelegates";
import {
    deployAuraDistributor,
    deployCanonicalPhase1,
    deployCanonicalPhase2,
    deployCanonicalView,
    deployCreate2Factory,
    deployKeeperMulticall3,
    deploySidechainClaimZap,
    deploySidechainPhase1,
    deploySidechainPhase2,
    deploySidechainView,
    setTrustedRemoteCanonicalPhase1,
    setTrustedRemoteCanonicalPhase2,
} from "../../scripts/deploySidechain";
import { deploySidechainMocks } from "../../scripts/deploySidechainMocks";
import { chainIds, waitForTx } from "../../tasks/utils";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import {
    AuraBalOFT__factory,
    AuraBalVault__factory,
    AuraOFT__factory,
    BoosterLite__factory,
    BoosterOwnerLite__factory,
    ExtraRewardStashV3__factory,
    L2Coordinator__factory,
    PoolManagerLite__factory,
    ProxyFactory__factory,
    RewardFactory__factory,
    SimpleStrategy__factory,
    StashFactoryV2__factory,
    TokenFactory__factory,
    VirtualRewardFactory__factory,
    VoterProxyLite__factory,
} from "../../types";
import { computeCreate2Address, logContracts } from "../utils/deploy-utils";
import { getSigner } from "../utils/signerFactory";
import { config as gnosisSidechainConfig } from "./gnosis-config";
import { config as goerliSidechainConfig } from "./goerliSidechain-config";
import {
    canonicalChains,
    canonicalConfigs,
    lzChainIds,
    remoteChainMap,
    sidechainConfigs,
    sideChains,
} from "./sidechain-constants";

// Configs
const debug = true;
const SALT = "3333";

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

task("deploy:sidechain:L1:bridgeReceiver")
    .addParam("wait", "wait for blocks")
    .addParam("sidechainid", "Sidechain chain ID")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const config = canonicalConfigs[hre.network.config.chainId];
        const sidechainId = lzChainIds[tskArgs.sidechainid];

        assert(config, `Config for chain ID ${hre.network.config.chainId} not found`);

        const canonical = config.getSidechain(deployer);

        const result = await deploySimpleBridgeReceiver(hre, canonical, sidechainId, deployer);

        logContracts(result as unknown as { [key: string]: { address: string } });
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

    assert(sidechainConfig, `Sidechain config for chain ID ${network.config.chainId} not found`);
    assert(canonicalConfig, `Canonical config for chain ID ${canonicalChainId} not found`);

    const canonical = canonicalConfig.getSidechain(deployer);
    const sidechain = sidechainConfig.getSidechain(deployer);

    if (!force) {
        assert(sideChains.includes(network.config.chainId), "Must be sidechain");
        assert(canonicalChains.includes(canonicalChainId), "Must be canonical chain");
        assert(canonicalChainId === remoteChainMap[network.config.chainId], "Incorrect canonical chain ID");
    }

    return { sidechain, canonical, canonicalConfig, sidechainConfig };
};

task("deploy:sidechain:create2Factory")
    .addParam("wait", "wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const waitForBlocks = tskArgs.wait;

        const nonce = await deployer.getTransactionCount();
        console.log("Nonce:", nonce);

        const phase = await deployCreate2Factory(hre, deployer, debug, waitForBlocks);

        const tx = await phase.create2Factory.updateDeployer(await deployer.getAddress(), true);
        await waitForTx(tx, debug);

        logContracts(phase as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:L2:bridgeSender:arbitrum")
    .addParam("wait", "wait for blocks")
    .addParam("canonicalchainid", "Canonical chain ID, eg Eth Mainnet is 1")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const canonicalChainId = Number(tskArgs.canonicalchainid);
        const { canonicalConfig, sidechainConfig } = sidechainTaskSetup(deployer, hre.network, canonicalChainId);

        const gatewayRouter = sidechainConfig.bridging.nativeBridge;
        const crv = sidechainConfig.extConfig.token;
        const l1Crv = canonicalConfig.addresses.token;

        const bridgeSender = await deployArbitrumBridgeSender(hre, deployer, gatewayRouter, crv, l1Crv);

        const result = { bridgeSender };
        logContracts(result as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:L2:bridgeSender:optimism")
    .addParam("wait", "wait for blocks")
    .addParam("canonicalchainid", "Canonical chain ID, eg Eth Mainnet is 1")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const canonicalChainId = Number(tskArgs.canonicalchainid);
        const { canonicalConfig, sidechainConfig } = sidechainTaskSetup(deployer, hre.network, canonicalChainId);

        const standardBridge = sidechainConfig.bridging.nativeBridge;
        const crv = sidechainConfig.extConfig.token;
        const l1Crv = canonicalConfig.addresses.token;

        const bridgeSender = await deployOptimismBridgeSender(hre, deployer, standardBridge, crv, l1Crv);

        const result = { bridgeSender };
        logContracts(result as unknown as { [key: string]: { address: string } });
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
            sidechainConfig.bridging,
            canonical,
            lzChainIds[canonicalChainId],
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

const setupCanonicalTask = (deployer: Signer, network: HardhatRuntimeEnvironment["network"], sidechainId: number) => {
    assert(canonicalChains.includes(network.config.chainId), "Must be canonical chain");
    assert(sideChains.includes(sidechainId), "Must be sidechain chain");

    const canonicalConfig = canonicalConfigs[network.config.chainId];
    assert(canonicalConfig, `Local config for chain ID ${network.config.chainId} not found`);

    const sidechainConfig = sidechainConfigs[sidechainId];
    assert(sidechainConfig, `Remote config for chain ID ${sidechainId} not found`);
    const sidechainLzChainId = lzChainIds[sidechainId];
    assert(sidechainLzChainId, "LZ chain ID not found");

    const canonical = canonicalConfig.getSidechain(deployer);
    const remote = sidechainConfig.getSidechain(deployer);

    return { canonical, remote, sidechainLzChainId, canonicalConfig };
};

task("deploy:sidechain:config:L1:phase1")
    .addParam("dryrun", "Should dry run")
    .addParam("wait", "Wait for blocks")
    .addParam("sidechainid", "Remote standard chain ID, eg Eth Mainnet is 1")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        // NOTICE: This task can only be run for the first deployment, future deployments
        // will have to be triggered via the protocol DAO which will be the owner
        // of the mainnet sidechain deployment
        const deployer = await getSigner(hre);
        const sidechainId = Number(tskArgs.sidechainid);
        const sidechainConfig = sidechainConfigs[sidechainId];

        const { canonicalConfig, remote, sidechainLzChainId, canonical } = setupCanonicalTask(
            deployer,
            hre.network,
            sidechainId,
        );

        if (tskArgs.dryrun) {
            console.log(
                "AuraProxyOFT.setTrustedRemote:",
                canonical.auraProxyOFT.address,
                "Sidechain ID:",
                sidechainLzChainId,
                "Trusted remote:",
                ethers.utils.solidityPack(
                    ["address", "address"],
                    [remote.auraOFT.address, canonical.auraProxyOFT.address],
                ),
            );

            console.log(
                "L1Coordinator.setTrustedRemote:",
                canonical.l1Coordinator.address,
                "Sidechain ID:",
                sidechainLzChainId,
                "Trusted remote:",
                ethers.utils.solidityPack(
                    ["address", "address"],
                    [remote.l2Coordinator.address, canonical.l1Coordinator.address],
                ),
            );

            console.log(
                "L1Coordinator.setBridgeDelegate",
                canonical.l1Coordinator.address,
                "Sidechain ID:",
                sidechainLzChainId,
                "Bridge:",
                sidechainConfig.bridging.l1Receiver,
            );

            console.log(
                "L1Coordinator.setL2Coordinator",
                canonical.l1Coordinator.address,
                "Sidechain ID:",
                sidechainLzChainId,
                "L2Coordinator:",
                remote.l2Coordinator.address,
            );
        } else {
            await setTrustedRemoteCanonicalPhase1(
                canonical,
                remote,
                sidechainLzChainId,
                canonicalConfig.multisigs,
                sidechainConfigs[sidechainId].bridging,
                debug,
                tskArgs.wait,
            );
        }
    });

task("deploy:sidechain:config:L1:phase2")
    .addParam("wait", "Wait for blocks")
    .addParam("sidechainid", "Remote standard chain ID, eg Eth Mainnet is 1")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        // NOTICE: This task can only be run for the first deployment, future deployments
        // will have to be triggered via the protocol DAO which will be the owner
        // of the mainnet sidechain deployment
        const deployer = await getSigner(hre);
        const sidechainId = Number(tskArgs.sidechainid);

        const { canonicalConfig, canonical, remote, sidechainLzChainId } = setupCanonicalTask(
            deployer,
            hre.network,
            sidechainId,
        );

        await setTrustedRemoteCanonicalPhase2(
            canonical,
            remote,
            sidechainLzChainId,
            canonicalConfig.multisigs,
            debug,
            tskArgs.wait,
        );
    });

/* ----------------------------------------------------------------------------
    Helper Tasks
---------------------------------------------------------------------------- */

task("deploy:sidechain:auraDistributor")
    .addParam("wait", "Wait for blocks")
    .addParam("canonicalchainid", "Wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const canonicalId = Number(tskArgs.canonicalchainid);
        const canonicalConfig = canonicalConfigs[canonicalId];
        const canonical = canonicalConfig.getSidechain(deployer);

        const result = await deployAuraDistributor(
            canonicalConfig.addresses,
            canonicalConfig.multisigs,
            canonical,
            hre,
            deployer,
            debug,
            tskArgs.wait,
        );

        logContracts(result as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:keeperMulticall3")
    .addParam("wait", "Wait for blocks")
    .addParam("canonicalchainid", "Wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const canonicalId = Number(tskArgs.canonicalchainid);

        const { sidechainConfig } = sidechainTaskSetup(deployer, hre.network, canonicalId);

        const result = await deployKeeperMulticall3(hre, deployer, sidechainConfig.extConfig);

        logContracts(result as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:zap")
    .addParam("wait", "Wait for blocks")
    .addParam("canonicalchainid", "Wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const canonicalId = Number(tskArgs.canonicalchainid);

        const { sidechain, sidechainConfig } = sidechainTaskSetup(deployer, hre.network, canonicalId);

        const result = await deploySidechainClaimZap(
            sidechainConfig.extConfig,
            sidechain,
            hre,
            deployer,
            debug,
            tskArgs.wait,
        );

        logContracts(result as unknown as { [key: string]: { address: string } });
    });

task("deploy:sidechain:safe")
    .addParam("wait", "Wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);

        // Safe factory address for all networks
        const safeFactoryAddress = "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
        // Gnosis safe L2 singleton
        const singleton = "0x3e5c63644e683549055b9be8653de26e0b4cd36e";
        const fallbackHandler = "0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4";
        const salt = 8888;
        const threshold = 4;

        // Treasury
        // const addresses = [
        //     "0x2BE293361aEA6136a42036Ef68FF248fC379b4f8",
        //     "0x3dB7FCD09cF12df1b8978ddf66F8bbF9f039eDd8",
        //     "0x71df067D1d2dF5291278b7C660Fd37d9b6272b4C",
        //     "0xC02ad7b9a9121fc849196E844DC869D2250DF3A6",
        //     "0xB65c1Ab1bF106F86a363dC10230a4AF11cCD063E",
        //     "0x4Ab5E3F0b2d1604dD2002CfEcA6163802D74c6Cb",
        //     "0x337F8f3316E1326B3188E534913F759460bd57CB",
        // ];

        // Protocol DAO
        const addresses = [
            "0x2BE293361aEA6136a42036Ef68FF248fC379b4f8",
            "0x82621E3a9584013B166f6939677Df67793530C7B",
            "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
            "0x512fce9B07Ce64590849115EE6B32fd40eC0f5F3",
            "0xF01Cc7154e255D20489E091a5aEA10Bc136696a8",
            "0x6429602699fEC6D205e0b9531C7f33476BA11Fb0",
            "0x6c97fd6eCCa478E2163920eC9bdb68873a4c3B43",
        ];

        const safeFactory = new ethers.Contract(
            safeFactoryAddress,
            [
                "event ProxyCreation(address indexed proxy, address singleton)",
                "function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce) public returns (address)",
                "function setup( address[] calldata _owners, uint256 _threshold, address to, bytes calldata data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver ) external",
            ],
            deployer,
        );

        const initializer = safeFactory.interface.encodeFunctionData("setup", [
            addresses,
            threshold,
            ZERO_ADDRESS, // to
            "0x", // data
            fallbackHandler,
            ZERO_ADDRESS, // paymentToken
            0, // payment
            ZERO_ADDRESS, // paymentReceiver
        ]);

        const tx = await safeFactory.createProxyWithNonce(singleton, initializer, salt, {
            gasPrice: 500000000000,
        });
        const resp = await waitForTx(tx, debug, tskArgs.wait);
        const address = ethers.utils.defaultAbiCoder.decode(["address", "address"], resp.events[1].data)[0];

        console.log("Safe deployed to:", address);
    });

task("deploy:sidechain:L2:view")
    .addParam("wait", "Blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const remoteChainId = hre.network.config.chainId;
        const sidechainConfig = sidechainConfigs[remoteChainId].getSidechain(deployer);
        const result = await deploySidechainView(
            lzChainIds[remoteChainId],
            sidechainConfig,
            hre,
            deployer,
            true,
            tskArgs.wait,
        );
        console.log("sidechainView:", result.sidechainView.address);
    });

task("deploy:sidechain:L1:view")
    .addParam("wait", "Blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const deployer = await getSigner(hre);
        const chainId = hre.network.config.chainId;
        const canonicalConfig = canonicalConfigs[chainId];
        const ext = canonicalConfig.addresses;
        const phase2 = await canonicalConfig.getPhase2(deployer);
        const canonical = canonicalConfig.getSidechain(deployer);
        const vault = await canonicalConfig.getAuraBalVault(deployer);
        const result = await deployCanonicalView(ext, phase2, vault, canonical, hre, deployer, true, tskArgs.wait);
        console.log("canonicalView:", result.canonicalView.address);
    });

task("sidechain:addresses")
    .addOptionalParam("chainId", "The chain ID, default arbitrumGoerli")
    .setAction(async function (_: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const configs = {
            [chainIds.goerli]: goerliSidechainConfig,
            [chainIds.gnosis]: gnosisSidechainConfig,
        };

        const config = configs[hre.network.config.chainId];

        if (!config) {
            throw new Error(`Config for chain ID ${hre.network.config.chainId} not found`);
        }

        const { extConfig, naming, multisigs } = config;
        const SALT = "berlin";

        // SidechainPhase1Deployed
        const voterProxyAddress = await computeCreate2Address<VoterProxyLite__factory>(
            extConfig.create2Factory,
            new VoterProxyLite__factory(deployer),
            SALT,
            [],
        );

        const auraOFTAddress = await computeCreate2Address<AuraOFT__factory>(
            extConfig.create2Factory,
            new AuraOFT__factory(deployer),
            SALT,
            [naming.auraOftName, naming.auraOftSymbol, multisigs.pauseGuardian, extConfig.canonicalChainId],
        );

        const l2CoordinatorAddress = await computeCreate2Address<L2Coordinator__factory>(
            extConfig.create2Factory,
            new L2Coordinator__factory(deployer),
            SALT,
            [auraOFTAddress, extConfig.canonicalChainId],
        );

        const boosterAddress = await computeCreate2Address<BoosterLite__factory>(
            extConfig.create2Factory,
            new BoosterLite__factory(deployer),
            SALT,
            [voterProxyAddress],
        );

        // Not a constant address
        const rewardFactoryAddress = await computeCreate2Address<RewardFactory__factory>(
            extConfig.create2Factory,
            new RewardFactory__factory(deployer),
            SALT,
            [boosterAddress, extConfig.token],
        );

        const tokenFactoryAddress = await computeCreate2Address<TokenFactory__factory>(
            extConfig.create2Factory,
            new TokenFactory__factory(deployer),
            SALT,
            [boosterAddress, naming.tokenFactoryNamePostfix, naming.auraOftName.toLowerCase()],
        );

        const proxyFactoryAddress = await computeCreate2Address<ProxyFactory__factory>(
            extConfig.create2Factory,
            new ProxyFactory__factory(deployer),
            SALT,
            [],
        );

        // Not a constant address
        const stashFactoryAddress = await computeCreate2Address<StashFactoryV2__factory>(
            extConfig.create2Factory,
            new StashFactoryV2__factory(deployer),
            SALT,
            [boosterAddress, rewardFactoryAddress, proxyFactoryAddress],
        );

        // Not a constant address
        const stashV3Address = await computeCreate2Address<ExtraRewardStashV3__factory>(
            extConfig.create2Factory,
            new ExtraRewardStashV3__factory(deployer),
            SALT,
            [extConfig.token],
        );

        const poolManagerAddress = await computeCreate2Address<PoolManagerLite__factory>(
            extConfig.create2Factory,
            new PoolManagerLite__factory(deployer),
            SALT,
            [boosterAddress],
        );

        // Not a constant address
        const boosterOwnerAddress = await computeCreate2Address<BoosterOwnerLite__factory>(
            extConfig.create2Factory,
            new BoosterOwnerLite__factory(deployer),
            SALT,
            [multisigs.daoMultisig, poolManagerAddress, boosterAddress, stashFactoryAddress, ZERO_ADDRESS, true],
        );

        //

        const auraBalOFTAddress = await computeCreate2Address<AuraBalOFT__factory>(
            extConfig.create2Factory,
            new AuraBalOFT__factory(deployer),
            SALT,
            [naming.auraBalOftName, naming.auraBalOftSymbol, multisigs.pauseGuardian],
        );
        const virtualRewardFactoryAddress = await computeCreate2Address<VirtualRewardFactory__factory>(
            extConfig.create2Factory,
            new VirtualRewardFactory__factory(deployer),
            SALT,
            [],
        );
        const auraBalVaultAddress = await computeCreate2Address<AuraBalVault__factory>(
            extConfig.create2Factory,
            new AuraBalVault__factory(deployer),
            SALT,
            [auraBalOFTAddress, virtualRewardFactoryAddress],
        );

        const auraBalStrategyAddress = await computeCreate2Address<SimpleStrategy__factory>(
            extConfig.create2Factory,
            new SimpleStrategy__factory(deployer),
            SALT,
            [auraBalOFTAddress, auraBalVaultAddress],
        );

        const deployed = {
            "--SidechainPhase1--": "------------------------------------------",
            auraOFTAddress,
            boosterAddress,
            boosterOwnerAddress,
            l2CoordinatorAddress,
            voterProxyAddress,
            poolManagerAddress,
            proxyFactoryAddress,
            stashFactoryAddress,
            tokenFactoryAddress,
            stashV3Address,
            "--SidechainPhase2--": "------------------------------------------",
            auraBalOFTAddress,
            auraBalVaultAddress,
            auraBalStrategyAddress,
            virtualRewardFactoryAddress,
        };

        Object.keys(deployed).forEach(key => {
            console.log(`${key}:`.padEnd(30, " "), deployed[key]);
        });
    });

task("deploy:sidechain:L2:bridgeSender:polygon")
    .addParam("wait", "wait for blocks")
    .addParam("canonicalchainid", "Canonical chain ID, eg Eth Mainnet is 1")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const canonicalChainId = Number(tskArgs.canonicalchainid);
        const { sidechainConfig } = sidechainTaskSetup(deployer, hre.network, canonicalChainId);

        const crv = sidechainConfig.extConfig.token;

        const bridgeSender = await deploPolygonBridgeSender(hre, deployer, crv);

        const result = { bridgeSender };
        logContracts(result as unknown as { [key: string]: { address: string } });
    });
