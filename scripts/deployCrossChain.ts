import { ethers, BigNumberish, Signer, ContractTransaction } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deployContract, waitForTx } from "../tasks/utils";
import { simpleToExactAmount } from "../test-utils/math";
import { ZERO_ADDRESS } from "../test-utils/constants";
import {
    BoosterLite,
    BoosterLite__factory,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    ProxyFactory,
    ProxyFactory__factory,
    RewardFactory,
    RewardFactory__factory,
    SiphonDepositor,
    SiphonDepositor__factory,
    SiphonGauge,
    SiphonGauge__factory,
    L2Coordinator,
    L2Coordinator__factory,
    SiphonToken,
    SiphonToken__factory,
    StashFactoryV2,
    StashFactoryV2__factory,
    TokenFactory,
    TokenFactory__factory,
    VoterProxyLite,
    VoterProxyLite__factory,
    BoosterOwner,
    BoosterOwner__factory,
    PoolManagerLite,
    PoolManagerLite__factory,
} from "../types";

// Layer 1 deployment config
export interface CrossChainL1DeploymentConfig {
    l2Coordinators: { chainId: number; address: string }[];
    siphonDepositor: { pid: BigNumberish };
    booster: string;
    cvxLocker: string;
    token: string;
    cvx: string;
    lzEndpoint: string;
}

// Layer 2 deployment config
export interface CrossChainL2DeploymentConfig {
    canonicalChainId: BigNumberish;
    lzEndpoint: string;
    minter: string;
    token: string;
    naming: {
        tokenFactoryNamePostfix: string;
        cvxSymbol: string;
        cvxName: string;
    };
}

export interface CrossChainL1Deployment {
    siphonToken: SiphonToken;
    siphonGauge: SiphonGauge;
    siphonDepositor: SiphonDepositor;
}

export interface CrossChainL2Deployment {
    l2Coordinator: L2Coordinator;
    voterProxy: VoterProxyLite;
    booster: BoosterLite;
    rewardFactory: RewardFactory;
    tokenFactory: TokenFactory;
    proxyFactory: ProxyFactory;
    stashFactory: StashFactoryV2;
    stash: ExtraRewardStashV3;
    boosterOwner: BoosterOwner;
    poolManager: PoolManagerLite;
}

/**
 * Deploy the layer 1 part of the Cross Chain deployment
 *
 * - SiphonToken: dummy lpToken used to siphon AURA rewards
 * - SiphonGauge: dummy gauge used to siphon AURA rewards
 * - siphonDepositor: The contract in charge or coordinating everything
 */
export async function deployCrossChainL1(
    config: CrossChainL1DeploymentConfig,
    signer: Signer,
    hre: HardhatRuntimeEnvironment,
    debug = true,
    waitForBlocks = 0,
): Promise<CrossChainL1Deployment> {
    let tx: ContractTransaction;
    const signerAddress = await signer.getAddress();

    // deploy siphon token (lp token)
    const siphonToken = await deployContract<SiphonToken>(
        hre,
        new SiphonToken__factory(signer),
        "SiphonLpToken",
        [signerAddress, simpleToExactAmount(1)],
        {},
        debug,
        waitForBlocks,
    );

    // deploy siphon gauge (gauge)
    const siphonGauge = await deployContract<SiphonGauge>(
        hre,
        new SiphonGauge__factory(signer),
        "SiphonGauge",
        [siphonToken.address],
        {},
        debug,
        waitForBlocks,
    );

    // deploy siphon depositor
    const siphonDepositor = await deployContract<SiphonDepositor>(
        hre,
        new SiphonDepositor__factory(signer),
        "SiphonDepositor",
        [
            siphonToken.address,
            config.siphonDepositor.pid,
            config.booster,
            config.cvxLocker,
            config.token,
            config.cvx,
            config.lzEndpoint,
        ],
        {},
        debug,
        waitForBlocks,
    );

    // send siphon token to depositor
    tx = await siphonToken.transfer(siphonDepositor.address, simpleToExactAmount(1));
    await waitForTx(tx, debug, waitForBlocks);

    for (const l2Coordinator of config.l2Coordinators) {
        tx = await siphonDepositor.setL2Coordinator(l2Coordinator.chainId, l2Coordinator.address);
        await waitForTx(tx, debug, waitForBlocks);
    }

    return {
        siphonToken,
        siphonGauge,
        siphonDepositor,
    };
}

