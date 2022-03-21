import { BigNumber as BN, Signer } from "ethers";
import {
    IWalletChecker__factory,
    ICurveVoteEscrow__factory,
    MockWalletChecker__factory,
    MockCurveVoteEscrow__factory,
    BoosterOwner__factory,
    BoosterOwner,
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
    CvxCrvToken__factory,
    CvxCrvToken,
    CrvDepositor__factory,
    CrvDepositor,
    PoolManagerV3__factory,
    PoolManagerV3,
    BaseRewardPool__factory,
    BaseRewardPool,
    ArbitratorVault__factory,
    ArbitratorVault,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    PoolManagerProxy__factory,
    PoolManagerProxy,
    PoolManagerSecondaryProxy__factory,
    PoolManagerSecondaryProxy,
    VestedEscrow,
    VestedEscrow__factory,
    MockERC20__factory,
    MerkleAirdropFactory,
    MerkleAirdropFactory__factory,
    MerkleAirdrop__factory,
    IWeightedPoolFactory__factory,
    IBalancerPool__factory,
    IBalancerVault__factory,
    ConvexMasterChef,
    AuraLocker,
    AuraLocker__factory,
    AuraStakingProxy,
    AuraStakingProxy__factory,
    AuraToken,
    AuraToken__factory,
    AuraMinter,
    AuraMinter__factory,
    MockERC20,
    ConvexMasterChef__factory,
} from "../types/generated";
import { deployContract } from "../tasks/utils";
import { ZERO_ADDRESS, DEAD_ADDRESS, ONE_WEEK } from "../test-utils/constants";
import { simpleToExactAmount } from "../test-utils/math";
import { impersonateAccount } from "../test-utils/fork";
import { HardhatRuntimeEnvironment } from "hardhat/types";

interface AirdropData {
    merkleRoot: string;
    amount: BN;
}

interface VestingRecipient {
    address: string;
    amount: BN;
}

interface VestingGroup {
    period: BN;
    recipients: VestingRecipient[];
}

interface LBPData {
    bootstrap: BN;
    matching: BN;
}
interface DistroList {
    miningRewards: BN;
    lpIncentives: BN;
    cvxCrvBootstrap: BN;
    lbp: LBPData;
    airdrops: AirdropData[];
    vesting: VestingGroup[];
}

interface ExtSystemConfig {
    token: string;
    tokenWhale: string;
    minter: string;
    votingEscrow: string;
    gaugeController: string;
    registry: string;
    registryID: number;
    voteOwnership?: string;
    voteParameter?: string;
    gauges?: string[];
    balancerVault: string;
    balancerWeightedPoolFactory: string;
    weth: string;
}

interface NamingConfig {
    cvxName: string;
    cvxSymbol: string;
    vlCvxName: string;
    vlCvxSymbol: string;
    cvxCrvName: string;
    cvxCrvSymbol: string;
    tokenFactoryNamePostfix: string;
}

interface MultisigConfig {
    vestingMultisig: string;
    treasuryMultisig: string;
    daoMultisig: string;
}

/* eslint-disable-next-line */
const curveSystem: ExtSystemConfig = {
    token: "0xD533a949740bb3306d119CC777fa900bA034cd52",
    tokenWhale: "0x7a16fF8270133F063aAb6C9977183D9e72835428",
    minter: "0xd061D61a4d941c39E5453435B6345Dc261C2fcE0",
    votingEscrow: "0x5f3b5DfEb7B28CDbD7FAba78963EE202a494e2A2",
    gaugeController: "0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB",
    registry: "0x0000000022D53366457F9d5E68Ec105046FC4383",
    registryID: 4,
    voteOwnership: "0xe478de485ad2fe566d49342cbd03e49ed7db3356",
    voteParameter: "0xbcff8b0b9419b9a88c44546519b1e909cf330399",
    gauges: ["0xBC89cd85491d81C6AD2954E6d0362Ee29fCa8F53"],
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    balancerWeightedPoolFactory: "0x8E9aa87E45e92bad84D5F8DD1bff34Fb92637dE9",
    weth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
};

