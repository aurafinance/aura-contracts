import {
    ExtSystemConfig,
    MultisigConfig,
    Phase1Deployed,
    Phase2Deployed,
    Phase3Deployed,
    Phase6Deployed,
    Phase8Deployed,
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
    AuraBalVault__factory,
    AuraBalStrategy__factory,
    BalancerSwapsHandler__factory,
    AuraBalVault,
    AuraBalStrategy,
    BalancerSwapsHandler,
    VirtualBalanceRewardPool,
    VirtualBalanceRewardPool__factory,
    PoolManagerV4__factory,
    BoosterOwnerSecondary__factory,
    ExtraRewardStashV3__factory,
    L1Coordinator__factory,
    AuraProxyOFT__factory,
    AuraBalProxyOFT__factory,
} from "../../types/generated";
import { Signer } from "ethers";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { getMockDistro } from "../../scripts/deployMocks";
import { CanonicalPhase1Deployed, CanonicalPhase2Deployed } from "scripts/deploySidechain";
import { chainIds } from "../../tasks/utils";
import { parseEther } from "ethers/lib/utils";

const addresses: ExtSystemConfig = {
    authorizerAdapter: "0x5d90225de345ee24d1d2b6f45de90b056f5265a1",
    token: "0xfA8449189744799aD2AcE7e0EBAC8BB7575eff47",
    tokenBpt: "0xf8a0623ab66F985EfFc1C69D05F1af4BaDB01b00",
    tokenWhale: "0x33A99Dcc4C85C014cf12626959111D5898bbCAbF",
    minter: "0xdf0399539A72E2689B8B2DD53C3C2A0883879fDd",
    votingEscrow: "0x33A99Dcc4C85C014cf12626959111D5898bbCAbF",
    feeDistribution: "0x42B67611B208E2e9b4CC975F6D74c87b865aE066",
    gaugeController: "0xBB1CE49b16d55A1f2c6e88102f32144C7334B116",
    gauges: ["0xec94b0453E14cde7fE1A66B54DCA29E9547C57ef"],
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
    feeToken: "0x13ACD41C585d7EbB4a9460f7C8f50BE60DC080Cd",
    lzEndpoint: "0xbfD2135BFfbb0B5378b56643c2Df8a87552Bfa23",
    sidechain: {
        auraBalInflowLimit: parseEther("1000000"),
        auraInflowLimit: parseEther("1000000"),
    },
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

const multisigs: MultisigConfig = {
    vestingMultisig: "0xcC4790f1493aD2be35f868e8429398794246144A",
    treasuryMultisig: "0xcC4790f1493aD2be35f868e8429398794246144A",
    daoMultisig: "0xcC4790f1493aD2be35f868e8429398794246144A",
    sudoMultisig: "0xcC4790f1493aD2be35f868e8429398794246144A",
    pauseGuardian: "0xcC4790f1493aD2be35f868e8429398794246144A",
};

const distroList = getMockDistro();

const getPhase1 = async (deployer: Signer): Promise<Phase1Deployed> => ({
    voterProxy: VoterProxy__factory.connect("0xB6856b8725504Fc496f810d07a6659e1145b671d", deployer),
});

const getPhase2 = async (deployer: Signer): Promise<Phase2Deployed> => ({
    ...(await getPhase1(deployer)),
    cvx: AuraToken__factory.connect("0x8Ef4f64D86016D30266c91cDDbE555B52a3Ce833", deployer),
    minter: AuraMinter__factory.connect("0x4D790084E4E7a5caCb85156AaA4DD14eDf813bf8", deployer),
    booster: Booster__factory.connect("0xA0357552c3e4ACB2f5828D1322D90A22801AD196", deployer),
    boosterOwner: BoosterOwner__factory.connect("0xeAb0b6c2528C54887d5DD3765ed9Bd1884A1d125", deployer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0xdc68A603703E4F9A0B2f80ac0480875b3629818C", deployer),
        stashFactory: StashFactoryV2__factory.connect("0xAB63B2D56322be318fe158e535854623e9622313", deployer),
        tokenFactory: TokenFactory__factory.connect("0x7aBCB88742AF7B7A28fb66AA8ec1544cE4682c6c", deployer),
        proxyFactory: ProxyFactory__factory.connect("0xaD55ab6fF97D02a38292bC6833AdE1fb231AC125", deployer),
    },
    arbitratorVault: ArbitratorVault__factory.connect("0x8e258eaBDc2aeE5528A9517C0199DB8f5CdC2cC9", deployer),
    cvxCrv: CvxCrvToken__factory.connect("0x13CCfb302Ab3EC5e646bD9Bdc87180fD255ee6A8", deployer),
    cvxCrvBpt: {
        poolId: "0x16442f5670083db2ef1fe6820a59cb9baa0113b50002000000000000000006e7",
        address: "0xD30d0B8667fd215ECEe125f56ae1e30d42659850",
    },
    cvxCrvRewards: BaseRewardPool__factory.connect("0xA2F294C74fe9d63Dc272b6a5C3aE494BfA0DF14B", deployer),
    crvDepositor: CrvDepositor__factory.connect("0x46af03341e0Afb410c87c5A6dF412Bf5C8858cCc", deployer),
    crvDepositorWrapper: CrvDepositorWrapper__factory.connect("0x79CC68A74F388d260e6Ed8F8aE2ce810E8d6FE38", deployer),
    poolManager: PoolManagerV3__factory.connect("0x68707046fF3fC67c931f0eb5f6d227bbe1DE6a7B", deployer),
    poolManagerProxy: PoolManagerProxy__factory.connect("0xA5e7926f7385c96c9a0DB751234EFc3eB503bA89", deployer),
    poolManagerSecondaryProxy: PoolManagerSecondaryProxy__factory.connect(
        "0x06531Dbfce795B84b4d29943eDF08239855c4D62",
        deployer,
    ),
    cvxLocker: AuraLocker__factory.connect("0x984B0aDFf6137BB1E00c977c594f4C1664894CEc", deployer),
    cvxStakingProxy: AuraStakingProxy__factory.connect("0x3DF79aFA5ECaCfB67719F0c34b562BA8cA5F0945", deployer),
    initialCvxCrvStaking: AuraBalRewardPool__factory.connect("0xEC24eBf4c3AE1fF5B8FeFdA36B63a36261Fb95c1", deployer),
    chef: ConvexMasterChef__factory.connect("0x8155a8fc133648aA21272dD5afE2a700B28c6250", deployer),
    vestedEscrows: [], //"0xad45617A84F30868Ee69d5A22dCB49AE0AD78D57","0xaB79aa6238D0d4BB27651534Fb08F4Bf1Ece122B","0x0Ee0CaE533B5c86910De029bbB3238c8824C11c4","0xEEf969A8ebdf73C5c5D8A2855206F1154Cd1a297"],
    drops: [], //"0xae6d5d7a8108c074220D3692C045696389d6D933","0x68AAf3ac16b57f3eC47F766b11f18f3DFFdC18db"],
    lbpBpt: {
        poolId: ZERO_ADDRESS,
        address: ZERO_ADDRESS,
    },
    balLiquidityProvider: BalLiquidityProvider__factory.connect("0xaffFf00e97A82535AB9e6B22D26fB37B8b66B9dF", deployer),
    penaltyForwarder: AuraPenaltyForwarder__factory.connect("0xB3Fa61fAC621e23A8fAcc26e54902D69851ac572", deployer),
    extraRewardsDistributor: ExtraRewardsDistributor__factory.connect(
        "0xa7AAa5feE1676938Eec8E45F984552C216da3796",
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
    claimZap: AuraClaimZap__factory.connect("0x39c8bE679120fcE63c9bB6ED5c6bE8225C9f16b9", deployer),
    feeCollector: ClaimFeesHelper__factory.connect("0x43Cd36E200EE1e590a930c21Fd1f67bb90d7f8B3", deployer),
    rewardDepositWrapper: RewardPoolDepositWrapper__factory.connect(
        "0x9161Fb533BA46B48464F945E4520CDD0E8d4F223",
        deployer,
    ),
});
const getPhase6 = async (deployer: Signer): Promise<Phase6Deployed> => ({
    // same as phase 2  as goerli was never migrated.
    booster: Booster__factory.connect("0xA0357552c3e4ACB2f5828D1322D90A22801AD196", deployer),
    boosterOwner: undefined,
    boosterHelper: undefined,
    feeCollector: undefined,
    factories: undefined,
    cvxCrvRewards: BaseRewardPool__factory.connect("0xA2F294C74fe9d63Dc272b6a5C3aE494BfA0DF14B", deployer),
    poolManager: undefined,
    poolManagerProxy: undefined,
    poolManagerSecondaryProxy: undefined,
    claimZap: undefined,
    stashV3: ExtraRewardStashV3__factory.connect("0x006aCF075161129190432D52F49dC4Ed267AC23A", deployer),
    poolMigrator: undefined,
});

const getPhase8 = async (deployer: Signer): Promise<Phase8Deployed> => ({
    poolManagerV4: PoolManagerV4__factory.connect("0x67b36B5A54Ab33C0cD38682693eEc78D08B008d1", deployer),
    boosterOwnerSecondary: BoosterOwnerSecondary__factory.connect(
        "0x3F8fa3CBd1157C8BaA5374feea0058A9AE68eb93",
        deployer,
    ),
});

export interface AuraBalVaultDeployed {
    vault: AuraBalVault;
    strategy: AuraBalStrategy;
    bbusdHandler: BalancerSwapsHandler;
    auraRewards: VirtualBalanceRewardPool;
}

const getAuraBalVault = async (deployer: Signer): Promise<AuraBalVaultDeployed> => ({
    vault: AuraBalVault__factory.connect("0x0E69F37f5009c174537277BA956A13663AAAa814", deployer),
    strategy: AuraBalStrategy__factory.connect("0x098810A74E7682fD650439E2b7440519cf4B022A", deployer),
    bbusdHandler: BalancerSwapsHandler__factory.connect("0xb30a0c7ac99D61650A528AbB31A46470C55f4834", deployer),
    auraRewards: VirtualBalanceRewardPool__factory.connect("0x6fE74EA452b21698bbC27617b2B23FB797393094", deployer),
});

const getSidechain = (deployer: Signer): CanonicalPhase1Deployed & CanonicalPhase2Deployed => ({
    auraProxyOFT: AuraProxyOFT__factory.connect("0x9838f48ae18C32D3aa25a81BC862eDA67C273146", deployer),
    l1Coordinator: L1Coordinator__factory.connect("0x51493Dfb75f35fDEAD2B5bFa6904b59aaD9A37a8", deployer),
    auraBalProxyOFT: AuraBalProxyOFT__factory.connect("0x76A383895103bde55987cEF54dbA7a2A57B72B73", deployer),
});

export const config = {
    chainId: chainIds.goerli,
    addresses,
    naming,
    multisigs,
    distroList,
    getPhase1,
    getPhase2,
    getPhase3,
    getPhase4,
    getPhase6,
    getPhase8,
    getAuraBalVault,
    getSidechain,
};
