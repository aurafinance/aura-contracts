# Aura Sidechain

Aura sidechain contracts

## Contracts

```
contracts/sidechain
├── AuraBalProxyOFT.sol     L1 Aura BAL proxy OFT
├── AuraBalOFT.sol          L2 Aura BAL OFT
├── AuraProxyOFT.sol        L1 Aura proxy OFT
├── AuraOFT.sol             L2 Aura OFT
├── Create2Factory.sol      A create2 factory to deploy the sidechain contracts to constant addresses
├── CrossChainConfig.sol    Abstract contract to handle setting LZ configs
├── CrossChainMessages.sol  Shared LZ messaging library
├── L1Coordinator.sol       L1 Coordinator handles sending messages to canonical chain
├── L2Coordinator.sol       L2 Coordinator handles sending messages to canonical chain
├── PausableOFT.sol         OFT extension  that allows a `guardian` address to perform an emergency pause
├── PausableProxyOFT.sol    Proxy OFT extension  that allows a `guardian` address to perform an emergency pause
└── PauseGuardian.sol       Allows to implement pauses triggered by a `guardian` address
```

## Deployment Tasks

### Phase 1

Deployment of sidechain pools (Booster, VoterProxy etc) and the Aura OFT.

1. Deploy the first phase of L1 sidechain system (AuraProxyOFT, L1Coordinator)

```
yarn task deploy:sidechain:L1:phase1 --wait <WAIT_N_BLOCKS>
```

2. Deploy the first phase of sidechain L2 system. (BoosterLite, VoterProxyLite, ... etc)

```
yarn task deploy:sidechain:L2:phase1 --wait <WAIT_N_BLOCKS>
```

3. Set the config and trusted remotes for the canonical chain

```
yarn task deploy:sidechain:config:L1:phase1 --wait <WAIT_N_BLOCKS> --sidechainid <CHAIN_ID> --network <CANONICAL_NETWORK_NAME>
```

### Phase 2

1. Deploy the second phase of L1 sidechain system (AuraBalProxyOFT)

```
yarn task deploy:sidechain:L1:phase2 --wait <WAIT_N_BLOCKS>
```

2. Deploy the second phase of sidechain L2 system. (AuraBalOFT)

```
yarn task deploy:sidechain:L2:phase2 --wait <WAIT_N_BLOCKS>
```

3. Set the config and trusted remotes for the canonical chain

```
yarn task deploy:sidechain:config:L1:phase2 --wait <WAIT_N_BLOCKS> --sidechainid <CHAIN_ID> --network <CANONICAL_NETWORK_NAME>
```

## Other Tasks

#### Mock contracts

Deploy mock contracts onto an L2 where Balancer is not deployed.

```
yarn task deploy:sidechain:mocks --wait <WAIT_N_BLOCKS>
```

#### Create2

Deploy a single instance of the create2Factory

```
yarn task deploy:sidechain:create2Factory --wait <WAIT_N_BLOCKS>
```

Compute L2 contract addresses

```
yarn task sidechain:addresses --chainId <CHAIN_ID>
```

#### LayerZero tasks

Lookup OFT information for a local->remote chain. It is also required that the environment variable REMOTE_NODE_URL is set.

For example if I want to lookup the information of mainnet->arbitrum I would set NODE_URL to a mainnet RPC and
REMOTE_NODE_URL to an arbitrum RPC and then pass in the arbitrum chain ID as sidechainid

```
yarn task sidechain:aura-oft-info --sidechainid <SIDECHAIN_ID>
```

Send AURA to a sidechain by providing a sidechain ID. Can also set force to true to ignore the chain ID sanity check when sending AURA between deployments running on the same chain. This is useful when testing

```
yarn task sidechain:test:send-aura-to-sidechain \
  --wait <WAIT_N_BLOCKS> \
  --amount <AMOUNT_OF_AURA> \
  --sidechainid <SIDECHAIN_ID> \
  --force <IGNORE_SIDECHAIN_CHECK>
```

Lock AURA from a sidechain

```
yarn task sidechhain:test:lock-aura --wait <WAIT_N_BLOCKS> --amount <AMOUNT_TO_LOCK>
```

## Deployments

#### Ethereum Mainnet (1)

