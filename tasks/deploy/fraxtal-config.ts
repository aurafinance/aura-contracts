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
    daoMultisig: "0x49Bd2Af2d8CF5D607c9580446A1373F55e7BB07f",
    pauseGuardian: "0x49Bd2Af2d8CF5D607c9580446A1373F55e7BB07f",
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
    l1Receiver: "0x81bA0309E9e0BBabF7F552DBFD40f1818f3fca08",
    l2Sender: "0xaFE81f85cFfAea7D5e677C523d406c61150b9E96",
    nativeBridge: "0x4200000000000000000000000000000000000010",
};
export const getSidechain = (signer: Signer | Provider) => ({
    voterProxy: VoterProxyLite__factory.connect("0xC181Edc719480bd089b94647c2Dc504e2700a2B0", signer),
    booster: BoosterLite__factory.connect("0x98Ef32edd24e2c92525E59afc4475C1242a30184", signer),
    keeperMulticall3: KeeperMulticall3__factory.connect("0x5a739082832Ff535413ceBFb2468b8d6B9F22C68", signer),
    boosterOwner: BoosterOwner__factory.connect("0x04798C9B4546d90A97F687188d346D170298703c", signer),
    poolManager: PoolManagerLite__factory.connect("0xf24074a1A6ad620aDC14745F9cc1fB1e7BA6CA71", signer),
    l2Coordinator: L2Coordinator__factory.connect("0x8b2970c237656d3895588B99a8bFe977D5618201", signer),
    auraOFT: AuraOFT__factory.connect("0x1509706a6c66CA549ff0cB464de88231DDBe213B", signer),
    auraBalOFT: AuraBalOFT__factory.connect(ZERO_ADDRESS, signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0xc24Fa5948a2A356b6A7E20D08E7A5EdC3697B7AC", signer),
        stashFactory: StashFactoryV2__factory.connect("0x919EEb7D8e73bD4E9addc1E81Fd1Ae799f0eFeE6", signer),
        tokenFactory: TokenFactory__factory.connect("0x87299312C820607f1E7E4d0c6715CEB594306FE9", signer),
        proxyFactory: ProxyFactory__factory.connect("0x731886426a3199b988194831031dfb993F25D961", signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect(ZERO_ADDRESS, signer),
    auraBalVault: AuraBalVault__factory.connect(ZERO_ADDRESS, signer),
    auraBalStrategy: SimpleStrategy__factory.connect(ZERO_ADDRESS, signer),
    cvxLocker: AuraLocker__factory.connect(ZERO_ADDRESS, signer),
    childGaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0xCbdcd817a93E733d48086C7c068c82c5a123DC4e", signer),
    stashRewardDistro: StashRewardDistro__factory.connect("0xb82434C7506B27c226564d6eF6AC9dDCb03E8bd3", signer),
    boosterHelper: BoosterHelper__factory.connect("0x84Df326E6B809810386B2560BAe2c8400E5e29e9", signer),
    payableMulticall: PayableMulticall__factory.connect("0xA8eF8Cf01CA6b0B2f89e8226734Ce947353d1Ba3", signer),
    l2PoolManagerProxy: L2PoolManagerProxy__factory.connect("0x2B6C227b26Bc0AcE74BB12DA86571179c2c8Bc54", signer),
});

export const getView = (signer: Signer | Provider) => ({
    sidechainView: SidechainView__factory.connect("0x1BA3DBd572B1b7aa3445Fa51492bfc644C67ad0F", signer),
});

export const getChildGaugeVoteRewards = (signer: Signer) => ({
    gaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0xCbdcd817a93E733d48086C7c068c82c5a123DC4e", signer),
    stashRewardDistro: ChildStashRewardDistro__factory.connect("0xb82434C7506B27c226564d6eF6AC9dDCb03E8bd3", signer),
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
