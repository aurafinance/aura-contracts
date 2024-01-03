import {
    ExtSystemConfig,
    MultisigConfig,
    Phase1Deployed,
    Phase2Deployed,
    Phase3Deployed,
    Phase6Deployed,
    Phase7Deployed,
    Phase8Deployed,
    SystemDeployed,
} from "../../scripts/deploySystem";
import {
    SiphonToken__factory,
    MasterChefRewardHook__factory,
    VoterProxy__factory,
    AuraToken__factory,
    AuraMinter__factory,
    Booster__factory,
    BoosterOwner__factory,
    CvxCrvToken__factory,
    CrvDepositor__factory,
    CrvDepositorWrapper__factory,
    AuraBalRewardPool__factory,
    AuraLocker__factory,
    AuraMerkleDrop__factory,
    AuraPenaltyForwarder__factory,
    AuraStakingProxy__factory,
    AuraVestedEscrow__factory,
    BalLiquidityProvider__factory,
    BaseRewardPool__factory,
    ConvexMasterChef__factory,
    ExtraRewardsDistributor__factory,
    PoolManagerV3__factory,
    PoolManagerProxy__factory,
    PoolManagerSecondaryProxy__factory,
    RewardFactory__factory,
    StashFactoryV2__factory,
    TokenFactory__factory,
    ProxyFactory__factory,
    ArbitratorVault__factory,
    AuraClaimZap__factory,
    ClaimFeesHelper__factory,
    RewardPoolDepositWrapper__factory,
    TempBooster__factory,
    TempBooster,
    BoosterHelper__factory,
    ExtraRewardStashV3__factory,
    PoolMigrator__factory,
    PoolManagerV4__factory,
    BoosterOwnerSecondary__factory,
    FeeForwarder__factory,
    AuraBalVault__factory,
    AuraBalStrategy__factory,
    BalancerSwapsHandler__factory,
    AuraBalVault,
    AuraBalStrategy,
    BalancerSwapsHandler,
    VirtualBalanceRewardPool,
    VirtualBalanceRewardPool__factory,
    AuraClaimZapV3,
    AuraClaimZapV3__factory,
    AuraProxyOFT__factory,
    L1Coordinator__factory,
    AuraBalProxyOFT__factory,
    CanonicalView__factory,
    AuraMining__factory,
    GaugeVoteRewards__factory,
    StashRewardDistro__factory,
} from "../../types/generated";
import { Signer } from "ethers";
import { simpleToExactAmount } from "../../test-utils/math";
import { ONE_WEEK, ZERO_ADDRESS, ZERO_KEY } from "../../test-utils/constants";
import {
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
    CanonicalPhase3Deployed,
} from "../../scripts/deploySidechain";
import { parseEther } from "ethers/lib/utils";
import { chainIds } from "../../tasks/utils";

const addresses: ExtSystemConfig = {
    token: "0xb19382073c7A0aDdbb56Ac6AF1808Fa49e377B75",
    tokenBpt: "0x650C15c9CFc6063e5046813f079774f56946dF21",
    tokenWhale: ZERO_ADDRESS,
    minter: "0x1783Cd84b3d01854A96B4eD5843753C2CcbD574A",
    votingEscrow: "0x150A72e4D4d81BbF045565E232c50Ed0931ad795",
    feeDistribution: "0xA6971317Fb06c76Ef731601C64433a4846fCa707",
    gaugeController: "0x577e5993B9Cc480F07F98B5Ebd055604bd9071C4",
    voteOwnership: ZERO_ADDRESS,
    voteParameter: ZERO_ADDRESS,
    gauges: [],
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    balancerPoolId: "0x650c15c9cfc6063e5046813f079774f56946df21000200000000000000000006",
    balancerMinOutBps: "9950",
    balancerPoolOwner: "0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B",
    balancerPoolFactories: {
        weightedPool2Tokens: "0x7920BFa1b2041911b354747CA7A6cDD2dfC50Cfd",
        weightedPool: "0x7920BFa1b2041911b354747CA7A6cDD2dfC50Cfd",
        stablePool: "0xa523f47A933D5020b23629dDf689695AA94612Dc",
        bootstrappingPool: "0x45fFd460cC6642B8D8Fb12373DFd77Ceb0f4932B",
    },
    balancerGaugeFactory: "0x2FF226CD12C80511a641A6101F071d853A4e5363",
    balancerHelpers: ZERO_ADDRESS,
    weth: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
    wethWhale: ZERO_ADDRESS,
    treasury: ZERO_ADDRESS,
    keeper: ZERO_ADDRESS,
    // feeToken: "", //USDC
    feeTokenWhale: ZERO_ADDRESS,
    uniswapRouter: ZERO_ADDRESS,
    sushiswapRouter: ZERO_ADDRESS,
    auraBalGauge: ZERO_ADDRESS,
    lzEndpoint: ZERO_ADDRESS,
    sidechain: {
        auraBalInflowLimit: parseEther("50000"),
        auraInflowLimit: parseEther("250000"),
    },
    darkQuestBoard: ZERO_ADDRESS,
};