| Contract                   | Address                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| L1Coordinator              | [0xc9e61174B8751003f493D25c2Ef49794aB6b1aC7](https://etherscan.io/address/0xc9e61174B8751003f493D25c2Ef49794aB6b1aC7) |
| AuraProxyOFT (ProxyOFT)    | [0xF8b6a90154D8AB85e543AB2fe10F94d4b20bC9AF](https://etherscan.io/address/0xF8b6a90154D8AB85e543AB2fe10F94d4b20bC9AF) |
| AuraBalProxyOFT (ProxyOFT) | [0xcD54C83759d2D55238bF742611B26A65D47F9719](https://etherscan.io/address/0xcD54C83759d2D55238bF742611B26A65D47F9719) |
| TestDistributeAura         | [0x8ede18ede974288c8a6e0fad140aff271fd65d46](https://etherscan.io/address/0x8ede18ede974288c8a6e0fad140aff271fd65d46) |

#### Arbitrum (42161)

| Contract           | Address                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| create2Factory     | [0x53C09096b1dC52e2Ef223b2969a714eE75Da364f](https://arbiscan.io/address/0x53C09096b1dC52e2Ef223b2969a714eE75Da364f) |
| L2Coordinator      | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |
| AuraOFT            | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |
| AuraBalOFT         | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |
| AuraBalVault       | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |
| AuraBalStrategy    | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |
| AuraVirtualRewards | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |
| BoosterLite        | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |
| VoterProxyLite     | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |
| TokenFactory       | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |
| ProxyFactory       | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |
| StashFactory       | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |
| PoolManagerLite    | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |
| BoosterOwner       | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/)                                           |

### Gnosis (test deployment) (100)

| Contract           | Address                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| GnosisBridgeSender | [0x2F70BF8d130aace466abBcbd21d34BB1A6a12c5d](https://gnosisscan.io/address/0x2F70BF8d130aace466abBcbd21d34BB1A6a12c5d) |
| create2Factory     | [0x53C09096b1dC52e2Ef223b2969a714eE75Da364f](https://gnosisscan.io/address/0x53C09096b1dC52e2Ef223b2969a714eE75Da364f) |
| L2Coordinator      | [0x0F665A14F2FC4e488c61cA45Ea53ad27Fb7cE223](https://gnosisscan.io/address/0x0F665A14F2FC4e488c61cA45Ea53ad27Fb7cE223) |
| AuraOFT            | [0x3B5357B10Ecd8FCA8345A03fEBA4cF0a97f01FB5](https://gnosisscan.io/address/0x3B5357B10Ecd8FCA8345A03fEBA4cF0a97f01FB5) |
| AuraBalOFT         | [0xF3552215c697ee67827A58CEFE1Ae027f2838E77](https://gnosisscan.io/address/0xF3552215c697ee67827A58CEFE1Ae027f2838E77) |
| AuraBalVault       | [0xf0586c2BA50c2A33eb5BbcBD496ED3E5638d3235](https://gnosisscan.io/address/0xf0586c2BA50c2A33eb5BbcBD496ED3E5638d3235) |
| AuraBalStrategy    | [0xFa247e4e04ad17988962261175F9E9a6a46E2114](https://gnosisscan.io/address/0xFa247e4e04ad17988962261175F9E9a6a46E2114) |
| BoosterLite        | [0x047B52d580047888902a37287E0d849e7433e85D](https://gnosisscan.io/address/0x047B52d580047888902a37287E0d849e7433e85D) |
| BoosterHelper      | [0x0000000000000000000000000000000000000000](https://gnosisscan.io/address/0x0000000000000000000000000000000000000000) |
| VoterProxyLite     | [0x363Fcb8B79cd67956F95923a1764A5062b9b7C0C](https://gnosisscan.io/address/0x363Fcb8B79cd67956F95923a1764A5062b9b7C0C) |
| TokenFactory       | [0xA18b88E087206BaA2f939BA0091A0aE261B239FC](https://gnosisscan.io/address/0xA18b88E087206BaA2f939BA0091A0aE261B239FC) |
| ProxyFactory       | [0xb28aAF076ca6Dff559DC1e9855ba2bceFb4b951a](https://gnosisscan.io/address/0xb28aAF076ca6Dff559DC1e9855ba2bceFb4b951a) |
| StashFactory       | [0x875882F7ccB5c494694cdf307290e41788857914](https://gnosisscan.io/address/0x875882F7ccB5c494694cdf307290e41788857914) |
| RewardFactory      | [0x88786239559FcEd792f256e029B66DaD09F605C1](https://gnosisscan.io/address/0x88786239559FcEd792f256e029B66DaD09F605C1) |
| PoolManagerLite    | [0x1F85614f2C79056EC538C127f505f0d9109c6979](https://gnosisscan.io/address/0x1F85614f2C79056EC538C127f505f0d9109c6979) |
| BoosterOwner       | [0xb2Ae2a8004359B30fa32a8b51AD822f2a5e06c41](https://gnosisscan.io/address/0xb2Ae2a8004359B30fa32a8b51AD822f2a5e06c41) |

### Testnets

#### Goerli (5)

| Contract              | Address                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| L1Coordinator         | [0x51493Dfb75f35fDEAD2B5bFa6904b59aaD9A37a8](https://goerli.etherscan.io/address/0x51493Dfb75f35fDEAD2B5bFa6904b59aaD9A37a8) |
| AuraOFT (ProxyOFT)    | [0x9838f48ae18C32D3aa25a81BC862eDA67C273146](https://goerli.etherscan.io/address/0x9838f48ae18C32D3aa25a81BC862eDA67C273146) |
| AuraBalOFT (ProxyOFT) | [0x76A383895103bde55987cEF54dbA7a2A57B72B73](https://goerli.etherscan.io/address/0x76A383895103bde55987cEF54dbA7a2A57B72B73) |

#### Goerli (Sidechain) (5)

| Contract              | Address                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| create2Factory        | [0xf97De68aD9968A970aEf9849f2B9224506B7E1F6](https://goerli.etherscan.io/address/0xf97De68aD9968A970aEf9849f2B9224506B7E1F6) |
| L2Coordinator         | [0xbF6A1859e2503441dE34197e73Bd32d8f82698b0](https://goerli.etherscan.io/address/0xbF6A1859e2503441dE34197e73Bd32d8f82698b0) |
| AuraOFT               | [0xe8a7E8C5a39996d2cf61bDFb8fD2F846b79D3099](https://goerli.etherscan.io/address/0xe8a7E8C5a39996d2cf61bDFb8fD2F846b79D3099) |
| AuraBalOFT            | [0xe00035Eb901f487D2c6A16624aff093a29FeeD73](https://goerli.etherscan.io/address/0xe00035Eb901f487D2c6A16624aff093a29FeeD73) |
| BoosterLite           | [0x852aD2fdE4cFEAd5c420F6f8027Dc14f877947C6](https://goerli.etherscan.io/address/0x852aD2fdE4cFEAd5c420F6f8027Dc14f877947C6) |
| VoterProxyLite        | [0x2B89339C923595b8e6Cc7bc87c83dbbd53f1FEb4](https://goerli.etherscan.io/address/0x2B89339C923595b8e6Cc7bc87c83dbbd53f1FEb4) |
| TokenFactory          | [0xDfA714A90d55e9524389bc5345aC2Bd8AbF578eE](https://goerli.etherscan.io/address/0xDfA714A90d55e9524389bc5345aC2Bd8AbF578eE) |
| ProxyFactory          | [0xC1E07A89f24B39f82D7d08b9C2bE5288Aa42abe3](https://goerli.etherscan.io/address/0xC1E07A89f24B39f82D7d08b9C2bE5288Aa42abe3) |
| StashFactory          | [0x3743d83ECffFA802f457bD25664d537A48182da7](https://goerli.etherscan.io/address/0x3743d83ECffFA802f457bD25664d537A48182da7) |
| RewardFactory         | [0xf3AE2E9620d7E93e69f9F7f0A6666E5D506aa978](https://goerli.etherscan.io/address/0xf3AE2E9620d7E93e69f9F7f0A6666E5D506aa978) |
| PoolManagerLite       | [0xEE6c82b8Ef215E43d485b25de0B490f0f2F708BD](https://goerli.etherscan.io/address/0xEE6c82b8Ef215E43d485b25de0B490f0f2F708BD) |
| BoosterOwner          | [0xE01d927481978b59E6aEbB32601A4435C8a05fb8](https://goerli.etherscan.io/address/0xE01d927481978b59E6aEbB32601A4435C8a05fb8) |
| VirtualRewardsFactory | [0xE4B11aa0ca5FE0d51CB2c53a4E583406FC338224](https://goerli.etherscan.io/address/0xE4B11aa0ca5FE0d51CB2c53a4E583406FC338224) |
| AuraBalVault          | [0xae8E14E01Fa6c651A6Cc4E410E8E623DFBa8BD1c](https://goerli.etherscan.io/address/0xae8E14E01Fa6c651A6Cc4E410E8E623DFBa8BD1c) |
| AuraBalStrategy       | [0x0d418EA619EbF42Bf9b69f4f2d26Ac690B322285](https://goerli.etherscan.io/address/0x0d418EA619EbF42Bf9b69f4f2d26Ac690B322285) |

## Deployment Diagram

![SideChain Deployment Diagram](../../docs/sidechain/sidechainDeployment.svg)
