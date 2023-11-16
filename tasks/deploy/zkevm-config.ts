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
    daoMultisig: "0xFe11E75A51CAC91516468cCb6bda3582F5F68Cfd",
    pauseGuardian: "0xFe11E75A51CAC91516468cCb6bda3582F5F68Cfd",
    defender: ZERO_ADDRESS,
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101, // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
    lzEndpoint: "0x9740FF91F1985D8d2B71494aE1A2f723bb3Ed9E4",
    minter: "0x475D18169BE8a89357A9ee3Ab00ca386d20fA229",
    token: "0x120ef59b80774f02211563834d8e3b72cb1649d6",
    create2Factory: "0x53C09096b1dC52e2Ef223b2969a714eE75Da364f",
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    gauges: [],
};

export const bridging: SidechainBridging = {
    l1Receiver: "0xBcF3B107a5ECDD8Efb70a74f44b827a1F7108c48",
    l2Sender: "0x364675D1A4e2564Ce1e30DA3ff67E0899C6E617c",
    nativeBridge: "0x2a3dd3eb832af982ec71669e178424b10dca2ede", // hermes bridge on zkevm chain
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
    stashRewardDistro: StashRewardDistro__factory.connect(ZERO_ADDRESS, signer),
    childGaugeVoteRewards: ChildGaugeVoteRewards__factory.connect(ZERO_ADDRESS, signer),
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
