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
import { simpleToExactAmount } from "../../test-utils/math";
import { DEAD_ADDRESS, ONE_WEEK, ZERO_ADDRESS, ZERO_KEY } from "../../test-utils/constants";

const addresses: ExtSystemConfig = {
    token: "0xfA8449189744799aD2AcE7e0EBAC8BB7575eff47",
    tokenBpt: "0xf8a0623ab66F985EfFc1C69D05F1af4BaDB01b00",
    tokenWhale: "0xC128a9954e6c874eA3d62ce62B468bA073093F25",
    minter: "0xdf0399539A72E2689B8B2DD53C3C2A0883879fDd",
    votingEscrow: "0xC128a9954e6c874eA3d62ce62B468bA073093F25",
    feeDistribution: "0x26743984e3357eFC59f2fd6C1aFDC310335a61c9",
    gaugeController: "0xBB1CE49b16d55A1f2c6e88102f32144C7334B116",
    voteOwnership: ZERO_ADDRESS,
    voteParameter: ZERO_ADDRESS,
    gauges: [
        "0x34f33CDaED8ba0E1CEECE80e5f4a73bcf234cfac",
        "0x605eA53472A496c3d483869Fe8F355c12E861e19",
        "0x4ca6AC0509E6381Ca7CD872a6cdC0Fbf00600Fa1",
        "0x5F4d57fd9Ca75625e4B7520c71c02948A48595d0",
        "0x79eF6103A513951a3b25743DB509E267685726B7",
        "0x5A481455E62D5825429C8c416f3B8D2938755B64",
        "0xcD4722B7c24C29e0413BDCd9e51404B4539D14aE",
        "0xb154d9D7f6C5d618c08D276f94239c03CFBF4575",
        "0xdB7D7C535B4081Bb8B719237bdb7DB9f23Cc0b83",
        "0xaB5ea78c8323212cC5736bfe4874557Bc778Bfbf",
        "0x8F4a5C19A74D7111bC0e1486640F0aAB537dE5A1",
        "0xD61dc7452C852B866c0Ae49F4e87C38884AE231d",
        "0xC5f8B1de80145e3a74524a3d1a772a31eD2B50cc",
        "0x7A89f34E976285b7b885b32b2dE566389C2436a0",
        "0x68d019f64A7aa97e2D4e7363AEE42251D08124Fb",
        "0x78DF155d6d75Ca2a1b1B2027f37414Ac1e7A1Ed8",
        "0xc43d32BC349cea7e0fe829F53E26096c184756fa",
        "0x4f9463405F5bC7b4C1304222c1dF76EFbD81a407",
        "0x9AB7B0C7b154f626451c9e8a68dC04f58fb6e5Ce",
        "0xE273d4aCC555A245a80cB494E9E0dE5cD18Ed530",
        "0x4e311e207CEAaaed421F17E909DA16527565Daef",
        "0x4E3c048BE671852277Ad6ce29Fd5207aA12fabff",
        "0x055d483D00b0FFe0c1123c96363889Fb03fa13a4",
        "0x942CB1Ed80D3FF8028B3DD726e0E2A9671bc6202",
        "0xbeC2d02008Dc64A6AD519471048CF3D3aF5ca0C5",
        "0x31e7F53D27BFB324656FACAa69Fe440169522E1C",
        "0xD6E4d70bdA78FBa018c2429e1b84153b9284298e",
        "0x78259f2e946B11a0bE404d29d3cc017eCddE84C6",
        "0xAFc28B2412B343574E8673D4fb6b220473677602",
        "0xCB664132622f29943f67FA56CCfD1e24CC8B4995",
        "0xf4339872Ad09B34a29Be76EE81D4F30BCf7dbf9F",
        "0x57d40FF4cF7441A04A05628911F57bb940B6C238",
        "0xa57453737849A4029325dfAb3F6034656644E104",
        "0xA6468eca7633246Dcb24E5599681767D27d1F978",
        "0x158772F59Fe0d3b75805fC11139b46CBc89F70e5",
        "0x852CF729dEF9beB9De2f18c97a0ea6bf93a7dF8B",
        "0x40AC67ea5bD1215D99244651CC71a03468bce6c0",
        "0xbD0DAe90cb4a0e08f1101929C2A01eB165045660",
        "0x86EC8Bd97622dc80B4a7346bc853760d99D14C7F",
        "0xe3A3Ca91794a995fe0bB24060987e73931B15f3D",
        "0x7CDc9dC877b69328ca8b1Ff11ebfBe2a444Cf350",
        "0xDc2Df969EE5E66236B950F5c4c5f8aBe62035df2",
        "0xAF50825B010Ae4839Ac444f6c12D44b96819739B",
    ],
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    balancerPoolId: "0xf8a0623ab66F985EfFc1C69D05F1af4BaDB01b00000200000000000000000060",
    balancerMinOutBps: "9950",
    balancerPoolOwner: "0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B",
    balancerPoolFactories: {
        weightedPool2Tokens: "0xA5bf2ddF098bb0Ef6d120C98217dD6B141c74EE0",
        stablePool: "0x8df6EfEc5547e31B0eb7d1291B511FF8a2bf987c",
        bootstrappingPool: "0x751A0bC0e3f75b38e01Cf25bFCE7fF36DE1C87DE",
    },
    weth: "0xdFCeA9088c8A88A76FF74892C1457C17dfeef9C1",
    wethWhale: "0xC564EE9f21Ed8A2d8E7e76c085740d5e4c5FaFbE",
    treasury: "0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f",
    // keeper: "0xc3f4D7b4EF10Dfe1dFfc4Ac2EC4D3Ee29CBF67aE",
    staBAL3: "0x06df3b2bbb68adc8b0e302443692037ed9f91b42", //  Balancer USD Stable Pool (staBAL3)
    staBAL3Whale: "0x4086e3e1e99a563989a9390facff553a4f29b6ee",
    feeToken: "0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2",
    ldo: "0x5a98fcbea516cf06857215779fd812ca3bef1b32",
    ldoWhale: "0x09f82ccd6bae2aebe46ba7dd2cf08d87355ac430",
    stEthGaugeLdoDepositor: "0x86F6c353A0965eB069cD7f4f91C1aFEf8C725551",
};

