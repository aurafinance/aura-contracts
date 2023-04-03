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
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    PoolManagerProxy,
    PoolManagerProxy__factory,
    PoolManagerSecondaryProxy,
    PoolManagerSecondaryProxy__factory,
    PoolManagerV3,
    PoolManagerV3__factory,
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
import { ZERO_ADDRESS } from "../test-utils";
import { deployContract, waitForTx } from "../tasks/utils";
import { ExtSidechainConfig, SidechainAddresses, SidechainNaming } from "../tasks/deploy/sidechain-config";
import { ExtSystemConfig, Phase2Deployed } from "./deploySystem";

export async function deployCanonicalPhase(
    hre: HardhatRuntimeEnvironment,
    config: ExtSystemConfig,
    phase2: Phase2Deployed,
    deployer: Signer,
    debug: boolean = false,
    waitForBlocks: number = 0,
) {
    const auraOFT = await deployContract<AuraOFT>(
        hre,
        new AuraOFT__factory(deployer),
        "AuraOFT",
        [config.lzEndpoint, phase2.cvx.address],
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
    poolManager: PoolManagerV3;
    poolManagerProxy: PoolManagerProxy;
    poolManagerSecondaryProxy: PoolManagerSecondaryProxy;
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

    // TODO: there is no gauge controller on the sidechains
    const gaugeController = "0x0000000000000000000000000000000000000000";

    const voterProxy = await deployContract<VoterProxyLite>(
        hre,
        new VoterProxyLite__factory(deployer),
        "VoterProxyLite",
        [addresses.minter, addresses.token],
        {},
        debug,
        waitForBlocks,
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

    const booster = await deployContract<BoosterLite>(
        hre,
        new BoosterLite__factory(deployer),
        "Booster",
        [voterProxy.address, cvxTokenAddress, addresses.token],
        {},
        debug,
        waitForBlocks,
    );

    const rewardFactory = await deployContract<RewardFactory>(
        hre,
        new RewardFactory__factory(deployer),
        "RewardFactory",
        [booster.address, addresses.token],
        {},
        debug,
        waitForBlocks,
    );

    const tokenFactory = await deployContract<TokenFactory>(
        hre,
        new TokenFactory__factory(deployer),
        "TokenFactory",
        [booster.address, naming.tokenFactoryNamePostfix, naming.coordinatorSymbol.toLowerCase()],
        {},
        debug,
        waitForBlocks,
    );

    const proxyFactory = await deployContract<ProxyFactory>(
        hre,
        new ProxyFactory__factory(deployer),
        "ProxyFactory",
        [],
        {},
        debug,
        waitForBlocks,
    );

    const stashFactory = await deployContract<StashFactoryV2>(
        hre,
        new StashFactoryV2__factory(deployer),
        "StashFactory",
        [booster.address, rewardFactory.address, proxyFactory.address],
        {},
        debug,
        waitForBlocks,
    );

    const stashV3 = await deployContract<ExtraRewardStashV3>(
        hre,
        new ExtraRewardStashV3__factory(deployer),
        "ExtraRewardStashV3",
        [addresses.token],
        {},
        debug,
        waitForBlocks,
    );

    const poolManagerProxy = await deployContract<PoolManagerProxy>(
        hre,
        new PoolManagerProxy__factory(deployer),
        "PoolManagerProxy",
        [booster.address, deployerAddress],
        {},
        debug,
        waitForBlocks,
    );

    const poolManagerSecondaryProxy = await deployContract<PoolManagerSecondaryProxy>(
        hre,
        new PoolManagerSecondaryProxy__factory(deployer),
        "PoolManagerProxy",
        [gaugeController, poolManagerProxy.address, booster.address, deployerAddress],
        {},
        debug,
        waitForBlocks,
    );

    const poolManager = await deployContract<PoolManagerV3>(
        hre,
        new PoolManagerV3__factory(deployer),
        "PoolManagerV3",
        [poolManagerSecondaryProxy.address, gaugeController, addresses.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );

    const boosterOwner = await deployContract<BoosterOwner>(
        hre,
        new BoosterOwner__factory(deployer),
        "BoosterOwner",
        [
            addresses.daoMultisig,
            poolManagerSecondaryProxy.address,
            booster.address,
            stashFactory.address,
            ZERO_ADDRESS,
            true,
        ],
        {},
        debug,
        waitForBlocks,
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

    tx = await booster.setPoolManager(poolManagerProxy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerProxy.setOperator(poolManagerSecondaryProxy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerProxy.setOwner(ZERO_ADDRESS);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerSecondaryProxy.setOperator(poolManager.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerSecondaryProxy.setOwner(addresses.daoMultisig);
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
        poolManagerProxy,
        poolManagerSecondaryProxy,
        coordinator,
    };
}
