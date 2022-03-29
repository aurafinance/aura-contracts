import { BigNumber as BN, ContractReceipt, ContractTransaction, Signer } from "ethers";
import {
    IInvestmentPoolFactory__factory,
    MockWalletChecker__factory,
    MockCurveVoteEscrow__factory,
    BoosterOwner__factory,
    BoosterOwner,
    ClaimZap__factory,
    ClaimZap,
    BalLiquidityProvider,
    BalLiquidityProvider__factory,
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
    CrvDepositorWrapper,
    CrvDepositorWrapper__factory,
    MerkleAirdrop,
    IWeightedPool2TokensFactory__factory,
    IStablePoolFactory__factory,
} from "../types/generated";
import { AssetHelpers } from "@balancer-labs/balancer-js";
import { Chain, deployContract } from "../tasks/utils";
import { ZERO_ADDRESS, DEAD_ADDRESS, ONE_WEEK, ZERO_KEY } from "../test-utils/constants";
import { simpleToExactAmount } from "../test-utils/math";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getChain } from "../tasks/utils/networkAddressFactory";

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
    vesting: VestingGroup[];
}
interface BalancerPoolFactories {
    weightedPool2Tokens: string;
    stablePool: string;
    investmentPool: string;
}
interface ExtSystemConfig {
    authorizerAdapter?: string;
    token: string;
    tokenBpt: string;
    tokenWhale?: string;
    minter: string;
    votingEscrow: string;
    feeDistribution: string;
    nativeTokenDistribution?: string;
    gaugeController: string;
    voteOwnership?: string;
    voteParameter?: string;
    gauges?: string[];
    balancerVault: string;
    balancerPoolFactories: BalancerPoolFactories;
    balancerPoolId: string;
    balancerMinOutBps: string;
    weth: string;
    wethWhale?: string;
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
    voterProxy: CurveVoterProxy;
}

interface Phase2Deployed extends Phase1Deployed {
    cvx: AuraToken;
    minter: AuraMinter;
    booster: Booster;
    boosterOwner: BoosterOwner;
    cvxCrv: CvxCrvToken;
    cvxCrvBpt: BalancerPoolDeployed;
    cvxCrvRewards: BaseRewardPool;
    initialCvxCrvStaking: BaseRewardPool;
    crvDepositor: CrvDepositor;
    crvDepositorWrapper: CrvDepositorWrapper;
    poolManager: PoolManagerV3;
    voterProxy: CurveVoterProxy;
    cvxLocker: AuraLocker;
    cvxStakingProxy: AuraStakingProxy;
    chef: ConvexMasterChef;
    vestedEscrows: VestedEscrow[];
    dropFactory: MerkleAirdropFactory;
    drops: MerkleAirdrop[];
    lbpBpt: BalancerPoolDeployed;
    balLiquidityProvider: BalLiquidityProvider;
}

interface Phase3Deployed extends Phase2Deployed {
    pool8020Bpt: BalancerPoolDeployed;
}
interface SystemDeployed extends Phase3Deployed {
    claimZap: ClaimZap;
}

async function waitForTx(tx: ContractTransaction, debug = false): Promise<ContractReceipt> {
    const receipt = await tx.wait(debug ? 3 : undefined);
    if (debug) {
        console.log(`\nTRANSACTION: ${receipt.transactionHash}`);
        console.log(`to:: ${tx.to}`);
        console.log(`txData:: ${tx.data}`);
    }
    return receipt;
}

