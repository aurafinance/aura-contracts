import { ContractTransaction, ethers, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
    AuraOFT,
    AuraOFT__factory,
    AuraProxyOFT,
    AuraProxyOFT__factory,
    BoosterLite,
    BoosterLite__factory,
    BoosterOwner,
    BoosterOwner__factory,
    L2Coordinator,
    L2Coordinator__factory,
    L1Coordinator,
    L1Coordinator__factory,
    Create2Factory,
    Create2Factory__factory,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    MockBalancerPoolToken,
    MockBalancerPoolToken__factory,
    MockCurveGauge,
    MockCurveGauge__factory,
    MockCurveMinter,
    MockCurveMinter__factory,
    MockERC20,
    MockERC20__factory,
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
    AuraBalProxyOFT,
    AuraBalProxyOFT__factory,
    AuraBalOFT,
    AuraBalOFT__factory,
    VirtualRewardFactory,
    VirtualRewardFactory__factory,
    AuraBalVault,
    AuraBalVault__factory,
    SimpleStrategy__factory,
    SimpleStrategy,
} from "../types";
import { ExtSystemConfig, Phase2Deployed, Phase6Deployed } from "./deploySystem";
import { simpleToExactAmount } from "../test-utils/math";
import { ZERO_ADDRESS } from "../test-utils/constants";
import { deployContract, deployContractWithCreate2, waitForTx } from "../tasks/utils";
import { ExtSidechainConfig, SidechainAddresses, SidechainNaming } from "../tasks/deploy/sidechain-types";
import { AuraBalVaultDeployed } from "tasks/deploy/mainnet-config";

export interface CanonicalPhaseDeployed {
    auraProxyOFT: AuraProxyOFT;
    auraBalProxyOFT: AuraBalProxyOFT;
    l1Coordinator: L1Coordinator;
}

