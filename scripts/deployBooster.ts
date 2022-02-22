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
} from "../types/generated";
import { deployContract } from "../tasks/utils";
import * as distroList from "../tasks/deploy/convex-distro.json";

const premineIncetives = BN.from(distroList.lpincentives)
    .add(BN.from(distroList.vecrv))
    .add(BN.from(distroList.teamcvxLpSeed));
const vestedAmounts = distroList.vested.team.amounts.concat(
    distroList.vested.investor.amounts,
    distroList.vested.treasury.amounts,
);
const totalVested = vestedAmounts.reduce((p, c) => p.add(c), BN.from(0));
const premine = premineIncetives.add(totalVested);

// TODO: ??
const distributionAddressId = "0";

interface DeployBoosterConfig {
    crv: string;
    crvMinter: string;
    votingEscrow: string;
    gaugeController: string;
    crvRegistry: string;
    voteOwnership: string;
    voteParameter: string;
    feeDistro: string;
}

interface DeployBoosterResult {
    booster: Booster;
    poolManager: PoolManagerV3;
    voterProxy: CurveVoterProxy;
}

export default async function deployBooster(signer: Signer, config: DeployBoosterConfig): Promise<DeployBoosterResult> {
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    const { crv, crvMinter, votingEscrow, gaugeController, crvRegistry, voteOwnership, voteParameter } = config;

    // -----------------------------
    // 1. Deployments
    // -----------------------------

    const voterProxy = await deployContract<CurveVoterProxy>(
        new CurveVoterProxy__factory(deployer),
        "CurveVoterProxy",
        [crvMinter, crv, votingEscrow, gaugeController],
    );

    const convexToken = await deployContract<ConvexToken>(new ConvexToken__factory(deployer), "ConvexToken", [
        voterProxy.address,
        "Convex",
        "CVX",
    ]);

    const booster = await deployContract<Booster>(new Booster__factory(deployer), "Booster", [
        voterProxy.address,
        convexToken.address,
        crv,
        crvRegistry,
        distributionAddressId,
        voteOwnership,
        voteParameter,
    ]);

    const rewardFactory = await deployContract<RewardFactory>(new RewardFactory__factory(deployer), "RewardFactory", [
        booster.address,
        crv,
    ]);

    const tokenFactory = await deployContract<TokenFactory>(new TokenFactory__factory(deployer), "TokenFactory", [
        booster.address,
        "Convex CRV",
        "cvx",
    ]);

    const proxyFactory = await deployContract<ProxyFactory>(new ProxyFactory__factory(deployer), "ProxyFactory");
    const stashFactory = await deployContract<StashFactoryV2>(new StashFactoryV2__factory(deployer), "StashFactory", [
        booster.address,
        rewardFactory.address,
        proxyFactory.address,
    ]);

    const cvxCrv = await deployContract<CvxCrvToken>(new CvxCrvToken__factory(deployer), "CvxCrv", [
        "CvxCrv",
        "CvxCrv",
    ]);

    const crvDepositor = await deployContract<CrvDepositor>(new CrvDepositor__factory(deployer), "CrvDepositor", [
        voterProxy.address,
        cvxCrv.address,
        crv,
        votingEscrow,
    ]);

    const cvxCrvRewards = await deployContract<BaseRewardPool>(
        new BaseRewardPool__factory(deployer),
        "BaseRewardPool",
        [0, cvxCrv.address, crv, booster.address, rewardFactory.address],
    );

    const cvxRewards = await deployContract<CvxRewardPool>(new CvxRewardPool__factory(deployer), "CvxRewardPool", [
        convexToken.address,
        crv,
        crvDepositor.address,
        cvxCrvRewards.address,
        cvxCrv.address,
        booster.address,
        deployerAddress,
    ]);

    const poolManager = await deployContract<PoolManagerV3>(new PoolManagerV3__factory(deployer), "PoolManagerV3", [
        booster.address,
        gaugeController,
        deployerAddress,
    ]);

    const arbitratorVault = await deployContract<ArbitratorVault>(
        new ArbitratorVault__factory(deployer),
        "ArbitratorVault",
        [booster.address],
    );

    // -----------------------------
    // 2. Setup
    // -----------------------------

    let tx = await voterProxy.setOperator(booster.address);
    await tx.wait();

    tx = await convexToken.mint(deployerAddress, premine.toString());
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
