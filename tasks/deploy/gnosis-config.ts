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
} from "../../types";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { sidechainNaming } from "./sidechain-constants";

const multisigs: SidechainMultisigConfig = {
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4", // Aura deployer EOA
    pauseGaurdian: ZERO_ADDRESS,
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 145, // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids#gnosis
    lzEndpoint: "0x9740FF91F1985D8d2B71494aE1A2f723bb3Ed9E4", // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids#gnosis
    minter: ZERO_ADDRESS, // Mock minter
    token: "0x7eF541E2a22058048904fE5744f9c7E4C57AF717", // Mock token
    create2Factory: ZERO_ADDRESS,
};
export const bridging: SidechainBridging = {
    l1Receiver: "0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0",
    l2Sender: ZERO_ADDRESS,
    nativeBridge: "0xf6A78083ca3e2a662D6dd1703c939c8aCE2e268d",
};

export const getSidechain = (signer: Signer) => ({
    voterProxy: VoterProxyLite__factory.connect(ZERO_ADDRESS, signer),
    booster: BoosterLite__factory.connect(ZERO_ADDRESS, signer),
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

export const config: SidechainConfig = {
    chainId: chainIds.arbitrumGoerli,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
};
