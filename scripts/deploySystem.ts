import { BoosterOwner__factory } from "./../types/generated/factories/BoosterOwner__factory";
import { BoosterOwner } from "./../types/generated/BoosterOwner";
import { BigNumber as BN, Signer } from "ethers";
import {
    ClaimZap__factory,
    ClaimZap,
    Booster__factory,
    Booster,
    CurveVoterProxy__factory,
    CurveVoterProxy,
    RewardFactory__factory,
    RewardFactory,
    StashFactoryV2__factory,
    StashFactoryV2,
    TokenFactory__factory,
    TokenFactory,
    ProxyFactory__factory,
    ProxyFactory,
    ConvexToken__factory,
    ConvexToken,
    CvxCrvToken__factory,
    CvxCrvToken,
    CrvDepositor__factory,
    CrvDepositor,
    PoolManagerV3__factory,
    PoolManagerV3,
    BaseRewardPool__factory,
    BaseRewardPool,
    CvxRewardPool__factory,
    CvxRewardPool,
    ArbitratorVault__factory,
    ArbitratorVault,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    PoolManagerProxy__factory,
    PoolManagerProxy,
    PoolManagerSecondaryProxy__factory,
    PoolManagerSecondaryProxy,
} from "../types/generated";
import { deployContract } from "../tasks/utils";
import * as distroList from "../tasks/deploy/convex-distro.json";
import { ZERO_ADDRESS } from "../test-utils";

// TODO - add this as args
const premineIncetives = BN.from(distroList.lpincentives)
    .add(BN.from(distroList.vecrv))
    .add(BN.from(distroList.teamcvxLpSeed));
const vestedAmounts = distroList.vested.team.amounts.concat(
    distroList.vested.investor.amounts,
    distroList.vested.treasury.amounts,
);
const totalVested = vestedAmounts.reduce((p, c) => p.add(c), BN.from(0));
const premine = premineIncetives.add(totalVested);

interface ExtSystemConfig {
    token: string;
    minter: string;
    votingEscrow: string;
    gaugeController: string;
    registry: string;
    registryID: number;
    voteOwnership?: string;
    voteParameter?: string;
}

interface NamingConfig {
    cvxName: string;
    cvxSymbol: string;
    cvxCrvName: string;
    cvxCrvSymbol: string;
    tokenFactoryNamePostfix: string;
}

/* eslint-disable-next-line */
const curveSystem: ExtSystemConfig = {
    token: "0xD533a949740bb3306d119CC777fa900bA034cd52",
    minter: "0xd061D61a4d941c39E5453435B6345Dc261C2fcE0",
    votingEscrow: "0x5f3b5DfEb7B28CDbD7FAba78963EE202a494e2A2",
    gaugeController: "0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB",
    registry: "0x0000000022D53366457F9d5E68Ec105046FC4383",
    registryID: 4,
    voteOwnership: "0xe478de485ad2fe566d49342cbd03e49ed7db3356",
    voteParameter: "0xbcff8b0b9419b9a88c44546519b1e909cf330399",
};

interface Phase1Deployed {
    voterProxy: CurveVoterProxy;
}

interface Phase2Deployed extends Phase1Deployed {
    cvx: ConvexToken;
}

interface Phase3Deployed extends Phase2Deployed {
    booster: Booster;
    cvxCrv: CvxCrvToken;
    cvxCrvRewards: BaseRewardPool;
    cvxRewards: CvxRewardPool;
    crvDepositor: CrvDepositor;
    poolManager: PoolManagerV3;
    voterProxy: CurveVoterProxy;
}

interface SystemDeployed extends Phase3Deployed {
    claimZap: ClaimZap;
}

/**
 * FLOW
 * Phase 1: Voter Proxy, get whitelisted on Curve system
 * Phase 2: cvx & lockdrop
 * Phase 3: booster, factories, cvxCrv, crvDepositor, poolManager, vesting, vlCVX + stakerProxy or fix
 * Phase 3.x: Liquidity provision post lockdrop
 * Phase 3.x: cvx/eth & cvxCRV/CRV pools
 * Phase 3.x: 2% emission for cvxCrv deposits
 * Phase 3.x: chef (or other) & cvxCRV/CRV incentives
 * Phase 3.x: Airdrop(s)
 * Phase 4: Pools, claimzap & farming
 * Phase 5: Governance - Bravo, GaugeVoting, VoteForwarder, update roles
 */

async function deployLiveSystem(signer: Signer, naming: NamingConfig): Promise<SystemDeployed> {
    const phase1 = await deployPhase1(signer, curveSystem, true);
    const phase2 = await deployPhase2(signer, phase1, naming, true);
    const phase3 = await deployPhase3(signer, phase2, naming, curveSystem, true);
    const phase4 = await deployPhase4(signer, phase3, curveSystem, true);
    return phase4;
}

