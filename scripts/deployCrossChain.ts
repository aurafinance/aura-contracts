import { ethers, BigNumberish, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deployContract } from "../tasks/utils";
import { simpleToExactAmount, ZERO_ADDRESS } from "../test-utils";
import {
    BoosterLite,
    BoosterLite__factory,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    ProxyFactory,
    ProxyFactory__factory,
    RAura,
    RAura__factory,
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
    PoolManagerProxy,
    PoolManagerProxy__factory,
    PoolManagerSecondaryProxy,
    PoolManagerSecondaryProxy__factory,
    PoolManagerV3,
    PoolManagerV3__factory,
    BoosterOwner,
    BoosterOwner__factory,
} from "../types";

// Layer 1 deployment config
export interface CrossChainL1DeploymentConfig {
    siphondepositor: { pid: BigNumberish };
    rAura: { symbol: string };
    booster: string;
    cvxLocker: string;
    token: string;
    cvx: string;
    lzEndpoint: string;
    dstChainId: BigNumberish;
    penalty: BigNumberish;
}

// Layer 2 deployment config
export interface CrossChainL2DeploymentConfig {
    siphonDepositor: string;
    rAura: { symbol: string };
    lzEndpoint: string;
    dstChainId: BigNumberish;
    minter: string;
    token: string;
    tokenBpt: string;
    votingEscrow: string;
    gaugeController: string;
    cvx: string;
    voteOwnership: string;
    voteParameter: string;
    naming: {
        tokenFactoryNamePostfix: string;
        cvxSymbol: string;
    };
}

export interface CrossChainL1Deployment {
    siphonToken: SiphonToken;
    siphonGauge: SiphonGauge;
    rAura: RAura;
    siphonDepositor: SiphonDepositor;
}

export interface CrossChainL2Deployment {
    rAura: RAura;
    l2Coordinator: L2Coordinator;
    voterProxy: VoterProxyLite;
    booster: BoosterLite;
    rewardFactory: RewardFactory;
    tokenFactory: TokenFactory;
    proxyFactory: ProxyFactory;
    stashFactory: StashFactoryV2;
    stash: ExtraRewardStashV3;
    poolManagerSecondaryProxy: PoolManagerSecondaryProxy;
    poolManagerProxy: PoolManagerProxy;
    poolManager: PoolManagerV3;
    boosterOwner: BoosterOwner;
}

/**
 * Deploy the layer 1 part of the Cross Chain deployment
 *
 * - SiphonToken: dummy lpToken used to siphon AURA rewards
 * - SiphonGauge: dummy gauge used to siphon AURA rewards
 * - rAURA: the wrapped AURA token bridge to L2 and given our as a reward
 * - siphonDepositor: The contract in charge or coordinating everything
 */
export async function deployCrossChainL1(
    config: CrossChainL1DeploymentConfig,
    signer: Signer,
    hre: HardhatRuntimeEnvironment,
    debug: boolean = true,
    waitForBlocks: number,
): Promise<CrossChainL1Deployment> {
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

    // deploy rAURA
    const rAura = await deployContract<RAura>(
        hre,
        new RAura__factory(signer),
        "rAura",
        [config.rAura.symbol, config.rAura.symbol],
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
            config.siphondepositor.pid,
            config.booster,
            config.cvxLocker,
            config.token,
            config.cvx,
            rAura.address,
            config.lzEndpoint,
            config.dstChainId,
            config.penalty,
        ],
        {},
        debug,
        waitForBlocks,
    );

    // send siphon token to depositor
    await siphonToken.transfer(siphonDepositor.address, simpleToExactAmount(1));
    // transfer ownership of rAURA to siphon depositor
    await rAura.transferOwnership(siphonDepositor.address);

    return {
        siphonToken,
        siphonGauge,
        rAura,
        siphonDepositor,
    };
}

