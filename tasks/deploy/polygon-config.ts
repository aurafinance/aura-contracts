import { Signer } from "ethers";
import { chainIds } from "../../tasks/utils";
import {
    BoosterLite__factory,
    BoosterOwner__factory,
    AuraOFT__factory,
    L2Coordinator__factory,
    PoolManagerLite__factory,
    ProxyFactory__factory,
    RewardFactory__factory,
    StashFactoryV2__factory,
    TokenFactory__factory,
    VoterProxyLite__factory,
    VirtualRewardFactory__factory,
    AuraBalVault__factory,
    SimpleStrategy__factory,
    AuraBalOFT__factory,
    SidechainMultisigConfig,
    ExtSidechainConfig,
    SidechainConfig,
    SidechainBridging,
    KeeperMulticall3__factory,
    SidechainView__factory,
} from "../../types";
import { sidechainNaming } from "./sidechain-naming";
import { ZERO_ADDRESS } from "../../test-utils/constants";

const multisigs: SidechainMultisigConfig = {
    daoMultisig: ZERO_ADDRESS,
    pauseGuardian: ZERO_ADDRESS,
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101,
    lzEndpoint: "0x3c2269811836af69497E5F486A85D7316753cf62",
    minter: "0x47B489bf5836f83ABD928C316F8e39bC0587B020",
    token: "0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3",
    create2Factory: "0x53C09096b1dC52e2Ef223b2969a714eE75Da364f",
    balancerVault: "0xba12222222228d8ba445958a75a0704d566bf2c8",
    gauges: [],
};

export const bridging: SidechainBridging = {
    l1Receiver: ZERO_ADDRESS,
    l2Sender: ZERO_ADDRESS,
    nativeBridge: ZERO_ADDRESS,
};

export const getSidechain = (signer: Signer) => ({
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
});

export const getView = (signer: Signer) => ({
    sidechainView: SidechainView__factory.connect(ZERO_ADDRESS, signer),
});

export const config: SidechainConfig = {
    chainId: chainIds.optimism,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
    getView,
    whales: {},
};