async function deploySystem(
    signer: Signer,
    naming: NamingConfig,
    extSystem: ExtSystemConfig,
    debug = false,
): Promise<SystemDeployed> {
    const phase1 = await deployPhase1(signer, extSystem, debug);
    const phase2 = await deployPhase2(signer, phase1, naming, debug);
    const phase3 = await deployPhase3(signer, phase2, naming, extSystem, debug);
    const phase4 = await deployPhase4(signer, phase3, extSystem, debug);
    return phase4;
}

async function deployPhase1(signer: Signer, extSystem: ExtSystemConfig, debug = false): Promise<Phase1Deployed> {
    const deployer = signer;

    // -----------------------------
    // 1. VoterProxy
    // -----------------------------

    const voterProxy = await deployContract<CurveVoterProxy>(
        new CurveVoterProxy__factory(deployer),
        "CurveVoterProxy",
        [extSystem.minter, extSystem.token, extSystem.votingEscrow, extSystem.gaugeController],
        {},
        debug,
    );

    return { voterProxy };
}

async function deployPhase2(
    signer: Signer,
    deployment: Phase1Deployed,
    naming: NamingConfig,
    debug = false,
): Promise<Phase2Deployed> {
    const deployer = signer;

    // -----------------------------
    // 2. CVX token & lockdrop
    // -----------------------------

    const cvx = await deployContract<ConvexToken>(
        new ConvexToken__factory(deployer),
        "ConvexToken",
        [deployment.voterProxy.address, naming.cvxName, naming.cvxSymbol],
        {},
        debug,
    );

    return { ...deployment, cvx };
}

