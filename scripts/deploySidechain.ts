import { ContractTransaction, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
    AuraOFT,
    AuraOFT__factory,
    AuraProxyOFT,
    AuraProxyOFT__factory,
    BoosterLite,
    BoosterLite__factory,
    BoosterOwnerLite,
    BoosterOwnerLite__factory,
    L2Coordinator,
    L2Coordinator__factory,
    L1Coordinator,
    L1Coordinator__factory,
    Create2Factory,
    Create2Factory__factory,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    PoolManagerLite,
    PoolManagerLite__factory,
    ProxyFactory,
    ProxyFactory__factory,
    RewardFactory,
    RewardFactory__factory,
    StashFactoryV2,
    StashFactoryV2__factory,
    TokenFactory,
    TokenFactory__factory,
    VoterProxyLite,
    VoterProxyLite__factory,
    IGaugeController__factory,
    MockGaugeController,
} from "../types";
import { ExtSystemConfig, Phase2Deployed, Phase6Deployed } from "./deploySystem";
import { ZERO_ADDRESS } from "../test-utils/constants";
import { deployContract, deployContractWithCreate2, waitForTx } from "../tasks/utils";
import { ExtSidechainConfig, SidechainNaming, SidechainMultisigConfig } from "../types/sidechain-types";
import { simpleToExactAmount } from "../test-utils";

export interface CanonicalPhaseDeployed {
    auraProxyOFT: AuraProxyOFT;
    l1Coordinator: L1Coordinator;
}

