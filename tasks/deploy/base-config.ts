import { Signer } from "ethers";
import { chainIds } from "../../tasks/utils";
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
    daoMultisig: "0x955384F4Bd3e5049335Aa287035379C1c693130e",
    pauseGuardian: "0x955384F4Bd3e5049335Aa287035379C1c693130e",
    defender: "0x64Cf0ad5e089488cDD0cab98b545f890b0939479",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 101, // https://docs.layerzero.network/v1/developers/evm/technical-reference/mainnet/mainnet-addresses
    lzEndpoint: "0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7", // https://docs.layerzero.network/v1/developers/evm/technical-reference/mainnet/mainnet-addresses#base
    minter: "0x0c5538098EBe88175078972F514C9e101D325D4F",
    token: "0x4158734d47fc9692176b5085e0f52ee0da5d47f1",
    create2Factory: "0x53C09096b1dC52e2Ef223b2969a714eE75Da364f",
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    gauges: [
        "0xbf8f01ebcf0a21c46d23ada2c86eb31c9965b2f0",
        "0xed0bb13496ce24efff8f9734a9707d092d4be10c",
        "0x67313e858fb87cc4b30ad56b6b461d7450738950",
        "0xe9b2cb6836be07357bcb8144f398730d5ec268e9",
    ],
};

export const bridging: SidechainBridging = {
    l1Receiver: "0x7eB87C3a4eabDaD158781d0dbB7Ab3589B9C2B4C",
    l2Sender: "0xC83Da60A38A4163790b159345493101D72782549",
    nativeBridge: "0x4200000000000000000000000000000000000010",
};

export const getSidechain = (signer: Signer | Provider) => ({
    voterProxy: VoterProxyLite__factory.connect("0xC181Edc719480bd089b94647c2Dc504e2700a2B0", signer),
    booster: BoosterLite__factory.connect("0x98Ef32edd24e2c92525E59afc4475C1242a30184", signer),
    keeperMulticall3: KeeperMulticall3__factory.connect("0x37aA9Ad9744D0686df1C7053225e700ce13e31Dd", signer),
    boosterOwner: BoosterOwner__factory.connect("0x0f0Ddad80025adf6C5Ca45905237e5ca12B755fc", signer),
    poolManager: PoolManagerLite__factory.connect("0xf24074a1A6ad620aDC14745F9cc1fB1e7BA6CA71", signer),
    l2Coordinator: L2Coordinator__factory.connect("0x8b2970c237656d3895588B99a8bFe977D5618201", signer),
    auraOFT: AuraOFT__factory.connect("0x1509706a6c66CA549ff0cB464de88231DDBe213B", signer),
    auraBalOFT: AuraBalOFT__factory.connect("0x223738a747383d6F9f827d95964e4d8E8AC754cE", signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0x334Df252CC0C44C37Ba85DbeAa9c230C3f22f6b0", signer),
        stashFactory: StashFactoryV2__factory.connect("0x60D6439631CC6f60ED15c07783B4c7848F87c84c", signer),
        tokenFactory: TokenFactory__factory.connect("0x87299312C820607f1E7E4d0c6715CEB594306FE9", signer),
        proxyFactory: ProxyFactory__factory.connect("0x731886426a3199b988194831031dfb993F25D961", signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect("0x05589CbbE1cC0357986DF6de4031B953819079c2", signer),
    auraBalVault: AuraBalVault__factory.connect("0x4EA9317D90b61fc28C418C247ad0CA8939Bbb0e9", signer),
    auraBalStrategy: SimpleStrategy__factory.connect("0x4B5D2848678Db574Fbc2d2f629143d969a4f41Cb", signer),
    cvxLocker: AuraLocker__factory.connect("0x9e1f4190f1a8Fe0cD57421533deCB57F9980922e", signer),
    childGaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0x2863582272A424234FcE76d97099AcBd432acC01", signer),
    stashRewardDistro: StashRewardDistro__factory.connect("0xcA85e2cE206b48ee28A87b0a06f9519ABE627451", signer),
    boosterHelper: BoosterHelper__factory.connect("0x4E91AE9c7D5B8898a21d55A9a629B7B04588E534", signer),
    payableMulticall: PayableMulticall__factory.connect("0xA8eF8Cf01CA6b0B2f89e8226734Ce947353d1Ba3", signer),
    l2PoolManagerProxy: L2PoolManagerProxy__factory.connect("0x7Ab2f4E1ee4a420559aD576065ec4D32631B9C61", signer),
});

export const getView = (signer: Signer | Provider) => ({
    sidechainView: SidechainView__factory.connect("0x609D44450231697227504e7fA6a327421B11BEAA", signer),
});

export const getChildGaugeVoteRewards = (signer: Signer) => ({
    gaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0x2863582272A424234FcE76d97099AcBd432acC01", signer),
    stashRewardDistro: ChildStashRewardDistro__factory.connect("0xcA85e2cE206b48ee28A87b0a06f9519ABE627451", signer),
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
