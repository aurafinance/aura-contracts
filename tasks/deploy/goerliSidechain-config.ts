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
} from "../../types";
import { config as goerliConfig } from "./goerli-config";
import { sidechainNaming } from "./sidechain-constants";

const multisigs: SidechainMultisigConfig = {
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4", // Aura deployer EOA
    pauseGaurdian: "0x30019eB135532bDdF2Da17659101cc000C73c8e4",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 10121, // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#goerli-ethereum-testnet
    lzEndpoint: "0xbfD2135BFfbb0B5378b56643c2Df8a87552Bfa23", // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#arbitrum-goerli-testnet
    minter: goerliConfig.addresses.minter, // Mock minter
    token: goerliConfig.addresses.token, // Mock token
    create2Factory: "0xaec901fBc8f83612011641d8aABa5B8432Dc228c",
};

export const bridging: SidechainBridging = {
    l1Receiver: "0x0000000000000000000000000000000000000000",
    l2Sender: "0x0000000000000000000000000000000000000000",
    nativeBridge: "0x0000000000000000000000000000000000000000",
};

export const getSidechain = (signer: Signer) => ({
    voterProxy: VoterProxyLite__factory.connect("0x6334c9b535C5c2e294554b54e62e778A040f8b43", signer),
    booster: BoosterLite__factory.connect("0x2386716accFdEb113913A0468f7deb5303679A60", signer),
    boosterOwner: BoosterOwner__factory.connect("0x5E7BF6380E6E24eDe10BE628C96b2d4943464149", signer),
    poolManager: PoolManagerLite__factory.connect("0xDC446885f43a3bB969141a746d536A0edf34b8De", signer),
    l2Coordinator: L2Coordinator__factory.connect("0x714636c864F3b02e001798b2d16370E74E4379e4", signer),
    auraOFT: AuraOFT__factory.connect("0x7E7460187F97532828aBc06af691a494F82Cf7f2", signer),
    auraBalOFT: AuraBalOFT__factory.connect("0x0000000000000000000000000000000000000000", signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0xeB01eD361B226252087646E2872e5306e82b314A", signer),
        stashFactory: StashFactoryV2__factory.connect("0xEBA33C82D890dBE19465a381F24428DDD1A62b59", signer),
        tokenFactory: TokenFactory__factory.connect("0x44F57984cbDbf63174C0bC3B8Db1Bfa4a1e20609", signer),
        proxyFactory: ProxyFactory__factory.connect("0x787633684fdd5F5B01255942AB5207eC5700375e", signer),
    },
    virtualRewardFactory: VirtualRewardFactory__factory.connect("0x0000000000000000000000000000000000000000", signer),
    auraBalVault: AuraBalVault__factory.connect("0x0000000000000000000000000000000000000000", signer),
    auraBalStrategy: SimpleStrategy__factory.connect("0x0000000000000000000000000000000000000000", signer),
});

export const config: SidechainConfig = {
    chainId: chainIds.goerli,
    multisigs,
    naming: sidechainNaming,
    extConfig,
    bridging,
    getSidechain,
};
