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
    // balancerPoolOwner: "0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B",
    balancerPoolFactories: {
        weightedPool2Tokens: "0xA5bf2ddF098bb0Ef6d120C98217dD6B141c74EE0",
        stablePool: "0xD360B8afb3d7463bE823bE1Ec3c33aA173EbE86e",
        bootstrappingPool: "0xb48Cc42C45d262534e46d5965a9Ac496F1B7a830",
    },
    weth: "0xdFCeA9088c8A88A76FF74892C1457C17dfeef9C1",
    // wethWhale: "0xC564EE9f21Ed8A2d8E7e76c085740d5e4c5FaFbE",
    // treasury: "0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f",
    // keeper: "0xc3f4D7b4EF10Dfe1dFfc4Ac2EC4D3Ee29CBF67aE",
    // staBAL3: "0x06df3b2bbb68adc8b0e302443692037ed9f91b42", //  Balancer USD Stable Pool (staBAL3)
    // staBAL3Whale: "0x4086e3e1e99a563989a9390facff553a4f29b6ee",
    // feeToken: "0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2",
    // ldo: "0x5a98fcbea516cf06857215779fd812ca3bef1b32",
    // ldoWhale: "0x09f82ccd6bae2aebe46ba7dd2cf08d87355ac430",
    // stEthGaugeLdoDepositor: "0x86F6c353A0965eB069cD7f4f91C1aFEf8C725551",
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
    voterProxy: await VoterProxy__factory.connect("0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9", deployer),
});

