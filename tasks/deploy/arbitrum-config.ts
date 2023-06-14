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
    BoosterHelper__factory,
} from "../../types";
import { sidechainNaming } from "./sidechain-naming";

const multisigs: SidechainMultisigConfig = {
    daoMultisig: "0xD86CEB76e9430D3bDE90ded79c82Ae62bc66d68b",
    pauseGuardian: "0xD86CEB76e9430D3bDE90ded79c82Ae62bc66d68b",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101, // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
    lzEndpoint: "0x3c2269811836af69497E5F486A85D7316753cf62", // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids#arbitrum
    minter: "0xc3ccacE87f6d3A81724075ADcb5ddd85a8A1bB68",
    token: "0x040d1edc9569d4bab2d15287dc5a4f10f56a56b8",
    create2Factory: "0x53C09096b1dC52e2Ef223b2969a714eE75Da364f",
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    gauges: [],
};

export const bridging: SidechainBridging = {
    l1Receiver: "0x397A2D4d23C6fD1316cE25000820779006e80cD7",
    l2Sender: "0x713E883C22fa543fb28cE96E0677aE347096fBe6",
    nativeBridge: "0x5288c571Fd7aD117beA99bF60FE0846C4E84F933",
};

export const getSidechain = (signer: Signer) => ({
    voterProxy: VoterProxyLite__factory.connect("0xC181Edc719480bd089b94647c2Dc504e2700a2B0", signer),
    booster: BoosterLite__factory.connect("0x98Ef32edd24e2c92525E59afc4475C1242a30184", signer),
    boosterHelper: BoosterHelper__factory.connect("0xe029c2edA9Cfa729BA6418D41A17276fD121F876", signer),
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
});

export const config: SidechainConfig = {
    chainId: chainIds.arbitrum,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
    whales: {},
};