const whales = {};

const multisigs: MultisigConfig = {
    vestingMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    treasuryMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    sudoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    pauseGuardian: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    incentivesMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    defender: {
        l1CoordinatorDistributor: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
        auraBalProxyOFTHarvestor: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    },
};

const contributorDistro = [
    { address: "0xe3B6c287C1369C6A4fa8d4e857813695C52948EF", amount: simpleToExactAmount(0.275, 24) }, //
    { address: "0x023320e0C9Ac45644c3305cE574360E901c7f582", amount: simpleToExactAmount(0.5, 24) }, //
    { address: "0xB1f881f47baB744E7283851bC090bAA626df931d", amount: simpleToExactAmount(3.5, 24) }, //
    { address: "0xE4b32828B558F17BcaF5efD52f0C067dba38833c", amount: simpleToExactAmount(0.45, 24) }, //
    { address: "0xcc6548f1b572968f9539d604ec9ff4b933c1be74", amount: simpleToExactAmount(0.075, 24) }, //
    { address: "0x51d63958a63a31eb4028917f049ce477c8dd07bb", amount: simpleToExactAmount(0.5, 24) }, //
    { address: "0x3078c3b436511152d86675f9cbfd89ec1672f804", amount: simpleToExactAmount(0.3, 24) }, //
    { address: "0x3000d9b2c0e6b9f97f30abe379eaaa8a85a04afc", amount: simpleToExactAmount(0.325, 24) }, //
    { address: "0x3CBFFF3E75881c1619eaa82DC724BDEE6fF6ED19", amount: simpleToExactAmount(0.06, 24) }, //
    { address: "0xaf3824e8401299B25C4D59a8a035Cf9312a3B454", amount: simpleToExactAmount(0.175, 24) }, //
    { address: "0x738175DB2C999581f29163e6D4D3516Ad4aF8834", amount: simpleToExactAmount(0.125, 24) }, //
    { address: "0x0d9A5678E73e5BbC0ee09FAF8e550B196c76fDad", amount: simpleToExactAmount(0.5, 24) }, //
    { address: "0x285b7EEa81a5B66B62e7276a24c1e0F83F7409c1", amount: simpleToExactAmount(1.5, 24) }, //
    { address: "0xbee5a45271cc66a5b0e9dc4164a4f9df196d94fa", amount: simpleToExactAmount(0.125, 24) }, //
    { address: "0x2fB09D2fD9e4Ca5C0597c6F81CDa7ed537469aaA", amount: simpleToExactAmount(0.04, 24) }, //
];

