import { BigNumber as BN, Signer } from "ethers";
import {
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
} from "../types/generated";
import { deployContract } from "../tasks/utils";
import * as distroList from "../tasks/deploy/convex-distro.json";
import { ZERO_ADDRESS } from "test-utils";

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

interface DeployBoosterResult {
    booster: Booster;
    poolManager: PoolManagerV3;
    voterProxy: CurveVoterProxy;
}

/**
 * FLOW
 * Phase 1: Voter Proxy, get whitelisted on Curve system
 * Phase 2: cvx, booster, factories, cvxCrv, crvDepositor, poolManager, vesting, vlCVX + stakerProxy or fix
 * Phase 2.x: cvx/eth & cvxCRV/CRV pools
 * Phase 2.x: 2% emission for cvxCrv deposits
 * Phase 2.x: chef (or other) & cvxCRV/CRV incentives
 * Phase 2.x: Lockdrop & liquidity provision
 * Phase 2.x: Airdrop(s)
 * Phase 3: Pools, claimzap & farming
 * Phase 4: Governance - Bravo, GaugeVoting, VoteForwarder, update roles
 */

export default async function deployBooster(
    signer: Signer,
    naming: NamingConfig,
    config?: ExtSystemConfig,
): Promise<DeployBoosterResult> {
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    const { token, minter, votingEscrow, gaugeController, registry, registryID, voteOwnership, voteParameter } = config;

    // -----------------------------
    // 1. Deployments
    // -----------------------------

    // TODO - move this to phase 1
    const voterProxy = await deployContract<CurveVoterProxy>(
        new CurveVoterProxy__factory(deployer),
        "CurveVoterProxy",
        [minter, token, votingEscrow, gaugeController],
    );

    const convexToken = await deployContract<ConvexToken>(new ConvexToken__factory(deployer), "ConvexToken", [
        voterProxy.address,
        naming.cvxName,
        naming.cvxSymbol,
    ]);

    // TODO - deploy boosterowner
    const booster = await deployContract<Booster>(new Booster__factory(deployer), "Booster", [
        voterProxy.address,
        convexToken.address,
        token,
        registry,
        registryID,
        voteOwnership,
        voteParameter,
    ]);

    const rewardFactory = await deployContract<RewardFactory>(new RewardFactory__factory(deployer), "RewardFactory", [
        booster.address,
        token,
    ]);

    const tokenFactory = await deployContract<TokenFactory>(new TokenFactory__factory(deployer), "TokenFactory", [
        booster.address,
        naming.tokenFactoryNamePostfix,
        naming.cvxSymbol.toLowerCase(),
    ]);

    const proxyFactory = await deployContract<ProxyFactory>(new ProxyFactory__factory(deployer), "ProxyFactory");
    const stashFactory = await deployContract<StashFactoryV2>(new StashFactoryV2__factory(deployer), "StashFactory", [
        booster.address,
        rewardFactory.address,
        proxyFactory.address,
    ]);

    const stashV3 = await deployContract<ExtraRewardStashV3>(
        new ExtraRewardStashV3__factory(deployer),
        "ExtraRewardStashV3",
        [token],
    );

    const cvxCrv = await deployContract<CvxCrvToken>(new CvxCrvToken__factory(deployer), "CvxCrv", [
        naming.cvxCrvName,
        naming.cvxCrvSymbol,
    ]);

    const crvDepositor = await deployContract<CrvDepositor>(new CrvDepositor__factory(deployer), "CrvDepositor", [
        voterProxy.address,
        cvxCrv.address,
        token,
        votingEscrow,
    ]);

    const cvxCrvRewards = await deployContract<BaseRewardPool>(
        new BaseRewardPool__factory(deployer),
        "BaseRewardPool",
        [0, cvxCrv.address, token, booster.address, rewardFactory.address],
    );

    const cvxRewards = await deployContract<CvxRewardPool>(new CvxRewardPool__factory(deployer), "CvxRewardPool", [
        convexToken.address,
        token,
        crvDepositor.address,
        cvxCrvRewards.address,
        cvxCrv.address,
        booster.address,
        deployerAddress,
    ]);

    // TODO - deploy pool manager proxies
    const poolManager = await deployContract<PoolManagerV3>(new PoolManagerV3__factory(deployer), "PoolManagerV3", [
        booster.address,
        gaugeController,
        deployerAddress, // TODO - set as multisig?
    ]);

    const arbitratorVault = await deployContract<ArbitratorVault>(
        new ArbitratorVault__factory(deployer),
        "ArbitratorVault",
        [booster.address],
    );

    // TODO - chef, claimzap, escrow, dropFactory, pools, etc

    // -----------------------------
    // 2. Setup
    // -----------------------------

    let tx = await voterProxy.setOperator(booster.address);
    await tx.wait();

    tx = await convexToken.mint(deployerAddress, premine.toString());
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

    tx = await booster.setPoolManager(poolManager.address);
    await tx.wait();
    tx = await booster.setFactories(rewardFactory.address, stashFactory.address, tokenFactory.address);
    await tx.wait();
    tx = await booster.setFeeInfo();
    await tx.wait();

    tx = await booster.setArbitrator(arbitratorVault.address);
    await tx.wait();

    return { booster, voterProxy, poolManager };
}
