# Aura Sidechain

Aura sidechain contracts

## Contracts

```
contracts/sidechain
├── AuraProxyOFT.sol        L1 Aura proxy OFT
├── AuraOFT.sol L2          Aura OFT
├── L1Coordinator.sol       L1 Coordinator handles sending messages to canonical chain
├── L2Coordinator.sol       L2 Coordinator handles sending messages to canonical chain
├── Create2Factory.sol      Ronseal
├── CrossChainConfig.sol    Abstract contract to handle setting LZ configs
└── CrossChainMessages.sol  Shared LZ messaging library
```

## Tasks

Deploy the L1 sidechain system (AuraProxyOFT, L1Coordinator)

```
yarn task deploy:sidechain:L1 --wait <WAIT_N_BLOCKS>
```

Deploy mock contracts onto an L2 where Balancer is not deployed.

```
yarn task deploy:sidechain:mocks --wait <WAIT_N_BLOCKS>
```

Deploy the sidechain L2 system. (BoosterLite, VoterProxyLite, ... etc)

```
yarn task deploy:sidechain:L2 --wait <WAIT_N_BLOCKS>
```

Deploy a single instance of the create2Factory

```
yarn task deploy:sidechain:create2Factory --wait <WAIT_N_BLOCKS>
```

Compute L2 contract addresses

```
yarn task sidechain:addresses --chainId <CHAIN_ID>
```

## Deployments

#### Ethereum Mainnet (1)

| Contract           | Address                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| L1Coordinator      | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |
| AuraOFT (ProxyOFT) | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |

#### Arbitrum (42161)

| Contract        | Address                                                                           |
| --------------- | --------------------------------------------------------------------------------- |
| create2Factory  | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |
| L2Coordinator   | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |
| AuraOFT         | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |
| BoosterLite     | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |
| VoterProxyLite  | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |
| TokenFactory    | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |
| ProxyFactory    | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |
| StashFactory    | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |
| PoolManagerLite | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |
| BoosterOwner    | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |

### Testnets

#### Goerli (5)

| Contract           | Address                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| L1Coordinator      | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |
| AuraOFT (ProxyOFT) | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/) |

#### Arbitrum Goerli (42163)

| Contract        | Address                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| create2Factory  | [0x2E1ADE7233e886D8041Fd7c3b87523F3DDC2169D](https://goerli.arbiscan.io/address/0x2E1ADE7233e886D8041Fd7c3b87523F3DDC2169D) |
| L2Coordinator   | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/)                                           |
| AuraOFT         | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/)                                           |
| BoosterLite     | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/)                                           |
| VoterProxyLite  | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/)                                           |
| TokenFactory    | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/)                                           |
| ProxyFactory    | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/)                                           |
| StashFactory    | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/)                                           |
| PoolManagerLite | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/)                                           |
| BoosterOwner    | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/)                                           |