export async function deployCanonicalPhase(
    hre: HardhatRuntimeEnvironment,
    config: ExtSystemConfig,
    phase2: Phase2Deployed,
    phase6: Phase6Deployed,
    auraBalVault: AuraBalVaultDeployed,
    deployer: Signer,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<CanonicalPhaseDeployed> {
    const auraProxyOFT = await deployContract<AuraProxyOFT>(
        hre,
        new AuraProxyOFT__factory(deployer),
        "AuraProxyOFT",
        [config.lzEndpoint, phase2.cvx.address, phase2.cvxLocker.address],
        {},
        debug,
        waitForBlocks,
    );

    const l1Coordinator = await deployContract<L1Coordinator>(
        hre,
        new L1Coordinator__factory(deployer),
        "L1Coordinator",
        [config.lzEndpoint, phase6.booster.address, config.token, phase2.cvx.address, auraProxyOFT.address],
        {},
        debug,
        waitForBlocks,
    );

    const auraBalProxyOFT = await deployContract<AuraBalProxyOFT>(
        hre,
        new AuraBalProxyOFT__factory(deployer),
        "AuraBalProxyOFT",
        [config.lzEndpoint, phase2.cvxCrv.address, auraBalVault.vault.address],
        {},
        debug,
        waitForBlocks,
    );

    return { auraProxyOFT, auraBalProxyOFT, l1Coordinator };
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
    boosterOwner: BoosterOwner;
    factories: Factories;
    poolManager: PoolManagerLite;
    l2Coordinator: L2Coordinator;
    auraOFT: AuraOFT;
    auraBalOFT: AuraBalOFT;
    virtualRewardFactory: VirtualRewardFactory;
    auraBalVault: AuraBalVault;
    auraBalStrategy: SimpleStrategy;
}

/**
 * Deploys the Sidechain system contracts.
 *  - Deploys with the same address across all chains the following contracts.
 *      - VoterProxyLite
 *      - BoosterLite
 *      - TokenFactory
 *      - ProxyFactory
 *      - PoolManagerLite
 *      - BoosterOwner
 *
 *  - Deploys with the different address the following contracts.
 *      - AuraOFT
 *      - Coordinator
 *      - RewardFactory
 *      - StashFactoryV2
 *      - ExtraRewardStashV3
 *      - BoosterOwner
 *
 * @param {HardhatRuntimeEnvironment} hre - The Hardhat runtime environment
 * @param {SidechainNaming} naming - Naming configuration.
 * @param {SidechainAddresses} addresses - List of Sidechain addresses
 * @param {ExtSidechainConfig} extConfig - The external Sidechain configuration
 * @param {Signer} deployer - The deployer signer
 * @param {boolean} debug - Weather console log or not the details of the tx
 * @param {number} waitForBlocks - Number of blocks to wait after the deployment of each contract.
 */
export async function deploySidechainSystem(
    hre: HardhatRuntimeEnvironment,
    naming: SidechainNaming,
    addresses: SidechainAddresses,
    extConfig: ExtSidechainConfig,
    deployer: Signer,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<SidechainDeployed> {
    const deployerAddress = await deployer.getAddress();
    const create2Options = { amount: 0, salt: "1", callbacks: [] };
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

    const create2Factory = Create2Factory__factory.connect(addresses.create2Factory, deployer);
    const voterProxyInitialize = VoterProxyLite__factory.createInterface().encodeFunctionData("initialize", [
        addresses.minter,
        addresses.token,
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

    const auraOFTTransferOwnership = L2Coordinator__factory.createInterface().encodeFunctionData("transferOwnership", [
        deployerAddress,
    ]);
    const auraOFT = await deployContractWithCreate2<AuraOFT, AuraOFT__factory>(
        hre,
        create2Factory,
        new AuraOFT__factory(deployer),
        "AuraOFT",
        [naming.auraOftName, naming.auraOftSymbol, addresses.lzEndpoint, extConfig.canonicalChainId],
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
        "Coordinator",
        [addresses.lzEndpoint, auraOFT.address, extConfig.canonicalChainId],
        deployOptionsWithCallbacks([coordinatorTransferOwnership]),
    );
    const cvxTokenAddress = l2Coordinator.address;

    const boosterLiteInitialize = BoosterLite__factory.createInterface().encodeFunctionData("initialize", [
        cvxTokenAddress,
        addresses.token,
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
        [booster.address, addresses.token],
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
        [addresses.token],
        deployOptions,
    );

    const poolManagerSetOperator = PoolManagerLite__factory.createInterface().encodeFunctionData("setOperator", [
        addresses.daoMultisig,
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
    const boosterOwner = await deployContractWithCreate2<BoosterOwner, BoosterOwner__factory>(
        hre,
        create2Factory,
        new BoosterOwner__factory(deployer),
        "BoosterOwner",
        [addresses.daoMultisig, poolManager.address, booster.address, stashFactory.address, ZERO_ADDRESS, true],
        deployOptions,
    );

    const auraBalOFTTransferOwnership = AuraBalOFT__factory.createInterface().encodeFunctionData("transferOwnership", [
        deployerAddress,
    ]);
    const auraBalOFT = await deployContractWithCreate2<AuraBalOFT, AuraBalOFT__factory>(
        hre,
        create2Factory,
        new AuraBalOFT__factory(deployer),
        "AuraBalOFT",
        [naming.auraBalOftName, naming.auraBalOftSymbol, addresses.lzEndpoint],
        deployOptionsWithCallbacks([auraBalOFTTransferOwnership]),
    );

    const virtualRewardFactory = await deployContractWithCreate2<VirtualRewardFactory, VirtualRewardFactory__factory>(
        hre,
        create2Factory,
        new VirtualRewardFactory__factory(deployer),
        "VirtualRewardFactory",
        [],
        {},
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
        {},
    );

    let tx: ContractTransaction;

    tx = await auraBalVault.setStrategy(auraBalStrategy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await auraBalVault.addExtraReward(auraOFT.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await l2Coordinator.initialize(booster.address, addresses.token);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await voterProxy.setOperator(booster.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await stashFactory.setImplementation(ZERO_ADDRESS, ZERO_ADDRESS, stashV3.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await voterProxy.setOwner(addresses.daoMultisig);
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

    tx = await booster.setFeeManager(addresses.daoMultisig);
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
        auraBalOFT,
        l2Coordinator,
        virtualRewardFactory,
        auraBalVault,
        auraBalStrategy,
    };
}

export interface SidechainMocksDeployed {
    token: MockERC20;
    bpt: MockBalancerPoolToken;
    minter: MockCurveMinter;
    gauge: MockCurveGauge;
}

export async function deploySidechainMocks(
    hre: HardhatRuntimeEnvironment,
    deployer: Signer,
    debug: boolean,
    waitForBlocks: number,
): Promise<SidechainMocksDeployed> {
    const deployerAddress = await deployer.getAddress();

    const token = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockERC20",
        ["mockToken", "mockToken", 18, deployerAddress, 10000000],
        {},
        debug,
        waitForBlocks,
    );

    const bpt = await deployContract<MockBalancerPoolToken>(
        hre,
        new MockBalancerPoolToken__factory(deployer),
        "MockBalancerPoolToken",
        [18, deployerAddress, 100],
        {},
        debug,
        waitForBlocks,
    );

    const minter = await deployContract<MockCurveMinter>(
        hre,
        new MockCurveMinter__factory(deployer),
        "MockCurveMinter",
        [token.address, simpleToExactAmount(10)],
        {},
        debug,
        waitForBlocks,
    );

    const gauge = await deployContract<MockCurveGauge>(
        hre,
        new MockCurveGauge__factory(deployer),
        "MockCurveGauge",
        ["MockGauge", "MOCK", bpt.address, []],
        {},
        debug,
        waitForBlocks,
    );

    const amount = await token.balanceOf(deployerAddress);
    const tx = await token.transfer(minter.address, amount.div(2));
    await waitForTx(tx);

    return { token, bpt, minter, gauge };
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

export async function setTrustedRemoteCanonical(
    canonical: CanonicalPhaseDeployed,
    sidechain: SidechainDeployed,
    sidechainLzChainId: number,
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

    tx = await canonical.auraBalProxyOFT.setTrustedRemote(
        sidechainLzChainId,
        ethers.utils.solidityPack(
            ["address", "address"],
            [sidechain.auraBalOFT.address, canonical.auraBalProxyOFT.address],
        ),
    );
    await waitForTx(tx, debug, waitForBlocks);
}

export async function setTrustedRemoteSidechain(
    canonical: CanonicalPhaseDeployed,
    sidechain: SidechainDeployed,
    canonicalLzChainId: number,
    debug = false,
    waitForBlocks = 0,
) {
    let tx: ContractTransaction;
    tx = await sidechain.l2Coordinator.setTrustedRemote(
        canonicalLzChainId,
        ethers.utils.solidityPack(
            ["address", "address"],
            [canonical.l1Coordinator.address, sidechain.l2Coordinator.address],
        ),
    );
    await waitForTx(tx, debug, waitForBlocks);

    tx = await sidechain.auraOFT.setTrustedRemote(
        canonicalLzChainId,
        ethers.utils.solidityPack(["address", "address"], [canonical.auraProxyOFT.address, sidechain.auraOFT.address]),
    );
    await waitForTx(tx, debug, waitForBlocks);

    tx = await sidechain.auraBalOFT.setTrustedRemote(
        canonicalLzChainId,
        ethers.utils.solidityPack(
            ["address", "address"],
            [canonical.auraBalProxyOFT.address, sidechain.auraBalOFT.address],
        ),
    );
    await waitForTx(tx, debug, waitForBlocks);
}
