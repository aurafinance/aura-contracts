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
    daoMultisig: "0xD86CEB76e9430D3bDE90ded79c82Ae62bc66d68b",
    pauseGuardian: "0xD86CEB76e9430D3bDE90ded79c82Ae62bc66d68b",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101, // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
    lzEndpoint: "0x3c2269811836af69497E5F486A85D7316753cf62",
    minter: "0x4fb47126Fa83A8734991E41B942Ac29A3266C968",
    token: "0xfe8b128ba8c78aabc59d4c64cee7ff28e9379921",
    create2Factory: "0x53C09096b1dC52e2Ef223b2969a714eE75Da364f",
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    gauges: [],
};

export const bridging: SidechainBridging = {
    l1Receiver: "0x60421ffaa36f3a8e69c25887e575689f52b055f7",
    l2Sender: "0x0451255563e2aca170b2552111837572e7a0bacd",
    nativeBridge: "0x4200000000000000000000000000000000000010",
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