const distroList = {
    miningRewards: simpleToExactAmount(50, 24),
    lpIncentives: simpleToExactAmount(10, 24),
    cvxCrvBootstrap: simpleToExactAmount(2, 24),
    lbp: {
        tknAmount: simpleToExactAmount(2.2, 24),
        wethAmount: simpleToExactAmount(100),
        matching: simpleToExactAmount(2.8, 24),
    },
    airdrops: [
        {
            merkleRoot: "0xdbfebc726c41a2647b8cf9ad7a770535e1fc3b8900e752147f7e14848720fe78",
            startDelay: ONE_WEEK,
            length: ONE_WEEK.mul(4),
            amount: simpleToExactAmount(2.5, 24),
        },
        {
            merkleRoot: ZERO_KEY,
            startDelay: ONE_WEEK.mul(26),
            length: ONE_WEEK.mul(26),
            amount: simpleToExactAmount(1, 24),
        },
    ],
    immutableVesting: [
        {
            period: ONE_WEEK.mul(104),
            recipients: [
                { address: addresses.treasury, amount: simpleToExactAmount(2, 24) }, // Partner Treasury
            ],
        },
        {
            period: ONE_WEEK.mul(208),
            recipients: [
                { address: multisigs.treasuryMultisig, amount: simpleToExactAmount(17.5, 24) }, // Treasury
            ],
        },
    ],
    vesting: [
        // 4 MONTHS - 0.016%
        {
            period: ONE_WEEK.mul(16),
            recipients: [
                { address: "0xb64f3884ceed18594bd707122988e913fa26f4bf", amount: simpleToExactAmount(0.008, 24) }, // Temp
                { address: "0x498f95A7b752A6FcF97559C815914cE4777b2390", amount: simpleToExactAmount(0.008, 24) }, // Temp
            ],
        },
        // 6 MONTHS - 0.0825% + 1.4515% future
        {
            period: ONE_WEEK.mul(26),
            recipients: [
                { address: "0x33c7B2c7Bf017FA8BF31A4a412A36f39124411d8", amount: simpleToExactAmount(0.0675, 24) }, // Temp
                { address: "0x337F8f3316E1326B3188E534913F759460bd57CB", amount: simpleToExactAmount(0.015, 24) }, // Temp
                { address: multisigs.vestingMultisig, amount: simpleToExactAmount(1.4515, 24) }, // Vesting dao - future
            ],
        },
        // 24 MONTHS - 8.45%
        {
            period: ONE_WEEK.mul(104),
            recipients: contributorDistro,
        },
    ],
};

const naming = {
    cvxName: "Aura",
    cvxSymbol: "AURA",
    vlCvxName: "Vote Locked Aura",
    vlCvxSymbol: "vlAURA",
    cvxCrvName: "Aura BAL",
    cvxCrvSymbol: "auraBAL",
    tokenFactoryNamePostfix: " Aura Deposit",
};

const getPhase1 = async (deployer: Signer): Promise<Phase1Deployed> => ({
    voterProxy: VoterProxy__factory.connect("0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9", deployer),
});

