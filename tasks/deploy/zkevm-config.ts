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
import { Provider } from "@ethersproject/providers";

const multisigs: SidechainMultisigConfig = {
    daoMultisig: "0xFe11E75A51CAC91516468cCb6bda3582F5F68Cfd",
    pauseGuardian: "0xFe11E75A51CAC91516468cCb6bda3582F5F68Cfd",
    defender: ZERO_ADDRESS,
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101, // https://docs.layerzero.network/v1/developers/evm/technical-reference/mainnet/mainnet-addresses
    lzEndpoint: "0x9740FF91F1985D8d2B71494aE1A2f723bb3Ed9E4",
    minter: "0x475D18169BE8a89357A9ee3Ab00ca386d20fA229",
    token: "0x120ef59b80774f02211563834d8e3b72cb1649d6",
    create2Factory: "0x53C09096b1dC52e2Ef223b2969a714eE75Da364f",
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    gauges: [
        "0xEdEa3E93b914E2654F8c7e0C2bb5E6205f9742b0",
        "0x2279abf4bdAb8CF29EAe4036262c62dBA6460306",
        "0x7733650c7aaF2074FD1fCf98f70cbC09138E1Ea5",
        "0x544BDCE27174EA8Ba829939bd3568efc6A6c9c53",
        "0x05257970368Efd323aeFfeC95F7e28C806c2e37F",
    ],
};

export const bridging: SidechainBridging = {
    l1Receiver: "0xBcF3B107a5ECDD8Efb70a74f44b827a1F7108c48",
    l2Sender: "0x364675D1A4e2564Ce1e30DA3ff67E0899C6E617c",
    nativeBridge: "0x2a3dd3eb832af982ec71669e178424b10dca2ede", // hermes bridge on zkevm chain
};

export const getSidechain = (signer: Signer | Provider) => ({
    voterProxy: VoterProxyLite__factory.connect("0xC181Edc719480bd089b94647c2Dc504e2700a2B0", signer),
    booster: BoosterLite__factory.connect("0x98Ef32edd24e2c92525E59afc4475C1242a30184", signer),
    keeperMulticall3: KeeperMulticall3__factory.connect("0x37aA9Ad9744D0686df1C7053225e700ce13e31Dd", signer),
    boosterOwner: BoosterOwner__factory.connect("0xA7CD8430249AE45C343b569Bb8F1c6ABc9A32794", signer),
    poolManager: PoolManagerLite__factory.connect("0xf24074a1A6ad620aDC14745F9cc1fB1e7BA6CA71", signer),
    l2Coordinator: L2Coordinator__factory.connect("0x8b2970c237656d3895588B99a8bFe977D5618201", signer),
    auraOFT: AuraOFT__factory.connect("0x1509706a6c66CA549ff0cB464de88231DDBe213B", signer),
    auraBalOFT: AuraBalOFT__factory.connect(ZERO_ADDRESS, signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0x252a18D569149CB9fd144d35842d2BEe596B3a63", signer),
        stashFactory: StashFactoryV2__factory.connect("0xa1FfACb9bb1852997d2A5931659A56272DC858F4", signer),
        tokenFactory: TokenFactory__factory.connect("0x87299312C820607f1E7E4d0c6715CEB594306FE9", signer),
        proxyFactory: ProxyFactory__factory.connect("0x731886426a3199b988194831031dfb993F25D961", signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect(ZERO_ADDRESS, signer),
    auraBalVault: AuraBalVault__factory.connect(ZERO_ADDRESS, signer),
    auraBalStrategy: SimpleStrategy__factory.connect(ZERO_ADDRESS, signer),
    cvxLocker: AuraLocker__factory.connect(ZERO_ADDRESS, signer),
    childGaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0x2863582272A424234FcE76d97099AcBd432acC01", signer),
    stashRewardDistro: StashRewardDistro__factory.connect("0xcA85e2cE206b48ee28A87b0a06f9519ABE627451", signer),
    boosterHelper: BoosterHelper__factory.connect("0x739B0c838E47A28877cAEF270DF0407FE5C62502", signer),
    payableMulticall: PayableMulticall__factory.connect("0xA8eF8Cf01CA6b0B2f89e8226734Ce947353d1Ba3", signer),
    l2PoolManagerProxy: L2PoolManagerProxy__factory.connect("0x7Ab2f4E1ee4a420559aD576065ec4D32631B9C61", signer),
});

export const getView = (signer: Signer | Provider) => ({
    sidechainView: SidechainView__factory.connect("0xb4c68ea0c1A5fFF3736CBFb402AfBB4AD88608DF", signer),
});

export const getChildGaugeVoteRewards = (signer: Signer) => ({
    gaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0x2863582272A424234FcE76d97099AcBd432acC01", signer),
    stashRewardDistro: ChildStashRewardDistro__factory.connect("0xcA85e2cE206b48ee28A87b0a06f9519ABE627451", signer),
});

export const config: SidechainConfig = {
    chainId: chainIds.zkevm,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
    getView,
    whales: {},
};
