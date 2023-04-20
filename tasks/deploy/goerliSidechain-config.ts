/**
 * Notice: this config represents the "fake" goerli sidechain deployment
 * that is used for testing the layerzero relayer on goerli
 */
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
import { config as goerliConfig } from "./goerli-config";
import { ExtSidechainConfig, SidechainAddresses, SidechainConfig, SidechainNaming } from "./sidechain-types";

const addresses: SidechainAddresses = {
    lzEndpoint: "0xbfD2135BFfbb0B5378b56643c2Df8a87552Bfa23", // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#arbitrum-goerli-testnet
    daoMultisig: "0x30019eB135532bDdF2Da17659101cc000C73c8e4", // Aura deployer EOA
    minter: goerliConfig.addresses.minter, // Mock minter
    token: goerliConfig.addresses.token, // Mock token
    create2Factory: "0xaec901fBc8f83612011641d8aABa5B8432Dc228c",
};

const naming: SidechainNaming = {
    coordinatorName: "Aura",
    coordinatorSymbol: "AURA",
    tokenFactoryNamePostfix: " Aura Deposit",
};

const extConfig: ExtSidechainConfig = {
    canonicalChainId: 10121, // https://layerzero.gitbook.io/docs/technical-reference/testnet/testnet-addresses#goerli-ethereum-testnet
};

export const getSidechain = (signer: Signer) => ({
    voterProxy: VoterProxyLite__factory.connect("0xe77e947ddc841f033d7c92945fbd265Ac51e59B2", signer),
    booster: BoosterLite__factory.connect("0x397210e0C98A988F07a2B998D8CA2F2Cf7f216bE", signer),
    boosterOwner: BoosterOwner__factory.connect("0xa8264e5fF91194475e2e3CBFf90a3bD0637eB61F", signer),
    poolManager: PoolManagerLite__factory.connect("0x02Ccab31e2a3B44F48E37228A10370d11C12CAA9", signer),
    l2Coordinator: L2Coordinator__factory.connect("0xC5d857223D42765EF9cB8a942464165D31247094", signer),
    auraOFT: AuraOFT__factory.connect("0x46e510565B76611BAe7a7d40a106Cd4180a094F7", signer),
    factories: {
        rewardFactory: RewardFactory__factory.connect("0x6c8437D31e0D5975Be4F8cE7c3BAB151c99355ca", signer),
        stashFactory: StashFactoryV2__factory.connect("0x63C3e29f98EB4a15676b7559086e180c682cE8EA", signer),
        tokenFactory: TokenFactory__factory.connect("0x5C9A896Ff3e9c7faE915b46f34eCf811cEa6E217", signer),
        proxyFactory: ProxyFactory__factory.connect("0x7dBf2969711d3E1344869D2F23FAf5755dde4366", signer),
    },
});

export const config: SidechainConfig = {
    chainId: chainIds.arbitrumGoerli,
    addresses,
    naming,
    extConfig,
    getSidechain,
};