const getPhase2 = async (deployer: Signer): Promise<Phase2Deployed> => ({
    ...(await getPhase1(deployer)),
    cvx: AuraToken__factory.connect("0x0451255563e2acA170b2552111837572E7A0BAcD", deployer),
    minter: AuraMinter__factory.connect("0xC83Da60A38A4163790b159345493101D72782549", deployer),
    booster: Booster__factory.connect("0x0cE2367495288b93bD185eC646A02691d84984d0", deployer),
    boosterOwner: BoosterOwner__factory.connect("0x3366EfDdc7d268759a1A1273740aE5C626b2DFbA", deployer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0x0000000000000000000000000000000000000000", deployer),
        stashFactory: StashFactoryV2__factory.connect("0x0000000000000000000000000000000000000000", deployer),
        tokenFactory: TokenFactory__factory.connect("0x0000000000000000000000000000000000000000", deployer),
        proxyFactory: ProxyFactory__factory.connect("0x0000000000000000000000000000000000000000", deployer),
    },
    arbitratorVault: ArbitratorVault__factory.connect("0x2ad214dA65effA92159057957E50994440E99A1b", deployer),
    cvxCrv: CvxCrvToken__factory.connect("0x00CF063eA33102301027703Cf161F6EFF73E6c0a", deployer),
    cvxCrvBpt: {
        poolId: "0x0000000000000000000000000000000000000000000000000000000000000000",
        address: "0x0000000000000000000000000000000000000000",
    },
    cvxCrvRewards: BaseRewardPool__factory.connect("0x713E883C22fa543fb28cE96E0677aE347096fBe6", deployer),
    initialCvxCrvStaking: AuraBalRewardPool__factory.connect("0xA9941Bdd35d1F3D892e3d19b18e825b0c345f34b", deployer),
    crvDepositor: CrvDepositor__factory.connect("0xA550F39d0517bB9F3eD2A2FbF88D9B4c151084F8", deployer),
    crvDepositorWrapper: CrvDepositorWrapper__factory.connect("0xFA226c6ec7d74E5a18839D3E5a2b35B9AE8d65d9", deployer),
    poolManager: PoolManagerV3__factory.connect("0xFf3653ee692F541efB7c2214D72FE05A7A6EC01f", deployer),
    poolManagerProxy: PoolManagerProxy__factory.connect("0x37CCfEc1Ef0ce293A751d85c0f3C336F3e942049", deployer),
    poolManagerSecondaryProxy: PoolManagerSecondaryProxy__factory.connect(
        "0xFB50aFF391D7E7F8835427085bB2078A41fB0aE3",
        deployer,
    ),
    cvxLocker: AuraLocker__factory.connect("0x78868AcEe480928E3A5a9e50545bf2f53903e350", deployer),
    cvxStakingProxy: AuraStakingProxy__factory.connect("0x9D246b32686f424162cB8e48A519E3a49c9AB000", deployer),
    chef: ConvexMasterChef__factory.connect("0xC2fd0F244116876b67747059cf99a6ffA7Dcf189", deployer),
    vestedEscrows: [
        AuraVestedEscrow__factory.connect("0xD91380637F50002a66E5F19B4B0301A3A6c3d855", deployer),
        AuraVestedEscrow__factory.connect("0x25d03062D994e358a8A90B93a19beD1d989f5e3F", deployer),
        AuraVestedEscrow__factory.connect("0x690Aa1970b1fF11923267C14248402b7F23c06d3", deployer),
        AuraVestedEscrow__factory.connect("0x40d52DE8B4FDda111294fa11fA366c5c5aef0916", deployer),
        AuraVestedEscrow__factory.connect("0xfAA2eD111B4F580fCb85C48E6DC6782Dc5FCD7a6", deployer),
    ],
    drops: [
        AuraMerkleDrop__factory.connect("0xa03474e63eA1876bB4Fa9B4026bb9A27E54e0B52", deployer),
        AuraMerkleDrop__factory.connect("0x7518a7D81d99D27531C6f310CB925407573ca0B2", deployer),
    ],
    lbpBpt: {
        poolId: "0x0000000000000000000000000000000000000000000000000000000000000000",
        address: "0x0000000000000000000000000000000000000000",
    },
    balLiquidityProvider: BalLiquidityProvider__factory.connect("0x0000000000000000000000000000000000000000", deployer),
    penaltyForwarder: AuraPenaltyForwarder__factory.connect("0x0000000000000000000000000000000000000000", deployer),
    extraRewardsDistributor: ExtraRewardsDistributor__factory.connect(
        "0x17581a142f181CeA807a480520537E4e97A63adB",
        deployer,
    ),
});

const getPhase3 = async (deployer: Signer): Promise<Phase3Deployed> => ({
    ...(await getPhase2(deployer)),
    pool8020Bpt: {
        poolId: ZERO_KEY,
        address: ZERO_ADDRESS,
    },
});

const getPhase4 = async (deployer: Signer): Promise<SystemDeployed> => ({
    ...(await getPhase3(deployer)),
    claimZap: AuraClaimZap__factory.connect("0xa3fCaFCa8150636C3B736A16Cd73d49cC8A7E10E", deployer),
    feeCollector: ClaimFeesHelper__factory.connect("0x5b2364fD757E262253423373E4D57C5c011Ad7F4", deployer),
    rewardDepositWrapper: RewardPoolDepositWrapper__factory.connect(
        "0x5422951f44e97710D0d0cbdfE591758B9A43281c",
        deployer,
    ),
});

const getTempBooster = async (deployer: Signer): Promise<TempBooster> =>
    TempBooster__factory.connect(ZERO_ADDRESS, deployer);

const getPhase6 = async (deployer: Signer): Promise<Phase6Deployed> => ({
    booster: Booster__factory.connect(ZERO_ADDRESS, deployer),
    boosterOwner: BoosterOwner__factory.connect(ZERO_ADDRESS, deployer),
    boosterHelper: BoosterHelper__factory.connect(ZERO_ADDRESS, deployer),
    feeCollector: ClaimFeesHelper__factory.connect(ZERO_ADDRESS, deployer),
    factories: {
        rewardFactory: RewardFactory__factory.connect(ZERO_ADDRESS, deployer),
        stashFactory: StashFactoryV2__factory.connect(ZERO_ADDRESS, deployer),
        tokenFactory: TokenFactory__factory.connect(ZERO_ADDRESS, deployer),
        proxyFactory: ProxyFactory__factory.connect(ZERO_ADDRESS, deployer),
    },
    cvxCrvRewards: BaseRewardPool__factory.connect(ZERO_ADDRESS, deployer),
    poolManager: PoolManagerV3__factory.connect(ZERO_ADDRESS, deployer),
    poolManagerProxy: PoolManagerProxy__factory.connect(ZERO_ADDRESS, deployer),
    poolManagerSecondaryProxy: PoolManagerSecondaryProxy__factory.connect(ZERO_ADDRESS, deployer),
    claimZap: AuraClaimZap__factory.connect(ZERO_ADDRESS, deployer),
    stashV3: ExtraRewardStashV3__factory.connect(ZERO_ADDRESS, deployer),
    poolMigrator: PoolMigrator__factory.connect(ZERO_ADDRESS, deployer),
});

