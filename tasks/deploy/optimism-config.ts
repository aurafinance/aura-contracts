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
    ExtraRewardStashModule__factory,
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
import { Provider } from "@ethersproject/providers";

const multisigs: SidechainMultisigConfig = {
    daoMultisig: "0xD86CEB76e9430D3bDE90ded79c82Ae62bc66d68b",
    pauseGuardian: "0xD86CEB76e9430D3bDE90ded79c82Ae62bc66d68b",
    defender: "0x37aA9Ad9744D0686df1C7053225e700ce13e31Dd",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101, // https://docs.layerzero.network/v1/developers/evm/technical-reference/mainnet/mainnet-addresses
    lzEndpoint: "0x3c2269811836af69497E5F486A85D7316753cf62",
    minter: "0x4fb47126Fa83A8734991E41B942Ac29A3266C968",
    token: "0xFE8B128bA8C78aabC59d4c64cEE7fF28e9379921",
    create2Factory: "0x53C09096b1dC52e2Ef223b2969a714eE75Da364f",
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    gauges: [],
};

export const bridging: SidechainBridging = {
    l1Receiver: "0x60421ffaa36f3a8e69c25887e575689f52b055f7",
    l2Sender: "0x7E702E51142eb7658CE4cE734C9bDec74250f265",
    nativeBridge: "0x4200000000000000000000000000000000000010",
};

export const getSidechain = (signer: Signer | Provider) => ({
    voterProxy: VoterProxyLite__factory.connect("0xC181Edc719480bd089b94647c2Dc504e2700a2B0", signer),
    booster: BoosterLite__factory.connect("0x98Ef32edd24e2c92525E59afc4475C1242a30184", signer),
    keeperMulticall3: KeeperMulticall3__factory.connect("0x37aA9Ad9744D0686df1C7053225e700ce13e31Dd", signer),
    boosterOwner: BoosterOwner__factory.connect("0xF044eE152C7D731825280350D876CF760181D96F", signer),
    poolManager: PoolManagerLite__factory.connect("0xf24074a1A6ad620aDC14745F9cc1fB1e7BA6CA71", signer),
    l2Coordinator: L2Coordinator__factory.connect("0xeC1c780A275438916E7CEb174D80878f29580606", signer),
    auraOFT: AuraOFT__factory.connect("0x1509706a6c66CA549ff0cB464de88231DDBe213B", signer),
    auraBalOFT: AuraBalOFT__factory.connect(ZERO_ADDRESS, signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0x2F4CdF0D46F4E3E6D4d37836E73073046138D4f7", signer),
        stashFactory: StashFactoryV2__factory.connect("0x8401B48760E70A39e6bBf861ABd050c00362bAE8", signer),
        tokenFactory: TokenFactory__factory.connect("0x87299312C820607f1E7E4d0c6715CEB594306FE9", signer),
        proxyFactory: ProxyFactory__factory.connect("0x731886426a3199b988194831031dfb993F25D961", signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect(ZERO_ADDRESS, signer),
    auraBalVault: AuraBalVault__factory.connect(ZERO_ADDRESS, signer),
    auraBalStrategy: SimpleStrategy__factory.connect(ZERO_ADDRESS, signer),
    cvxLocker: AuraLocker__factory.connect(ZERO_ADDRESS, signer),
    childGaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0x2863582272A424234FcE76d97099AcBd432acC01", signer),
    stashRewardDistro: StashRewardDistro__factory.connect("0xcA85e2cE206b48ee28A87b0a06f9519ABE627451", signer),
    boosterHelper: BoosterHelper__factory.connect("0x5C90ee408e1Fc2cfe9D17cd784f5307E6b877A66", signer),
    payableMulticall: PayableMulticall__factory.connect("0xA8eF8Cf01CA6b0B2f89e8226734Ce947353d1Ba3", signer),
    l2PoolManagerProxy: L2PoolManagerProxy__factory.connect("0x2B6C227b26Bc0AcE74BB12DA86571179c2c8Bc54", signer),
});

export const getView = (signer: Signer | Provider) => ({
    sidechainView: SidechainView__factory.connect("0xFa6B857cC17740A946c9eb85C1a6896f2e0Be98E", signer),
});

export const getChildGaugeVoteRewards = (signer: Signer) => ({
    gaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0x2863582272A424234FcE76d97099AcBd432acC01", signer),
    stashRewardDistro: ChildStashRewardDistro__factory.connect("0xcA85e2cE206b48ee28A87b0a06f9519ABE627451", signer),
});
const getSafeModules = (signer: Signer | Provider) => ({
    extraRewardStashModule: ExtraRewardStashModule__factory.connect(
        "0xF137083CF97c9302CA4f3700Eab00D38Cd7494ce",
        signer,
    ),
});
export const config: SidechainConfig = {
    chainId: chainIds.optimism,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
    getView,
    getSafeModules,
    whales: {},
};
