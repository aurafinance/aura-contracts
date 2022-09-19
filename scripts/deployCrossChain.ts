import { ethers, BigNumberish, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deployContract } from "../tasks/utils";
import { simpleToExactAmount } from "../test-utils";
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
    SiphonReceiver,
    SiphonReceiver__factory,
    SiphonToken,
    SiphonToken__factory,
    StashFactoryV2,
    StashFactoryV2__factory,
    TokenFactory,
    TokenFactory__factory,
    VoterProxyLite,
    VoterProxyLite__factory,
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
    siphonReceiver: SiphonReceiver;
    voterProxy: VoterProxyLite;
    booster: BoosterLite;
    rewardFactory: RewardFactory;
    tokenFactory: TokenFactory;
    proxyFactory: ProxyFactory;
    stashFactory: StashFactoryV2;
    stash: ExtraRewardStashV3;
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
 * - siphonReceiver: receives rAURA from L1 and distributes as rewards
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
    const siphonReceiver = await deployContract<SiphonReceiver>(
        hre,
        new SiphonReceiver__factory(signer),
        "SiphonReceiver",
        [rAura.address, config.siphonDepositor, config.lzEndpoint, config.dstChainId],
        {},
        debug,
        waitForBlocks,
    );

    // transfer ownership of rAURA to siphon receiver
    await rAura.transferOwnership(siphonReceiver.address);

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
        [voterProxy.address, siphonReceiver.address, config.token],
        {},
        debug,
        waitForBlocks,
    );

    // booster setup
    await voterProxy.setOperator(booster.address);
    await siphonReceiver.setBooster(booster.address);
    await booster.setPoolManager(signerAddress);
    await booster.setFees(550, 1100, 50, 0);
    await booster.setOwner(signerAddress);
    await booster.setRewardContracts(siphonReceiver.address, siphonReceiver.address);

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

    return {
        rAura,
        siphonReceiver,
        voterProxy,
        booster,
        rewardFactory,
        tokenFactory,
        proxyFactory,
        stashFactory,
        stash,
    };
}

export async function setUpCrossChainL2(contracts: {
    siphonDepositor: SiphonDepositor;
    siphonReceiver: SiphonReceiver;
}) {
    // set siphon receiver on L1 siphon depositor
    await contracts.siphonDepositor.setL2SiphonReceiver(contracts.siphonReceiver.address);
}
