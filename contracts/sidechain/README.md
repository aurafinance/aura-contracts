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

| Contract           | Address                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| L1Coordinator      | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/)                                           |
| AuraOFT (ProxyOFT) | [0x9B36D6cADC5284Bb46EE815Ba4959a8E22869717](https://goerli.arbiscan.io/address/0x9B36D6cADC5284Bb46EE815Ba4959a8E22869717) |

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
| L2Coordinator   | [0x269a60d7d12e392F6e096C923823C371Dea7cE9C](https://goerli.arbiscan.io/address/0x269a60d7d12e392F6e096C923823C371Dea7cE9C) |
| AuraOFT         | [0x0000000000000000000000000000000000000000](https://goerli.arbiscan.io/address/)                                           |
| BoosterLite     | [0x8e9b10c65a8eCAC1F3f880675a88B75E31D2E8C0](https://goerli.arbiscan.io/address/0x8e9b10c65a8eCAC1F3f880675a88B75E31D2E8C0) |
| VoterProxyLite  | [0xfdAe5b9b7C98618CD03216D64F9917e16B014BF8](https://goerli.arbiscan.io/address/0xfdAe5b9b7C98618CD03216D64F9917e16B014BF8) |
| TokenFactory    | [0x0ED6Fe0d554D7F38B1224513b53C73BAB204316d](https://goerli.arbiscan.io/address/0x0ED6Fe0d554D7F38B1224513b53C73BAB204316d) |
| ProxyFactory    | [0xA2F70247AddEEA9c205477Fb73889da8F0D69317](https://goerli.arbiscan.io/address/0xA2F70247AddEEA9c205477Fb73889da8F0D69317) |
| StashFactory    | [0xBdE6BdF2C16b4407d6B3b983856d7b4253098e4D](https://goerli.arbiscan.io/address/0xBdE6BdF2C16b4407d6B3b983856d7b4253098e4D) |
| RewardFactory   | [0xd0Bd843B245BeA845411Ef118c0a25494692d7C6](https://goerli.arbiscan.io/address/0xd0Bd843B245BeA845411Ef118c0a25494692d7C6) |
| PoolManagerLite | [0x0792E9aaB201a002B1C18a7A35D026c6c251cdF1](https://goerli.arbiscan.io/address/0x0792E9aaB201a002B1C18a7A35D026c6c251cdF1) |
| BoosterOwner    | [0x0A01A721a4B881ae1B63aE7Ce3076Af6D36eea73](https://goerli.arbiscan.io/address/0x0A01A721a4B881ae1B63aE7Ce3076Af6D36eea73) |
