import { ExtSystemConfig, Phase1Deployed, Phase2Deployed, Phase3Deployed } from "../../scripts/deploySystem";
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
} from "../../types/generated";
import { Signer } from "ethers";
import { simpleToExactAmount } from "../../test-utils/math";
import { DEAD_ADDRESS, ONE_WEEK, ZERO_ADDRESS, ZERO_KEY } from "../../test-utils/constants";

const addresses: ExtSystemConfig = {
    token: "0xba100000625a3754423978a60c9317c58a424e3D",
    tokenBpt: "0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56",
    tokenWhale: "0xC128a9954e6c874eA3d62ce62B468bA073093F25",
    minter: "0x239e55F427D44C3cc793f49bFB507ebe76638a2b",
    votingEscrow: "0xC128a9954e6c874eA3d62ce62B468bA073093F25",
    feeDistribution: "0x26743984e3357eFC59f2fd6C1aFDC310335a61c9",
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
    ],
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    balancerPoolId: "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014",
    balancerMinOutBps: "9950",
    balancerPoolFactories: {
        weightedPool2Tokens: "0xA5bf2ddF098bb0Ef6d120C98217dD6B141c74EE0",
        stablePool: "0xc66Ba2B6595D3613CCab350C886aCE23866EDe24",
        bootstrappingPool: "0x751A0bC0e3f75b38e01Cf25bFCE7fF36DE1C87DE",
    },
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    wethWhale: "0xC564EE9f21Ed8A2d8E7e76c085740d5e4c5FaFbE",
    treasury: "0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f",
    keeper: "0xc3f4D7b4EF10Dfe1dFfc4Ac2EC4D3Ee29CBF67aE",
    staBAL3: "0x06df3b2bbb68adc8b0e302443692037ed9f91b42", //  Balancer USD Stable Pool (staBAL3)
    staBAL3Whale: "0x4086e3e1e99a563989a9390facff553a4f29b6ee",
    feeToken: "0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2",
    ldo: "0x5a98fcbea516cf06857215779fd812ca3bef1b32",
    ldoWhale: "0x09f82ccd6bae2aebe46ba7dd2cf08d87355ac430",
    stEthGaugeLdoDepositor: "0x86F6c353A0965eB069cD7f4f91C1aFEf8C725551",
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

const multisigs = {
    vestingMultisig: "0xab9ff9Fbc44Bb889751c4E70AD2F6977267A1E09",
    treasuryMultisig: "0xfc78f8e1Af80A3bF5A1783BB59eD2d1b10f78cA9",
    daoMultisig: "0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0",
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
                { address: "0xcc6548f1b572968f9539d604ec9ff4b933c1be74", amount: simpleToExactAmount(0.04, 24) }, // Core team
            ],
        },
    ],
};

const getPhase1 = async (deployer: Signer): Promise<Phase1Deployed> => ({
    voterProxy: await VoterProxy__factory.connect("0xaF52695E1bB01A16D33D7194C28C42b10e0Dbec2", deployer),
});

const getPhase2 = async (deployer: Signer): Promise<Phase2Deployed> => ({
    ...(await getPhase1(deployer)),
    cvx: await AuraToken__factory.connect("0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF", deployer),
    minter: await AuraMinter__factory.connect("0x59A5ccD34943CD0AdCf5ce703EE9F06889E13707", deployer),
    booster: await Booster__factory.connect("0x7818A1DA7BD1E64c199029E86Ba244a9798eEE10", deployer),
    boosterOwner: await BoosterOwner__factory.connect("0xFa838Af70314135159b309bf27f1DbF1F954eC34", deployer),
    factories: {
        rewardFactory: await RewardFactory__factory.connect("0x45aaD11F2FA2C215bc9686eb6f06D46E0474F356", deployer),
        stashFactory: await StashFactoryV2__factory.connect("0x95171c9Ef5cA540A6d3502e9547fcFE022458Eb5", deployer),
        tokenFactory: await TokenFactory__factory.connect("0xb6CE51DEE8BD4A2Fd11c01205414dc26f0b453AC", deployer),
        proxyFactory: await ProxyFactory__factory.connect("0x7eD9003C6003EaCe1e8C3ae99F0Bb19894377b0F", deployer),
    },
    arbitratorVault: await ArbitratorVault__factory.connect("0x5d208cD54f5132f2BD0c1F1e8d8c864Bb6BEdc40", deployer),
    cvxCrv: await CvxCrvToken__factory.connect("0x616e8BfA43F920657B3497DBf40D6b1A02D4608d", deployer),
    cvxCrvBpt: {
        poolId: "0x6641a8c1d33bd3dec8dd85e69c63cafb5bf36388000200000000000000000234",
        address: "0x6641a8c1d33bd3dec8dd85e69c63cafb5bf36388",
    },
    cvxCrvRewards: await BaseRewardPool__factory.connect("0x5e5ea2048475854a5702F5B8468A51Ba1296EFcC", deployer),
    initialCvxCrvStaking: await AuraBalRewardPool__factory.connect(
        "0xC47162863a12227E5c3B0860715F9cF721651C0c",
        deployer,
    ),
    crvDepositor: await CrvDepositor__factory.connect("0xeAd792B55340Aa20181A80d6a16db6A0ECd1b827", deployer),
    crvDepositorWrapper: await CrvDepositorWrapper__factory.connect(
        "0x68655AD9852a99C87C0934c7290BB62CFa5D4123",
        deployer,
    ),
    poolManager: await PoolManagerV3__factory.connect("0xf843F61508Fc17543412DE55B10ED87f4C28DE50", deployer),
    poolManagerProxy: await PoolManagerProxy__factory.connect("0x16A04E58a77aB1CE561A37371dFb479a8594947A", deployer),
    poolManagerSecondaryProxy: await PoolManagerSecondaryProxy__factory.connect(
        "0xdc274F4854831FED60f9Eca12CaCbD449134cF67",
        deployer,
    ),
    cvxLocker: await AuraLocker__factory.connect("0x3Fa73f1E5d8A792C80F426fc8F84FBF7Ce9bBCAC", deployer),
    cvxStakingProxy: await AuraStakingProxy__factory.connect("0xd9e863B7317a66fe0a4d2834910f604Fd6F89C6c", deployer),
    chef: await ConvexMasterChef__factory.connect("0x1ab80F7Fb46B25b7e0B2cfAC23Fc88AC37aaf4e9", deployer),
    vestedEscrows: [
        await AuraVestedEscrow__factory.connect("0x5bd3fCA8D3d8c94a6419d85E0a76ec8Da52d836a", deployer),
        await AuraVestedEscrow__factory.connect("0x24346652e0e2aE0CE05c781501fDF4Fe4553fAc6", deployer),
        await AuraVestedEscrow__factory.connect("0x45025Ebc38647bcf7Edd2b40CfDaF3fbfE1538F5", deployer),
        await AuraVestedEscrow__factory.connect("0xFd72170339AC6d7bdda09D1eACA346B21a30D422", deployer),
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
        "0x4043569200F7a7a1D989AbbaBC2De2Bde1C20D1E",
        deployer,
    ),
    extraRewardsDistributor: await ExtraRewardsDistributor__factory.connect(
        "0xA3739b206097317c72EF416F0E75BB8f58FbD308",
        deployer,
    ),
});

const getPhase3 = async (deployer: Signer): Promise<Phase3Deployed> => ({
    ...(await getPhase2(deployer)),
    pool8020Bpt: {
        poolId: "",
        address: "",
    },
});

export const config = {
    addresses,
    naming,
    multisigs,
    distroList,
    getPhase1,
    getPhase2,
    getPhase3,
};
