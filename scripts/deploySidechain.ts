import { ContractTransaction, ethers, Signer } from "ethers";
import { toUtf8Bytes } from "ethers/lib/utils";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { AuraBalVaultDeployed } from "tasks/deploy/mainnet-config";

import { deployContract, deployContractWithCreate2, waitForTx } from "../tasks/utils/deploy-utils";
import { ZERO_ADDRESS } from "../test-utils/constants";
import {
    AuraBalOFT,
    AuraBalOFT__factory,
    AuraBalProxyOFT,
    AuraBalProxyOFT__factory,
    AuraBalVault,
    AuraBalVault__factory,
    AuraDistributor,
    AuraDistributor__factory,
    AuraLocker,
    AuraLocker__factory,
    AuraOFT,
    AuraOFT__factory,
    AuraProxyOFT,
    AuraProxyOFT__factory,
    AuraViewHelpersLite,
    AuraViewHelpersLite__factory,
    BoosterLite,
    BoosterLite__factory,
    BoosterOwnerLite,
    BoosterOwnerLite__factory,
    CanonicalView,
    CanonicalView__factory,
    ChildGaugeVoteRewards,
    ChildGaugeVoteRewards__factory,
    Create2Factory,
    Create2Factory__factory,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    GaugeVoteRewards,
    GaugeVoteRewards__factory,
    KeeperMulticall3,
    KeeperMulticall3__factory,
    L1Coordinator,
    L1Coordinator__factory,
    L2Coordinator,
    L2Coordinator__factory,
    PoolManagerLite,
    PoolManagerLite__factory,
    ProxyFactory,
    ProxyFactory__factory,
    RewardFactory,
    RewardFactory__factory,
    RewardPoolDepositWrapper,
    RewardPoolDepositWrapper__factory,
    SidechainClaimZap,
    SidechainClaimZap__factory,
    SidechainView,
    SidechainView__factory,
    SimpleStrategy,
    SimpleStrategy__factory,
    StashFactoryV2,
    StashFactoryV2__factory,
    StashRewardDistro,
    StashRewardDistro__factory,
    TokenFactory,
    TokenFactory__factory,
    VirtualRewardFactory,
    VirtualRewardFactory__factory,
    VoterProxyLite,
    VoterProxyLite__factory,
} from "../types";
import {
    ExtSidechainConfig,
    SidechainBridging,
    SidechainMultisigConfig,
    SidechainNaming,
    SidechainPhaseDeployed,
} from "../types/sidechain-types";
import { ExtSystemConfig, MultisigConfig, Phase2Deployed, Phase6Deployed } from "./deploySystem";

const SALT = "berlin";

export interface CanonicalPhase1Deployed {
    auraProxyOFT: AuraProxyOFT;
    l1Coordinator: L1Coordinator;
}
export interface CanonicalPhase2Deployed {
    auraBalProxyOFT: AuraBalProxyOFT;
}
export interface CanonicalPhase3Deployed {
    stashRewardDistro: StashRewardDistro;
    gaugeVoteRewards: GaugeVoteRewards;
}
interface Factories {
    rewardFactory: RewardFactory;
    stashFactory: StashFactoryV2;
    tokenFactory: TokenFactory;
    proxyFactory: ProxyFactory;
}

export interface SidechainPhase1Deployed {
    voterProxy: VoterProxyLite;
    booster: BoosterLite;
    keeperMulticall3: KeeperMulticall3;
    boosterOwner: BoosterOwnerLite;
    factories: Factories;
    poolManager: PoolManagerLite;
    l2Coordinator: L2Coordinator;
    auraOFT: AuraOFT;
}

export interface SidechainPhase2Deployed {
    auraBalOFT: AuraBalOFT;
    virtualRewardFactory: VirtualRewardFactory;
    auraBalVault: AuraBalVault;
    auraBalStrategy: SimpleStrategy;
}
export interface SidechainPhase3Deployed {
    stashRewardDistro: StashRewardDistro;
    childGaugeVoteRewards: ChildGaugeVoteRewards;
}
export interface SidechainViewDeployed {
    sidechainView: SidechainView;
}

export interface CanonicalViewDeployed {
    canonicalView: CanonicalView;
}
export interface SidechainPeripheralsDeployed {
    keeperMulticall3: KeeperMulticall3;
    sidechainClaimZap: SidechainClaimZap;
    sidechainView: SidechainView;
    rewardDepositWrapper: RewardPoolDepositWrapper;
}

