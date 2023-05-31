/**
 * Notice: this config represents the "fake" goerli sidechain deployment
 * that is used for testing the layerzero relayer on goerli
 */
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
    AuraBalOFT__factory,
    VirtualRewardFactory__factory,
    AuraBalVault__factory,
    SimpleStrategy__factory,
    ExtSidechainConfig,
    SidechainBridging,
    SidechainConfig,
    SidechainMultisigConfig,
    BoosterHelper__factory,
} from "../../types";
import { config as goerliConfig } from "./goerli-config";
import { sidechainNaming } from "./sidechain-naming";
import { ZERO_ADDRESS } from "test-utils";

const multisigs: SidechainMultisigConfig = {
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4", // Aura deployer EOA
    pauseGuardian: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 10121, // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#goerli-ethereum-testnet
    lzEndpoint: "0xbfD2135BFfbb0B5378b56643c2Df8a87552Bfa23", // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#arbitrum-goerli-testnet
    minter: goerliConfig.addresses.minter, // Mock minter
    token: goerliConfig.addresses.token, // Mock token
    create2Factory: "0xf97De68aD9968A970aEf9849f2B9224506B7E1F6",
    gauges: ["0xec94b0453E14cde7fE1A66B54DCA29E9547C57ef"],
};

const whales = {
    // Token => Holder
    "0x16faF9f73748013155B7bC116a3008b57332D1e6": "0xE0a171587b1Cae546E069A943EDa96916F5EE977",
};

export const bridging: SidechainBridging = {
    l1Receiver: "0x0000000000000000000000000000000000000000",
    l2Sender: "0x0000000000000000000000000000000000000000",
    nativeBridge: "0x0000000000000000000000000000000000000000",
};

export const getSidechain = (signer: Signer) => ({
    voterProxy: VoterProxyLite__factory.connect("0x2B89339C923595b8e6Cc7bc87c83dbbd53f1FEb4", signer),
    booster: BoosterLite__factory.connect("0x852aD2fdE4cFEAd5c420F6f8027Dc14f877947C6", signer),
    boosterOwner: BoosterOwner__factory.connect("0xE01d927481978b59E6aEbB32601A4435C8a05fb8", signer),
    poolManager: PoolManagerLite__factory.connect("0xEE6c82b8Ef215E43d485b25de0B490f0f2F708BD", signer),
    l2Coordinator: L2Coordinator__factory.connect("0xbF6A1859e2503441dE34197e73Bd32d8f82698b0", signer),
    auraOFT: AuraOFT__factory.connect("0xe8a7E8C5a39996d2cf61bDFb8fD2F846b79D3099", signer),
    auraBalOFT: AuraBalOFT__factory.connect("0xe00035Eb901f487D2c6A16624aff093a29FeeD73", signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0xf3AE2E9620d7E93e69f9F7f0A6666E5D506aa978", signer),
        stashFactory: StashFactoryV2__factory.connect("0x3743d83ECffFA802f457bD25664d537A48182da7", signer),
        tokenFactory: TokenFactory__factory.connect("0xDfA714A90d55e9524389bc5345aC2Bd8AbF578eE", signer),
        proxyFactory: ProxyFactory__factory.connect("0xC1E07A89f24B39f82D7d08b9C2bE5288Aa42abe3", signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect("0xE4B11aa0ca5FE0d51CB2c53a4E583406FC338224", signer),
    auraBalVault: AuraBalVault__factory.connect("0xae8E14E01Fa6c651A6Cc4E410E8E623DFBa8BD1c", signer),
    auraBalStrategy: SimpleStrategy__factory.connect("0x0d418EA619EbF42Bf9b69f4f2d26Ac690B322285", signer),
    boosterHelper: BoosterHelper__factory.connect(ZERO_ADDRESS, signer),
});

export const config: SidechainConfig = {
    chainId: chainIds.goerli,
    whales,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
};