export async function deployCanonicalPhase(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    config: ExtSystemConfig,
    phase2: Phase2Deployed,
    phase6: Phase6Deployed,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<CanonicalPhaseDeployed> {
    // -----------------------------
    // Post:
    //         Deployer : l1Coordinator.transferOwnership(multisigs.daoMultisig);
    // -----------------------------

    const auraProxyOFT = await deployContract<AuraProxyOFT>(
        hre,
        new AuraProxyOFT__factory(deployer),
        "AuraProxyOFT",
        [config.l1LzEndpoint, phase2.cvx.address, phase2.cvxLocker.address],
        {},
        debug,
        waitForBlocks,
    );

    const l1Coordinator = await deployContract<L1Coordinator>(
        hre,
        new L1Coordinator__factory(deployer),
        "L1Coordinator",
        [config.l1LzEndpoint, phase6.booster.address, config.token, phase2.cvx.address, auraProxyOFT.address],
        {},
        debug,
        waitForBlocks,
    );

    // const tx = await l1Coordinator.transferOwnership(multisigs.daoMultisig);
    // await waitForTx(tx, debug, waitForBlocks);
    // TODO - confirm with phry why it is not present the transfer of ownership
    return { auraProxyOFT, l1Coordinator };
}

interface Factories {
    rewardFactory: RewardFactory;
    stashFactory: StashFactoryV2;
    tokenFactory: TokenFactory;
    proxyFactory: ProxyFactory;
}

export interface SidechainDeployed {
    voterProxy: VoterProxyLite;
    booster: BoosterLite;
    boosterOwner: BoosterOwnerLite;
    factories: Factories;
    poolManager: PoolManagerLite;
    l2Coordinator: L2Coordinator;
    auraOFT: AuraOFT;
}
export interface SidechainPhase2Deployed extends SidechainDeployed {
    gaugeController: MockGaugeController;
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
 * @param {ExtSystemConfig} l1ExtConfig - L1 Configurations
 * @param {SidechainNaming} naming - Naming configuration.
 * @param {SidechainMultisigConfig} multisigs - List of Sidechain multisigs addresses
 * @param {ExtSidechainConfig} extConfig - The external Sidechain configuration
 * @param {boolean} debug - Weather console log or not the details of the tx
 * @param {number} waitForBlocks - Number of blocks to wait after the deployment of each contract.
 */
export async function deploySidechainSystem(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    l1ExtConfig: ExtSystemConfig,
    canonicalPhase: CanonicalPhaseDeployed,
    naming: SidechainNaming,
    multisigs: SidechainMultisigConfig,
    extConfig: ExtSidechainConfig,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<SidechainDeployed> {
    const deployerAddress = await deployer.getAddress();

    // -----------------------------
    // Pre-1:  Deploy create2Factory
    //         Protocol DAO : create2Factory.updateDeployer(deployer.address, true);
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
    //         Protocol DAO : 1Coordinator.setTrustedRemote(L2_CHAIN_ID, [l2Coordinator.address, l1Coordinator.address]);
    //         Protocol DAO : auraProxyOFT.setTrustedRemote(L2_CHAIN_ID, [auraOFT.address, auraProxyOFT.address]);
    // Post-1: L2 add trusted remotes to layerzero endpoints
    //         Protocol DAO : l2Coordinator.setTrustedRemote(L1_CHAIN_ID, [l1Coordinator.address, l2Coordinator.address]);
    //         Protocol DAO : auraOFT.setTrustedRemote(L1_CHAIN_ID, [auraProxyOFT.address, auraOFT.address]);
    // -----------------------------

    const create2Options = { amount: 0, salt: undefined, callbacks: [] };
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

    const auraOFTTransferOwnership = AuraOFT__factory.createInterface().encodeFunctionData("transferOwnership", [
        deployerAddress,
    ]);
    const auraOFT = await deployContractWithCreate2<AuraOFT, AuraOFT__factory>(
        hre,
        create2Factory,
        new AuraOFT__factory(deployer),
        "AuraOFT",
        [naming.coordinatorName, naming.coordinatorSymbol, extConfig.l2LzEndpoint, extConfig.canonicalChainId],
        deployOptionsWithCallbacks([auraOFTTransferOwnership]),
    );

    const coordinatorTransferOwnership = L2Coordinator__factory.createInterface().encodeFunctionData(
        "transferOwnership",
        [deployerAddress],
    );

    const l2Coordinator = await deployContractWithCreate2<L2Coordinator, L2Coordinator__factory>(
        hre,
        create2Factory,
        new L2Coordinator__factory(deployer),
        "L2Coordinator",
        [extConfig.l2LzEndpoint, auraOFT.address, extConfig.canonicalChainId],
        deployOptionsWithCallbacks([coordinatorTransferOwnership]),
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
        [booster.address, naming.tokenFactoryNamePostfix, naming.coordinatorSymbol.toLowerCase()],
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

    tx = await l2Coordinator.setBooster(booster.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await l2Coordinator.setTrustedRemote(
        l1ExtConfig.canonicalChainId,
        hre.ethers.utils.solidityPack(
            ["address", "address"],
            [canonicalPhase.l1Coordinator.address, l2Coordinator.address],
        ),
    );

    await waitForTx(tx, debug, waitForBlocks);

    tx = await l2Coordinator.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await auraOFT.setTrustedRemote(
        l1ExtConfig.canonicalChainId,
        hre.ethers.utils.solidityPack(["address", "address"], [canonicalPhase.auraProxyOFT.address, auraOFT.address]),
    );
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

    tx = await booster.setFees(550, 1100, 50, 0);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFeeManager(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setOwner(boosterOwner.address);
    await waitForTx(tx, debug, waitForBlocks);

    return {
        voterProxy,
        booster,
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

export async function deploySidechainPhase2(
    __: HardhatRuntimeEnvironment,
    deployer: Signer,
    deployment: SidechainDeployed,
    extConfig: ExtSidechainConfig,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<SidechainPhase2Deployed> {
    // -----------------------------
    // Pre-2: L1
    //          Protocol DAO : l1Coordinator.setTrustedRemote(L2_CHAIN_ID, [l2Coordinator.address, l1Coordinator.address])
    //          Protocol DAO : auraProxyOFT.setTrustedRemote(L2_CHAIN_ID, [auraOFT.address, auraProxyOFT.address])
    // Pre-2: L2
    //          Protocol DAO : l1Coordinator.setTrustedRemote(L2_CHAIN_ID, [l2Coordinator.address, l1Coordinator.address])
    //          Protocol DAO : auraProxyOFT.setTrustedRemote(L2_CHAIN_ID, [auraOFT.address, auraProxyOFT.address])
    // -----------------------------
    // 2. Sidechain Add pools at PoolManager:
    // -----------------------------
    // -----------------------------
    // POST-2: TreasuryDAO: LBP.updateWeightsGradually
    //         TreasuryDAO: LBP.setSwapEnabled

    const { poolManager } = deployment;
    const { gauges } = extConfig;

    const gaugeLength = gauges.length;
    const gaugeController = IGaugeController__factory.connect(extConfig.gaugeController, deployer);
    for (let i = 0; i < gaugeLength; i++) {
        if (gaugeLength > 10) {
            const weight = await gaugeController.get_gauge_weight(gauges[i]);
            if (weight.lt(simpleToExactAmount(15000))) continue;
        }
        const tx = await poolManager["addPool(address)"](gauges[i]);
        await waitForTx(tx, debug, waitForBlocks);
    }

    return { ...deployment, gaugeController };
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
