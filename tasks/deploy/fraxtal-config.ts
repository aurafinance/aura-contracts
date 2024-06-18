import { Signer } from "ethers";
import { chainIds } from "../utils";
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
    daoMultisig: "0x5452E6ABbC7bCB9e0907A3f8f24434CbaF438bA4",
    pauseGuardian: "0x5452E6ABbC7bCB9e0907A3f8f24434CbaF438bA4",
    defender: "0x5452E6ABbC7bCB9e0907A3f8f24434CbaF438bA4",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101, // https://docs.layerzero.network/v1/developers/evm/technical-reference/mainnet/mainnet-addresses
    lzEndpoint: "0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7", // https://docs.layerzero.network/v1/developers/evm/technical-reference/mainnet/mainnet-addresses
    minter: "0x9805dcfD25e6De36bad8fe9D3Fe2c9b44B764102",
    token: "0x2FC7447F6cF71f9aa9E7FF8814B37E55b268Ec91",
    create2Factory: "0x53C09096b1dC52e2Ef223b2969a714eE75Da364f",
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    gauges: [],
};

export const bridging: SidechainBridging = {
    l1Receiver: ZERO_ADDRESS, //TODO
    l2Sender: ZERO_ADDRESS, //TODO
    nativeBridge: ZERO_ADDRESS,
};

export const getSidechain = (signer: Signer | Provider) => ({
    voterProxy: VoterProxyLite__factory.connect("0xC181Edc719480bd089b94647c2Dc504e2700a2B0", signer),
    booster: BoosterLite__factory.connect("0x98Ef32edd24e2c92525E59afc4475C1242a30184", signer),
    keeperMulticall3: KeeperMulticall3__factory.connect("0x37aA9Ad9744D0686df1C7053225e700ce13e31Dd", signer),
    boosterOwner: BoosterOwner__factory.connect("0x8034fbC6246Caa37d2Af084b2fB0ea4a211B6F8d", signer), //
    poolManager: PoolManagerLite__factory.connect("0xf24074a1A6ad620aDC14745F9cc1fB1e7BA6CA71", signer),
    l2Coordinator: L2Coordinator__factory.connect("0x8b2970c237656d3895588B99a8bFe977D5618201", signer),
    auraOFT: AuraOFT__factory.connect("0x1509706a6c66CA549ff0cB464de88231DDBe213B", signer),
    auraBalOFT: AuraBalOFT__factory.connect(ZERO_ADDRESS, signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0xcc92694A8b2367BC6A0D6c2349C30B7D8F1d3c0E", signer), //
        stashFactory: StashFactoryV2__factory.connect("0x1fd645458F6CD8EB95d161d9A38EaBE5dAB1900b", signer), //
        tokenFactory: TokenFactory__factory.connect("0x87299312C820607f1E7E4d0c6715CEB594306FE9", signer),
        proxyFactory: ProxyFactory__factory.connect("0x731886426a3199b988194831031dfb993F25D961", signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect(ZERO_ADDRESS, signer),
    auraBalVault: AuraBalVault__factory.connect(ZERO_ADDRESS, signer),
    auraBalStrategy: SimpleStrategy__factory.connect(ZERO_ADDRESS, signer),
    cvxLocker: AuraLocker__factory.connect(ZERO_ADDRESS, signer),
    childGaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0xCbdcd817a93E733d48086C7c068c82c5a123DC4e", signer), //
    stashRewardDistro: StashRewardDistro__factory.connect("0xb82434C7506B27c226564d6eF6AC9dDCb03E8bd3", signer), //
    boosterHelper: BoosterHelper__factory.connect("0x138f951c141C2F34c1001258cD95DfeEaC26bb8A", signer), //
    payableMulticall: PayableMulticall__factory.connect("0xA8eF8Cf01CA6b0B2f89e8226734Ce947353d1Ba3", signer),
});

export const getView = (signer: Signer | Provider) => ({
    sidechainView: SidechainView__factory.connect("0x739B0c838E47A28877cAEF270DF0407FE5C62502", signer), //
});

export const getChildGaugeVoteRewards = (signer: Signer) => ({
    gaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0xCbdcd817a93E733d48086C7c068c82c5a123DC4e", signer), //
    stashRewardDistro: ChildStashRewardDistro__factory.connect("0xb82434C7506B27c226564d6eF6AC9dDCb03E8bd3", signer), //
});

export const config: SidechainConfig = {
    chainId: chainIds.fraxtal,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
    getView,
    whales: {},
};
