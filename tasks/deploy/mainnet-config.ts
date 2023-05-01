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
} from "../../types/generated";
import { Signer } from "ethers";
import { simpleToExactAmount } from "../../test-utils/math";
import { ONE_WEEK, ZERO_ADDRESS, ZERO_KEY } from "../../test-utils/constants";
import { CanonicalPhaseDeployed } from "scripts/deploySidechain";
import { parseEther } from "ethers/lib/utils";

const addresses: ExtSystemConfig = {
    token: "0xba100000625a3754423978a60c9317c58a424e3D",
    tokenBpt: "0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56",
    tokenWhale: "0xC128a9954e6c874eA3d62ce62B468bA073093F25",
    minter: "0x239e55F427D44C3cc793f49bFB507ebe76638a2b",
    votingEscrow: "0xC128a9954e6c874eA3d62ce62B468bA073093F25",
    // feeDistribution: "0x26743984e3357eFC59f2fd6C1aFDC310335a61c9", // @deprecated
    feeDistribution: "0xD3cf852898b21fc233251427c2DC93d3d604F3BB",
    gaugeController: "0xC128468b7Ce63eA702C1f104D55A2566b13D3ABD",
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
    balancerPoolId: "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014",
    balancerMinOutBps: "9950",
    balancerPoolOwner: "0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B",
    balancerPoolFactories: {
        weightedPool2Tokens: "0xA5bf2ddF098bb0Ef6d120C98217dD6B141c74EE0",
        weightedPool: "0xcC508a455F5b0073973107Db6a878DdBDab957bC",
        stablePool: "0x8df6EfEc5547e31B0eb7d1291B511FF8a2bf987c",
        bootstrappingPool: "0x751A0bC0e3f75b38e01Cf25bFCE7fF36DE1C87DE",
    },
    balancerGaugeFactory: "0xf1665E19bc105BE4EDD3739F88315cC699cc5b65",
    balancerHelpers: "0x5aDDCCa35b7A0D07C74063c48700C8590E87864E",
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    wethWhale: "0xC564EE9f21Ed8A2d8E7e76c085740d5e4c5FaFbE",
    treasury: "0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f",
    keeper: "0xc3f4D7b4EF10Dfe1dFfc4Ac2EC4D3Ee29CBF67aE",
    staBAL3: "0x06df3b2bbb68adc8b0e302443692037ed9f91b42", //  Balancer USD Stable Pool (staBAL3)
    staBAL3Whale: "0x4086e3e1e99a563989a9390facff553a4f29b6ee",
    // feeToken: "0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2", @deprecated
    feeToken: "0xA13a9247ea42D743238089903570127DdA72fE44",
    feeTokenWhale: "0x3a3eE61F7c6e1994a2001762250A5E17B2061b6d",
    ldo: "0x5a98fcbea516cf06857215779fd812ca3bef1b32",
    ldoWhale: "0x09f82ccd6bae2aebe46ba7dd2cf08d87355ac430",
    stEthGaugeLdoDepositor: "0x86F6c353A0965eB069cD7f4f91C1aFEf8C725551",
    uniswapRouter: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    sushiswapRouter: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
    auraBalGauge: "0x0312AA8D0BA4a1969Fddb382235870bF55f7f242",
    feeTokenHandlerPath: {
        poolIds: [
            "0x25accb7943fd73dda5e23ba6329085a3c24bfb6a000200000000000000000387",
            "0x32296969ef14eb0c6d29669c550d4a0449130230000200000000000000000080",
        ],
        assetsIn: ["0xA13a9247ea42D743238089903570127DdA72fE44", "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0"],
    },
    lzEndpoint: "0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675",
    sidechain: {
        auraBalInflowLimit: parseEther("1000000"),
        auraInflowLimit: parseEther("1000000"),
    },
};

const multisigs: MultisigConfig = {
    vestingMultisig: "0xab9ff9Fbc44Bb889751c4E70AD2F6977267A1E09",
    treasuryMultisig: "0xfc78f8e1Af80A3bF5A1783BB59eD2d1b10f78cA9",
    daoMultisig: "0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0",
    pauseGaurdian: "0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0",
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
    voterProxy: VoterProxy__factory.connect("0xaF52695E1bB01A16D33D7194C28C42b10e0Dbec2", deployer),
});

