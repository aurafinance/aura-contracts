import {
    ExtSystemConfig,
    Phase1Deployed,
    Phase2Deployed,
    Phase3Deployed,
    SystemDeployed,
} from "../../scripts/deploySystem";
import {
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
    AuraPenaltyForwarder__factory,
    AuraStakingProxy__factory,
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
} from "../../types/generated";
import { Signer } from "ethers";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { getMockDistro } from "../../scripts/deployMocks";

const addresses: ExtSystemConfig = {
    authorizerAdapter: "0x5d90225de345ee24d1d2b6f45de90b056f5265a1",
    token: "0xfA8449189744799aD2AcE7e0EBAC8BB7575eff47",
    tokenBpt: "0xf8a0623ab66F985EfFc1C69D05F1af4BaDB01b00",
    tokenWhale: "0x33A99Dcc4C85C014cf12626959111D5898bbCAbF",
    minter: "0xdf0399539A72E2689B8B2DD53C3C2A0883879fDd",
    votingEscrow: "0x33A99Dcc4C85C014cf12626959111D5898bbCAbF",
    feeDistribution: "0x42B67611B208E2e9b4CC975F6D74c87b865aE066",
    gaugeController: "0xBB1CE49b16d55A1f2c6e88102f32144C7334B116",
    voteOwnership: ZERO_ADDRESS,
    voteParameter: ZERO_ADDRESS,
    gauges: [],
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    balancerPoolId: "0xf8a0623ab66f985effc1c69d05f1af4badb01b00000200000000000000000060",
    balancerMinOutBps: "9975", // mainnet is 9950
    balancerPoolFactories: {
        weightedPool2Tokens: "0xA5bf2ddF098bb0Ef6d120C98217dD6B141c74EE0",
        stablePool: "0xD360B8afb3d7463bE823bE1Ec3c33aA173EbE86e",
        bootstrappingPool: "0xb48Cc42C45d262534e46d5965a9Ac496F1B7a830",
    },
    balancerGaugeFactory: "0x224E808FBD9e491Be8988B8A0451FBF777C81B8A",
    weth: "0xdFCeA9088c8A88A76FF74892C1457C17dfeef9C1",
    uniswapRouter: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    sushiswapRouter: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
};

const naming = {
    cvxName: "Slipknot Finance",
    cvxSymbol: "SLK",
    vlCvxName: "Tightly tied Slipknot",
    vlCvxSymbol: "ttSLK",
    cvxCrvName: "Slipknot BUL",
    cvxCrvSymbol: "slkBUL",
    tokenFactoryNamePostfix: " Slipknot rope",
    tokenFactoryNamePrefix: "slk",
};

const multisigs = {
    vestingMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    treasuryMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
};

const distroList = getMockDistro();

const getPhase1 = async (deployer: Signer): Promise<Phase1Deployed> => ({
    voterProxy: VoterProxy__factory.connect("0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9", deployer),
});

