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
    daoMultisig: "0xD86CEB76e9430D3bDE90ded79c82Ae62bc66d68b",
    pauseGuardian: "0xD86CEB76e9430D3bDE90ded79c82Ae62bc66d68b",
    defender: "0x64Cf0ad5e089488cDD0cab98b545f890b0939479",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101, // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids
    lzEndpoint: "0x9740FF91F1985D8d2B71494aE1A2f723bb3Ed9E4", // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids#gnosis
    minter: "0xA8920455934Da4D853faac1f94Fe7bEf72943eF1",
    token: "0x7eF541E2a22058048904fE5744f9c7E4C57AF717",
    create2Factory: "0x53C09096b1dC52e2Ef223b2969a714eE75Da364f",
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    gauges: [
        "0x7eA8B4e2CaBA854C3dD6bf9c5ebABa143BE7Fe9E",
        "0xf752dd899F87a91370C1C8ac1488Aef6be687505",
        "0x7E13b8b95d887c2326C25e71815F33Ea10A2674e",
    ],
};

export const bridging: SidechainBridging = {
    l1Receiver: "0xac962acd42f93c6f26e1cf83271d2a53b208daa6",
    l2Sender: "0x908c9D41183aDE493EFFC12bb9ad11a9333052bc",
    nativeBridge: "0xf6A78083ca3e2a662D6dd1703c939c8aCE2e268d",
};

export const getSidechain = (signer: Signer | Provider) => ({
    voterProxy: VoterProxyLite__factory.connect("0xC181Edc719480bd089b94647c2Dc504e2700a2B0", signer),
    booster: BoosterLite__factory.connect("0x98Ef32edd24e2c92525E59afc4475C1242a30184", signer),
    keeperMulticall3: KeeperMulticall3__factory.connect("0x37aA9Ad9744D0686df1C7053225e700ce13e31Dd", signer),
    boosterOwner: BoosterOwner__factory.connect("0xA9802dB57c6D9218CCfa5BeD6364dFd0CF25D985", signer),
    poolManager: PoolManagerLite__factory.connect("0xf24074a1A6ad620aDC14745F9cc1fB1e7BA6CA71", signer),
    l2Coordinator: L2Coordinator__factory.connect("0x8b2970c237656d3895588B99a8bFe977D5618201", signer),
    auraOFT: AuraOFT__factory.connect("0x1509706a6c66CA549ff0cB464de88231DDBe213B", signer),
    auraBalOFT: AuraBalOFT__factory.connect(ZERO_ADDRESS, signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0x0F641b291Ba374Ec9B17a878c54B98005a0BAcaE", signer),
        stashFactory: StashFactoryV2__factory.connect("0xaB9016380db2A2a564f8Ee0122e3Ed5776cA4c50", signer),
        tokenFactory: TokenFactory__factory.connect("0x87299312C820607f1E7E4d0c6715CEB594306FE9", signer),
        proxyFactory: ProxyFactory__factory.connect("0x731886426a3199b988194831031dfb993F25D961", signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect(ZERO_ADDRESS, signer),
    auraBalVault: AuraBalVault__factory.connect(ZERO_ADDRESS, signer),
    auraBalStrategy: SimpleStrategy__factory.connect(ZERO_ADDRESS, signer),
    cvxLocker: AuraLocker__factory.connect(ZERO_ADDRESS, signer),
    childGaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0x2863582272A424234FcE76d97099AcBd432acC01", signer),
    stashRewardDistro: StashRewardDistro__factory.connect("0xcA85e2cE206b48ee28A87b0a06f9519ABE627451", signer),
    boosterHelper: BoosterHelper__factory.connect("0xDd2a149066E9B90A8F66d556F55D85D69d4384A2", signer),
    payableMulticall: PayableMulticall__factory.connect("0xA8eF8Cf01CA6b0B2f89e8226734Ce947353d1Ba3", signer),
    l2PoolManagerProxy: L2PoolManagerProxy__factory.connect(ZERO_ADDRESS, signer),
});

export const getView = (signer: Signer | Provider) => ({
    sidechainView: SidechainView__factory.connect("0x421DbF836b903b15Ba09C40553AD305d22275482", signer),
});

export const getChildGaugeVoteRewards = (signer: Signer) => ({
    gaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0x2863582272A424234FcE76d97099AcBd432acC01", signer),
    stashRewardDistro: ChildStashRewardDistro__factory.connect("0xcA85e2cE206b48ee28A87b0a06f9519ABE627451", signer),
});

export const config: SidechainConfig = {
    chainId: chainIds.gnosis,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
    getView,
    whales: {
        "0x66f33ae36dd80327744207a48122f874634b3ada": extConfig.balancerVault,
        "0xF48f01DCB2CbB3ee1f6AaB0e742c2D3941039d56": "0xf752dd899f87a91370c1c8ac1488aef6be687505",
        "0xb973ca96a3f0d61045f53255e319aedb6ed49240": extConfig.balancerVault,
    },
};
