import { Provider } from "@ethersproject/providers";
import { Signer } from "ethers";
import { chainIds } from "../../tasks/utils";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import {
    AuraBalOFT__factory,
    AuraBalVault__factory,
    AuraLocker__factory,
    AuraOFT__factory,
    BoosterHelper__factory,
    BoosterLite__factory,
    BoosterOwner__factory,
    ChildGaugeVoteRewards__factory,
    ChildStashRewardDistro__factory,
    ExtSidechainConfig,
    KeeperMulticall3__factory,
    L2Coordinator__factory,
    L2PoolManagerProxy__factory,
    PayableMulticall__factory,
    PoolManagerLite__factory,
    ProxyFactory__factory,
    RewardFactory__factory,
    SidechainBridging,
    SidechainConfig,
    SidechainMultisigConfig,
    SidechainView__factory,
    SimpleStrategy__factory,
    StashFactoryV2__factory,
    StashRewardDistro__factory,
    TokenFactory__factory,
    VirtualRewardFactory__factory,
    VoterProxyLite__factory,
} from "../../types";
import { sidechainNaming } from "./sidechain-naming";

const multisigs: SidechainMultisigConfig = {
    daoMultisig: "0xD86CEB76e9430D3bDE90ded79c82Ae62bc66d68b",
    pauseGuardian: "0xD86CEB76e9430D3bDE90ded79c82Ae62bc66d68b",
    defender: "0xFC3F4e28D914dA71447d94829C48b1248c7C0b46",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101, // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
    lzEndpoint: "0x3c2269811836af69497E5F486A85D7316753cf62", // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids#arbitrum
    minter: "0xc3ccacE87f6d3A81724075ADcb5ddd85a8A1bB68",
    token: "0x040d1EdC9569d4Bab2D15287Dc5A4F10F56a56B8",
    create2Factory: "0x53C09096b1dC52e2Ef223b2969a714eE75Da364f",
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    gauges: [
        "0xb438c6cc53315FfA3fcD1bc8b27d6c3155b0B56A",
        "0xae9F2cE52FE89DD78e6F13d5d7b33125aE3dFF8C",
        "0xeF767E740D83d410794519c2F93Db32e44359a5C",
        "0xB154E017848b65270e0265274bC20b813e732a3b",
    ],
};

export const bridging: SidechainBridging = {
    l1Receiver: "0x397A2D4d23C6fD1316cE25000820779006e80cD7",
    l2Sender: "0xdE386aeDEC27521daF1f8a49C03aDa7C158455Bf",
    nativeBridge: "0x5288c571Fd7aD117beA99bF60FE0846C4E84F933",
};

export const getSidechain = (signer: Signer | Provider) => ({
    voterProxy: VoterProxyLite__factory.connect("0xC181Edc719480bd089b94647c2Dc504e2700a2B0", signer),
    booster: BoosterLite__factory.connect("0x98Ef32edd24e2c92525E59afc4475C1242a30184", signer),
    keeperMulticall3: KeeperMulticall3__factory.connect("0x5C97f09506d60B90a817EB547ea4F03Ae990E798", signer),
    boosterOwner: BoosterOwner__factory.connect("0x3af95Ba5C362075Bb28E5A2A42D7Cd1e201A1b66", signer),
    poolManager: PoolManagerLite__factory.connect("0xf24074a1A6ad620aDC14745F9cc1fB1e7BA6CA71", signer),
    l2Coordinator: L2Coordinator__factory.connect("0xeC1c780A275438916E7CEb174D80878f29580606", signer),
    auraOFT: AuraOFT__factory.connect("0x1509706a6c66CA549ff0cB464de88231DDBe213B", signer),
    auraBalOFT: AuraBalOFT__factory.connect("0x223738a747383d6F9f827d95964e4d8E8AC754cE", signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0xda2e6bA0B1aBBCA925b70E9747AFbD481C16e7dB", signer),
        stashFactory: StashFactoryV2__factory.connect("0x779aa2880d7a701FB46d320C710944a72E2A049b", signer),
        tokenFactory: TokenFactory__factory.connect("0x87299312C820607f1E7E4d0c6715CEB594306FE9", signer),
        proxyFactory: ProxyFactory__factory.connect("0x731886426a3199b988194831031dfb993F25D961", signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect("0x05589CbbE1cC0357986DF6de4031B953819079c2", signer),
    auraBalVault: AuraBalVault__factory.connect("0x4EA9317D90b61fc28C418C247ad0CA8939Bbb0e9", signer),
    auraBalStrategy: SimpleStrategy__factory.connect("0x4B5D2848678Db574Fbc2d2f629143d969a4f41Cb", signer),
    cvxLocker: AuraLocker__factory.connect(ZERO_ADDRESS, signer),
    childGaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0x2863582272A424234FcE76d97099AcBd432acC01", signer),
    stashRewardDistro: StashRewardDistro__factory.connect("0xcA85e2cE206b48ee28A87b0a06f9519ABE627451", signer),
    boosterHelper: BoosterHelper__factory.connect("0x33543500d44Bb9182C807eD08ee6FA9d457B4c42", signer),
    payableMulticall: PayableMulticall__factory.connect("0xA8eF8Cf01CA6b0B2f89e8226734Ce947353d1Ba3", signer),
    l2PoolManagerProxy: L2PoolManagerProxy__factory.connect("0x4963c9d5DED5CA0e0ac05dCEA19Da2cc48772e99", signer),
});

export const getView = (signer: Signer | Provider) => ({
    sidechainView: SidechainView__factory.connect("0x0a6bcB3a0C03aB2Bc8A058ee02ed11D50b494083", signer),
});

export const getChildGaugeVoteRewards = (signer: Signer) => ({
    gaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0x2863582272A424234FcE76d97099AcBd432acC01", signer),
    stashRewardDistro: ChildStashRewardDistro__factory.connect("0xcA85e2cE206b48ee28A87b0a06f9519ABE627451", signer),
});

export const config: SidechainConfig = {
    chainId: chainIds.arbitrum,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
    getView,
    whales: {
        "0x542f16da0efb162d20bf4358efa095b70a100f9e": "0xba12222222228d8ba445958a75a0704d566bf2c8",
        "0x5a7f39435fd9c381e4932fa2047c9a5136a5e3e7": "0xba12222222228d8ba445958a75a0704d566bf2c8",
        "0xb3028ca124b80cfe6e9ca57b70ef2f0ccc41ebd4": "0xba12222222228d8ba445958a75a0704d566bf2c8",
        "0x519cce718fcd11ac09194cff4517f12d263be067": "0xba12222222228d8ba445958a75a0704d566bf2c8",
    },
};
