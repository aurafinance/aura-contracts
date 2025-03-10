import { AssetHelpers } from "@balancer-labs/balancer-js";
import { BigNumber, BigNumber as BN, ContractReceipt, ContractTransaction, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
    Chain,
    create2OptionsWithCallbacks,
    deployContract,
    deployContractWithCreate2,
    waitForTx,
} from "../tasks/utils";
import { getChain } from "../tasks/utils/networkAddressFactory";
import { DEAD_ADDRESS, ONE_WEEK, ZERO_ADDRESS, ZERO_KEY } from "../test-utils/constants";
import { simpleToExactAmount } from "../test-utils/math";
import {
    ArbitratorVault,
    ArbitratorVault__factory,
    AuraBalRewardPool,
    AuraBalRewardPool__factory,
    AuraClaimZap,
    AuraClaimZap__factory,
    AuraLocker,
    AuraLocker__factory,
    AuraMerkleDrop,
    AuraMerkleDrop__factory,
    AuraMinter,
    AuraMinter__factory,
    AuraPenaltyForwarder,
    AuraPenaltyForwarder__factory,
    AuraStakingProxy,
    AuraStakingProxy__factory,
    AuraToken,
    AuraToken__factory,
    AuraVestedEscrow,
    AuraVestedEscrow__factory,
    BalLiquidityProvider,
    BalLiquidityProvider__factory,
    BaseRewardPool,
    BaseRewardPool__factory,
    Booster,
    Booster__factory,
    BoosterHelper,
    BoosterHelper__factory,
    BoosterOwner,
    BoosterOwner__factory,
    BoosterOwnerSecondary,
    BoosterOwnerSecondary__factory,
    ClaimFeesHelper,
    ClaimFeesHelper__factory,
    ConvexMasterChef,
    ConvexMasterChef__factory,
    Create2Factory__factory,
    CrvDepositor,
    CrvDepositor__factory,
    CrvDepositorWrapper,
    CrvDepositorWrapper__factory,
    CrvDepositorWrapperForwarder,
    CrvDepositorWrapperForwarder__factory,
    CrvDepositorWrapperForwarderV2,
    CrvDepositorWrapperForwarderV2__factory,
    CrvDepositorWrapperSwapper,
    CrvDepositorWrapperSwapper__factory,
    CrvDepositorWrapperWithFee,
    CrvDepositorWrapperWithFee__factory,
    CvxCrvToken,
    CvxCrvToken__factory,
    ExtraRewardsDistributor,
    ExtraRewardsDistributor__factory,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    GaugeMigrator,
    GaugeMigrator__factory,
    IBalancerPool__factory,
    IBalancerVault__factory,
    IGaugeController__factory,
    ILBPFactory__factory,
    IStablePoolFactory__factory,
    IWeightedPool2TokensFactory__factory,
    MasterChefRewardHook,
    MasterChefRewardHook__factory,
    MockCurveVoteEscrow__factory,
    MockERC20,
    MockERC20__factory,
    MockWalletChecker__factory,
    PoolFeeManagerProxy,
    PoolFeeManagerProxy__factory,
    PoolManagerProxy,
    PoolManagerProxy__factory,
    PoolManagerSecondaryProxy,
    PoolManagerSecondaryProxy__factory,
    PoolManagerV3,
    PoolManagerV3__factory,
    PoolManagerV4,
    PoolManagerV4__factory,
    PoolMigrator,
    PoolMigrator__factory,
    ProxyFactory,
    ProxyFactory__factory,
    RewardFactory,
    RewardFactory__factory,
    RewardPoolDepositWrapper,
    RewardPoolDepositWrapper__factory,
    SiphonToken,
    SiphonToken__factory,
    StashFactoryV2,
    StashFactoryV2__factory,
    StashRewardDistro,
    TempBooster,
    TempBooster__factory,
    TokenFactory,
    TokenFactory__factory,
    UniswapMigrator,
    UniswapMigrator__factory,
    VoterProxy,
    VoterProxy__factory,
} from "../types/generated";

const SALT = "berlin";

interface AirdropData {
    merkleRoot: string;
    startDelay: BN;
    length: BN;
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
    tknAmount: BN;
    wethAmount: BN;
    matching: BN;
}
interface DistroList {
    miningRewards: BN;
    lpIncentives: BN;
    cvxCrvBootstrap: BN;
    lbp: LBPData;
    airdrops: AirdropData[];
    immutableVesting: VestingGroup[];
    vesting: VestingGroup[];
}
interface BalancerPoolFactories {
    weightedPool2Tokens: string;
    stablePool: string;
    bootstrappingPool: string;
    weightedPool?: string;
}
interface ExtSystemConfig {
    authorizerAdapter?: string;
    token: string;
    tokenBpt: string;
    tokenWhale?: string;
    minter: string;
    votingEscrow: string;
    feeDistribution: string;
    gaugeController: string;
    gaugeCheckpointer?: string;
    voteOwnership?: string;
    voteParameter?: string;
    gauges?: string[];
    balancerVault: string;
    balancerPoolFactories: BalancerPoolFactories;
    balancerPoolId: string;
    balancerMinOutBps: string;
    balancerPoolOwner?: string;
    balancerGaugeFactory?: string;
    balancerHelpers?: string;
    create2Factory?: string;
    weth: string;
    wethWhale?: string;
    treasury?: string;
    keeper?: string;
    staBAL3?: string;
    staBAL3Whale?: string;
    feeToken?: string;
    feeTokenWhale?: string;
    feeTokenHandlerPath?: { poolIds: string[]; assetsIn: string[] };
    ldo?: string;
    ldoWhale?: string;
    stEthGaugeLdoDepositor?: string;
    uniswapRouter?: string;
    uniswapV3Router?: string;
    sushiswapRouter?: string;
    auraBalGauge?: string;
    lzEndpoint?: string;
    sidechain?: {
        auraBalInflowLimit: BigNumber;
        auraInflowLimit: BigNumber;
    };
    darkQuestBoard?: string;
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
    sudoMultisig: string;
    pauseGuardian: string;
    incentivesMultisig?: string;
    defender?: {
        l1CoordinatorDistributor?: string;
        auraBalProxyOFTHarvestor?: string;
        keeperMulticall3?: string;
    };
}

interface BPTData {
    tokens: string[];
    name: string;
    symbol: string;
    swapFee: BN;
    weights?: BN[];
    ampParameter?: number;
}

interface BalancerPoolDeployed {
    poolId: string;
    address: string;
}
interface Phase1Deployed {
    voterProxy: VoterProxy;
}