const getPhase2 = async (deployer: Signer): Promise<Phase2Deployed> => ({
    ...(await getPhase1(deployer)),
    cvx: await AuraToken__factory.connect("0xFf3653ee692F541efB7c2214D72FE05A7A6EC01f", deployer),
    minter: await AuraMinter__factory.connect("0x3366EfDdc7d268759a1A1273740aE5C626b2DFbA", deployer),
    booster: await Booster__factory.connect("0x2ad214dA65effA92159057957E50994440E99A1b", deployer),
    boosterOwner: await BoosterOwner__factory.connect("0x6931835d072f50d98D7a7BF7B2C4faFdA86628d7", deployer),
    factories: {
        rewardFactory: await RewardFactory__factory.connect("0x78868AcEe480928E3A5a9e50545bf2f53903e350", deployer),
        stashFactory: await StashFactoryV2__factory.connect("0x17581a142f181CeA807a480520537E4e97A63adB", deployer),
        tokenFactory: await TokenFactory__factory.connect("0xFA226c6ec7d74E5a18839D3E5a2b35B9AE8d65d9", deployer),
        proxyFactory: await ProxyFactory__factory.connect("0x9D246b32686f424162cB8e48A519E3a49c9AB000", deployer),
    },
    arbitratorVault: await ArbitratorVault__factory.connect("0xc2939C598e2D044A87C8E22a90A9e36b9579F197", deployer),
    cvxCrv: await CvxCrvToken__factory.connect("0xf80D3083b18fe3f11196E57438258330Ba4f15Ec", deployer),
    cvxCrvBpt: {
        poolId: "0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd000200000000000000000249", // TODO
        address: "0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd", //TODO Balancer auraBAL Stable Pool (B-auraBAL...)
    },
    cvxCrvRewards: await BaseRewardPool__factory.connect("0x09421e5D9C2B11f502482DcE2B718b037fD10a25", deployer),
    initialCvxCrvStaking: await AuraBalRewardPool__factory.connect(
        "0xe0b4823F9a872FD2a33aE11708C67e1a2Af3C147",
        deployer,
    ),
    crvDepositor: await CrvDepositor__factory.connect("0xD2e06829a8464bd802Ef68A6C900F36db3a86cb1", deployer),
    crvDepositorWrapper: await CrvDepositorWrapper__factory.connect(
        "0x4AC5c047CfA39b14fb06564DEC7D85e6fA2b045a",
        deployer,
    ),
    poolManager: await PoolManagerV3__factory.connect("0x0B4566B619Dc12381E386564E45df62316259E71", deployer),
    poolManagerProxy: await PoolManagerProxy__factory.connect("0x073b3903BC9747B4e7e974698a202cA2c591FEC1", deployer),
    poolManagerSecondaryProxy: await PoolManagerSecondaryProxy__factory.connect(
        "0x0Fc3C95E512E44EAA12C4e5543643B17Aa20a1D6",
        deployer,
    ),
    cvxLocker: await AuraLocker__factory.connect("0x1e5B33222977642Bf64EC80846BBF83A016727A0", deployer),
    cvxStakingProxy: await AuraStakingProxy__factory.connect("0x1A8bB30F2AfF498ef026D2BCCc8971a30144b93C", deployer),
    chef: await ConvexMasterChef__factory.connect("0xa3fCaFCa8150636C3B736A16Cd73d49cC8A7E10E", deployer),
    vestedEscrows: [
        await AuraVestedEscrow__factory.connect("0x7372EcE4C18bEABc19981A53b557be90dcBd2b66", deployer),
        await AuraVestedEscrow__factory.connect("0x6FC5a70BC896645D529CD9CAfa1D3755438E7D83", deployer),
        await AuraVestedEscrow__factory.connect("0xdEB339E69e87A010Cab637f922d270A981A37891", deployer),
        await AuraVestedEscrow__factory.connect("0x8F2cE52277b2bC044Ca0B2e26B9b5d230067c6f4", deployer),
        // await AuraVestedEscrow__factory.connect("0x43B17088503F4CE1AED9fB302ED6BB51aD6694Fa", deployer), // TODO
    ],
    drops: [
        await AuraMerkleDrop__factory.connect("0x89f67f3054bFD662971854190Dbc18dcaBb416f6", deployer),
        await AuraMerkleDrop__factory.connect("0x29d1f271D823b4989416E1d2076d0CE666f8fC16", deployer),
    ],
    lbpBpt: {
        poolId: "0x6fc73b9d624b543f8b6b88fc3ce627877ff169ee000200000000000000000235",
        address: "0x6fc73b9d624b543f8b6b88fc3ce627877ff169ee", // TODO  Balancer AURA WETH LBP (B-AURA-WE...)
    },
    balLiquidityProvider: await BalLiquidityProvider__factory.connect(
        "0xa7429af4DeB16827dAd0e71D8AEEa9C2bF70e32c", // TODO BalLiquidityProvider
        deployer,
    ),
    penaltyForwarder: await AuraPenaltyForwarder__factory.connect(
        "0xCEB49C1F8716C9D90e349eBcAeE589E7Bb6ec6f2",
        deployer,
    ),
    extraRewardsDistributor: await ExtraRewardsDistributor__factory.connect(
        "0xbdfFBBD7Ac592a53405AE152B6D23CF3F6B8a738",
        deployer,
    ),
});

const getPhase3 = async (deployer: Signer): Promise<Phase3Deployed> => ({
    ...(await getPhase2(deployer)),
    pool8020Bpt: {
        poolId: "0xc29562b045d80fd77c69bec09541f5c16fe20d9d000200000000000000000251",
        address: "0xc29562b045d80fd77c69bec09541f5c16fe20d9d",
    },
});

// TODO
const getPhase4 = async (deployer: Signer): Promise<SystemDeployed> => ({
    ...(await getPhase3(deployer)),
    claimZap: await AuraClaimZap__factory.connect("0x623B83755a39B12161A63748f3f595A530917Ab2", deployer),
    feeCollector: await ClaimFeesHelper__factory.connect("0x999dBcE0A18F721F04E793f916C30e72A9D0f56E", deployer),
    rewardDepositWrapper: await RewardPoolDepositWrapper__factory.connect(
        "0xB188b1CB84Fb0bA13cb9ee1292769F903A9feC59",
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