interface Phase1Deployed {
    voterProxy: CurveVoterProxy;
}

interface Phase2Deployed extends Phase1Deployed {
    cvx: AuraToken;
    minter: AuraMinter;
    booster: Booster;
    boosterOwner: BoosterOwner;
    cvxCrv: CvxCrvToken;
    cvxCrvRewards: BaseRewardPool;
    crvDepositor: CrvDepositor;
    poolManager: PoolManagerV3;
    voterProxy: CurveVoterProxy;
    cvxLocker: AuraLocker;
    cvxStakingProxy: AuraStakingProxy;
    vestedEscrows: VestedEscrow[];
    dropFactory: MerkleAirdropFactory;
}
interface SystemDeployed extends Phase2Deployed {
    claimZap: ClaimZap;
}

/**
 * FLOW
 * Phase 1: Voter Proxy, get whitelisted on Curve system
 * Phase 2: cvx, booster, factories, cvxCrv, crvDepositor, poolManager, vlCVX + stakerProxy
 *           - Schedule: Vesting streams
 *           - Schedule: 2% emission for cvxCrv staking
 *           - Create:   cvxCRV/CRV BPT Stableswap
 *           - Schedule: chef (or other) & cvxCRV/CRV incentives
 *           - Schedule: Airdrop(s)
 *           - Schedule: LBP
 * Phase 2.1: Enable swapping and start weight decay on LBP
 * Phase 3: Liquidity from LBP taken and used for AURA/ETH pool
 *          Airdrops & initial farming begins like clockwork
 * Phase 4: Pools, claimzap & farming
 * Phase 5: Governance - Bravo, GaugeVoting, VoteForwarder, update roles
 */

async function deployForkSystem(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    distroList: DistroList,
    multisigs: MultisigConfig,
    naming: NamingConfig,
): Promise<SystemDeployed> {
    const phase1 = await deployPhase1(signer, curveSystem, false, true);

    // Whitelist the VoterProxy in the Curve system
    const ve = ICurveVoteEscrow__factory.connect(curveSystem.votingEscrow, signer);
    const walletChecker = IWalletChecker__factory.connect(await ve.smart_wallet_checker(), signer);
    const owner = await walletChecker.dao();
    const ownerSigner = await impersonateAccount(owner);
    let tx = await walletChecker.connect(ownerSigner.signer).approveWallet(phase1.voterProxy.address);
    await tx.wait();

    // Send VoterProxy some CRV for initial lock
    const tokenWhaleSigner = await impersonateAccount(curveSystem.tokenWhale);
    const crv = MockERC20__factory.connect(curveSystem.token, tokenWhaleSigner.signer);
    tx = await crv.transfer(phase1.voterProxy.address, simpleToExactAmount(1));
    await tx.wait();

    const phase2 = await deployPhase2(hre, signer, phase1, distroList, multisigs, naming, curveSystem, true);
    const phase3 = await deployPhase3(signer, phase2, curveSystem, true);
    const phase4 = await deployPhase4(signer, phase3, curveSystem, true);
    return phase4;
}

async function deployLocalSystem(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    distroList: DistroList,
    multisigs: MultisigConfig,
    naming: NamingConfig,
    extSystem: ExtSystemConfig,
    debug = false,
): Promise<SystemDeployed> {
    const phase1 = await deployPhase1(signer, extSystem, debug);
    const phase2 = await deployPhase2(hre, signer, phase1, distroList, multisigs, naming, extSystem, debug);
    const phase3 = await deployPhase3(signer, phase2, extSystem, debug);
    const phase4 = await deployPhase4(signer, phase3, extSystem, debug);
    return phase4;
}