const getPhase2 = async (deployer: Signer): Promise<Phase2Deployed> => ({
    ...(await getPhase1(deployer)),
    cvx: AuraToken__factory.connect("0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF", deployer),
    minter: AuraMinter__factory.connect("0x59A5ccD34943CD0AdCf5ce703EE9F06889E13707", deployer),
    booster: Booster__factory.connect("0x7818A1DA7BD1E64c199029E86Ba244a9798eEE10", deployer),
    boosterOwner: BoosterOwner__factory.connect("0xFa838Af70314135159b309bf27f1DbF1F954eC34", deployer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0x45aaD11F2FA2C215bc9686eb6f06D46E0474F356", deployer),
        stashFactory: StashFactoryV2__factory.connect("0x95171c9Ef5cA540A6d3502e9547fcFE022458Eb5", deployer),
        tokenFactory: TokenFactory__factory.connect("0xb6CE51DEE8BD4A2Fd11c01205414dc26f0b453AC", deployer),
        proxyFactory: ProxyFactory__factory.connect("0x7eD9003C6003EaCe1e8C3ae99F0Bb19894377b0F", deployer),
    },
    arbitratorVault: ArbitratorVault__factory.connect("0x5d208cD54f5132f2BD0c1F1e8d8c864Bb6BEdc40", deployer),
    cvxCrv: CvxCrvToken__factory.connect("0x616e8BfA43F920657B3497DBf40D6b1A02D4608d", deployer),
    cvxCrvBpt: {
        poolId: "0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd000200000000000000000249",
        address: "0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd",
    },
    cvxCrvRewards: BaseRewardPool__factory.connect("0x5e5ea2048475854a5702F5B8468A51Ba1296EFcC", deployer),
    initialCvxCrvStaking: AuraBalRewardPool__factory.connect("0xC47162863a12227E5c3B0860715F9cF721651C0c", deployer),
    crvDepositor: CrvDepositor__factory.connect("0xeAd792B55340Aa20181A80d6a16db6A0ECd1b827", deployer),
    crvDepositorWrapper: CrvDepositorWrapper__factory.connect("0x68655AD9852a99C87C0934c7290BB62CFa5D4123", deployer),
    poolManager: PoolManagerV3__factory.connect("0xf843F61508Fc17543412DE55B10ED87f4C28DE50", deployer),
    poolManagerProxy: PoolManagerProxy__factory.connect("0x16A04E58a77aB1CE561A37371dFb479a8594947A", deployer),
    poolManagerSecondaryProxy: PoolManagerSecondaryProxy__factory.connect(
        "0xdc274F4854831FED60f9Eca12CaCbD449134cF67",
        deployer,
    ),
    cvxLocker: AuraLocker__factory.connect("0x3Fa73f1E5d8A792C80F426fc8F84FBF7Ce9bBCAC", deployer),
    cvxStakingProxy: AuraStakingProxy__factory.connect("0xd9e863B7317a66fe0a4d2834910f604Fd6F89C6c", deployer),
    chef: ConvexMasterChef__factory.connect("0x1ab80F7Fb46B25b7e0B2cfAC23Fc88AC37aaf4e9", deployer),
    vestedEscrows: [
        AuraVestedEscrow__factory.connect("0x5bd3fCA8D3d8c94a6419d85E0a76ec8Da52d836a", deployer),
        AuraVestedEscrow__factory.connect("0x24346652e0e2aE0CE05c781501fDF4Fe4553fAc6", deployer),
        AuraVestedEscrow__factory.connect("0x45025Ebc38647bcf7Edd2b40CfDaF3fbfE1538F5", deployer),
        AuraVestedEscrow__factory.connect("0xFd72170339AC6d7bdda09D1eACA346B21a30D422", deployer),
        AuraVestedEscrow__factory.connect("0x43B17088503F4CE1AED9fB302ED6BB51aD6694Fa", deployer),
    ],
    drops: [
        AuraMerkleDrop__factory.connect("0x45EB1A004373b1D8457134A2C04a42d69D287724", deployer),
        AuraMerkleDrop__factory.connect("0x1a661CF8D8cd69dD2A423F3626A461A24280a8fB", deployer),
    ],
    lbpBpt: {
        poolId: "0x6fc73b9d624b543f8b6b88fc3ce627877ff169ee000200000000000000000235",
        address: "0x6fc73b9d624b543f8b6b88fc3ce627877ff169ee",
    },
    balLiquidityProvider: BalLiquidityProvider__factory.connect("0xa7429af4DeB16827dAd0e71D8AEEa9C2bF70e32c", deployer),
    penaltyForwarder: AuraPenaltyForwarder__factory.connect("0x4043569200F7a7a1D989AbbaBC2De2Bde1C20D1E", deployer),
    extraRewardsDistributor: ExtraRewardsDistributor__factory.connect(
        "0xA3739b206097317c72EF416F0E75BB8f58FbD308",
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
    claimZap: AuraClaimZap__factory.connect("0x623B83755a39B12161A63748f3f595A530917Ab2", deployer),
    feeCollector: ClaimFeesHelper__factory.connect("0xa96CCC5B7f04c7Ab74a43F81e07C342fb9808cF1", deployer),
    rewardDepositWrapper: RewardPoolDepositWrapper__factory.connect(
        "0xB188b1CB84Fb0bA13cb9ee1292769F903A9feC59",
        deployer,
    ),
});

const getTempBooster = async (deployer: Signer): Promise<TempBooster> =>
    TempBooster__factory.connect("0xFfDE3F862e1397E81b140906F334De6Dd567aB22", deployer);

const getPhase6 = async (deployer: Signer): Promise<Phase6Deployed> => ({
    booster: Booster__factory.connect("0xA57b8d98dAE62B26Ec3bcC4a365338157060B234", deployer),
    boosterOwner: BoosterOwner__factory.connect("0x228a142081b456a9fF803d004504955032989f04", deployer),
    boosterHelper: BoosterHelper__factory.connect("0x82bbbC3c7B459913Ae6063858832a6C2c43D0Bd0", deployer),
    feeCollector: ClaimFeesHelper__factory.connect("0xAf824c80aA77Ae7F379DA3Dc05fea0dC1941c200", deployer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0xBC8d9cAf4B6bf34773976c5707ad1F2778332DcA", deployer),
        stashFactory: StashFactoryV2__factory.connect("0x54da426EFBB93fbaB5CF81bef03F9B9F00A3E915", deployer),
        tokenFactory: TokenFactory__factory.connect("0x3eC040DbF7D953216F4C89A2e665d5073445f5Ba", deployer),
        proxyFactory: ProxyFactory__factory.connect("0xf5E2cFde016bd55BEF42a5A4bAad7E21cd39720d", deployer),
    },
    cvxCrvRewards: BaseRewardPool__factory.connect("0x00A7BA8Ae7bca0B10A32Ea1f8e2a1Da980c6CAd2", deployer),
    poolManager: PoolManagerV3__factory.connect("0xB58Eb197c35157E6F3351718C4C387D284562BE5", deployer),
    poolManagerProxy: PoolManagerProxy__factory.connect("0x2c809Ec701C088099c911AF9DdfA4A1Db6110F3c", deployer),
    poolManagerSecondaryProxy: PoolManagerSecondaryProxy__factory.connect(
        "0xa72932Aea1392b0Da9eDc34178dA2B29EcE2de54",
        deployer,
    ),
    claimZap: AuraClaimZap__factory.connect("0x2E307704EfaE244c4aae6B63B601ee8DA69E92A9", deployer),
    stashV3: ExtraRewardStashV3__factory.connect("0x4A53301Fe213ECA70f904cD3766C07DB3A621bF8", deployer),
    poolMigrator: PoolMigrator__factory.connect("0x12addE99768a82871EAaecFbDB065b12C56F0578", deployer),
});

const getPhase7 = async (deployer: Signer): Promise<Phase7Deployed> => ({
    masterChefRewardHook: MasterChefRewardHook__factory.connect("0xB5932c9CfdE9aDDa6D578FA168D7F8D2688b84Da", deployer),
    siphonToken: SiphonToken__factory.connect("0xa348a39a98418DD78B242E2fD7B14e18aC080e75", deployer),
});

const getPhase8 = async (deployer: Signer): Promise<Phase8Deployed> => ({
    poolManagerV4: PoolManagerV4__factory.connect("0x8Dd8cDb1f3d419CCDCbf4388bC05F4a7C8aEBD64", deployer),
    boosterOwnerSecondary: BoosterOwnerSecondary__factory.connect(
        "0xCe96e48A2893C599fe2601Cc1918882e1D001EaD",
        deployer,
    ),
});

const getFeeForwarder = async (deployer: Signer) => ({
    feeForwarder: FeeForwarder__factory.connect("0xE14360AA496A85FCfe4B75AFD2ec4d95CbA38Fe1", deployer),
});

export interface AuraBalVaultDeployed {
    vault: AuraBalVault;
    strategy: AuraBalStrategy;
    bbusdHandler: BalancerSwapsHandler;
    auraRewards: VirtualBalanceRewardPool;
}

const getAuraBalVault = async (deployer: Signer): Promise<AuraBalVaultDeployed> => ({
    vault: AuraBalVault__factory.connect("0xfAA2eD111B4F580fCb85C48E6DC6782Dc5FCD7a6", deployer),
    strategy: AuraBalStrategy__factory.connect("0x7372EcE4C18bEABc19981A53b557be90dcBd2b66", deployer),
    bbusdHandler: BalancerSwapsHandler__factory.connect("0xC4eF943b7c2f6b387b37689f1e9fa6ecB738845d", deployer),
    auraRewards: VirtualBalanceRewardPool__factory.connect("0xAc16927429c5c7Af63dD75BC9d8a58c63FfD0147", deployer),
});

const getAuraClaimZapV3 = async (deployer: Signer): Promise<AuraClaimZapV3> =>
    AuraClaimZapV3__factory.connect("0x3eB33F9a2479Af1f98297834861fb4e053A0215f", deployer);

const getSidechain = async (deployer: Signer): Promise<CanonicalPhaseDeployed> => ({
    auraProxyOFT: AuraProxyOFT__factory.connect("0x0000000000000000000000000000000000000000", deployer),
    auraBalProxyOFT: AuraBalProxyOFT__factory.connect("0x0000000000000000000000000000000000000000", deployer),
    l1Coordinator: L1Coordinator__factory.connect("0x0000000000000000000000000000000000000000", deployer),
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
    getTempBooster,
    getPhase6,
    getPhase7,
    getPhase8,
    getFeeForwarder,
    getAuraBalVault,
    getAuraClaimZapV3,
    getSidechain,
};
