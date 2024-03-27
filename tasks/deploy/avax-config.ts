import { Signer } from "ethers";
import { chainIds } from "../../tasks/utils";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import {
    AuraBalOFT__factory,
    AuraBalVault__factory,
    AuraOFT__factory,
    BoosterLite__factory,
    BoosterOwner__factory,
    ChildGaugeVoteRewards__factory,
    ChildStashRewardDistro__factory,
    ExtSidechainConfig,
    KeeperMulticall3__factory,
    L2Coordinator__factory,
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
    defender: "0x0000000000000000000000000000000000000000",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101, // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
    lzEndpoint: "0x3c2269811836af69497E5F486A85D7316753cf62", // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
    minter: "0xEa924b45a3fcDAAdf4E5cFB1665823B8F8F2039B",
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
    voterProxy: VoterProxyLite__factory.connect(ZERO_ADDRESS, signer),
    booster: BoosterLite__factory.connect(ZERO_ADDRESS, signer),
    keeperMulticall3: KeeperMulticall3__factory.connect(ZERO_ADDRESS, signer),
    boosterOwner: BoosterOwner__factory.connect(ZERO_ADDRESS, signer),
    poolManager: PoolManagerLite__factory.connect(ZERO_ADDRESS, signer),
    l2Coordinator: L2Coordinator__factory.connect(ZERO_ADDRESS, signer),
    auraOFT: AuraOFT__factory.connect(ZERO_ADDRESS, signer),
    auraBalOFT: AuraBalOFT__factory.connect(ZERO_ADDRESS, signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect(ZERO_ADDRESS, signer),
        stashFactory: StashFactoryV2__factory.connect(ZERO_ADDRESS, signer),
        tokenFactory: TokenFactory__factory.connect(ZERO_ADDRESS, signer),
        proxyFactory: ProxyFactory__factory.connect(ZERO_ADDRESS, signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect(ZERO_ADDRESS, signer),
    auraBalVault: AuraBalVault__factory.connect(ZERO_ADDRESS, signer),
    auraBalStrategy: SimpleStrategy__factory.connect(ZERO_ADDRESS, signer),
    childGaugeVoteRewards: ChildGaugeVoteRewards__factory.connect(ZERO_ADDRESS, signer),
    stashRewardDistro: StashRewardDistro__factory.connect(ZERO_ADDRESS, signer),
});

export const getView = (signer: Signer) => ({
    sidechainView: SidechainView__factory.connect(ZERO_ADDRESS, signer),
});

export const getChildGaugeVoteRewards = (signer: Signer) => ({
    gaugeVoteRewards: ChildGaugeVoteRewards__factory.connect(ZERO_ADDRESS, signer),
    stashRewardDistro: ChildStashRewardDistro__factory.connect(ZERO_ADDRESS, signer),
});

export const config: SidechainConfig = {
    chainId: chainIds.base,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
    getView,
    whales: {},
};
