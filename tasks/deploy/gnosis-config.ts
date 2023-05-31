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
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { sidechainNaming } from "./sidechain-naming";

const multisigs: SidechainMultisigConfig = {
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4", // Aura deployer EOA
    pauseGuardian: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
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
    l1Receiver: "0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0",
    l2Sender: ZERO_ADDRESS,
    nativeBridge: "0xf6A78083ca3e2a662D6dd1703c939c8aCE2e268d",
};

export const getSidechain = (signer: Signer) => ({
    voterProxy: VoterProxyLite__factory.connect("0x363Fcb8B79cd67956F95923a1764A5062b9b7C0C", signer),
    booster: BoosterLite__factory.connect("0x047B52d580047888902a37287E0d849e7433e85D", signer),
    boosterOwner: BoosterOwner__factory.connect("0xb2Ae2a8004359B30fa32a8b51AD822f2a5e06c41", signer),
    poolManager: PoolManagerLite__factory.connect("0x1F85614f2C79056EC538C127f505f0d9109c6979", signer),
    l2Coordinator: L2Coordinator__factory.connect("0x0F665A14F2FC4e488c61cA45Ea53ad27Fb7cE223", signer),
    auraOFT: AuraOFT__factory.connect("0x3B5357B10Ecd8FCA8345A03fEBA4cF0a97f01FB5", signer),
    auraBalOFT: AuraBalOFT__factory.connect("0xF3552215c697ee67827A58CEFE1Ae027f2838E77", signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0x88786239559FcEd792f256e029B66DaD09F605C1", signer),
        stashFactory: StashFactoryV2__factory.connect("0x875882F7ccB5c494694cdf307290e41788857914", signer),
        tokenFactory: TokenFactory__factory.connect("0xA18b88E087206BaA2f939BA0091A0aE261B239FC", signer),
        proxyFactory: ProxyFactory__factory.connect("0xb28aAF076ca6Dff559DC1e9855ba2bceFb4b951a", signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect("0xD6847262790a6A04A15F688Ade2ef42cA8F9e162", signer),
    auraBalVault: AuraBalVault__factory.connect("0xf0586c2BA50c2A33eb5BbcBD496ED3E5638d3235", signer),
    auraBalStrategy: SimpleStrategy__factory.connect("0xFa247e4e04ad17988962261175F9E9a6a46E2114", signer),
    boosterHelper: BoosterHelper__factory.connect(ZERO_ADDRESS, signer),
});

export const config: SidechainConfig = {
    chainId: chainIds.gnosis,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
    whales: {
        "0x66f33ae36dd80327744207a48122f874634b3ada": extConfig.balancerVault,
        "0xF48f01DCB2CbB3ee1f6AaB0e742c2D3941039d56": "0xf752dd899f87a91370c1c8ac1488aef6be687505",
        "0xb973ca96a3f0d61045f53255e319aedb6ed49240": extConfig.balancerVault,
    },
};