async function deployPhase1(
    signer: Signer,
    extSystem: ExtSystemConfig,
    approveWalletLocal = true,
    debug = false,
): Promise<Phase1Deployed> {
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

    if (approveWalletLocal) {
        const ve = MockCurveVoteEscrow__factory.connect(extSystem.votingEscrow, deployer);
        const walletChecker = MockWalletChecker__factory.connect(await ve.smart_wallet_checker(), deployer);
        await walletChecker.approveWallet(voterProxy.address);

        const crv = MockERC20__factory.connect(extSystem.token, deployer);
        await crv.transfer(voterProxy.address, simpleToExactAmount(1));
    }

    return { voterProxy };
}

async function deployPhase2(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    deployment: Phase1Deployed,
    distroList: DistroList,
    multisigs: MultisigConfig,
    naming: NamingConfig,
    config: ExtSystemConfig,
    debug = false,
): Promise<Phase2Deployed> {
    const { ethers } = hre;
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    const { token, votingEscrow, gaugeController, registry, registryID, voteOwnership, voteParameter } = config;
    const { voterProxy } = deployment;

    // -----------------------------
    // 2: cvx, booster, factories, cvxCrv, crvDepositor, poolManager, vlCVX + stakerProxy
    //        - Schedule: Vesting streams
    //        - Schedule: 2% emission for cvxCrv staking
    //        - Create:   cvxCRV/CRV BPT Stableswap
    //        - Schedule: chef (or other) & cvxCRV/CRV incentives
    //        - Schedule: Airdrop(s)
    //        - Schedule: LBP
    // -----------------------------

    // -----------------------------
    // 2.1 Core system:
    //     - cvx
    //     - booster
    //     - factories (reward, token, proxy, stash)
    //     - cvxCrv (cvxCrv, crvDepositor)
    //     - pool management (poolManager + 2x proxies)
    //     TODO - ensure all places using vlCVX (i.e. vesting & lockdrop) are updated
    //     - vlCVX + ((stkCVX && stakerProxy) || fix)
    // -----------------------------

    const premineIncetives = distroList.lpIncentives
        .add(distroList.airdrops.reduce((p, c) => p.add(c.amount), BN.from(0)))
        .add(distroList.cvxCrvBootstrap)
        .add(distroList.lbp.bootstrap)
        .add(distroList.lbp.matching);
    const totalVested = distroList.vesting.reduce(
        (p, c) => p.add(c.recipients.reduce((pp, cc) => pp.add(cc.amount), BN.from(0))),
        BN.from(0),
    );
    const premine = premineIncetives.add(totalVested);
    const checksum = premine.add(distroList.miningRewards);
    if (!checksum.eq(simpleToExactAmount(100, 24))) {
        console.log(checksum.toString());
        throw console.error();
    }

    const cvx = await deployContract<AuraToken>(
        new AuraToken__factory(deployer),
        "AuraToken",
        [deployment.voterProxy.address, naming.cvxName, naming.cvxSymbol],
        {},
        debug,
    );

    const minter = await deployContract<AuraMinter>(
        new AuraMinter__factory(deployer),
        "AuraMinter",
        [cvx.address, multisigs.daoMultisig],
        {},
        debug,
    );

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
        [voterProxy.address, cvxCrv.address, token, votingEscrow, multisigs.daoMultisig],
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

    const poolManagerProxy = await deployContract<PoolManagerProxy>(
        new PoolManagerProxy__factory(deployer),
        "PoolManagerProxy",
        [booster.address, multisigs.daoMultisig],
        {},
        debug,
    );

    const poolManagerSecondaryProxy = await deployContract<PoolManagerSecondaryProxy>(
        new PoolManagerSecondaryProxy__factory(deployer),
        "PoolManagerProxy",
        [gaugeController, poolManagerProxy.address, booster.address, multisigs.daoMultisig],
        {},
        debug,
    );

    const poolManager = await deployContract<PoolManagerV3>(
        new PoolManagerV3__factory(deployer),
        "PoolManagerV3",
        [poolManagerSecondaryProxy.address, gaugeController, multisigs.daoMultisig],
        {},
        debug,
    );

    const boosterOwner = await deployContract<BoosterOwner>(
        new BoosterOwner__factory(deployer),
        "BoosterOwner",
        [
            multisigs.daoMultisig,
            poolManagerSecondaryProxy.address,
            booster.address,
            stashFactory.address,
            ZERO_ADDRESS, // TODO - rescuestash or substitute needed
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

    // TODO: boostPayment is set to ZERO_ADDRESS?
    const cvxLocker = await deployContract<AuraLocker>(
        new AuraLocker__factory(deployer),
        "AuraLocker",
        [naming.vlCvxName, naming.vlCvxSymbol, cvx.address, cvxCrv.address, ZERO_ADDRESS, cvxCrvRewards.address],
        {},
        debug,
    );

    const cvxStakingProxy = await deployContract<AuraStakingProxy>(
        new AuraStakingProxy__factory(deployer),
        "AuraStakingProxy",
        [cvxLocker.address, config.token, cvx.address, cvxCrv.address, cvxCrvRewards.address, crvDepositor.address],
        {},
        debug,
    );

    let tx = await cvxLocker.setStakingContract(cvxStakingProxy.address);
    await tx.wait();

    tx = await cvxLocker.addReward(cvxCrv.address, cvxStakingProxy.address, false);
    await tx.wait();

    tx = await cvxLocker.setApprovals();
    await tx.wait();

    tx = await cvxStakingProxy.setApprovals();
    await tx.wait();

    tx = await voterProxy.setOperator(booster.address);
    await tx.wait();

    tx = await cvx.init(deployerAddress, premine.toString(), minter.address);
    await tx.wait();

    tx = await stashFactory.setImplementation(ZERO_ADDRESS, ZERO_ADDRESS, stashV3.address);
    await tx.wait();

    tx = await cvxCrv.setOperator(crvDepositor.address);
    await tx.wait();

    tx = await voterProxy.setDepositor(crvDepositor.address);
    await tx.wait();

    tx = await voterProxy.setOwner(multisigs.daoMultisig);
    await tx.wait();

    tx = await crvDepositor.initialLock();
    await tx.wait();

    tx = await crvDepositor.setFeeManager(multisigs.daoMultisig);
    await tx.wait();

    tx = await booster.setRewardContracts(cvxCrvRewards.address, cvxStakingProxy.address);
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

    tx = await booster.setVoteDelegate(multisigs.daoMultisig);
    await tx.wait();

    tx = await booster.setFeeManager(multisigs.daoMultisig);
    await tx.wait();

    tx = await booster.setOwner(boosterOwner.address);
    await tx.wait();

    // -----------------------------
    // 2.2. Token liquidity:
    //     - Schedule: vesting (team, treasury, etc)
    //     - Schedule: 2% emission for cvxCrv staking
    //     - Create:   cvxCRV/CRV BPT Stableswap
    //     - Schedule: chef (or other) & cvxCRV/CRV incentives
    //     - Schedule: Airdrop(s)
    //     - Schedule: LBP
    // -----------------------------

    // -----------------------------
    // 2.2.1 Schedule: vesting (team, treasury, etc)
    // -----------------------------

    const currentTime = BN.from((await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp);
    const DELAY = ONE_WEEK;
    const rewardsStart = currentTime.add(DELAY);
    const vestedEscrows = [];

    for (let i = 0; i < distroList.vesting.length; i++) {
        const vestingGroup = distroList.vesting[i];
        const groupVestingAmount = vestingGroup.recipients.reduce((p, c) => p.add(c.amount), BN.from(0));
        const rewardsEnd = rewardsStart.add(vestingGroup.period);

        const vestedEscrow = await deployContract<VestedEscrow>(
            new VestedEscrow__factory(deployer),
            "VestedEscrow",
            [cvx.address, rewardsStart, rewardsEnd, cvxLocker.address, multisigs.vestingMultisig],
            {},
            debug,
        );

        tx = await cvx.approve(vestedEscrow.address, groupVestingAmount);
        await tx.wait();
        tx = await vestedEscrow.addTokens(groupVestingAmount);
        await tx.wait();
        const vestingAddr = vestingGroup.recipients.map(m => m.address);
        const vestingAmounts = vestingGroup.recipients.map(m => m.amount);
        tx = await vestedEscrow.fund(vestingAddr, vestingAmounts);
        await tx.wait();

        vestedEscrows.push(vestedEscrow);
    }

    // TODO - add this new contract
    // -----------------------------
    // 2.2.2 Schedule: 2% emission for cvxCrv staking
    // -----------------------------
    const initialCvxCrvStaking = await deployContract<BaseRewardPool>(
        new BaseRewardPool__factory(deployer),
        "Bootstrap",
        [0, cvxCrv.address, cvx.address, deployerAddress, rewardFactory.address],
        {},
        debug,
    );
    tx = await cvx.transfer(initialCvxCrvStaking.address, distroList.cvxCrvBootstrap);
    await tx.wait();

    // TODO - add this pool
    // -----------------------------
    // 2.2.3 Create: auraBAL/BPT BPT Stableswap
    // https://dev.balancer.fi/resources/deploy-pools-from-factory/creation#deploying-a-pool-with-typescript
    // -----------------------------

    // let poolTokens = [cvx.address, config.weth].sort((a, b) => (a > b ? 1 : 0));
    // console.log(poolTokens);
    // let poolName = `${await cvx.symbol()}-WETH 50/50 Pool`;
    // let poolSymbol = `50${await cvx.symbol()}-50WETH`;
    // let poolSwapFee = simpleToExactAmount(5, 15);
    // let poolWeights = [simpleToExactAmount(5, 17), simpleToExactAmount(5, 17)];
    // const weightedPoolFactory = IWeightedPoolFactory__factory.connect(config.balancerWeightedPoolFactory, deployer);
    // tx = await weightedPoolFactory.create(poolName, poolSymbol, poolTokens, poolWeights, poolSwapFee, ZERO_ADDRESS);
    // let receipt = await tx.wait();
    // const events = receipt.events.filter(e => e.event === "PoolCreated");
    // const poolAddress = events[0].args.pool;

    // let pool = await IBalancerPool__factory.connect(poolAddress, deployer);
    // let poolId = await pool.getPoolId();
    // const balancerVault = IBalancerVault__factory.connect(config.balancerVault, deployer);
    // let initialPoolBalances =
    const cvxCrvBpt = await deployContract<MockERC20>(
        new MockERC20__factory(deployer),
        "CvxCrvBPT",
        ["Balancer Pool Token 50/50 CRV/CVXCRV", "50/50 CRV/CVXCRV", 18, deployerAddress, 100000],
        {},
        debug,
    );

    // -----------------------------
    // 2.2.4 Schedule: chef (or other) & cvxCRV/CRV incentives
    // -----------------------------
    const currentBlock = await ethers.provider.getBlockNumber();
    const chefCvx = distroList.lpIncentives;

    const blocksInDay = BN.from(6500);
    const numberOfBlocks = blocksInDay.mul(365).mul(4); // 4 years
    const rewardPerBlock = chefCvx.div(numberOfBlocks);
    const startBlock = blocksInDay.mul(7).add(currentBlock); //start with small delay
    const endbonusblock = 0; // No bonus

    const chef = await deployContract<ConvexMasterChef>(
        new ConvexMasterChef__factory(deployer),
        "Bootstrap",
        [cvx.address, rewardPerBlock, startBlock, endbonusblock],
        {},
        debug,
    );

    tx = await cvx.transfer(chef.address, distroList.lpIncentives);
    await tx.wait();

    tx = await chef.add(1000, cvxCrvBpt.address, ZERO_ADDRESS, false);
    await tx.wait();

    tx = await chef.transferOwnership(multisigs.daoMultisig);
    await tx.wait();

    // TODO - add time delay & correct roots
    // -----------------------------
    // 2.2.5 Schedule: Airdrop(s)
    // -----------------------------

    const dropFactory = await deployContract<MerkleAirdropFactory>(
        new MerkleAirdropFactory__factory(deployer),
        "MerkleAirdropFactory",
        [],
        {},
        debug,
    );
    const dropCount = distroList.airdrops.length;
    for (let i = 0; i < dropCount; i++) {
        const { merkleRoot, amount } = distroList.airdrops[i];
        tx = await dropFactory.CreateMerkleAirdrop();
        const txReceipt = await tx.wait();
        const merkleDropAddr = txReceipt.events[0].args[0];

        const airdrop = MerkleAirdrop__factory.connect(merkleDropAddr, deployer);
        tx = await airdrop.setRewardToken(cvx.address);
        await tx.wait();
        tx = await cvx.transfer(airdrop.address, amount);
        await tx.wait();
        tx = await airdrop.setRoot(merkleRoot);
        await tx.wait();
        tx = await airdrop.setOwner(multisigs.daoMultisig);
        await tx.wait();
    }

    // -----------------------------
    // 2.2.6 Schedule: LBP & Matching liq
    // -----------------------------

    // TODO - add LBP
    tx = await cvx.transfer(DEAD_ADDRESS, distroList.lbp.bootstrap);
    await tx.wait();

    // TODO - add matching liq
    tx = await cvx.transfer(DEAD_ADDRESS, distroList.lbp.matching);
    await tx.wait();

    const balance = await cvx.balanceOf(deployerAddress);
    if (balance.gt(0)) {
        throw console.error("Uh oh, deployer still has CVX to distribute: ", balance.toString());
    }
    // TODO - add all contracts to output

    return {
        ...deployment,
        cvx,
        minter,
        booster,
        boosterOwner,
        cvxCrv,
        cvxCrvRewards,
        crvDepositor,
        poolManager,
        cvxLocker,
        cvxStakingProxy,
        vestedEscrows,
        dropFactory,
    };
}

async function deployPhase3(
    signer: Signer,
    deployment: Phase2Deployed,
    config: ExtSystemConfig,
    debug = false,
): Promise<Phase2Deployed> {
    if (debug) {
        console.log(debug);
    }
    return deployment;
}

async function deployPhase4(
    signer: Signer,
    deployment: Phase2Deployed,
    config: ExtSystemConfig,
    debug = false,
): Promise<SystemDeployed> {
    const deployer = signer;

    const { token, gauges } = config;
    const { cvx, cvxCrv, cvxLocker, cvxCrvRewards, crvDepositor, poolManager } = deployment;

    // -----------------------------
    // 4. Pool creation etc
    //     - Claimzap
    //     - All initial gauges
    // -----------------------------

    // TODO - add "init" flag to PoolManager in order to allow for pool creation

    const claimZap = await deployContract<ClaimZap>(
        new ClaimZap__factory(deployer),
        "ClaimZap",
        [
            token,
            cvx.address,
            cvxCrv.address,
            crvDepositor.address,
            cvxCrvRewards.address,
            cvxLocker.address, // TODO - deprecate or ensure this is vlCVX
            DEAD_ADDRESS, // TODO - this needs to be changed, used for trading cvx for cvxCRV
            cvxLocker.address,
        ],
        {},
        debug,
    );

    let tx = await claimZap.setApprovals();
    await tx.wait();

    const gaugeLength = gauges.length;
    for (let i = 0; i < gaugeLength; i++) {
        tx = await poolManager["addPool(address)"](gauges[i]);
        await tx.wait();
    }

    return { ...deployment, claimZap };
}

export {
    deployForkSystem,
    deployLocalSystem,
    DistroList,
    MultisigConfig,
    ExtSystemConfig,
    NamingConfig,
    deployPhase1,
    Phase1Deployed,
    deployPhase2,
    Phase2Deployed,
    deployPhase3,
    deployPhase4,
    SystemDeployed,
};
