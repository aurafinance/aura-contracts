import { Signer } from "ethers";
import { chainIds } from "../../hardhat.config";
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
} from "../../types";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import {
    ExtSidechainConfig,
    SidechainAddresses,
    SidechainConfig,
    SidechainNaming,
    SidechainBridging,
} from "./sidechain-types";

const addresses: SidechainAddresses = {
    lzEndpoint: "0x9740FF91F1985D8d2B71494aE1A2f723bb3Ed9E4", // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids#gnosis
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4", // Aura deployer EOA
    minter: ZERO_ADDRESS, // Mock minter
    token: "0x7eF541E2a22058048904fE5744f9c7E4C57AF717", // Mock token
    create2Factory: ZERO_ADDRESS,
};

const naming: SidechainNaming = {
    coordinatorName: "Aura",
    coordinatorSymbol: "AURA",
    tokenFactoryNamePostfix: " Aura Deposit",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 145, // https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids#gnosis
};

export const getSidechain = (signer: Signer) => ({
    voterProxy: VoterProxyLite__factory.connect(ZERO_ADDRESS, signer),
    booster: BoosterLite__factory.connect(ZERO_ADDRESS, signer),
    boosterOwner: BoosterOwner__factory.connect(ZERO_ADDRESS, signer),
    poolManager: PoolManagerLite__factory.connect(ZERO_ADDRESS, signer),
    l2Coordinator: L2Coordinator__factory.connect(ZERO_ADDRESS, signer),
    auraOFT: AuraOFT__factory.connect(ZERO_ADDRESS, signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect(ZERO_ADDRESS, signer),
        stashFactory: StashFactoryV2__factory.connect(ZERO_ADDRESS, signer),
        tokenFactory: TokenFactory__factory.connect(ZERO_ADDRESS, signer),
        proxyFactory: ProxyFactory__factory.connect(ZERO_ADDRESS, signer),
    },
});

export const bridging: SidechainBridging = {
    l1Receiver: "0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0",
    l2Sender: ZERO_ADDRESS,
    nativeBridge: "0xf6A78083ca3e2a662D6dd1703c939c8aCE2e268d",
};

export const config: SidechainConfig = {
    chainId: chainIds.arbitrumGoerli,
    addresses,
    naming,
    extConfig,
    bridging,
    getSidechain,
};
