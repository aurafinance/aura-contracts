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
    daoMultisig: "0x5B8f57a643fa655309aB8c7eb658Fed2b2D731c3",
    pauseGuardian: "0x5B8f57a643fa655309aB8c7eb658Fed2b2D731c3",
    defender: "0x37aA9Ad9744D0686df1C7053225e700ce13e31Dd",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101, // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
    lzEndpoint: "0x3c2269811836af69497E5F486A85D7316753cf62", // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
    minter: "0x85a80afee867aDf27B50BdB7b76DA70f1E853062",
    token: "0xE15bCB9E0EA69e6aB9FA080c4c4A5632896298C3",
    create2Factory: "0x53C09096b1dC52e2Ef223b2969a714eE75Da364f",
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    gauges: [],
};

export const bridging: SidechainBridging = {
    l1Receiver: "0x80b1116FC9f5334bC8D6502e59DC4c42Ce98aB8D",
    l2Sender: "0xEA1a2F036317823D725E3Ba8002a7c323FDDcF12",
    nativeBridge: "0x0000000000000000000000000000000000000000",
};

export const getSidechain = (signer: Signer | Provider) => ({
    voterProxy: VoterProxyLite__factory.connect("0xC181Edc719480bd089b94647c2Dc504e2700a2B0", signer),
    booster: BoosterLite__factory.connect("0x98Ef32edd24e2c92525E59afc4475C1242a30184", signer),
    keeperMulticall3: KeeperMulticall3__factory.connect("0x37aA9Ad9744D0686df1C7053225e700ce13e31Dd", signer),
    boosterOwner: BoosterOwner__factory.connect("0x8034fbC6246Caa37d2Af084b2fB0ea4a211B6F8d", signer),
    poolManager: PoolManagerLite__factory.connect("0xf24074a1A6ad620aDC14745F9cc1fB1e7BA6CA71", signer),
    l2Coordinator: L2Coordinator__factory.connect("0x8b2970c237656d3895588B99a8bFe977D5618201", signer),
    auraOFT: AuraOFT__factory.connect("0x1509706a6c66CA549ff0cB464de88231DDBe213B", signer),
    auraBalOFT: AuraBalOFT__factory.connect(ZERO_ADDRESS, signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0xcc92694A8b2367BC6A0D6c2349C30B7D8F1d3c0E", signer),
        stashFactory: StashFactoryV2__factory.connect("0x1fd645458F6CD8EB95d161d9A38EaBE5dAB1900b", signer),
        tokenFactory: TokenFactory__factory.connect("0x87299312C820607f1E7E4d0c6715CEB594306FE9", signer),
        proxyFactory: ProxyFactory__factory.connect("0x731886426a3199b988194831031dfb993F25D961", signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect(ZERO_ADDRESS, signer),
    auraBalVault: AuraBalVault__factory.connect(ZERO_ADDRESS, signer),
    auraBalStrategy: SimpleStrategy__factory.connect(ZERO_ADDRESS, signer),
    cvxLocker: AuraLocker__factory.connect(ZERO_ADDRESS, signer),
    childGaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0xCbdcd817a93E733d48086C7c068c82c5a123DC4e", signer),
    stashRewardDistro: StashRewardDistro__factory.connect("0xb82434C7506B27c226564d6eF6AC9dDCb03E8bd3", signer),
    boosterHelper: BoosterHelper__factory.connect("0x138f951c141C2F34c1001258cD95DfeEaC26bb8A", signer),
    payableMulticall: PayableMulticall__factory.connect("0xA8eF8Cf01CA6b0B2f89e8226734Ce947353d1Ba3", signer),
});

export const getView = (signer: Signer | Provider) => ({
    sidechainView: SidechainView__factory.connect("0x739B0c838E47A28877cAEF270DF0407FE5C62502", signer),
});

export const getChildGaugeVoteRewards = (signer: Signer) => ({
    gaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0xCbdcd817a93E733d48086C7c068c82c5a123DC4e", signer),
    stashRewardDistro: ChildStashRewardDistro__factory.connect("0xb82434C7506B27c226564d6eF6AC9dDCb03E8bd3", signer),
});

export const config: SidechainConfig = {
    chainId: chainIds.avalanche,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
    getView,
    whales: {},
};