function getPoolAddress(utils, receipt: ContractReceipt): string {
    const event = receipt.events.find(e => e.topics[0] === utils.keccak256(utils.toUtf8Bytes("PoolCreated(address)")));
    return utils.hexStripZeros(event.topics[1]);
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
        [extSystem.minter, extSystem.token, extSystem.tokenBpt, extSystem.votingEscrow, extSystem.gaugeController],
        {},
        debug,
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
): Promise<Phase2Deployed> {
    const { ethers } = hre;
    const chain = getChain(hre);
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();
    const balHelper = new AssetHelpers(config.weth);

    const {
        token,
        tokenBpt,
        votingEscrow,
        gaugeController,
        feeDistribution,
        nativeTokenDistribution,
        voteOwnership,
        voteParameter,
    } = config;
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
    //     TODO - ensure all places using vlCVX (i.e. vesting & lockdrop) are updated
    //     - vlCVX + ((stkCVX && stakerProxy) || fix)
    // -----------------------------

    const premineIncetives = distroList.lpIncentives
        .add(distroList.airdrops.reduce((p, c) => p.add(c.amount), BN.from(0)))
        .add(distroList.cvxCrvBootstrap)
        .add(distroList.lbp.tknAmount)
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
        [voterProxy.address, cvx.address, token, voteOwnership, voteParameter],
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
        [voterProxy.address, cvxCrv.address, tokenBpt, votingEscrow, multisigs.daoMultisig],
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
        [booster.address, deployerAddress],
        {},
        debug,
    );

    const poolManagerSecondaryProxy = await deployContract<PoolManagerSecondaryProxy>(
        new PoolManagerSecondaryProxy__factory(deployer),
        "PoolManagerProxy",
        [gaugeController, poolManagerProxy.address, booster.address, deployerAddress],
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

    const cvxLocker = await deployContract<AuraLocker>(
        new AuraLocker__factory(deployer),
        "AuraLocker",
        [naming.vlCvxName, naming.vlCvxSymbol, cvx.address, cvxCrv.address, cvxCrvRewards.address],
        {},
        debug,
    );

    const crvDepositorWrapper = await deployContract<CrvDepositorWrapper>(
        new CrvDepositorWrapper__factory(deployer),
        "CrvDepositorWrapper",
        [crvDepositor.address, config.balancerVault, config.token, config.weth, config.balancerPoolId],
        {},
        debug,
    );

    const cvxStakingProxy = await deployContract<AuraStakingProxy>(
        new AuraStakingProxy__factory(deployer),
        "AuraStakingProxy",
        [cvxLocker.address, config.token, cvx.address, cvxCrv.address, crvDepositorWrapper.address, 9980],
        {},
        debug,
    );
    let tx = await cvxLocker.addReward(cvxCrv.address, cvxStakingProxy.address);
    await waitForTx(tx, debug);

    tx = await cvxLocker.setApprovals();
    await waitForTx(tx, debug);

    tx = await crvDepositorWrapper.setApprovals();
    await waitForTx(tx, debug);

    tx = await cvxLocker.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug);

    tx = await cvxStakingProxy.setApprovals();
    await waitForTx(tx, debug);

    tx = await voterProxy.setOperator(booster.address);
    await waitForTx(tx, debug);

    tx = await cvx.init(deployerAddress, premine.toString(), minter.address);
    await waitForTx(tx, debug);

    tx = await stashFactory.setImplementation(ZERO_ADDRESS, ZERO_ADDRESS, stashV3.address);
    await waitForTx(tx, debug);

    tx = await cvxCrv.setOperator(crvDepositor.address);
    await waitForTx(tx, debug);

    tx = await voterProxy.setDepositor(crvDepositor.address);
    await waitForTx(tx, debug);

    tx = await voterProxy.setOwner(multisigs.daoMultisig);
    await waitForTx(tx, debug);

    const crvBpt = MockERC20__factory.connect(config.tokenBpt, deployer);
    let crvBptbalance = await crvBpt.balanceOf(deployerAddress);
    if (crvBptbalance.lt(simpleToExactAmount(1))) {
        throw console.error("No crvBPT for initial lock");
    }
    tx = await crvBpt.transfer(voterProxy.address, simpleToExactAmount(1));
    await waitForTx(tx, debug);

    tx = await crvDepositor.initialLock();
    await waitForTx(tx, debug);

    tx = await crvDepositor.setFeeManager(multisigs.daoMultisig);
    await waitForTx(tx, debug);

    tx = await booster.setRewardContracts(cvxCrvRewards.address, cvxStakingProxy.address);
    await waitForTx(tx, debug);

    tx = await booster.setPoolManager(poolManagerProxy.address);
    await waitForTx(tx, debug);

    tx = await poolManagerProxy.setOperator(poolManagerSecondaryProxy.address);
    await waitForTx(tx, debug);

    tx = await poolManagerProxy.setOwner(multisigs.daoMultisig);
    await waitForTx(tx, debug);

    tx = await poolManagerSecondaryProxy.setOperator(poolManager.address);
    await waitForTx(tx, debug);

    tx = await poolManagerSecondaryProxy.setOwner(multisigs.daoMultisig);
    await waitForTx(tx, debug);

    tx = await booster.setFactories(rewardFactory.address, stashFactory.address, tokenFactory.address);
    await waitForTx(tx, debug);

    if (!!nativeTokenDistribution && nativeTokenDistribution != ZERO_ADDRESS) {
        tx = await booster.setFeeInfo(nativeTokenDistribution);
        await waitForTx(tx, debug);
    }

    if (!!feeDistribution && feeDistribution != ZERO_ADDRESS) {
        tx = await booster.setFeeInfo(feeDistribution);
        await waitForTx(tx, debug);
    }

    tx = await booster.setArbitrator(arbitratorVault.address);
    await waitForTx(tx, debug);

    tx = await booster.setVoteDelegate(multisigs.daoMultisig);
    await waitForTx(tx, debug);

    tx = await booster.setFeeManager(multisigs.daoMultisig);
    await waitForTx(tx, debug);

    tx = await booster.setOwner(boosterOwner.address);
    await waitForTx(tx, debug);

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
        await waitForTx(tx, debug);
        tx = await vestedEscrow.addTokens(groupVestingAmount);
        await waitForTx(tx, debug);
        const vestingAddr = vestingGroup.recipients.map(m => m.address);
        const vestingAmounts = vestingGroup.recipients.map(m => m.amount);
        tx = await vestedEscrow.fund(vestingAddr, vestingAmounts);
        await waitForTx(tx, debug);

        vestedEscrows.push(vestedEscrow);
    }

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
    await waitForTx(tx, debug);

    // TODO - replace queueNewRewards
    tx = await initialCvxCrvStaking.queueNewRewards(distroList.cvxCrvBootstrap);
    await waitForTx(tx, debug);

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
    await waitForTx(tx, debug);

    tx = await crvDepositor["deposit(uint256,bool)"](depositAmt, true);
    await waitForTx(tx, debug);

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
            swapFee: simpleToExactAmount(1, 15),
            ampParameter: 25,
        };
        console.log(poolData.tokens);

        const poolFactory = IStablePoolFactory__factory.connect(config.balancerPoolFactories.stablePool, deployer);
        tx = await poolFactory.create(
            poolData.name,
            poolData.symbol,
            poolData.tokens,
            poolData.ampParameter,
            poolData.swapFee,
            multisigs.treasuryMultisig,
        );
        const receipt = await waitForTx(tx, debug);
        const cvxCrvPoolAddress = getPoolAddress(ethers.utils, receipt);

        const poolId = await IBalancerPool__factory.connect(cvxCrvPoolAddress, deployer).getPoolId();
        cvxCrvBpt = { address: cvxCrvPoolAddress, poolId };
        const balancerVault = IBalancerVault__factory.connect(config.balancerVault, deployer);

        tx = await cvxCrv.approve(config.balancerVault, cvxCrvBalance);
        await waitForTx(tx, debug);
        tx = await crvBpt.approve(config.balancerVault, cvxCrvBalance);
        await waitForTx(tx, debug);

        const joinPoolRequest = {
            assets: poolTokens,
            maxAmountsIn: initialBalances as BN[],
            userData: ethers.utils.defaultAbiCoder.encode(["uint256", "uint256[]"], [0, initialBalances as BN[]]),
            fromInternalBalance: false,
        };

        tx = await balancerVault.joinPool(poolId, deployerAddress, deployerAddress, joinPoolRequest);
        await waitForTx(tx, debug);
    } else {
        const fakeBpt = await deployContract<MockERC20>(
            new MockERC20__factory(deployer),
            "CvxCrvBPT",
            ["Balancer Pool Token 50/50 CRV/CVXCRV", "50/50 CRV/CVXCRV", 18, deployerAddress, 100000],
            {},
            debug,
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
        new ConvexMasterChef__factory(deployer),
        "Bootstrap",
        [cvx.address, rewardPerBlock, startBlock, startBlock.add(numberOfBlocks)],
        {},
        debug,
    );

    tx = await cvx.transfer(chef.address, distroList.lpIncentives);
    await waitForTx(tx, debug);

    tx = await chef.add(1000, cvxCrvBpt.address, ZERO_ADDRESS, false);
    await waitForTx(tx, debug);

    tx = await chef.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug);

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
    const drops: MerkleAirdrop[] = [];
    for (let i = 0; i < dropCount; i++) {
        const { merkleRoot, amount } = distroList.airdrops[i];
        tx = await dropFactory.CreateMerkleAirdrop();
        const txReceipt = await waitForTx(tx, debug);
        const merkleDropAddr = txReceipt.events[0].args[0];
        const airdrop = MerkleAirdrop__factory.connect(merkleDropAddr, deployer);
        drops.push(airdrop);
        tx = await airdrop.setRewardToken(cvx.address);
        await waitForTx(tx, debug);
        tx = await cvx.transfer(airdrop.address, amount);
        await waitForTx(tx, debug);
        tx = await airdrop.setRoot(merkleRoot);
        await waitForTx(tx, debug);
        tx = await airdrop.setOwner(multisigs.treasuryMultisig);
        await waitForTx(tx, debug);
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
        console.log(poolData.tokens);

        const poolFactory = IInvestmentPoolFactory__factory.connect(
            config.balancerPoolFactories.investmentPool,
            deployer,
        );
        tx = await poolFactory.create(
            poolData.name,
            poolData.symbol,
            poolData.tokens,
            poolData.weights,
            poolData.swapFee,
            multisigs.treasuryMultisig,
            false,
            0,
        );
        const receipt = await waitForTx(tx, debug);
        const poolAddress = getPoolAddress(ethers.utils, receipt);
        const poolId = await IBalancerPool__factory.connect(poolAddress, deployer).getPoolId();
        lbpBpt = { address: poolAddress, poolId };
        const balancerVault = IBalancerVault__factory.connect(config.balancerVault, deployer);

        tx = await MockERC20__factory.connect(config.weth, deployer).approve(config.balancerVault, wethAmount);
        await waitForTx(tx, debug);
        tx = await cvx.approve(config.balancerVault, tknAmount);
        await waitForTx(tx, debug);

        const joinPoolRequest = {
            assets: poolTokens,
            maxAmountsIn: initialBalances as BN[],
            userData: ethers.utils.defaultAbiCoder.encode(["uint256", "uint256[]"], [0, initialBalances as BN[]]),
            fromInternalBalance: false,
        };

        tx = await balancerVault.joinPool(poolId, deployerAddress, multisigs.treasuryMultisig, joinPoolRequest);
        await waitForTx(tx, debug);
    }
    // Else just make a fake one to move tokens
    else {
        lbpBpt = { address: DEAD_ADDRESS, poolId: ZERO_KEY };
        tx = await cvx.transfer(DEAD_ADDRESS, distroList.lbp.tknAmount);
        await waitForTx(tx, debug);
        tx = await MockERC20__factory.connect(config.weth, deployer).transfer(DEAD_ADDRESS, distroList.lbp.wethAmount);
        await waitForTx(tx, debug);
    }

    const balLiquidityProvider = await deployContract<BalLiquidityProvider>(
        new BalLiquidityProvider__factory(deployer),
        "BalLiquidityProvider",
        [cvx.address, config.weth, simpleToExactAmount(375), multisigs.daoMultisig, config.balancerVault],
        {},
        debug,
    );

    tx = await cvx.transfer(balLiquidityProvider.address, distroList.lbp.matching);
    await waitForTx(tx, debug);

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
        dropFactory,
        drops,
        lbpBpt,
        balLiquidityProvider,
    };
}