const naming = {
    cvxName: "Slipknot Finance",
    cvxSymbol: "SLK",
    vlCvxName: "Tightly tied Slipknot",
    vlCvxSymbol: "ttSLK",
    cvxCrvName: "Slipknot BUL",
    cvxCrvSymbol: "slkBUL",
    tokenFactoryNamePostfix: " Slipknot rope",
};

const multisigs = {
    vestingMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    treasuryMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
};

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
        // 6 MONTHS - 0.0825% + 1.4515% future team
        {
            period: ONE_WEEK.mul(26),
            recipients: [
                { address: "0x33c7B2c7Bf017FA8BF31A4a412A36f39124411d8", amount: simpleToExactAmount(0.0675, 24) }, // Temp
                { address: "0x337F8f3316E1326B3188E534913F759460bd57CB", amount: simpleToExactAmount(0.015, 24) }, // Temp
                { address: multisigs.vestingMultisig, amount: simpleToExactAmount(1.4515, 24) }, // Vesting dao - future team
            ],
        },
        // 24 MONTHS - 8.45%
        {
            period: ONE_WEEK.mul(104),
            recipients: [
                { address: "0xe3B6c287C1369C6A4fa8d4e857813695C52948EF", amount: simpleToExactAmount(0.275, 24) }, // Core team
                { address: "0x023320e0C9Ac45644c3305cE574360E901c7f582", amount: simpleToExactAmount(0.5, 24) }, // Core team
                { address: "0xB1f881f47baB744E7283851bC090bAA626df931d", amount: simpleToExactAmount(3.5, 24) }, // Core team
                { address: "0xE4b32828B558F17BcaF5efD52f0C067dba38833c", amount: simpleToExactAmount(0.45, 24) }, // Core team
                { address: "0xcc6548f1b572968f9539d604ec9ff4b933c1be74", amount: simpleToExactAmount(0.075, 24) }, // Core team
                { address: "0x51d63958a63a31eb4028917f049ce477c8dd07bb", amount: simpleToExactAmount(0.5, 24) }, // Core team
                { address: "0x3078c3b436511152d86675f9cbfd89ec1672f804", amount: simpleToExactAmount(0.3, 24) }, // Core team
                { address: "0x3000d9b2c0e6b9f97f30abe379eaaa8a85a04afc", amount: simpleToExactAmount(0.325, 24) }, // Core team
                { address: "0x3CBFFF3E75881c1619eaa82DC724BDEE6fF6ED19", amount: simpleToExactAmount(0.06, 24) }, // Core team
                { address: "0xaf3824e8401299B25C4D59a8a035Cf9312a3B454", amount: simpleToExactAmount(0.175, 24) }, // Core team
                { address: "0x738175DB2C999581f29163e6D4D3516Ad4aF8834", amount: simpleToExactAmount(0.125, 24) }, // Core team
                { address: "0x0d9A5678E73e5BbC0ee09FAF8e550B196c76fDad", amount: simpleToExactAmount(0.5, 24) }, // Core team
                { address: "0x285b7EEa81a5B66B62e7276a24c1e0F83F7409c1", amount: simpleToExactAmount(1.5, 24) }, // Core team
                { address: "0xbee5a45271cc66a5b0e9dc4164a4f9df196d94fa", amount: simpleToExactAmount(0.125, 24) }, // Core team
                { address: "0x2fB09D2fD9e4Ca5C0597c6F81CDa7ed537469aaA", amount: simpleToExactAmount(0.04, 24) }, // Core team
            ],
        },
    ],
};

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
        poolId: "0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd000200000000000000000249",
        address: "0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd",
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
    chef: await ConvexMasterChef__factory.connect("0x1ab80F7Fb46B25b7e0B2cfAC23Fc88AC37aaf4e9", deployer),
    vestedEscrows: [
        await AuraVestedEscrow__factory.connect("0x7372EcE4C18bEABc19981A53b557be90dcBd2b66", deployer),
        await AuraVestedEscrow__factory.connect("0x6FC5a70BC896645D529CD9CAfa1D3755438E7D83", deployer),
        await AuraVestedEscrow__factory.connect("0xdEB339E69e87A010Cab637f922d270A981A37891", deployer),
        await AuraVestedEscrow__factory.connect("0x8F2cE52277b2bC044Ca0B2e26B9b5d230067c6f4", deployer),
        await AuraVestedEscrow__factory.connect("0x43B17088503F4CE1AED9fB302ED6BB51aD6694Fa", deployer),
    ],
    drops: [
        await AuraMerkleDrop__factory.connect("0x45EB1A004373b1D8457134A2C04a42d69D287724", deployer),
        await AuraMerkleDrop__factory.connect("0x1a661CF8D8cd69dD2A423F3626A461A24280a8fB", deployer),
    ],
    lbpBpt: {
        poolId: "0x6fc73b9d624b543f8b6b88fc3ce627877ff169ee000200000000000000000235",
        address: "0x6fc73b9d624b543f8b6b88fc3ce627877ff169ee",
    },
    balLiquidityProvider: await BalLiquidityProvider__factory.connect(
        "0xa7429af4DeB16827dAd0e71D8AEEa9C2bF70e32c",
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