const getPhase2 = async (deployer: Signer): Promise<Phase2Deployed> => ({
    ...(await getPhase1(deployer)),
    cvx: AuraToken__factory.connect("0xFf3653ee692F541efB7c2214D72FE05A7A6EC01f", deployer),
    minter: AuraMinter__factory.connect("0x3366EfDdc7d268759a1A1273740aE5C626b2DFbA", deployer),
    booster: Booster__factory.connect("0x2ad214dA65effA92159057957E50994440E99A1b", deployer),
    boosterOwner: BoosterOwner__factory.connect("0x6931835d072f50d98D7a7BF7B2C4faFdA86628d7", deployer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0x78868AcEe480928E3A5a9e50545bf2f53903e350", deployer),
        stashFactory: StashFactoryV2__factory.connect("0x17581a142f181CeA807a480520537E4e97A63adB", deployer),
        tokenFactory: TokenFactory__factory.connect("0xFA226c6ec7d74E5a18839D3E5a2b35B9AE8d65d9", deployer),
        proxyFactory: ProxyFactory__factory.connect("0x9D246b32686f424162cB8e48A519E3a49c9AB000", deployer),
    },
    arbitratorVault: ArbitratorVault__factory.connect("0xc2939C598e2D044A87C8E22a90A9e36b9579F197", deployer),
    cvxCrv: CvxCrvToken__factory.connect("0xf80D3083b18fe3f11196E57438258330Ba4f15Ec", deployer),
    cvxCrvBpt: {
        poolId: ZERO_ADDRESS,
        address: "0xAc98C986d8318ff08109AE6F4E7043468dA9d0a2",
    },
    cvxCrvRewards: BaseRewardPool__factory.connect("0x09421e5d9c2b11f502482dce2b718b037fd10a25", deployer),
    crvDepositor: CrvDepositor__factory.connect("0xD2e06829a8464bd802Ef68A6C900F36db3a86cb1", deployer),
    crvDepositorWrapper: CrvDepositorWrapper__factory.connect("0x4AC5c047CfA39b14fb06564DEC7D85e6fA2b045a", deployer),
    poolManager: PoolManagerV3__factory.connect("0x0B4566B619Dc12381E386564E45df62316259E71", deployer),
    poolManagerProxy: PoolManagerProxy__factory.connect("0x073b3903BC9747B4e7e974698a202cA2c591FEC1", deployer),
    poolManagerSecondaryProxy: PoolManagerSecondaryProxy__factory.connect(
        "0x0Fc3C95E512E44EAA12C4e5543643B17Aa20a1D6",
        deployer,
    ),
    cvxLocker: AuraLocker__factory.connect("0x1e5B33222977642Bf64EC80846BBF83A016727A0", deployer),
    cvxStakingProxy: AuraStakingProxy__factory.connect("0x1a8bb30f2aff498ef026d2bccc8971a30144b93c", deployer),
    initialCvxCrvStaking: AuraBalRewardPool__factory.connect(ZERO_ADDRESS, deployer),
    chef: ConvexMasterChef__factory.connect("0xa3fCaFCa8150636C3B736A16Cd73d49cC8A7E10E", deployer),
    vestedEscrows: [],
    drops: [],
    lbpBpt: {
        poolId: ZERO_ADDRESS,
        address: ZERO_ADDRESS,
    },
    balLiquidityProvider: BalLiquidityProvider__factory.connect(ZERO_ADDRESS, deployer),
    penaltyForwarder: AuraPenaltyForwarder__factory.connect(ZERO_ADDRESS, deployer),
    extraRewardsDistributor: ExtraRewardsDistributor__factory.connect(
        "0xbdfFBBD7Ac592a53405AE152B6D23CF3F6B8a738",
        deployer,
    ),
});

const getPhase3 = async (deployer: Signer): Promise<Phase3Deployed> => ({
    ...(await getPhase2(deployer)),
    pool8020Bpt: {
        poolId: ZERO_ADDRESS,
        address: "0xf8a0623ab66f985effc1c69d05f1af4badb01b00",
    },
});

const getPhase4 = async (deployer: Signer): Promise<SystemDeployed> => ({
    ...(await getPhase3(deployer)),
    claimZap: AuraClaimZap__factory.connect("0x9Ba88Cb931B46a6E646B9bd0ba677D375647EB23", deployer),
    feeCollector: ClaimFeesHelper__factory.connect("0xDc2f8293f7f3E49a949df6A1FB1bCb9200eC3982", deployer),
    rewardDepositWrapper: RewardPoolDepositWrapper__factory.connect(
        "0x0a6bcB3a0C03aB2Bc8A058ee02ed11D50b494083",
        deployer,
    ),
});

export const config = {
    addresses,
    naming,
    multisigs,
    distroList,
    getPhase1,
    getPhase2,
    getPhase3,
    getPhase4,
};