async function deployPhase3(
    signer: Signer,
    deployment: Phase2Deployed,
    naming: NamingConfig,
    config: ExtSystemConfig,
    debug = false,
): Promise<Phase3Deployed> {
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    const { token, votingEscrow, gaugeController, registry, registryID, voteOwnership, voteParameter } = config;
    const { voterProxy, cvx } = deployment;

    // -----------------------------
    // 3. Core system:
    //     - booster
    //     - factories (reward, token, proxy, stash)
    //     - cvxCrv (cvxCrv, crvDepositor)
    //     - pool management (poolManager + 2x proxies)
    //     - vlCVX + ((stkCVX && stakerProxy) || fix) // TODO - deploy this & setRewardContracts on boosted
    // -----------------------------

    const booster = await deployContract<Booster>(
        new Booster__factory(deployer),
        "Booster",
        [voterProxy.address, cvx.address, token, registry, registryID, voteOwnership, voteParameter],
        {},
        debug,
    );

    const rewardFactory = await deployContract<RewardFactory>(
        new RewardFactory__factory(deployer),
        "RewardFactory",
        [booster.address, token],
        {},
        debug,
    );

    const tokenFactory = await deployContract<TokenFactory>(
        new TokenFactory__factory(deployer),
        "TokenFactory",
        [booster.address, naming.tokenFactoryNamePostfix, naming.cvxSymbol.toLowerCase()],
        {},
        debug,
    );

    const proxyFactory = await deployContract<ProxyFactory>(
        new ProxyFactory__factory(deployer),
        "ProxyFactory",
        [],
        {},
        false,
    );
    const stashFactory = await deployContract<StashFactoryV2>(
        new StashFactoryV2__factory(deployer),
        "StashFactory",
        [booster.address, rewardFactory.address, proxyFactory.address],
        {},
        debug,
    );

    const stashV3 = await deployContract<ExtraRewardStashV3>(
        new ExtraRewardStashV3__factory(deployer),
        "ExtraRewardStashV3",
        [token],
        {},
        debug,
    );

    const cvxCrv = await deployContract<CvxCrvToken>(
        new CvxCrvToken__factory(deployer),
        "CvxCrv",
        [naming.cvxCrvName, naming.cvxCrvSymbol],
        {},
        debug,
    );

    const crvDepositor = await deployContract<CrvDepositor>(
        new CrvDepositor__factory(deployer),
        "CrvDepositor",
        [voterProxy.address, cvxCrv.address, token, votingEscrow],
        {},
        debug,
    );

    const cvxCrvRewards = await deployContract<BaseRewardPool>(
        new BaseRewardPool__factory(deployer),
        "BaseRewardPool",
        [0, cvxCrv.address, token, booster.address, rewardFactory.address],
        {},
        debug,
    );

    const cvxRewards = await deployContract<CvxRewardPool>(
        new CvxRewardPool__factory(deployer),
        "CvxRewardPool",
        [
            cvx.address,
            token,
            crvDepositor.address,
            cvxCrvRewards.address,
            cvxCrv.address,
            booster.address,
            deployerAddress,
        ],
        {},
        debug,
    );

    const poolManagerProxy = await deployContract<PoolManagerProxy>(
        new PoolManagerProxy__factory(deployer),
        "PoolManagerProxy",
        [booster.address, deployerAddress], // TODO - should be multisig
        {},
        debug,
    );

    const poolManagerSecondaryProxy = await deployContract<PoolManagerSecondaryProxy>(
        new PoolManagerSecondaryProxy__factory(deployer),
        "PoolManagerProxy",
        [gaugeController, poolManagerProxy.address, booster.address, deployerAddress], // TODO - should be multisig
        {},
        debug,
    );

    const poolManager = await deployContract<PoolManagerV3>(
        new PoolManagerV3__factory(deployer),
        "PoolManagerV3",
        [
            poolManagerSecondaryProxy.address,
            gaugeController,
            deployerAddress, // TODO - should be multisig
        ],
        {},
        debug,
    );

    const boosterOwner = await deployContract<BoosterOwner>(
        new BoosterOwner__factory(deployer),
        "BoosterOwner",
        [
            deployerAddress, // TODO - deployerAddress should be multisig
            poolManagerSecondaryProxy.address,
            booster.address,
            stashFactory.address,
            ZERO_ADDRESS, // TODO - rescuestash needed
        ],
        {},
        debug,
    );

    const arbitratorVault = await deployContract<ArbitratorVault>(
        new ArbitratorVault__factory(deployer),
        "ArbitratorVault",
        [booster.address],
        {},
        debug,
    );

    let tx = await voterProxy.setOperator(booster.address);
    await tx.wait();

    tx = await cvx.mint(deployerAddress, premine.toString());
    await tx.wait();

    tx = await stashFactory.setImplementation(ZERO_ADDRESS, ZERO_ADDRESS, stashV3.address);
    await tx.wait();

    tx = await cvxCrv.setOperator(crvDepositor.address);
    await tx.wait();
    tx = await voterProxy.setDepositor(crvDepositor.address);
    await tx.wait();
    tx = await booster.setTreasury(crvDepositor.address);
    await tx.wait();

    tx = await booster.setRewardContracts(cvxCrvRewards.address, cvxRewards.address);
    await tx.wait();

    tx = await booster.setPoolManager(poolManagerProxy.address);
    await tx.wait();
    tx = await poolManagerProxy.setOperator(poolManagerSecondaryProxy.address);
    await tx.wait();
    tx = await poolManagerSecondaryProxy.setOperator(poolManager.address);
    await tx.wait();

    tx = await booster.setFactories(rewardFactory.address, stashFactory.address, tokenFactory.address);
    await tx.wait();
    tx = await booster.setFeeInfo();
    await tx.wait();

    tx = await booster.setArbitrator(arbitratorVault.address);
    await tx.wait();

    tx = await booster.setOwner(boosterOwner.address);
    await tx.wait();

    // TODO - 3.1
    // -----------------------------
    // 3.1. Token liquidity:
    //     - vesting (team, treasury, etc)
    //     - bPool creation: cvx/eth & cvxCrv/crv https://dev.balancer.fi/resources/deploy-pools-from-factory/creation#deploying-a-pool-with-typescript
    //     - lockdrop: use liquidity & init streams
    //     - 2% emission for cvxCrv deposits
    //     - chef (or other) & cvxCRV/CRV incentives
    //     - airdrop factory & Airdrop(s)
    // -----------------------------

    return { ...deployment, booster, cvxCrv, cvxRewards, cvxCrvRewards, crvDepositor, poolManager };
}

async function deployPhase4(
    signer: Signer,
    deployment: Phase3Deployed,
    config: ExtSystemConfig,
    debug = false,
): Promise<SystemDeployed> {
    const deployer = signer;

    const { token } = config;
    const { cvx, cvxCrv, cvxRewards, cvxCrvRewards, crvDepositor } = deployment;

    // -----------------------------
    // 4. Pool creation etc
    //     - Claimzap
    //     - All initial gauges // TODO - add gauges
    // -----------------------------

    const claimZap = await deployContract<ClaimZap>(
        new ClaimZap__factory(deployer),
        "ClaimZap",
        [
            token,
            cvx.address,
            cvxCrv.address,
            crvDepositor.address,
            cvxCrvRewards.address,
            cvxRewards.address,
            ZERO_ADDRESS, // TODO - this needs to be changed, used for trading cvx for cvxCRV
        ],
        {},
        debug,
    );

    return { ...deployment, claimZap };
}

export {
    deployLiveSystem,
    deploySystem,
    ExtSystemConfig,
    NamingConfig,
    deployPhase1,
    Phase1Deployed,
    deployPhase2,
    Phase2Deployed,
    deployPhase3,
    Phase3Deployed,
    deployPhase4,
    SystemDeployed,
};