interface Factories {
    rewardFactory: RewardFactory;
    stashFactory: StashFactoryV2;
    tokenFactory: TokenFactory;
    proxyFactory: ProxyFactory;
}
interface Phase2Deployed extends Phase1Deployed {
    cvx: AuraToken;
    minter: AuraMinter;
    booster: Booster;
    boosterOwner: BoosterOwner;
    factories: Factories;
    arbitratorVault: ArbitratorVault;
    cvxCrv: CvxCrvToken;
    cvxCrvBpt: BalancerPoolDeployed;
    cvxCrvRewards: BaseRewardPool;
    initialCvxCrvStaking: AuraBalRewardPool;
    crvDepositor: CrvDepositor;
    crvDepositorWrapper: CrvDepositorWrapper;
    poolManager: PoolManagerV3;
    poolManagerProxy: PoolManagerProxy;
    poolManagerSecondaryProxy: PoolManagerSecondaryProxy;
    cvxLocker: AuraLocker;
    cvxStakingProxy: AuraStakingProxy;
    chef: ConvexMasterChef;
    vestedEscrows: AuraVestedEscrow[];
    drops: AuraMerkleDrop[];
    lbpBpt: BalancerPoolDeployed;
    balLiquidityProvider: BalLiquidityProvider;
    penaltyForwarder: AuraPenaltyForwarder;
    extraRewardsDistributor: ExtraRewardsDistributor;
}

interface Phase3Deployed extends Phase2Deployed {
    pool8020Bpt: BalancerPoolDeployed;
}
// Phase 4
interface SystemDeployed extends Phase3Deployed {
    claimZap: AuraClaimZap;
    feeCollector: ClaimFeesHelper;
    rewardDepositWrapper: RewardPoolDepositWrapper;
}

// Alias of phase 4 is the core system deployed.
type Phase4Deployed = SystemDeployed;

interface Phase5Deployed extends Phase4Deployed {
    boosterHelper: BoosterHelper;
    gaugeMigrator: GaugeMigrator;
    uniswapMigrator: UniswapMigrator;
    crvDepositorWrapperWithFee: CrvDepositorWrapperWithFee;
}

interface Phase6Deployed {
    booster: Booster;
    boosterOwner: BoosterOwner;
    boosterHelper: BoosterHelper;
    feeCollector: ClaimFeesHelper;
    factories: Factories;
    cvxCrvRewards: BaseRewardPool;
    poolManager: PoolManagerV3;
    poolManagerProxy: PoolManagerProxy;
    poolManagerSecondaryProxy: PoolManagerSecondaryProxy;
    claimZap: AuraClaimZap;
    stashV3: ExtraRewardStashV3;
    poolMigrator: PoolMigrator;
}
type PoolsSnapshot = { gauge: string; lptoken: string; shutdown: boolean; pid: number };

interface Phase7Deployed {
    masterChefRewardHook: MasterChefRewardHook;
    siphonToken: SiphonToken;
}
interface Phase8Deployed {
    poolManagerV4: PoolManagerV4;
    boosterOwnerSecondary: BoosterOwnerSecondary;
}
interface Phase9Deployed {
    poolFeeManagerProxy: PoolFeeManagerProxy;
}

