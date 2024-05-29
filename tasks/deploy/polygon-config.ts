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
    StashRewardDistro__factory,
    ChildGaugeVoteRewards__factory,
    ChildStashRewardDistro__factory,
    BoosterHelper__factory,
    PayableMulticall__factory,
} from "../../types";
import { sidechainNaming } from "./sidechain-naming";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { Provider } from "@ethersproject/providers";

const multisigs: SidechainMultisigConfig = {
    daoMultisig: "0xD86CEB76e9430D3bDE90ded79c82Ae62bc66d68b",
    pauseGuardian: "0xD86CEB76e9430D3bDE90ded79c82Ae62bc66d68b",
    defender: "0x64Cf0ad5e089488cDD0cab98b545f890b0939479",
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
    l1Receiver: "0x25e7C574c4016e09F608971F97c3B09A6cf4F669",
    l2Sender: "0x25e7C574c4016e09F608971F97c3B09A6cf4F669",
    nativeBridge: ZERO_ADDRESS,
};

export const getSidechain = (signer: Signer | Provider) => ({
    voterProxy: VoterProxyLite__factory.connect("0xC181Edc719480bd089b94647c2Dc504e2700a2B0", signer),
    booster: BoosterLite__factory.connect("0x98Ef32edd24e2c92525E59afc4475C1242a30184", signer),
    keeperMulticall3: KeeperMulticall3__factory.connect("0x37aA9Ad9744D0686df1C7053225e700ce13e31Dd", signer),
    boosterOwner: BoosterOwner__factory.connect("0x8B9DA502Cccb32dBF19Cd68E258e6Fd05e1B5eEe", signer),
    poolManager: PoolManagerLite__factory.connect("0xf24074a1A6ad620aDC14745F9cc1fB1e7BA6CA71", signer),
    l2Coordinator: L2Coordinator__factory.connect("0x8b2970c237656d3895588B99a8bFe977D5618201", signer),
    auraOFT: AuraOFT__factory.connect("0x1509706a6c66CA549ff0cB464de88231DDBe213B", signer),
    auraBalOFT: AuraBalOFT__factory.connect("0x223738a747383d6F9f827d95964e4d8E8AC754cE", signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0xB292BE31649A0b079DBdb772FCf5c7a02a6E0144", signer),
        stashFactory: StashFactoryV2__factory.connect("0x4DcE82F149649906d622eFCa613736a2015cbd1b", signer),
        tokenFactory: TokenFactory__factory.connect("0x87299312C820607f1E7E4d0c6715CEB594306FE9", signer),
        proxyFactory: ProxyFactory__factory.connect("0x731886426a3199b988194831031dfb993F25D961", signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect("0x05589CbbE1cC0357986DF6de4031B953819079c2", signer),
    auraBalVault: AuraBalVault__factory.connect("0x4EA9317D90b61fc28C418C247ad0CA8939Bbb0e9", signer),
    auraBalStrategy: SimpleStrategy__factory.connect("0x4B5D2848678Db574Fbc2d2f629143d969a4f41Cb", signer),
    childGaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0x2863582272A424234FcE76d97099AcBd432acC01", signer),
    stashRewardDistro: StashRewardDistro__factory.connect("0xcA85e2cE206b48ee28A87b0a06f9519ABE627451", signer),
    boosterHelper: BoosterHelper__factory.connect("0x49589fD9F088C2d3Cd85E97917ED74CF33b1b385", signer),
    payableMulticall: PayableMulticall__factory.connect("0xA8eF8Cf01CA6b0B2f89e8226734Ce947353d1Ba3", signer),
});

export const getView = (signer: Signer | Provider) => ({
    sidechainView: SidechainView__factory.connect("0xea865D0dACf923c8d6254DE734f31294ca74C1dc", signer),
});

export const getChildGaugeVoteRewards = (signer: Signer) => ({
    gaugeVoteRewards: ChildGaugeVoteRewards__factory.connect("0x2863582272A424234FcE76d97099AcBd432acC01", signer),
    stashRewardDistro: ChildStashRewardDistro__factory.connect("0xcA85e2cE206b48ee28A87b0a06f9519ABE627451", signer),
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