/**
 * Deploy the layer 2 part of the Cross Chain deployment
 *
 * - rAURA: wrapped AURA token
 * - l2Coordinator: receives rAURA from L1 and distributes as rewards
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
    const signerAddress = await signer.getAddress();

    // deploy rAURA
    const rAura = await deployContract<RAura>(
        hre,
        new RAura__factory(signer),
        "rAura",
        [config.rAura.symbol, config.rAura.symbol],
        {},
        debug,
        waitForBlocks,
    );

    // deploy siphon receiver
    const l2Coordinator = await deployContract<L2Coordinator>(
        hre,
        new L2Coordinator__factory(signer),
        "L2Coordinator",
        [rAura.address, config.siphonDepositor, config.lzEndpoint, config.dstChainId],
        {},
        debug,
        waitForBlocks,
    );

    // transfer ownership of rAURA to siphon receiver
    await rAura.transferOwnership(l2Coordinator.address);

    /* ---------------------------------------------------
       Deploy Voter Proxy 
    --------------------------------------------------- */

    // deploy voter proxy
    const voterProxy = await deployContract<VoterProxyLite>(
        hre,
        new VoterProxyLite__factory(signer),
        "VoterProxyLite",
        [config.minter, config.token, config.tokenBpt, config.votingEscrow, config.gaugeController],
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
    await voterProxy.setOperator(booster.address);
    await l2Coordinator.setBooster(booster.address);
    await booster.setPoolManager(signerAddress);
    await booster.setFees(550, 1100, 50, 0);
    await booster.setOwner(signerAddress);
    await booster.setRewardContracts(l2Coordinator.address, l2Coordinator.address);

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
    await booster.setFactories(rewardFactory.address, stashFactory.address, tokenFactory.address);
    await stashFactory.setImplementation(ethers.constants.AddressZero, ethers.constants.AddressZero, stash.address);

    /* ---------------------------------------------------
       Deploy Booster Owner/Pool Managers 
    --------------------------------------------------- */

    const poolManagerProxy = await deployContract<PoolManagerProxy>(
        hre,
        new PoolManagerProxy__factory(signer),
        "PoolManagerProxy",
        [booster.address, signerAddress],
        {},
        debug,
        waitForBlocks,
    );

    const poolManagerSecondaryProxy = await deployContract<PoolManagerSecondaryProxy>(
        hre,
        new PoolManagerSecondaryProxy__factory(signer),
        "PoolManagerProxy",
        [config.gaugeController, poolManagerProxy.address, booster.address, signerAddress],
        {},
        debug,
        waitForBlocks,
    );

    const poolManager = await deployContract<PoolManagerV3>(
        hre,
        new PoolManagerV3__factory(signer),
        "PoolManagerV3",
        [poolManagerSecondaryProxy.address, config.gaugeController, signerAddress],
        {},
        debug,
        waitForBlocks,
    );

    const boosterOwner = await deployContract<BoosterOwner>(
        hre,
        new BoosterOwner__factory(signer),
        "BoosterOwner",
        [signerAddress, poolManagerSecondaryProxy.address, booster.address, stashFactory.address, ZERO_ADDRESS, true],
        {},
        debug,
        waitForBlocks,
    );

    await booster.setOwner(boosterOwner.address);
    await booster.setPoolManager(poolManagerProxy.address);
    await poolManagerProxy.setOperator(poolManagerSecondaryProxy.address);
    await poolManagerProxy.setOwner(ZERO_ADDRESS);
    await poolManagerSecondaryProxy.setOperator(poolManager.address);
    await poolManagerSecondaryProxy.setOwner(signerAddress);

    return {
        rAura,
        l2Coordinator,
        voterProxy,
        booster,
        rewardFactory,
        tokenFactory,
        proxyFactory,
        stashFactory,
        stash,
        poolManagerSecondaryProxy,
        poolManagerProxy,
        poolManager,
        boosterOwner,
    };
}

export async function setUpCrossChainL2(contracts: { siphonDepositor: SiphonDepositor; l2Coordinator: L2Coordinator }) {
    // set siphon receiver on L1 siphon depositor
    await contracts.siphonDepositor.setL2SiphonReceiver(contracts.l2Coordinator.address);
}