export function getPoolAddress(utils: any, receipt: ContractReceipt): string {
    const event = receipt.events.find(e => e.topics[0] === utils.keccak256(utils.toUtf8Bytes("PoolCreated(address)")));
    return utils.hexZeroPad(utils.hexStripZeros(event.topics[1]), 20);
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

async function deployPhase1(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    extSystem: ExtSystemConfig,
    approveWalletLocal = true,
    debug = false,
    waitForBlocks = 0,
): Promise<Phase1Deployed> {
    const deployer = signer;

    // -----------------------------
    // 1. VoterProxy
    // -----------------------------

    const voterProxy = await deployContract<VoterProxy>(
        hre,
        new VoterProxy__factory(deployer),
        "VoterProxy",
        [extSystem.minter, extSystem.token, extSystem.tokenBpt, extSystem.votingEscrow, extSystem.gaugeController],
        {},
        debug,
        waitForBlocks,
    );

    if (approveWalletLocal) {
        const ve = MockCurveVoteEscrow__factory.connect(extSystem.votingEscrow, deployer);
        const walletChecker = MockWalletChecker__factory.connect(await ve.smart_wallet_checker(), deployer);
        await walletChecker.approveWallet(voterProxy.address);

        const crvBpt = MockERC20__factory.connect(extSystem.tokenBpt, deployer);
        await crvBpt.transfer(voterProxy.address, simpleToExactAmount(1));
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
    waitForBlocks = 0,
): Promise<Phase2Deployed> {
    const { ethers } = hre;
    const chain = getChain(hre);
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();
    const balHelper = new AssetHelpers(config.weth);

    const { token, tokenBpt, votingEscrow, gaugeController, voteOwnership, voteParameter } = config;
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
    // POST-2: TreasuryDAO: LBP.updateWeightsGradually
    //         TreasuryDAO: LBP.setSwapEnabled

    // -----------------------------
    // 2.1 Core system:
    //     - cvx
    //     - booster
    //     - factories (reward, token, proxy, stash)
    //     - cvxCrv (cvxCrv, crvDepositor)
    //     - pool management (poolManager + 2x proxies)
    //     - vlCVX + ((stkCVX && stakerProxy) || fix)
    // -----------------------------

    const premineIncetives = distroList.lpIncentives
        .add(distroList.airdrops.reduce((p, c) => p.add(c.amount), BN.from(0)))
        .add(distroList.cvxCrvBootstrap)
        .add(distroList.lbp.tknAmount)
        .add(distroList.lbp.matching);
    const totalVested = distroList.vesting
        .concat(distroList.immutableVesting)
        .reduce((p, c) => p.add(c.recipients.reduce((pp, cc) => pp.add(cc.amount), BN.from(0))), BN.from(0));
    const premine = premineIncetives.add(totalVested);
    const checksum = premine.add(distroList.miningRewards);
    if (!checksum.eq(simpleToExactAmount(100, 24)) || !premine.eq(simpleToExactAmount(50, 24))) {
        console.log(checksum.toString());
        throw console.error();
    }

    const cvx = await deployContract<AuraToken>(
        hre,
        new AuraToken__factory(deployer),
        "AuraToken",
        [deployment.voterProxy.address, naming.cvxName, naming.cvxSymbol],
        {},
        debug,
        waitForBlocks,
    );

    const minter = await deployContract<AuraMinter>(
        hre,
        new AuraMinter__factory(deployer),
        "AuraMinter",
        [cvx.address, multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );

    const booster = await deployContract<Booster>(
        hre,
        new Booster__factory(deployer),
        "Booster",
        [voterProxy.address, cvx.address, token, voteOwnership, voteParameter],
        {},
        debug,
        waitForBlocks,
    );

    const rewardFactory = await deployContract<RewardFactory>(
        hre,
        new RewardFactory__factory(deployer),
        "RewardFactory",
        [booster.address, token],
        {},
        debug,
        waitForBlocks,
    );

    const tokenFactory = await deployContract<TokenFactory>(
        hre,
        new TokenFactory__factory(deployer),
        "TokenFactory",
        [booster.address, naming.tokenFactoryNamePostfix, naming.cvxSymbol.toLowerCase()],
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
        [token],
        {},
        debug,
        waitForBlocks,
    );

    const cvxCrv = await deployContract<CvxCrvToken>(
        hre,
        new CvxCrvToken__factory(deployer),
        "CvxCrv",
        [naming.cvxCrvName, naming.cvxCrvSymbol],
        {},
        debug,
        waitForBlocks,
    );

    const crvDepositor = await deployContract<CrvDepositor>(
        hre,
        new CrvDepositor__factory(deployer),
        "CrvDepositor",
        [voterProxy.address, cvxCrv.address, tokenBpt, votingEscrow, multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );

    const cvxCrvRewards = await deployContract<BaseRewardPool>(
        hre,
        new BaseRewardPool__factory(deployer),
        "BaseRewardPool",
        [0, cvxCrv.address, token, booster.address, rewardFactory.address],
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
        [poolManagerSecondaryProxy.address, gaugeController, multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );

    const boosterOwner = await deployContract<BoosterOwner>(
        hre,
        new BoosterOwner__factory(deployer),
        "BoosterOwner",
        [
            multisigs.daoMultisig,
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

    const arbitratorVault = await deployContract<ArbitratorVault>(
        hre,
        new ArbitratorVault__factory(deployer),
        "ArbitratorVault",
        [booster.address],
        {},
        debug,
        waitForBlocks,
    );

    const cvxLocker = await deployContract<AuraLocker>(
        hre,
        new AuraLocker__factory(deployer),
        "AuraLocker",
        [naming.vlCvxName, naming.vlCvxSymbol, cvx.address, cvxCrv.address, cvxCrvRewards.address],
        {},
        debug,
        waitForBlocks,
    );

    const crvDepositorWrapper = await deployContract<CrvDepositorWrapper>(
        hre,
        new CrvDepositorWrapper__factory(deployer),
        "CrvDepositorWrapper",
        [crvDepositor.address, config.balancerVault, config.token, config.weth, config.balancerPoolId],
        {},
        debug,
        waitForBlocks,
    );

    const cvxStakingProxy = await deployContract<AuraStakingProxy>(
        hre,
        new AuraStakingProxy__factory(deployer),
        "AuraStakingProxy",
        [
            cvxLocker.address,
            config.token,
            cvx.address,
            cvxCrv.address,
            crvDepositorWrapper.address,
            config.balancerMinOutBps,
        ],
        {},
        debug,
        waitForBlocks,
    );
    const extraRewardsDistributor = await deployContract<ExtraRewardsDistributor>(
        hre,
        new ExtraRewardsDistributor__factory(deployer),
        "ExtraRewardsDistributor",
        [cvxLocker.address],
        {},
        debug,
        waitForBlocks,
    );
    const penaltyForwarder = await deployContract<AuraPenaltyForwarder>(
        hre,
        new AuraPenaltyForwarder__factory(deployer),
        "AuraPenaltyForwarder",
        [extraRewardsDistributor.address, cvx.address, ONE_WEEK.mul(7).div(2), multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );

    let tx = await cvxLocker.addReward(cvxCrv.address, cvxStakingProxy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await cvxLocker.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);

    tx = await crvDepositorWrapper.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);

    tx = await cvxLocker.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await cvxStakingProxy.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);

    if (!!config.keeper && config.keeper != ZERO_ADDRESS) {
        tx = await cvxStakingProxy.setKeeper(config.keeper);
        await waitForTx(tx, debug, waitForBlocks);
    }

    tx = await cvxStakingProxy.setPendingOwner(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await cvxStakingProxy.applyPendingOwner();
    await waitForTx(tx, debug, waitForBlocks);

    tx = await voterProxy.setOperator(booster.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await cvx.init(deployerAddress, minter.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await stashFactory.setImplementation(ZERO_ADDRESS, ZERO_ADDRESS, stashV3.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await cvxCrv.setOperator(crvDepositor.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await voterProxy.setDepositor(crvDepositor.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await voterProxy.setOwner(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    const crvBpt = MockERC20__factory.connect(config.tokenBpt, deployer);
    let crvBptbalance = await crvBpt.balanceOf(deployerAddress);
    if (crvBptbalance.lt(simpleToExactAmount(1))) {
        throw console.error("No crvBPT for initial lock");
    }
    tx = await crvBpt.transfer(voterProxy.address, simpleToExactAmount(1));
    await waitForTx(tx, debug, waitForBlocks);

    tx = await crvDepositor.initialLock();
    await waitForTx(tx, debug, waitForBlocks);

    tx = await crvDepositor.setFeeManager(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setRewardContracts(cvxCrvRewards.address, cvxStakingProxy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setPoolManager(poolManagerProxy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerProxy.setOperator(poolManagerSecondaryProxy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerProxy.setOwner(ZERO_ADDRESS);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerSecondaryProxy.setOperator(poolManager.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerSecondaryProxy.setOwner(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFactories(rewardFactory.address, stashFactory.address, tokenFactory.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await arbitratorVault.setOperator(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setArbitrator(arbitratorVault.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setVoteDelegate(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFees(550, 1100, 50, 0);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFeeManager(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setOwner(boosterOwner.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await extraRewardsDistributor.modifyWhitelist(penaltyForwarder.address, true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await extraRewardsDistributor.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    // -----------------------------
    // 2.2. Token liquidity:
    // - Schedule: vesting streams
    // - Schedule: 2% emission for cvxCrv staking
    // - Create:   cvxCRV/CRV BPT Stableswap
    // - Schedule: chef (or other) & cvxCRV/CRV incentives
    // - Schedule: Airdrop(s)
    // - Schedule: LBP
    // -----------------------------

    // -----------------------------
    // 2.2.1 Schedule: vesting escrow streams
    // -----------------------------

    const currentTime = BN.from((await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp);
    const DELAY = ONE_WEEK;
    const vestingStart = currentTime.add(DELAY);
    const vestedEscrows = [];

    const vestingDistro = distroList.vesting
        .map(v => ({ ...v, admin: multisigs.vestingMultisig }))
        .concat(distroList.immutableVesting.map(v => ({ ...v, admin: ZERO_ADDRESS })));

    for (let i = 0; i < vestingDistro.length; i++) {
        const vestingGroup = vestingDistro[i];
        const groupVestingAmount = vestingGroup.recipients.reduce((p, c) => p.add(c.amount), BN.from(0));
        const vestingEnd = vestingStart.add(vestingGroup.period);

        const vestedEscrow = await deployContract<AuraVestedEscrow>(
            hre,
            new AuraVestedEscrow__factory(deployer),
            "AuraVestedEscrow",
            [cvx.address, vestingGroup.admin, cvxLocker.address, vestingStart, vestingEnd],
            {},
            debug,
            waitForBlocks,
        );

        tx = await cvx.approve(vestedEscrow.address, groupVestingAmount);
        await waitForTx(tx, debug, waitForBlocks);
        const vestingAddr = vestingGroup.recipients.map(m => m.address);
        const vestingAmounts = vestingGroup.recipients.map(m => m.amount);
        tx = await vestedEscrow.fund(vestingAddr, vestingAmounts);
        await waitForTx(tx, debug, waitForBlocks);

        vestedEscrows.push(vestedEscrow);
    }

    // -----------------------------
    // 2.2.2 Schedule: 2% emission for cvxCrv staking
    // -----------------------------

    const initialCvxCrvStaking = await deployContract<AuraBalRewardPool>(
        hre,
        new AuraBalRewardPool__factory(deployer),
        "AuraBalRewardPool",
        [cvxCrv.address, cvx.address, multisigs.treasuryMultisig, cvxLocker.address, penaltyForwarder.address, DELAY],
        {},
        debug,
        waitForBlocks,
    );

    tx = await cvx.transfer(initialCvxCrvStaking.address, distroList.cvxCrvBootstrap);
    await waitForTx(tx, debug, waitForBlocks);

    // -----------------------------
    // 2.2.3 Create: auraBAL/BPT BPT Stableswap
    // https://dev.balancer.fi/resources/deploy-pools-from-factory/creation#deploying-a-pool-with-typescript
    // -----------------------------

    crvBptbalance = await crvBpt.balanceOf(deployerAddress);
    if (crvBptbalance.eq(0)) {
        throw console.error("Uh oh, deployer has no crvBpt");
    }

    const depositAmt = crvBptbalance.div(5).mul(2);

    tx = await crvBpt.approve(crvDepositor.address, depositAmt);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await crvDepositor["deposit(uint256,bool)"](depositAmt, true);
    await waitForTx(tx, debug, waitForBlocks);

    const cvxCrvBalance = await cvxCrv.balanceOf(deployerAddress);
    if (!cvxCrvBalance.eq(depositAmt)) {
        throw console.error("Uh oh, invalid cvxCrv balance");
    }

    let cvxCrvBpt: BalancerPoolDeployed;
    if (chain == Chain.mainnet || chain == Chain.kovan) {
        const [poolTokens, initialBalances] = balHelper.sortTokens(
            [cvxCrv.address, crvBpt.address],
            [cvxCrvBalance, cvxCrvBalance],
        );
        const poolData: BPTData = {
            tokens: poolTokens,
            name: `Balancer ${await cvxCrv.symbol()} Stable Pool`,
            symbol: `B-${await cvxCrv.symbol()}-STABLE`,
            swapFee: simpleToExactAmount(6, 15),
            ampParameter: 25,
        };
        if (debug) {
            console.log(poolData.tokens);
        }

        const poolFactory = IStablePoolFactory__factory.connect(config.balancerPoolFactories.stablePool, deployer);
        tx = await poolFactory.create(
            poolData.name,
            poolData.symbol,
            poolData.tokens,
            poolData.ampParameter,
            poolData.swapFee,
            multisigs.treasuryMultisig,
        );
        const receipt = await waitForTx(tx, debug, waitForBlocks);
        const cvxCrvPoolAddress = getPoolAddress(ethers.utils, receipt);

        const poolId = await IBalancerPool__factory.connect(cvxCrvPoolAddress, deployer).getPoolId();
        cvxCrvBpt = { address: cvxCrvPoolAddress, poolId };
        const balancerVault = IBalancerVault__factory.connect(config.balancerVault, deployer);

        tx = await cvxCrv.approve(config.balancerVault, cvxCrvBalance);
        await waitForTx(tx, debug, waitForBlocks);
        tx = await crvBpt.approve(config.balancerVault, cvxCrvBalance);
        await waitForTx(tx, debug, waitForBlocks);

        const joinPoolRequest = {
            assets: poolTokens,
            maxAmountsIn: initialBalances as BN[],
            userData: ethers.utils.defaultAbiCoder.encode(["uint256", "uint256[]"], [0, initialBalances as BN[]]),
            fromInternalBalance: false,
        };

        tx = await balancerVault.joinPool(poolId, deployerAddress, multisigs.treasuryMultisig, joinPoolRequest);
        await waitForTx(tx, debug, waitForBlocks);
    } else {
        const fakeBpt = await deployContract<MockERC20>(
            hre,
            new MockERC20__factory(deployer),
            "CvxCrvBPT",
            ["Balancer Pool Token 50/50 CRV/CVXCRV", "50/50 CRV/CVXCRV", 18, deployerAddress, 100000],
            {},
            debug,
            waitForBlocks,
        );
        cvxCrvBpt = { address: fakeBpt.address, poolId: ZERO_KEY };
    }

    // -----------------------------
    // 2.2.4 Schedule: chef (or other) & cvxCRV/CRV incentives
    // -----------------------------
    const currentBlock = await ethers.provider.getBlockNumber();
    const chefCvx = distroList.lpIncentives;

    const blocksInDay = BN.from(7000);
    const numberOfBlocks = blocksInDay.mul(365).mul(4); // 4 years
    const rewardPerBlock = chefCvx.div(numberOfBlocks);
    const startBlock = BN.from(currentBlock).add(blocksInDay.mul(7)); //start with small delay

    const chef = await deployContract<ConvexMasterChef>(
        hre,
        new ConvexMasterChef__factory(deployer),
        "Bootstrap",
        [cvx.address, rewardPerBlock, startBlock, startBlock.add(numberOfBlocks)],
        {},
        debug,
        waitForBlocks,
    );

    tx = await cvx.transfer(chef.address, distroList.lpIncentives);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await chef.add(1000, cvxCrvBpt.address, ZERO_ADDRESS);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await chef.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    // -----------------------------
    // 2.2.5 Schedule: Airdrop(s)
    // -----------------------------

    const dropCount = distroList.airdrops.length;
    const drops: AuraMerkleDrop[] = [];
    for (let i = 0; i < dropCount; i++) {
        const { merkleRoot, startDelay, length, amount } = distroList.airdrops[i];
        const airdrop = await deployContract<AuraMerkleDrop>(
            hre,
            new AuraMerkleDrop__factory(deployer),
            "AuraMerkleDrop",
            [
                multisigs.treasuryMultisig,
                merkleRoot,
                cvx.address,
                cvxLocker.address,
                penaltyForwarder.address,
                startDelay,
                length,
            ],
            {},
            debug,
            waitForBlocks,
        );
        tx = await cvx.transfer(airdrop.address, amount);
        await waitForTx(tx, debug, waitForBlocks);
        drops.push(airdrop);
    }

    // -----------------------------
    // 2.2.6 Schedule: LBP & Matching liq
    // -----------------------------

    // If Mainnet or Kovan, create LBP
    let lbpBpt: BalancerPoolDeployed;
    if (chain == Chain.mainnet || chain == Chain.kovan) {
        const { tknAmount, wethAmount } = distroList.lbp;
        const [poolTokens, weights, initialBalances] = balHelper.sortTokens(
            [cvx.address, config.weth],
            [simpleToExactAmount(99, 16), simpleToExactAmount(1, 16)],
            [tknAmount, wethAmount],
        );
        const poolData: BPTData = {
            tokens: poolTokens,
            name: `Balancer ${await cvx.symbol()} WETH LBP`,
            symbol: `B-${await cvx.symbol()}-WETH-LBP`,
            swapFee: simpleToExactAmount(2, 16),
            weights: weights as BN[],
        };
        if (debug) {
            console.log(poolData.tokens);
        }

        const poolFactory = ILBPFactory__factory.connect(config.balancerPoolFactories.bootstrappingPool, deployer);
        tx = await poolFactory.create(
            poolData.name,
            poolData.symbol,
            poolData.tokens,
            poolData.weights,
            poolData.swapFee,
            deployerAddress,
            false,
        );
        const receipt = await waitForTx(tx, debug, waitForBlocks);
        const poolAddress = getPoolAddress(ethers.utils, receipt);
        const poolId = await IBalancerPool__factory.connect(poolAddress, deployer).getPoolId();
        lbpBpt = { address: poolAddress, poolId };
        const balancerVault = IBalancerVault__factory.connect(config.balancerVault, deployer);

        tx = await MockERC20__factory.connect(config.weth, deployer).approve(config.balancerVault, wethAmount);
        await waitForTx(tx, debug, waitForBlocks);
        tx = await cvx.approve(config.balancerVault, tknAmount);
        await waitForTx(tx, debug, waitForBlocks);

        const joinPoolRequest = {
            assets: poolTokens,
            maxAmountsIn: initialBalances as BN[],
            userData: ethers.utils.defaultAbiCoder.encode(["uint256", "uint256[]"], [0, initialBalances as BN[]]),
            fromInternalBalance: false,
        };

        tx = await balancerVault.joinPool(poolId, deployerAddress, multisigs.treasuryMultisig, joinPoolRequest);
        await waitForTx(tx, debug, waitForBlocks);
    }
    // Else just make a fake one to move tokens
    else {
        lbpBpt = { address: DEAD_ADDRESS, poolId: ZERO_KEY };
        tx = await cvx.transfer(DEAD_ADDRESS, distroList.lbp.tknAmount);
        await waitForTx(tx, debug, waitForBlocks);
        tx = await MockERC20__factory.connect(config.weth, deployer).transfer(DEAD_ADDRESS, distroList.lbp.wethAmount);
        await waitForTx(tx, debug, waitForBlocks);
    }

    const balLiquidityProvider = await deployContract<BalLiquidityProvider>(
        hre,
        new BalLiquidityProvider__factory(deployer),
        "BalLiquidityProvider",
        [cvx.address, config.weth, simpleToExactAmount(375), multisigs.treasuryMultisig, config.balancerVault],
        {},
        debug,
        waitForBlocks,
    );

    tx = await cvx.transfer(balLiquidityProvider.address, distroList.lbp.matching);
    await waitForTx(tx, debug, waitForBlocks);

    const balance = await cvx.balanceOf(deployerAddress);
    if (balance.gt(0)) {
        throw console.error("Uh oh, deployer still has CVX to distribute: ", balance.toString());
    }

    return {
        ...deployment,
        cvx,
        minter,
        booster,
        boosterOwner,
        factories: {
            rewardFactory,
            stashFactory,
            tokenFactory,
            proxyFactory,
        },
        arbitratorVault,
        cvxCrv,
        cvxCrvBpt,
        cvxCrvRewards,
        initialCvxCrvStaking,
        crvDepositor,
        crvDepositorWrapper,
        poolManager,
        cvxLocker,
        cvxStakingProxy,
        chef,
        vestedEscrows,
        drops,
        lbpBpt,
        balLiquidityProvider,
        penaltyForwarder,
        extraRewardsDistributor,
        poolManagerProxy,
        poolManagerSecondaryProxy,
    };
}

async function deployPhase3(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    deployment: Phase2Deployed,
    multisigs: MultisigConfig,
    config: ExtSystemConfig,
    debug = false,
    waitForBlocks = 0,
): Promise<Phase3Deployed> {
    const { ethers } = hre;
    const chain = getChain(hre);
    const deployer = signer;
    const balHelper = new AssetHelpers(config.weth);

    const { cvx, balLiquidityProvider } = deployment;

    // PRE-3: TreasuryDAO: LBP.withdraw
    //        TreasuryDAO: WETH.transfer(liqProvider)
    //        TreasuryDAO: AURA.transfer(liqProvider)
    // -----------------------------
    // 3: Liquidity from LBP taken and used for AURA/ETH pool
    //     - create: TKN/ETH 80/20 BPT
    //     - fund: liq
    // -----------------------------
    // POST-3: MerkleDrops && 2% cvxCRV staking manual trigger

    // If Mainnet or Kovan, create LBP
    let tx: ContractTransaction;
    let pool: BalancerPoolDeployed = { address: DEAD_ADDRESS, poolId: ZERO_KEY };
    if (chain == Chain.mainnet || chain == Chain.kovan) {
        const tknAmount = await cvx.balanceOf(balLiquidityProvider.address);
        const wethAmount = await MockERC20__factory.connect(config.weth, deployer).balanceOf(
            balLiquidityProvider.address,
        );
        if (tknAmount.lt(simpleToExactAmount(1.5, 24)) || wethAmount.lt(simpleToExactAmount(375))) {
            console.log(tknAmount.toString(), wethAmount.toString());
            throw console.error("Invalid balances");
        }
        const [poolTokens, weights, initialBalances] = balHelper.sortTokens(
            [cvx.address, config.weth],
            [simpleToExactAmount(80, 16), simpleToExactAmount(20, 16)],
            [tknAmount, wethAmount],
        );
        const poolData: BPTData = {
            tokens: poolTokens,
            name: `Balancer 80 ${await cvx.symbol()} 20 WETH`,
            symbol: `B-80${await cvx.symbol()}-20WETH`,
            swapFee: simpleToExactAmount(1, 16),
            weights: weights as BN[],
        };
        if (debug) {
            console.log(poolData.tokens);
        }

        const poolFactory = IWeightedPool2TokensFactory__factory.connect(
            config.balancerPoolFactories.weightedPool2Tokens,
            deployer,
        );
        tx = await poolFactory.create(
            poolData.name,
            poolData.symbol,
            poolData.tokens,
            poolData.weights,
            poolData.swapFee,
            true,
            !!config.balancerPoolOwner && config.balancerPoolOwner != ZERO_ADDRESS
                ? config.balancerPoolOwner
                : multisigs.treasuryMultisig,
        );
        const receipt = await waitForTx(tx, debug, waitForBlocks);
        const poolAddress = getPoolAddress(ethers.utils, receipt);

        const poolId = await IBalancerPool__factory.connect(poolAddress, deployer).getPoolId();
        pool = { address: poolAddress, poolId };
        const joinPoolRequest = {
            assets: poolTokens,
            maxAmountsIn: initialBalances as BN[],
            userData: ethers.utils.defaultAbiCoder.encode(["uint256", "uint256[]"], [0, initialBalances as BN[]]),
            fromInternalBalance: false,
        };

        tx = await balLiquidityProvider.provideLiquidity(poolId, joinPoolRequest);
        await waitForTx(tx, debug, waitForBlocks);
    }

    return { ...deployment, pool8020Bpt: pool };
}

async function deployPhase4(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    deployment: Phase3Deployed,
    config: ExtSystemConfig,
    debug = false,
    waitForBlocks = 0,
): Promise<SystemDeployed> {
    const deployer = signer;

    const { token, gauges, feeDistribution } = config;
    const { cvx, cvxCrv, cvxLocker, cvxCrvRewards, poolManager, crvDepositorWrapper } = deployment;

    // PRE-4: daoMultisig.setProtectPool(false)
    //        daoMultisig.setFeeInfo(bbaUSD distro)
    //        daoMultisig.setFeeInfo($BAL distro)
    // -----------------------------
    // 4. Pool creation etc
    //     - Claimzap
    //     - All initial gauges
    // -----------------------------

    const claimZap = await deployContract<AuraClaimZap>(
        hre,
        new AuraClaimZap__factory(deployer),
        "AuraClaimZap",
        [token, cvx.address, cvxCrv.address, crvDepositorWrapper.address, cvxCrvRewards.address, cvxLocker.address],
        {},
        debug,
        waitForBlocks,
    );

    let tx = await claimZap.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);

    const gaugeLength = gauges.length;
    const gaugeController = IGaugeController__factory.connect(config.gaugeController, deployer);
    for (let i = 0; i < gaugeLength; i++) {
        if (gaugeLength > 10) {
            const weight = await gaugeController.get_gauge_weight(gauges[i]);
            if (weight.lt(simpleToExactAmount(15000))) continue;
        }
        tx = await poolManager["addPool(address)"](gauges[i]);
        await waitForTx(tx, debug, waitForBlocks);
    }

    const feeCollector = await deployContract<ClaimFeesHelper>(
        hre,
        new ClaimFeesHelper__factory(deployer),
        "ClaimFeesHelper",
        [deployment.booster.address, deployment.voterProxy.address, feeDistribution || ZERO_ADDRESS],
        {},
        debug,
        waitForBlocks,
    );

    const rewardDepositWrapper = await deployContract<RewardPoolDepositWrapper>(
        hre,
        new RewardPoolDepositWrapper__factory(deployer),
        "RewardPoolDepositWrapper",
        [config.balancerVault],
        {},
        debug,
        waitForBlocks,
    );

    return { ...deployment, claimZap, feeCollector, rewardDepositWrapper };
}

async function deployTempBooster(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
): Promise<TempBooster> {
    const deployer = signer;
    return deployContract<TempBooster>(
        hre,
        new TempBooster__factory(deployer),
        "TempBooster",
        [],
        {},
        debug,
        waitForBlocks,
    );
}

async function deployPhase5(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    deployment: Phase4Deployed,
    multisigs: MultisigConfig,
    config: ExtSystemConfig,
    debug = false,
    waitForBlocks = 0,
): Promise<Phase5Deployed> {
    const deployer = signer;

    const {
        token,
        balancerPoolFactories,
        balancerVault,
        balancerGaugeFactory,
        uniswapRouter,
        sushiswapRouter,
        balancerPoolOwner,
    } = config;
    const { booster, crvDepositor, voterProxy } = deployment;

    // -----------------------------
    // 5. Helpers
    //     - boosterHelper
    //     - gaugeMigrator
    //     - uniswapMigrator
    // -----------------------------
    const boosterHelper = await deployContract<BoosterHelper>(
        hre,
        new BoosterHelper__factory(deployer),
        "BoosterHelper",
        [booster.address, token],
        {},
        debug,
        waitForBlocks,
    );

    const gaugeMigrator = await deployContract<GaugeMigrator>(
        hre,
        new GaugeMigrator__factory(deployer),
        "GaugeMigrator",
        [booster.address],
        {},
        debug,
        waitForBlocks,
    );
    const uniswapMigrator = await deployContract<UniswapMigrator>(
        hre,
        new UniswapMigrator__factory(deployer),
        "UniswapMigrator",
        [
            balancerPoolFactories.weightedPool,
            balancerVault,
            balancerGaugeFactory,
            uniswapRouter,
            sushiswapRouter,
            balancerPoolOwner,
        ],
        {},
        debug,
        waitForBlocks,
    );
    const crvDepositorWrapperWithFee = await deployContract<CrvDepositorWrapperWithFee>(
        hre,
        new CrvDepositorWrapperWithFee__factory(deployer),
        "CrvDepositorWrapperWithFee",
        [
            crvDepositor.address,
            config.balancerVault,
            config.token,
            config.weth,
            config.balancerPoolId,
            booster.address,
            voterProxy.address,
            multisigs.daoMultisig,
        ],
        {},
        debug,
        waitForBlocks,
    );
    const tx = await crvDepositorWrapperWithFee.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);
    return { ...deployment, boosterHelper, gaugeMigrator, uniswapMigrator, crvDepositorWrapperWithFee };
}

// -----------------------------
// 6   Upgrade of booster and dependencies
// 6.1 Core system:  Deployment
// 6.2 Core system:  Configurations
// -----------------------------
async function deployPhase6(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    deployment: Phase2Deployed,
    multisigs: MultisigConfig,
    naming: NamingConfig,
    extConfig: ExtSystemConfig,
    debug = false,
    waitForBlocks = 0,
): Promise<Phase6Deployed> {
    // -----------------------------
    // 6.1 Core system:
    //     - booster
    //     - factories (reward, token, proxy, stash, stashV3)
    //     - cvxCrvRewards
    //     - pool management (poolManager + 2x proxies)
    //     - boosterOwner
    //     - helpers (boosterHelper, feeCollector, claimZap, poolMigrator)
    // -----------------------------

    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    const { token, gaugeController, voteOwnership, voteParameter, feeDistribution } = extConfig;

    const {
        arbitratorVault,
        booster: boosterV1,
        cvxLocker,
        voterProxy,
        cvx,
        cvxCrv,
        cvxStakingProxy,
        crvDepositorWrapper,
    } = deployment;

    let tx: ContractTransaction;

    const booster = await deployContract<Booster>(
        hre,
        new Booster__factory(deployer),
        "Booster",
        [voterProxy.address, cvx.address, token, voteOwnership, voteParameter],
        {},
        debug,
        waitForBlocks,
    );

    const rewardFactory = await deployContract<RewardFactory>(
        hre,
        new RewardFactory__factory(deployer),
        "RewardFactory",
        [booster.address, token],
        {},
        debug,
        waitForBlocks,
    );

    const tokenFactory = await deployContract<TokenFactory>(
        hre,
        new TokenFactory__factory(deployer),
        "TokenFactory",
        [booster.address, naming.tokenFactoryNamePostfix, naming.cvxSymbol.toLowerCase()],
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
        [token],
        {},
        debug,
        waitForBlocks,
    );

    const cvxCrvRewards = await deployContract<BaseRewardPool>(
        hre,
        new BaseRewardPool__factory(deployer),
        "BaseRewardPool",
        [0, cvxCrv.address, token, booster.address, rewardFactory.address],
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
        [poolManagerSecondaryProxy.address, gaugeController, multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );

    const boosterOwner = await deployContract<BoosterOwner>(
        hre,
        new BoosterOwner__factory(deployer),
        "BoosterOwner",
        [
            multisigs.daoMultisig,
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

    const boosterHelper = await deployContract<BoosterHelper>(
        hre,
        new BoosterHelper__factory(deployer),
        "BoosterHelper",
        [booster.address, token],
        {},
        debug,
        waitForBlocks,
    );

    const feeCollector = await deployContract<ClaimFeesHelper>(
        hre,
        new ClaimFeesHelper__factory(deployer),
        "ClaimFeesHelper",
        [booster.address, voterProxy.address, feeDistribution || ZERO_ADDRESS],
        {},
        debug,
        waitForBlocks,
    );

    const claimZap = await deployContract<AuraClaimZap>(
        hre,
        new AuraClaimZap__factory(deployer),
        "AuraClaimZap",
        [token, cvx.address, cvxCrv.address, crvDepositorWrapper.address, cvxCrvRewards.address, cvxLocker.address],
        {},
        debug,
        waitForBlocks,
    );

    const poolMigrator = await deployContract<PoolMigrator>(
        hre,
        new PoolMigrator__factory(deployer),
        "PoolMigrator",
        [boosterV1.address, booster.address],
        {},
        debug,
        waitForBlocks,
    );

    // -----------------------------
    // 6.2: Configurations
    //     - booster (setRewardContracts, setPoolManager, setVoteDelegate, setFees, setFeeInfo, setFeeInfo, setTreasury, setFeeManager, setOwner)
    //     - factories (stashFactory.setImplementation)
    //     - pool management (poolManagerProxy.setOperator poolManagerProxy.setOwner, poolManagerSecondaryProxy.setOperator,  poolManagerSecondaryProxy.setOwner)
    // -----------------------------

    tx = await claimZap.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setRewardContracts(cvxCrvRewards.address, cvxStakingProxy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setPoolManager(poolManagerProxy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerProxy.setOperator(poolManagerSecondaryProxy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerProxy.setOwner(ZERO_ADDRESS);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerSecondaryProxy.setOperator(poolManager.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerSecondaryProxy.setUsedAddress([token, cvx.address]);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolManagerSecondaryProxy.setOwner(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFactories(rewardFactory.address, stashFactory.address, tokenFactory.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setArbitrator(arbitratorVault.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setVoteDelegate(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await stashFactory.setImplementation(ZERO_ADDRESS, ZERO_ADDRESS, stashV3.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFees(2050, 400, 50, 0);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFeeInfo(extConfig.token, extConfig.feeDistribution);
    await waitForTx(tx, debug, waitForBlocks);

    if (extConfig.feeToken) {
        tx = await booster.setFeeInfo(extConfig.feeToken, extConfig.feeDistribution);
        await waitForTx(tx, debug, waitForBlocks);
    } else {
        console.log("!warning feeToken not provided");
    }

    tx = await booster.setTreasury(multisigs.treasuryMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setFeeManager(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await booster.setOwner(boosterOwner.address);
    await waitForTx(tx, debug, waitForBlocks);

    return {
        booster,
        boosterOwner,
        boosterHelper,
        feeCollector,
        factories: {
            rewardFactory,
            stashFactory,
            tokenFactory,
            proxyFactory,
        },
        cvxCrvRewards,
        poolManager,
        poolManagerProxy,
        poolManagerSecondaryProxy,
        claimZap,
        stashV3,
        poolMigrator,
    };
}

// -----------------------------
// 7   Deploys MasterChefRewardHook and SiphonToken
// -----------------------------
async function deployPhase7(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    phase2: Phase2Deployed,
    auraBalStash: string,
    debug = false,
    waitForBlocks = 0,
): Promise<Phase7Deployed> {
    const { chef, cvx } = phase2;

    const masterChefRewardHook = await deployContract<MasterChefRewardHook>(
        hre,
        new MasterChefRewardHook__factory(signer),
        "MasterChefRewardHook",
        [auraBalStash, chef.address, cvx.address],
        {},
        debug,
        waitForBlocks,
    );

    const siphonToken = await deployContract<SiphonToken>(
        hre,
        new SiphonToken__factory(signer),
        "SiphonToken",
        [masterChefRewardHook.address, simpleToExactAmount(1)],
        {},
        debug,
        waitForBlocks,
    );

    // -----------------------------
    // POST-7: Setup MasterChefRewardHook (setPid, transferOwnership)
    //  -  boosterOwner (setStashExtraReward, setStashRewardHook)

    return { masterChefRewardHook, siphonToken };
}

// -----------------------------
// 8   Deploys PoolManagerV4, BoosterOwnerSecondary
// -----------------------------
async function deployPhase8(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    phase6: Phase6Deployed,
    multisigs: MultisigConfig,
    debug = false,
    waitForBlocks = 0,
): Promise<Phase8Deployed> {
    const poolManagerV4 = await deployContract<PoolManagerV4>(
        hre,
        new PoolManagerV4__factory(signer),
        "PoolManagerV4",
        [phase6.poolManagerSecondaryProxy.address, multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );

    const boosterOwnerSecondary = await deployContract<BoosterOwnerSecondary>(
        hre,
        new BoosterOwnerSecondary__factory(signer),
        "BoosterOwnerSecondary",
        [multisigs.daoMultisig, phase6.boosterOwner.address, phase6.booster.address],
        {},
        debug,
        waitForBlocks,
    );

    return {
        boosterOwnerSecondary,
        poolManagerV4,
    };
}
/**
 *   9   Upgrades to PoolFeeManagerProxy
 *   DAO Txs to execute
 *
 *   9.1.- PoolManagerV4.connect(Multisig).setOperator(poolFeeManagerProxy)
 *
 *   9.2.- Change the fee manager from Ms to V5
 *   BoosterOwnerSecondary.connect(Multisig).setFeeManager(poolFeeManagerProxy)
 *       |- BoosterOwner.connect(BoosterOwnerSecondary).setFeeManager(poolFeeManagerProxy)
 *       |- Booster.connect(BoosterOwner).setFeeManager(poolFeeManagerProxy)
 *
 *   To Revert the changes.
 *   PoolFeeManagerProxy.connect(poolFeeManagerProxy).setPoolManager(poolManagerV4) => Not able to change
 *   BoosterOwnerSecondary.connect(Multisig).setFeeManager(Multisig)
 */
async function deployPhase9(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    extConfig: ExtSystemConfig,
    phase8: Phase6Deployed & Phase8Deployed,
    multisigs: MultisigConfig,
    salt: string = SALT,
    debug = false,
    waitForBlocks = 0,
): Promise<Phase9Deployed> {
    const create2Factory = Create2Factory__factory.connect(extConfig.create2Factory, signer);
    const deployOptionsWithCallbacks = (callbacks: string[] = []) =>
        create2OptionsWithCallbacks(salt, callbacks, debug, waitForBlocks);

    const deployerAddress = await signer.getAddress();
    const poolFeeManagerProxy = await deployContractWithCreate2<PoolFeeManagerProxy, PoolFeeManagerProxy__factory>(
        hre,
        create2Factory,
        new PoolFeeManagerProxy__factory(signer),
        "PoolFeeManagerProxy",
        [phase8.poolManagerV4.address, phase8.booster.address, deployerAddress],
        deployOptionsWithCallbacks([]),
    );

    let tx = await poolFeeManagerProxy.setDefaultRewardMultiplier(4000);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await poolFeeManagerProxy.setOperator(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    return { poolFeeManagerProxy };
}
async function deployCrvDepositorWrapperForwarder(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    phase2Extended: Phase2Deployed & { stashRewardDistro: StashRewardDistro; pid: number },
    config: ExtSystemConfig,
    debug = false,
    waitForBlocks = 0,
): Promise<{ crvDepositorWrapperForwarder: CrvDepositorWrapperForwarder }> {
    const { crvDepositor, cvxCrv, stashRewardDistro, pid } = phase2Extended;

    const crvDepositorWrapperForwarder = await deployContract<CrvDepositorWrapperForwarder>(
        hre,
        new CrvDepositorWrapperForwarder__factory(signer),
        "CrvDepositorWrapperForwarder",
        [
            crvDepositor.address,
            config.balancerVault,
            config.token,
            config.weth,
            config.balancerPoolId,
            cvxCrv.address,
            stashRewardDistro.address,
            pid,
        ],
        {},
        debug,
        waitForBlocks,
    );
    return {
        crvDepositorWrapperForwarder,
    };
}
async function deployCrvDepositorWrapperForwarderV2(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    phase2Extended: Phase2Deployed & { stashRewardDistro: StashRewardDistro; pid: number },
    config: ExtSystemConfig,
    debug = false,
    waitForBlocks = 0,
): Promise<{ crvDepositorWrapperForwarderV2: CrvDepositorWrapperForwarderV2 }> {
    const { cvxCrv, stashRewardDistro, pid, cvxCrvBpt } = phase2Extended;

    const crvDepositorWrapperForwarderV2 = await deployContract<CrvDepositorWrapperForwarderV2>(
        hre,
        new CrvDepositorWrapperForwarderV2__factory(signer),
        "CrvDepositorWrapperForwarderV2",
        [
            config.balancerVault,
            config.token,
            config.weth,
            config.balancerPoolId,
            cvxCrv.address,
            cvxCrvBpt.poolId,
            stashRewardDistro.address,
            pid,
        ],
        {},
        debug,
        waitForBlocks,
    );
    return {
        crvDepositorWrapperForwarderV2,
    };
}
async function deployCrvDepositorWrapperSwapper(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    phase2: Phase2Deployed,
    config: ExtSystemConfig,
    debug = false,
    waitForBlocks = 0,
): Promise<{ crvDepositorWrapperSwapper: CrvDepositorWrapperSwapper }> {
    const { cvxCrv, cvxCrvBpt } = phase2;

    const crvDepositorWrapperSwapper = await deployContract<CrvDepositorWrapperSwapper>(
        hre,
        new CrvDepositorWrapperSwapper__factory(signer),
        "CrvDepositorWrapperSwapper",
        [config.balancerVault, config.token, config.weth, config.balancerPoolId, cvxCrv.address, cvxCrvBpt.poolId],
        {},
        debug,
        waitForBlocks,
    );
    const tx = await crvDepositorWrapperSwapper.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);
    return {
        crvDepositorWrapperSwapper,
    };
}
export {
    DistroList,
    MultisigConfig,
    ExtSystemConfig,
    BalancerPoolDeployed,
    NamingConfig,
    deployPhase1,
    Phase1Deployed,
    deployPhase2,
    Phase2Deployed,
    deployPhase3,
    Phase3Deployed,
    deployPhase4,
    SystemDeployed,
    Phase4Deployed,
    deployTempBooster,
    deployCrvDepositorWrapperForwarder,
    deployCrvDepositorWrapperForwarderV2,
    deployCrvDepositorWrapperSwapper,
    deployPhase5,
    Phase5Deployed,
    deployPhase6,
    Phase6Deployed,
    deployPhase7,
    Phase7Deployed,
    deployPhase8,
    Phase8Deployed,
    deployPhase9,
    Phase9Deployed,
    PoolsSnapshot,
};
