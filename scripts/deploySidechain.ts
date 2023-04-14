import { ContractTransaction, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
    AuraOFT,
    AuraOFT__factory,
    BoosterLite,
    BoosterLite__factory,
    BoosterOwner,
    BoosterOwner__factory,
    Coordinator,
    Coordinator__factory,
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
} from "../types";
import { ExtSystemConfig, Phase2Deployed, Phase6Deployed } from "./deploySystem";
import { simpleToExactAmount } from "../test-utils/math";
import { ZERO_ADDRESS } from "../test-utils/constants";
import { deployContract, deployContractWithCreate2, waitForTx } from "../tasks/utils";
import { ExtSidechainConfig, SidechainAddresses, SidechainNaming } from "../tasks/deploy/sidechain-types";

export interface CanonicalPhaseDeployed {
    auraOFT: AuraOFT;
}

export async function deployCanonicalPhase(
    hre: HardhatRuntimeEnvironment,
    config: ExtSystemConfig,
    phase2: Phase2Deployed,
    phase6: Phase6Deployed,
    deployer: Signer,
    debug: boolean = false,
    waitForBlocks: number = 0,
): Promise<CanonicalPhaseDeployed> {
    const auraOFT = await deployContract<AuraOFT>(
        hre,
        new AuraOFT__factory(deployer),
        "AuraOFT",
        [config.lzEndpoint, phase2.cvx.address, phase6.booster.address, phase2.cvxLocker.address, config.token],
        {},
        debug,
        waitForBlocks,
    );

    return { auraOFT };
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
    coordinator: Coordinator;
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

    const coordinator = await deployContract<Coordinator>(
        hre,
        new Coordinator__factory(deployer),
        "Coordinator",
        [naming.coordinatorName, naming.coordinatorSymbol, addresses.lzEndpoint, extConfig.canonicalChainId],
        {},
        debug,
        waitForBlocks,
    );
    const cvxTokenAddress = coordinator.address;

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

    let tx: ContractTransaction;

    tx = await coordinator.setBooster(booster.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await voterProxy.setOperator(booster.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await stashFactory.setImplementation(ZERO_ADDRESS, ZERO_ADDRESS, stashV3.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await voterProxy.setOwner(addresses.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setRewardContracts(coordinator.address);
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
        coordinator,
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