async function deployPhase3(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    deployment: Phase2Deployed,
    multisigs: MultisigConfig,
    config: ExtSystemConfig,
    debug = false,
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
    let tx;
    let pool: BalancerPoolDeployed = { address: DEAD_ADDRESS, poolId: ZERO_KEY };
    if (chain == Chain.mainnet || chain == Chain.kovan) {
        const tknAmount = await cvx.balanceOf(balLiquidityProvider.address);
        const wethAmount = await MockERC20__factory.connect(config.weth, deployer).balanceOf(
            balLiquidityProvider.address,
        );
        if (tknAmount.lt(simpleToExactAmount(2.8, 24)) || wethAmount.lt(simpleToExactAmount(375))) {
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
        console.log(poolData.tokens);

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
            multisigs.treasuryMultisig,
        );
        const receipt = await waitForTx(tx, debug);
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
        await waitForTx(tx, debug);
    }

    return { ...deployment, pool8020Bpt: pool };
}

async function deployPhase4(
    signer: Signer,
    deployment: Phase3Deployed,
    config: ExtSystemConfig,
    debug = false,
): Promise<SystemDeployed> {
    const deployer = signer;

    const { token, gauges } = config;
    const { cvx, cvxCrv, cvxLocker, cvxCrvRewards, crvDepositor, poolManager } = deployment;

    // PRE-4: daoMultisig.setProtectPool(false)
    // -----------------------------
    // 4. Pool creation etc
    //     - Claimzap
    //     - All initial gauges
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
            cvxLocker.address, // TODO - deprecate or ensure this is vlCVX
            DEAD_ADDRESS, // TODO - this needs to be changed, used for trading cvx for cvxCRV
            cvxLocker.address,
        ],
        {},
        debug,
    );

    let tx = await claimZap.setApprovals();
    await waitForTx(tx, debug);

    const gaugeLength = gauges.length;
    for (let i = 0; i < gaugeLength; i++) {
        tx = await poolManager["addPool(address)"](gauges[i]);
        await waitForTx(tx, debug);
    }

    return { ...deployment, claimZap };
}

export {
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