export async function deployCanonicalPhase1(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    multisigs: MultisigConfig,
    config: ExtSystemConfig,
    phase2: Phase2Deployed,
    phase6: Phase6Deployed,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<CanonicalPhase1Deployed> {
    // -----------------------------
    // Post:
    //     Protocol DAO : l1Booster.setBridgeDelegate(l1Coordinator.address);
    //     Protocol DAO : l1Coordinator.setBridgeDelegate(sidechainLzChainId, bridgeDelegateReceiver.address);
    //     Protocol DAO : l1Coordinator.setL2Coordinator(sidechainLzChainId, sidechain.l2Coordinator.address);
    // -----------------------------

    const auraProxyOFT = await deployContract<AuraProxyOFT>(
        hre,
        new AuraProxyOFT__factory(deployer),
        "AuraProxyOFT",
        [
            config.lzEndpoint,
            phase2.cvx.address,
            phase2.cvxLocker.address,
            multisigs.pauseGuardian,
            multisigs.sudoMultisig,
            config.sidechain.auraInflowLimit,
        ],
        {},
        debug,
        waitForBlocks,
    );

    const l1Coordinator = await deployContract<L1Coordinator>(
        hre,
        new L1Coordinator__factory(deployer),
        "L1Coordinator",
        [
            config.lzEndpoint,
            phase6.booster.address,
            config.token,
            phase2.cvx.address,
            auraProxyOFT.address,
            multisigs.treasuryMultisig,
        ],
        {},
        debug,
        waitForBlocks,
    );

    return { auraProxyOFT, l1Coordinator };
}

export async function deployCanonicalPhase2(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    multisigs: MultisigConfig,
    config: ExtSystemConfig,
    phase2: Phase2Deployed,
    auraBalVault: AuraBalVaultDeployed,
    canonicalPhase1: CanonicalPhase1Deployed,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<CanonicalPhase2Deployed> {
    const auraBalProxyOFT = await deployContract<AuraBalProxyOFT>(
        hre,
        new AuraBalProxyOFT__factory(deployer),
        "AuraBalProxyOFT",
        [
            config.lzEndpoint,
            phase2.cvxCrv.address,
            auraBalVault.vault.address,
            multisigs.pauseGuardian,
            multisigs.sudoMultisig,
            config.sidechain.auraBalInflowLimit,
        ],
        {},
        debug,
        waitForBlocks,
    );

    let tx = await auraBalProxyOFT.setOFT(phase2.cvxCrv.address, auraBalProxyOFT.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await auraBalProxyOFT.setOFT(phase2.cvx.address, canonicalPhase1.auraProxyOFT.address);
    await waitForTx(tx, debug, waitForBlocks);

    if (!multisigs.defender?.auraBalProxyOFTHarvestor) {
        throw new Error("auraBalProxyOFTHarvestor not set");
    }

    tx = await auraBalProxyOFT.updateAuthorizedHarvesters(multisigs.defender?.auraBalProxyOFTHarvestor, true);
    await waitForTx(tx, debug, waitForBlocks);

    return { auraBalProxyOFT };
}
export async function deployCanonicalPhase3(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    multisigs: MultisigConfig,
    extConfig: ExtSystemConfig,
    phase2: Phase2Deployed,
    phase6: Phase6Deployed,
    canonicalPhase1: CanonicalPhase1Deployed,
    canonicalLzChainId: number,
    debug = false,
    waitForBlocks = 0,
): Promise<CanonicalPhase3Deployed> {
    const stashRewardDistro = await deployContract<StashRewardDistro>(
        hre,
        new StashRewardDistro__factory(signer),
        "StashRewardDistro",
        [phase6.booster.address],
        {},
        debug,
        waitForBlocks,
    );

    const gaugeVoteRewards = await deployContract<GaugeVoteRewards>(
        hre,
        new GaugeVoteRewards__factory(signer),
        "GaugeVoteRewards",
        [
            phase2.cvx.address,
            canonicalPhase1.auraProxyOFT.address,
            phase6.booster.address,
            stashRewardDistro.address,
            canonicalLzChainId,
            extConfig.lzEndpoint,
        ],
        {},
        debug,
        waitForBlocks,
    );

    return {
        stashRewardDistro,
        gaugeVoteRewards,
    };
}
/**
 * Deploys the Sidechain system contracts.
 *  - Deploys with the same address across all chains the following contracts.
 *      - AuraOFT
 *      - VoterProxyLite
 *      - BoosterLite
 *      - TokenFactory
 *      - ProxyFactory
 *      - PoolManagerLite
 *      - L2Coordinator
 *      - BoosterOwnerLite
 *
 *  - Deploys with the different address the following contracts.
 *      - RewardFactory
 *      - StashFactoryV2
 *      - ExtraRewardStashV3
 *
 * @param {HardhatRuntimeEnvironment} hre - The Hardhat runtime environment
 * @param {Signer} deployer - The deployer signer
 * @param {SidechainNaming} naming - Naming configuration.
 * @param {SidechainMultisigConfig} multisigs - List of Sidechain multisigs addresses
 * @param {ExtSidechainConfig} extConfig - The external Sidechain configuration
 * @param {boolean} debug - Weather console log or not the details of the tx
 * @param {number} waitForBlocks - Number of blocks to wait after the deployment of each contract.
 */
export async function deploySidechainPhase1(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    naming: SidechainNaming,
    multisigs: SidechainMultisigConfig,
    extConfig: ExtSidechainConfig,
    bridging: SidechainBridging,
    canonical: CanonicalPhase1Deployed,
    canonicalLzChainId: number,
    salt: string = SALT,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<SidechainPhase1Deployed> {
    const deployerAddress = await deployer.getAddress();

    // -----------------------------
    // Pre-1:  Deploy create2Factory
    //         Protocol DAO : creat12Factory.updateDeployer(deployer.address, true);
    //         Protocol DAO : booster.bridgeDelegate(l1Coordinator.address)
    // -----------------------------
    // 1. Sidechain system:
    //     - voterProxy
    //     - cvx (coordinator)
    //     - boosterLite
    //     - factories (reward, token, proxy, stash)
    //     - pool management (poolManager + boosterOwner)
    // -----------------------------
    // -----------------------------
    // Post-1: L1 add trusted remotes to layerzero endpoints
    //         @see setTrustedRemoteCanonical()
    //         Protocol DAO : 1Coordinator.setTrustedRemote(L2_CHAIN_ID, [l2Coordinator.address, l1Coordinator.address]);
    //         Protocol DAO : auraProxyOFT.setTrustedRemote(L2_CHAIN_ID, [auraOFT.address, auraProxyOFT.address]);
    //         Protocol DAO : auraProxyOFT.setTrustedRemote(L2_CHAIN_ID, [auraBalOFT.address, auraBalProxyOFT.address]);
    //         Protocol DAO : l2Coordinator.setTrustedRemote(L1_CHAIN_ID, [l1Coordinator.address, l2Coordinator.address]);
    //         Protocol DAO : auraOFT.setTrustedRemote(L1_CHAIN_ID, [auraProxyOFT.address, auraOFT.address]);
    //         Deployer: keeperMulticall3.updateAuthorizedKeepers(keeperAddress)
    //         Deployer: keeperMulticall3.transferOwnership(protocolDAO.address)
    // -----------------------------

    const create2Options = { amount: 0, salt, callbacks: [] };
    const deployOptions = {
        overrides: {},
        create2Options,
        debug,
        waitForBlocks,
    };
    const deployOptionsWithCallbacks = (callbacks: string[]) => ({
        ...deployOptions,
        create2Options: {
            ...create2Options,
            callbacks: [...callbacks],
        },
    });

    const create2Factory = Create2Factory__factory.connect(extConfig.create2Factory, deployer);
    const voterProxyInitialize = VoterProxyLite__factory.createInterface().encodeFunctionData("initialize", [
        extConfig.minter,
        extConfig.token,
        deployerAddress,
    ]);
    const voterProxy = await deployContractWithCreate2<VoterProxyLite, VoterProxyLite__factory>(
        hre,
        create2Factory,
        new VoterProxyLite__factory(deployer),
        "VoterProxyLite",
        [],
        deployOptionsWithCallbacks([voterProxyInitialize]),
    );

    const auraOFTInitialize = AuraOFT__factory.createInterface().encodeFunctionData("initialize", [
        extConfig.lzEndpoint,
        multisigs.pauseGuardian,
    ]);

    const auraOFTTransferOwnership = AuraOFT__factory.createInterface().encodeFunctionData("transferOwnership", [
        deployerAddress,
    ]);
    const auraOFT = await deployContractWithCreate2<AuraOFT, AuraOFT__factory>(
        hre,
        create2Factory,
        new AuraOFT__factory(deployer),
        "AuraOFT",
        [naming.auraOftName, naming.auraOftSymbol, extConfig.canonicalChainId],
        deployOptionsWithCallbacks([auraOFTInitialize, auraOFTTransferOwnership]),
    );

    const l2CoordinatorTransferOwnership = L2Coordinator__factory.createInterface().encodeFunctionData(
        "transferOwnership",
        [deployerAddress],
    );
    const l2Coordinator = await deployContractWithCreate2<L2Coordinator, L2Coordinator__factory>(
        hre,
        create2Factory,
        new L2Coordinator__factory(deployer),
        "L2Coordinator",
        [auraOFT.address, extConfig.canonicalChainId],
        deployOptionsWithCallbacks([l2CoordinatorTransferOwnership]),
    );
    const cvxTokenAddress = l2Coordinator.address;

    const boosterLiteInitialize = BoosterLite__factory.createInterface().encodeFunctionData("initialize", [
        cvxTokenAddress,
        extConfig.token,
        deployerAddress,
    ]);
    const booster = await deployContractWithCreate2<BoosterLite, BoosterLite__factory>(
        hre,
        create2Factory,
        new BoosterLite__factory(deployer),
        "BoosterLite",
        [voterProxy.address],
        deployOptionsWithCallbacks([boosterLiteInitialize]),
    );

    const keeperMulticall3 = await deployContractWithCreate2<KeeperMulticall3, KeeperMulticall3__factory>(
        hre,
        create2Factory,
        new KeeperMulticall3__factory(deployer),
        "KeeperMulticall3",
        [deployerAddress],
        deployOptions,
    );

    // Not a constant address
    const rewardFactory = await deployContractWithCreate2<RewardFactory, RewardFactory__factory>(
        hre,
        create2Factory,
        new RewardFactory__factory(deployer),
        "RewardFactory",
        [booster.address, extConfig.token],
        deployOptions,
    );
    const tokenFactory = await deployContractWithCreate2<TokenFactory, TokenFactory__factory>(
        hre,
        create2Factory,
        new TokenFactory__factory(deployer),
        "TokenFactory",
        [booster.address, naming.tokenFactoryNamePostfix, naming.auraOftName.toLowerCase()],
        deployOptions,
    );
    const proxyFactory = await deployContractWithCreate2<ProxyFactory, ProxyFactory__factory>(
        hre,
        create2Factory,
        new ProxyFactory__factory(deployer),
        "ProxyFactory",
        [],
        deployOptions,
    );
    // Not a constant address
    const stashFactory = await deployContractWithCreate2<StashFactoryV2, StashFactoryV2__factory>(
        hre,
        create2Factory,
        new StashFactoryV2__factory(deployer),
        "StashFactory",
        [booster.address, rewardFactory.address, proxyFactory.address],
        deployOptions,
    );
    // Not a constant address
    const stashV3 = await deployContractWithCreate2<ExtraRewardStashV3, ExtraRewardStashV3__factory>(
        hre,
        create2Factory,
        new ExtraRewardStashV3__factory(deployer),
        "ExtraRewardStashV3",
        [extConfig.token],
        deployOptions,
    );

    const poolManagerSetOperator = PoolManagerLite__factory.createInterface().encodeFunctionData("setOperator", [
        multisigs.daoMultisig,
    ]);
    const poolManager = await deployContractWithCreate2<PoolManagerLite, PoolManagerLite__factory>(
        hre,
        create2Factory,
        new PoolManagerLite__factory(deployer),
        "PoolManagerLite",
        [booster.address],
        deployOptionsWithCallbacks([poolManagerSetOperator]),
    );
    // Not a constant address
    const boosterOwner = await deployContractWithCreate2<BoosterOwnerLite, BoosterOwnerLite__factory>(
        hre,
        create2Factory,
        new BoosterOwnerLite__factory(deployer),
        "BoosterOwnerLite",
        [multisigs.daoMultisig, poolManager.address, booster.address, stashFactory.address, ZERO_ADDRESS, true],
        deployOptions,
    );

    let tx: ContractTransaction;

    tx = await l2Coordinator.initialize(booster.address, extConfig.token, extConfig.lzEndpoint);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await l2Coordinator.setTrustedRemote(
        canonicalLzChainId,
        ethers.utils.solidityPack(["address", "address"], [canonical.l1Coordinator.address, l2Coordinator.address]),
    );
    await waitForTx(tx, debug, waitForBlocks);

    tx = await l2Coordinator.setBridgeDelegate(bridging.l2Sender);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await l2Coordinator.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await auraOFT.setTrustedRemote(
        canonicalLzChainId,
        ethers.utils.solidityPack(["address", "address"], [canonical.auraProxyOFT.address, auraOFT.address]),
    );
    await waitForTx(tx, debug, waitForBlocks);

    const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 600_000]);
    const lockSelector = ethers.utils.keccak256(toUtf8Bytes("lock(address,uint256,address)"));

    tx = await auraOFT.setAdapterParams(canonicalLzChainId, lockSelector, adapterParams);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await auraOFT.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await voterProxy.setOperator(booster.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await stashFactory.setImplementation(ZERO_ADDRESS, ZERO_ADDRESS, stashV3.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await voterProxy.setOwner(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setRewardContracts(l2Coordinator.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setPoolManager(poolManager.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFactories(rewardFactory.address, stashFactory.address, tokenFactory.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFeeManager(deployerAddress);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFees(1850, 400, 50, 200);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFeeManager(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setOwner(boosterOwner.address);
    await waitForTx(tx, debug, waitForBlocks);

    return {
        voterProxy,
        booster,
        keeperMulticall3,
        boosterOwner,
        factories: {
            rewardFactory,
            stashFactory,
            tokenFactory,
            proxyFactory,
        },
        poolManager,
        auraOFT,
        l2Coordinator,
    };
}

/**
 * Deploys the Sidechain system contracts.
 *  - Deploys with the same address across all chains the following contracts.
 *      - VoterProxyLite
 *      - BoosterLite
 *      - TokenFactory
 *      - ProxyFactory
 *      - PoolManagerLite
 *
 *  - Deploys with the different address the following contracts.
 *      - AuraOFT
 *      - Coordinator
 *      - RewardFactory
 *      - StashFactoryV2
 *      - ExtraRewardStashV3
 *      - BoosterOwnerLite
 *
 * @param {HardhatRuntimeEnvironment} hre - The Hardhat runtime environment
 * @param {Signer} deployer - The deployer signer
 * @param {SidechainNaming} naming - Naming configuration.
 * @param {SidechainMultisigConfig} multisigs - List of Sidechain multisigs addresses
 * @param {ExtSidechainConfig} extConfig - The external Sidechain configuration
 * @param {boolean} debug - Weather console log or not the details of the tx
 * @param {number} waitForBlocks - Number of blocks to wait after the deployment of each contract.
 */
export async function deploySidechainPhase2(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    naming: SidechainNaming,
    multisigs: SidechainMultisigConfig,
    extConfig: ExtSidechainConfig,
    canonical: CanonicalPhase2Deployed,
    phase1: SidechainPhase1Deployed,
    canonicalLzChainId: number,
    salt: string = SALT,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<SidechainPhase2Deployed> {
    const deployerAddress = await deployer.getAddress();

    // -----------------------------
    // Pre-1:  Deploy
    //     - Sidechain Phase1
    // -----------------------------
    // 1. Sidechain system:
    //     - auraBALOFT
    // -----------------------------
    // -----------------------------
    // Post-1: L1 add trusted remotes to layerzero endpoints
    //         Protocol DAO : auraBalOFT.setTrustedRemote(L1_CHAIN_ID, [auraBalProxyOFT.address, auraBalOFT.address]);
    // -----------------------------

    const create2Options = { amount: 0, salt, callbacks: [] };
    const deployOptions = {
        overrides: {},
        create2Options,
        debug,
        waitForBlocks,
    };
    const deployOptionsWithCallbacks = (callbacks: string[]) => ({
        ...deployOptions,
        create2Options: {
            ...create2Options,
            callbacks: [...callbacks],
        },
    });

    const create2Factory = Create2Factory__factory.connect(extConfig.create2Factory, deployer);

    const auraBalOFTInitialize = AuraBalOFT__factory.createInterface().encodeFunctionData("initialize", [
        extConfig.lzEndpoint,
        multisigs.pauseGuardian,
    ]);
    const auraBalOFTTransferOwnership = AuraBalOFT__factory.createInterface().encodeFunctionData("transferOwnership", [
        deployerAddress,
    ]);
    const auraBalOFT = await deployContractWithCreate2<AuraBalOFT, AuraBalOFT__factory>(
        hre,
        create2Factory,
        new AuraBalOFT__factory(deployer),
        "AuraBalOFT",
        [naming.auraBalOftName, naming.auraBalOftSymbol],
        deployOptionsWithCallbacks([auraBalOFTInitialize, auraBalOFTTransferOwnership]),
    );

    const virtualRewardFactory = await deployContractWithCreate2<VirtualRewardFactory, VirtualRewardFactory__factory>(
        hre,
        create2Factory,
        new VirtualRewardFactory__factory(deployer),
        "VirtualRewardFactory",
        [],
        deployOptions,
    );

    const auraBalVaultTransferOwnership = AuraBalVault__factory.createInterface().encodeFunctionData(
        "transferOwnership",
        [deployerAddress],
    );
    const auraBalVault = await deployContractWithCreate2<AuraBalVault, AuraBalVault__factory>(
        hre,
        create2Factory,
        new AuraBalVault__factory(deployer),
        "AuraBalVault",
        [auraBalOFT.address, virtualRewardFactory.address],
        deployOptionsWithCallbacks([auraBalVaultTransferOwnership]),
    );

    const auraBalStrategy = await deployContractWithCreate2<SimpleStrategy, SimpleStrategy__factory>(
        hre,
        create2Factory,
        new SimpleStrategy__factory(deployer),
        "SimpleStrategy",
        [auraBalOFT.address, auraBalVault.address],
        deployOptions,
    );

    let tx: ContractTransaction;

    tx = await auraBalVault.setStrategy(auraBalStrategy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await auraBalVault.setHarvestPermissions(false);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await auraBalVault.addExtraReward(phase1.auraOFT.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await auraBalOFT.setTrustedRemote(
        canonicalLzChainId,
        ethers.utils.solidityPack(["address", "address"], [canonical.auraBalProxyOFT.address, auraBalOFT.address]),
    );
    await waitForTx(tx, debug, waitForBlocks);

    tx = await auraBalOFT.setUseCustomAdapterParams(true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await auraBalOFT.setMinDstGas(canonicalLzChainId, await auraBalOFT.PT_SEND(), 500_000);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await auraBalOFT.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    return {
        auraBalOFT,
        virtualRewardFactory,
        auraBalVault,
        auraBalStrategy,
    };
}

export async function deployCreate2Factory(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
): Promise<{ create2Factory: Create2Factory }> {
    const create2Factory = await deployContract<Create2Factory>(
        hre,
        new Create2Factory__factory(signer),
        "Create2Factory",
        [],
        {},
        debug,
        waitForBlocks,
    );

    return { create2Factory };
}

export async function setTrustedRemoteCanonicalPhase1(
    canonical: CanonicalPhase1Deployed,
    sidechain: SidechainPhase1Deployed,
    sidechainLzChainId: number,
    multisigs: MultisigConfig,
    bridging: SidechainBridging,
    debug = false,
    waitForBlocks = 0,
) {
    let tx: ContractTransaction;

    tx = await canonical.l1Coordinator.setTrustedRemote(
        sidechainLzChainId,
        ethers.utils.solidityPack(
            ["address", "address"],
            [sidechain.l2Coordinator.address, canonical.l1Coordinator.address],
        ),
    );
    await waitForTx(tx, debug, waitForBlocks);

    tx = await canonical.auraProxyOFT.setTrustedRemote(
        sidechainLzChainId,
        ethers.utils.solidityPack(["address", "address"], [sidechain.auraOFT.address, canonical.auraProxyOFT.address]),
    );
    await waitForTx(tx, debug, waitForBlocks);

    tx = await canonical.l1Coordinator.setBridgeDelegate(sidechainLzChainId, bridging.l1Receiver);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await canonical.l1Coordinator.setL2Coordinator(sidechainLzChainId, sidechain.l2Coordinator.address);
    await waitForTx(tx, debug, waitForBlocks);

    if (!multisigs.defender?.l1CoordinatorDistributor) {
        throw new Error("No l1CoordinatorDistributor found in config");
    }

    tx = await canonical.l1Coordinator.setDistributor(multisigs.defender?.l1CoordinatorDistributor, true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await canonical.l1Coordinator.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await canonical.auraProxyOFT.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);
}

export async function setTrustedRemoteCanonicalPhase2(
    canonical: CanonicalPhase2Deployed,
    sidechain: SidechainPhase2Deployed,
    sidechainLzChainId: number,
    multisigs: MultisigConfig,
    debug = false,
    waitForBlocks = 0,
) {
    let tx = await canonical.auraBalProxyOFT.setTrustedRemote(
        sidechainLzChainId,
        ethers.utils.solidityPack(
            ["address", "address"],
            [sidechain.auraBalOFT.address, canonical.auraBalProxyOFT.address],
        ),
    );
    await waitForTx(tx, debug, waitForBlocks);

    tx = await canonical.auraBalProxyOFT.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);
}
export async function setTrustedRemoteCanonicalPhase3(
    canonical: CanonicalPhase3Deployed,
    sidechain: SidechainPhase3Deployed,
    sidechainLzChainId: number,
    multisigs: MultisigConfig,
    debug = false,
    waitForBlocks = 0,
) {
    let tx = await canonical.gaugeVoteRewards.setTrustedRemote(
        sidechainLzChainId,
        ethers.utils.solidityPack(
            ["address", "address"],
            [sidechain.childGaugeVoteRewards.address, canonical.gaugeVoteRewards.address],
        ),
    );
    await waitForTx(tx, debug, waitForBlocks);

    tx = await canonical.gaugeVoteRewards.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);
}

export async function deploySidechainClaimZap(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    extConfig: ExtSidechainConfig,
    sidechain: SidechainPhase1Deployed & SidechainPhase2Deployed,
    debug = false,
    waitForBlocks = 0,
    salt: string = SALT,
): Promise<{ sidechainClaimZap: SidechainClaimZap }> {
    const create2Options = { amount: 0, salt, callbacks: [] };
    const deployOptions = {
        overrides: {},
        create2Options,
        debug,
        waitForBlocks,
    };

    const deployOptionsWithCallbacks = (callbacks: string[]) => ({
        ...deployOptions,
        create2Options: {
            ...create2Options,
            callbacks: [...callbacks],
        },
    });

    const create2Factory = Create2Factory__factory.connect(extConfig.create2Factory, signer);

    const sidechainInitialize = SidechainClaimZap__factory.createInterface().encodeFunctionData("initialize", [
        await signer.getAddress(),
        sidechain.auraOFT.address,
        sidechain.auraBalOFT.address || ZERO_ADDRESS,
        sidechain.auraBalVault.address || ZERO_ADDRESS,
    ]);

    const sidechainClaimZap = await deployContractWithCreate2<SidechainClaimZap, SidechainClaimZap__factory>(
        hre,
        create2Factory,
        new SidechainClaimZap__factory(signer),
        "SidechainClaimZap",
        [],
        deployOptionsWithCallbacks([sidechainInitialize]),
    );
    if ((await sidechainClaimZap.cvxCrv()) !== ZERO_ADDRESS) {
        const tx = await sidechainClaimZap.setApprovals();
        await waitForTx(tx, debug, waitForBlocks);
    }

    return { sidechainClaimZap };
}

export async function deploySidechainView(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    sidechainId: number,
    sidechain: SidechainPhaseDeployed,
    debug = false,
    waitForBlocks = 0,
) {
    const sidechainView = await deployContract<SidechainView>(
        hre,
        new SidechainView__factory(signer),
        "SidechainView",
        [
            sidechainId,
            sidechain.l2Coordinator.address,
            sidechain.auraOFT.address,
            sidechain.auraBalOFT.address || ZERO_ADDRESS,
            sidechain.auraBalStrategy.address || ZERO_ADDRESS,
        ],
        {},
        debug,
        waitForBlocks,
    );
    const auraViewHelpers = await deployContract<AuraViewHelpersLite>(
        hre,
        new AuraViewHelpersLite__factory(signer),
        "AuraViewHelpersLite",
        [],
        {},
        debug,
        waitForBlocks,
    );
    return {
        sidechainView,
        auraViewHelpers,
    };
}

export async function deployCanonicalView(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    config: ExtSystemConfig,
    phase2: Phase2Deployed,
    aurabalVault: AuraBalVaultDeployed,
    canonical: CanonicalPhase1Deployed & CanonicalPhase2Deployed,
    debug = false,
    waitForBlocks = 0,
) {
    const canonicalView = await deployContract<CanonicalView>(
        hre,
        new CanonicalView__factory(signer),
        "CanonicalView",
        [
            phase2.cvx.address,
            canonical.auraProxyOFT.address,
            canonical.auraBalProxyOFT.address,
            phase2.cvxCrv.address,
            aurabalVault.vault.address,
            config.token,
            canonical.l1Coordinator.address,
        ],
        {},
        debug,
        waitForBlocks,
    );

    return {
        canonicalView,
    };
}

export async function deployKeeperMulticall3(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    extConfig: ExtSidechainConfig,
    salt: string = SALT,
    debug: boolean = false,
    waitForBlocks: number = 0,
) {
    const create2Options = { amount: 0, salt, callbacks: [] };
    const deployOptions = {
        overrides: {},
        create2Options,
        debug,
        waitForBlocks,
    };

    const create2Factory = Create2Factory__factory.connect(extConfig.create2Factory, deployer);

    const keeperMulticall3 = await deployContractWithCreate2<KeeperMulticall3, KeeperMulticall3__factory>(
        hre,
        create2Factory,
        new KeeperMulticall3__factory(deployer),
        "KeeperMulticall3",
        [await deployer.getAddress()],
        deployOptions,
    );

    return {
        keeperMulticall3,
    };
}

// Deployment on canonical chain
export async function deployCanonicalAuraDistributor(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    extConfig: ExtSystemConfig,
    multisigs: MultisigConfig,
    canonical: CanonicalPhase1Deployed,
    debug = false,
    waitForBlocks = 0,
) {
    const auraDistributor = await deployContract<AuraDistributor>(
        hre,
        new AuraDistributor__factory(signer),
        "AuraDistributor",
        [
            multisigs.treasuryMultisig,
            extConfig.token,
            canonical.l1Coordinator.address,
            multisigs.defender.l1CoordinatorDistributor,
        ],
        {},
        debug,
        waitForBlocks,
    );

    const tx = await auraDistributor.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    return {
        auraDistributor,
    };
}

/**
 *
 * Deploys all sidechain peripherals in one go:
 * - Multicall3
 * - SidechainClaimZap
 * - SidechainView
 * @see deployKeeperMulticall3
 * @see deploySidechainClaimZap
 * @see deploySidechainView
 * @export
 * @param {HardhatRuntimeEnvironment} hre
 * @param {Signer} signer
 * @param {number} sidechainLzChainId
 * @param {ExtSidechainConfig} extSidechainConfig
 * @param {SidechainPhaseDeployed} sidechain
 * @param {boolean} [debug=false]
 * @param {number} [waitForBlocks=0]
 * @param {*} [salt=SALT]
 * @returns {SidechainPeripheralsDeployed}
 */
export async function deploySidechainPeripherals(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    extSidechainConfig: ExtSidechainConfig,
    sidechain: SidechainPhaseDeployed,
    sidechainLzChainId: number,
    salt: string = SALT,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<SidechainPeripheralsDeployed> {
    const { keeperMulticall3 } = await deployKeeperMulticall3(
        hre,
        signer,
        extSidechainConfig,
        SALT,
        debug,
        waitForBlocks,
    );
    const { sidechainClaimZap } = await deploySidechainClaimZap(
        hre,
        signer,
        extSidechainConfig,
        sidechain,
        debug,
        waitForBlocks,
        salt,
    );
    const { sidechainView } = await deploySidechainView(
        hre,
        signer,
        sidechainLzChainId,
        sidechain,
        debug,
        waitForBlocks,
    );

    const rewardDepositWrapper = await deployContract<RewardPoolDepositWrapper>(
        hre,
        new RewardPoolDepositWrapper__factory(signer),
        "RewardPoolDepositWrapper",
        [extSidechainConfig.balancerVault],
        {},
        debug,
        waitForBlocks,
    );

    return {
        keeperMulticall3,
        sidechainClaimZap,
        sidechainView,
        rewardDepositWrapper,
    };
}

export async function deploySidechainPhase3(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    extConfig: ExtSidechainConfig,
    multisigs: SidechainMultisigConfig,
    sidechain: SidechainPhase1Deployed,
    salt: string = SALT,
    debug = false,
    waitForBlocks = 0,
): Promise<SidechainPhase3Deployed> {
    const create2Options = { amount: 0, salt, callbacks: [] };
    const deployOptions = {
        overrides: {},
        create2Options,
        debug,
        waitForBlocks,
    };
    const deployOptionsWithCallbacks = (callbacks: string[]) => ({
        ...deployOptions,
        create2Options: {
            ...create2Options,
            callbacks: [...callbacks],
        },
    });

    const create2Factory = Create2Factory__factory.connect(extConfig.create2Factory, signer);
    // stashRewardDistro
    const stashRewardDistro = await deployContractWithCreate2<StashRewardDistro, StashRewardDistro__factory>(
        hre,
        create2Factory,
        new StashRewardDistro__factory(signer),
        "StashRewardDistro",
        [sidechain.booster.address],
        deployOptions,
    );

    // ChildGaugeVoteRewards
    const childGaugeVoteRewardsTransferOwnership = ChildGaugeVoteRewards__factory.createInterface().encodeFunctionData(
        "transferOwnership",
        [multisigs.daoMultisig],
    );
    const childGaugeVoteRewardsInitialize = ChildGaugeVoteRewards__factory.createInterface().encodeFunctionData(
        "initialize",
        [extConfig.lzEndpoint],
    );

    const childGaugeVoteRewards = await deployContractWithCreate2<
        ChildGaugeVoteRewards,
        ChildGaugeVoteRewards__factory
    >(
        hre,
        create2Factory,
        new ChildGaugeVoteRewards__factory(signer),
        "ChildGaugeVoteRewards",
        [sidechain.auraOFT.address, sidechain.booster.address, stashRewardDistro.address],
        deployOptionsWithCallbacks([childGaugeVoteRewardsInitialize, childGaugeVoteRewardsTransferOwnership]),
    );

    return { stashRewardDistro, childGaugeVoteRewards };
}

export async function deploySidechainAuraLocker(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    naming: SidechainNaming,
    extConfig: ExtSidechainConfig,
    sidechain: SidechainPhase1Deployed,
    debug = false,
    waitForBlocks = 0,
    salt: string = SALT,
): Promise<{ cvxLocker: AuraLocker }> {
    const create2Options = { amount: 0, salt, callbacks: [] };
    const deployOptions = {
        overrides: {},
        create2Options,
        debug,
        waitForBlocks,
    };

    const deployOptionsWithCallbacks = (callbacks: string[]) => ({
        ...deployOptions,
        create2Options: {
            ...create2Options,
            callbacks: [...callbacks],
        },
    });

    const create2Factory = Create2Factory__factory.connect(extConfig.create2Factory, signer);

    const cvxLocker = await deployContractWithCreate2<AuraLocker, AuraLocker__factory>(
        hre,
        create2Factory,
        new AuraLocker__factory(signer),
        "AuraLocker",
        [naming.vlCvxName, naming.vlCvxSymbol, sidechain.auraOFT.address, ZERO_ADDRESS, ZERO_ADDRESS],
        deployOptionsWithCallbacks([]),
    );
    if ((await cvxLocker.cvxCrv()) !== ZERO_ADDRESS) {
        const tx = await cvxLocker.setApprovals();
        await waitForTx(tx, debug, waitForBlocks);
    }

    return { cvxLocker };
}
