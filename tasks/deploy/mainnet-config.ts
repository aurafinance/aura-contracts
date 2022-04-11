import { ExtSystemConfig, Phase1Deployed, Phase2Deployed, Phase3Deployed } from "../../scripts/deploySystem";
import {
    CurveVoterProxy__factory,
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
} from "../../types/generated";
import { Signer } from "ethers";
import { simpleToExactAmount } from "../../test-utils/math";
import { ONE_WEEK, ZERO_ADDRESS, ZERO_KEY } from "../../test-utils/constants";

const addresses: ExtSystemConfig = {
    token: "0xba100000625a3754423978a60c9317c58a424e3d",
    tokenBpt: "0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56",
    tokenWhale: "0x849d52316331967b6ff1198e5e32a0eb168d039d",
    minter: "0x239e55F427D44C3cc793f49bFB507ebe76638a2b",
    votingEscrow: "0xC128a9954e6c874eA3d62ce62B468bA073093F25",
    feeDistribution: undefined, // TODO - add
    nativeTokenDistribution: undefined, // TODO - add
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
    balancerMinOutBps: "9975",
    balancerPoolFactories: {
        weightedPool2Tokens: "0xA5bf2ddF098bb0Ef6d120C98217dD6B141c74EE0",
        stablePool: "0xc66Ba2B6595D3613CCab350C886aCE23866EDe24",
        investmentPool: "0x48767F9F868a4A7b86A90736632F6E44C2df7fa9",
    },
    weth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    wethWhale: "0xC564EE9f21Ed8A2d8E7e76c085740d5e4c5FaFbE",
    treasury: "0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f", // TODO - define treasury
};

const naming = {
    cvxName: "Aura Finance",
    cvxSymbol: "AURA",
    vlCvxName: "Vote Locked Aura",
    vlCvxSymbol: "vlAURA",
    cvxCrvName: "Aura BAL",
    cvxCrvSymbol: "auraBAL",
    tokenFactoryNamePostfix: " Aura Deposit",
};

// TODO - add proper multisigs
const multisigs = {
    vestingMultisig: "0x97bA9Ec4d946366c75DE81734a51740Fffa7a300",
    treasuryMultisig: "0x8BE7Cb562a52398E55f0a04a76028d1805Aa435f",
    daoMultisig: "0xfEE0Bbe31345a7c27368534fEf45a57133FF3A86",
};

const distroList = {
    miningRewards: simpleToExactAmount(50, 24),
    lpIncentives: simpleToExactAmount(10, 24),
    cvxCrvBootstrap: simpleToExactAmount(2, 24),
    lbp: {
        tknAmount: simpleToExactAmount(2.2, 24),
        wethAmount: simpleToExactAmount(33), // TODO - update wethAmount
        matching: simpleToExactAmount(2.8, 24),
    },
    // TODO - add final merkleRoots
    airdrops: [
        {
            merkleRoot: ZERO_KEY,
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
    // TODO - add final stream data
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
    // TODO - add final stream data
    vesting: [
        {
            period: ONE_WEEK.mul(24),
            recipients: [
                { address: "0x1e1300EEAf333c572E4FC0133614291fa9d0df8B", amount: simpleToExactAmount(1, 24) }, // Team vesting
            ],
        },
        {
            period: ONE_WEEK.mul(104),
            recipients: [
                { address: "0x0cebb78bf382d3b9e5ae2b73930dc41a9a7a5e06", amount: simpleToExactAmount(9, 24) }, // Team vesting
            ],
        },
    ],
};

const getPhase1 = async (deployer: Signer): Promise<Phase1Deployed> => ({
    voterProxy: await CurveVoterProxy__factory.connect("", deployer),
});

const getPhase2 = async (deployer: Signer): Promise<Phase2Deployed> => ({
    ...(await getPhase1(deployer)),
    voterProxy: await CurveVoterProxy__factory.connect("", deployer),
    cvx: await AuraToken__factory.connect("", deployer),
    minter: await AuraMinter__factory.connect("", deployer),
    booster: await Booster__factory.connect("", deployer),
    boosterOwner: await BoosterOwner__factory.connect("", deployer),
    cvxCrv: await CvxCrvToken__factory.connect("", deployer),
    cvxCrvBpt: {
        poolId: "",
        address: "",
    },
    cvxCrvRewards: await BaseRewardPool__factory.connect("", deployer),
    initialCvxCrvStaking: await AuraBalRewardPool__factory.connect("", deployer),
    crvDepositor: await CrvDepositor__factory.connect("", deployer),
    crvDepositorWrapper: await CrvDepositorWrapper__factory.connect("", deployer),
    poolManager: await PoolManagerV3__factory.connect("", deployer),
    poolManagerProxy: await PoolManagerProxy__factory.connect("", deployer),
    poolManagerSecondaryProxy: await PoolManagerSecondaryProxy__factory.connect("", deployer),
    cvxLocker: await AuraLocker__factory.connect("", deployer),
    cvxStakingProxy: await AuraStakingProxy__factory.connect("", deployer),
    chef: await ConvexMasterChef__factory.connect("", deployer),
    vestedEscrows: [await AuraVestedEscrow__factory.connect("", deployer)],
    drops: [await AuraMerkleDrop__factory.connect("", deployer)],
    lbpBpt: {
        poolId: "",
        address: "",
    },
    balLiquidityProvider: await BalLiquidityProvider__factory.connect("", deployer),
    penaltyForwarder: await AuraPenaltyForwarder__factory.connect("", deployer),
    extraRewardsDistributor: await ExtraRewardsDistributor__factory.connect("", deployer),
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