const getPhase7 = async (deployer: Signer): Promise<Phase7Deployed> => ({
    masterChefRewardHook: MasterChefRewardHook__factory.connect(ZERO_ADDRESS, deployer),
    siphonToken: SiphonToken__factory.connect(ZERO_ADDRESS, deployer),
});

const getPhase8 = async (deployer: Signer): Promise<Phase8Deployed> => ({
    poolManagerV4: PoolManagerV4__factory.connect(ZERO_ADDRESS, deployer),
    boosterOwnerSecondary: BoosterOwnerSecondary__factory.connect(ZERO_ADDRESS, deployer),
});

const getFeeForwarder = async (deployer: Signer) => ({
    feeForwarder: FeeForwarder__factory.connect("0x0000000000000000000000000000000000000000", deployer),
});

const getAuraMining = async (deployer: Signer) => ({
    auraMining: AuraMining__factory.connect("0x0000000000000000000000000000000000000000", deployer),
});

export interface AuraBalVaultDeployed {
    vault: AuraBalVault;
    strategy: AuraBalStrategy;
    feeTokenHandler: BalancerSwapsHandler;
    auraRewards: VirtualBalanceRewardPool;
}

const getAuraBalVault = async (deployer: Signer): Promise<AuraBalVaultDeployed> => ({
    vault: AuraBalVault__factory.connect(ZERO_ADDRESS, deployer),
    strategy: AuraBalStrategy__factory.connect(ZERO_ADDRESS, deployer),
    feeTokenHandler: BalancerSwapsHandler__factory.connect(ZERO_ADDRESS, deployer),
    auraRewards: VirtualBalanceRewardPool__factory.connect(ZERO_ADDRESS, deployer),
});

const getAuraClaimZapV3 = async (deployer: Signer): Promise<AuraClaimZapV3> =>
    AuraClaimZapV3__factory.connect("0x0000000000000000000000000000000000000000", deployer);

const getSidechain = (
    deployer: Signer,
): CanonicalPhase1Deployed & CanonicalPhase2Deployed & CanonicalPhase3Deployed => ({
    auraProxyOFT: AuraProxyOFT__factory.connect(ZERO_ADDRESS, deployer),
    l1Coordinator: L1Coordinator__factory.connect(ZERO_ADDRESS, deployer),
    auraBalProxyOFT: AuraBalProxyOFT__factory.connect(ZERO_ADDRESS, deployer),
    stashRewardDistro: StashRewardDistro__factory.connect(ZERO_ADDRESS, deployer),
    gaugeVoteRewards: GaugeVoteRewards__factory.connect(ZERO_ADDRESS, deployer),
});

export const getCanonicalView = (signer: Signer) => ({
    canonicalView: CanonicalView__factory.connect(ZERO_ADDRESS, signer),
});

export const getGaugeVoteRewards = (signer: Signer) => ({
    gaugeVoteRewards: GaugeVoteRewards__factory.connect(ZERO_ADDRESS, signer),
    stashRewardDistro: StashRewardDistro__factory.connect(ZERO_ADDRESS, signer),
});

export const config = {
    chainId: chainIds.mainnet,
    whales,
    addresses,
    naming,
    multisigs,
    distroList,
    getPhase1,
    getPhase2,
    getPhase3,
    getPhase4,
    getTempBooster,
    getPhase6,
    getPhase7,
    getPhase8,
    getFeeForwarder,
    getAuraBalVault,
    getAuraClaimZapV3,
    getSidechain,
    getCanonicalView,
    getAuraMining,
    getGaugeVoteRewards,
};
