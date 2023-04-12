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
import { simpleToExactAmount, ZERO_ADDRESS } from "../test-utils";
import { deployContract, deployContractWithCreate2, waitForTx } from "../tasks/utils";
import {
    ExtSidechainConfig,
    SidechainAddresses,
    SidechainNaming,
    config as sidechainConfig,
} from "../tasks/deploy/sidechain-config";
import { ExtSystemConfig, Phase2Deployed } from "./deploySystem";

export async function deployCanonicalPhase(
    hre: HardhatRuntimeEnvironment,
    config: ExtSystemConfig,
    phase2: Phase2Deployed,
    deployer: Signer,
    debug: boolean = false,
    waitForBlocks: number = 0,
) {
    const create2Factory = Create2Factory__factory.connect(sidechainConfig.addresses.create2Factory, deployer);
    const auraOFT = await deployContractWithCreate2<AuraOFT, AuraOFT__factory>(
        hre,
        create2Factory,
        new AuraOFT__factory(deployer),
        "AuraOFT",
        [config.lzEndpoint, phase2.cvx.address, phase2.cvxLocker.address, await deployer.getAddress()],
        { debug, waitForBlocks },
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

    const create2Factory = Create2Factory__factory.connect(addresses.create2Factory, deployer);

    const voterProxySetOwner = VoterProxyLite__factory.createInterface().encodeFunctionData("setOwner", [
        deployerAddress,
    ]);

    const voterProxy = await deployContractWithCreate2<VoterProxyLite, VoterProxyLite__factory>(
        hre,
        create2Factory,
        new VoterProxyLite__factory(deployer),
        "VoterProxyLite",
        [addresses.minter, addresses.token],
        { ...deployOptions, create2Options: { ...create2Options, callbacks: [voterProxySetOwner] } },
    );

    const coordinatorTransferOwnership = Coordinator__factory.createInterface().encodeFunctionData(
        "transferOwnership",
        [deployerAddress],
    );

    const coordinator = await deployContractWithCreate2<Coordinator, Coordinator__factory>(
        hre,
        create2Factory,
        new Coordinator__factory(deployer),
        "Coordinator",
        [naming.coordinatorName, naming.coordinatorSymbol, addresses.lzEndpoint, extConfig.canonicalChainId],
        { ...deployOptions, create2Options: { ...create2Options, callbacks: [coordinatorTransferOwnership] } },
    );

    const cvxTokenAddress = coordinator.address;
    const boosterSetOwner = BoosterLite__factory.createInterface().encodeFunctionData("setOwner", [deployerAddress]);
    const boosterSetFeeManager = BoosterLite__factory.createInterface().encodeFunctionData("setFeeManager", [
        deployerAddress,
    ]);
    const boosterSetPoolManager = BoosterLite__factory.createInterface().encodeFunctionData("setPoolManager", [
        deployerAddress,
    ]);

    const booster = await deployContractWithCreate2<BoosterLite, BoosterLite__factory>(
        hre,
        create2Factory,
        new BoosterLite__factory(deployer),
        "BoosterLite",
        [voterProxy.address, cvxTokenAddress, addresses.token],
        {
            ...deployOptions,
            create2Options: {
                ...create2Options,
                callbacks: [boosterSetPoolManager, boosterSetFeeManager, boosterSetOwner],
            },
        },
    );
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
    const stashFactory = await deployContractWithCreate2<StashFactoryV2, StashFactoryV2__factory>(
        hre,
        create2Factory,
        new StashFactoryV2__factory(deployer),
        "StashFactory",
        [booster.address, rewardFactory.address, proxyFactory.address],
        deployOptions,
    );
    const stashV3 = await deployContractWithCreate2<ExtraRewardStashV3, ExtraRewardStashV3__factory>(
        hre,
        create2Factory,
        new ExtraRewardStashV3__factory(deployer),
        "ExtraRewardStashV3",
        [addresses.token],
        deployOptions,
    );
    const poolManager = await deployContractWithCreate2<PoolManagerLite, PoolManagerLite__factory>(
        hre,
        create2Factory,
        new PoolManagerLite__factory(deployer),
        "PoolManagerLite",
        [booster.address, addresses.daoMultisig],
        deployOptions,
    );
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