/**
 * Deploy the layer 2 part of the Cross Chain deployment
 *
 * - l2Coordinator: receives AURA from L1 and distributes as rewards
 * - voterProxy: L2 voter proxy
 * - booster: L2 booster
 * - factories:
 *   - rewardFactory
 *   - tokenFactory
 *   - proxyFactory
 *   - stashFactory
 * - stash: extra reward stash v3
 */
export async function deployCrossChainL2(
    config: CrossChainL2DeploymentConfig,
    signer: Signer,
    hre: HardhatRuntimeEnvironment,
    debug: boolean = true,
    waitForBlocks: number,
): Promise<CrossChainL2Deployment> {
    let tx: ContractTransaction;
    const signerAddress = await signer.getAddress();

    // deploy siphon receiver
    const l2Coordinator = await deployContract<L2Coordinator>(
        hre,
        new L2Coordinator__factory(signer),
        "L2Coordinator",
        [config.naming.cvxName, config.naming.cvxSymbol, config.lzEndpoint, config.canonicalChainId, config.token],
        {},
        debug,
        waitForBlocks,
    );

    /* ---------------------------------------------------
       Deploy Voter Proxy 
    --------------------------------------------------- */

    // deploy voter proxy
    const voterProxy = await deployContract<VoterProxyLite>(
        hre,
        new VoterProxyLite__factory(signer),
        "VoterProxyLite",
        [config.minter, config.token],
        {},
        debug,
        waitForBlocks,
    );

    /* ---------------------------------------------------
       Deploy BoosterLite 
    --------------------------------------------------- */

    // deploy booster
    const booster = await deployContract<BoosterLite>(
        hre,
        new BoosterLite__factory(signer),
        "BoosterLite",
        [voterProxy.address, l2Coordinator.address, config.token],
        {},
        debug,
        waitForBlocks,
    );

    // booster setup
    tx = await voterProxy.setOperator(booster.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await l2Coordinator.setBooster(booster.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFees(550, 1100, 50, 0);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setOwner(signerAddress);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setRewardContracts(l2Coordinator.address);
    await waitForTx(tx, debug, waitForBlocks);

    // deploy factories
    const rewardFactory = await deployContract<RewardFactory>(
        hre,
        new RewardFactory__factory(signer),
        "RewardFactory",
        [booster.address, config.token],
        {},
        debug,
        waitForBlocks,
    );

    const tokenFactory = await deployContract<TokenFactory>(
        hre,
        new TokenFactory__factory(signer),
        "TokenFactory",
        [booster.address, config.naming.tokenFactoryNamePostfix, config.naming.cvxSymbol.toLowerCase()],
        {},
        debug,
        waitForBlocks,
    );

    const proxyFactory = await deployContract<ProxyFactory>(
        hre,
        new ProxyFactory__factory(signer),
        "ProxyFactory",
        [],
        {},
        debug,
        waitForBlocks,
    );

    const stashFactory = await deployContract<StashFactoryV2>(
        hre,
        new StashFactoryV2__factory(signer),
        "StashFactory",
        [booster.address, rewardFactory.address, proxyFactory.address],
        {},
        debug,
        waitForBlocks,
    );

    const stash = await deployContract<ExtraRewardStashV3>(
        hre,
        new ExtraRewardStashV3__factory(signer),
        "ExtraRewardStashV3",
        [config.token],
        {},
        debug,
        waitForBlocks,
    );

    // booster setup
    tx = await booster.setFactories(rewardFactory.address, stashFactory.address, tokenFactory.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await stashFactory.setImplementation(
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        stash.address,
    );
    await waitForTx(tx, debug, waitForBlocks);

    /* ---------------------------------------------------
       Deploy Booster Owner/Pool Managers 
    --------------------------------------------------- */

    const poolManager = await deployContract<PoolManagerLite>(
        hre,
        new PoolManagerLite__factory(signer),
        "PoolManagerLite",
        [booster.address, signerAddress],
        {},
        debug,
        waitForBlocks,
    );

    const boosterOwner = await deployContract<BoosterOwner>(
        hre,
        new BoosterOwner__factory(signer),
        "BoosterOwner",
        [signerAddress, poolManager.address, booster.address, stashFactory.address, ZERO_ADDRESS, true],
        {},
        debug,
        waitForBlocks,
    );

    tx = await booster.setOwner(boosterOwner.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setPoolManager(poolManager.address);
    await waitForTx(tx, debug, waitForBlocks);

    return {
        l2Coordinator,
        voterProxy,
        booster,
        rewardFactory,
        tokenFactory,
        proxyFactory,
        stashFactory,
        stash,
        boosterOwner,
        poolManager,
    };
}
