# Aura Sidechain

Aura sidechain contracts

## Contracts

```
contracts/sidechain
├── AuraProxyOFT.sol        L1 Aura proxy OFT
├── AuraOFT.sol             L2 Aura OFT
├── L1Coordinator.sol       L1 Coordinator handles sending messages to canonical chain
├── L2Coordinator.sol       L2 Coordinator handles sending messages to canonical chain
├── Create2Factory.sol      A create2 factory to deploy the sidechain contracts to constant addresses
├── CrossChainConfig.sol    Abstract contract to handle setting LZ configs
└── CrossChainMessages.sol  Shared LZ messaging library
```

## Deployment Tasks

1. Deploy the L1 sidechain system (AuraProxyOFT, L1Coordinator)

```
yarn task deploy:sidechain:L1 --wait <WAIT_N_BLOCKS>
```

2. Deploy the sidechain L2 system. (BoosterLite, VoterProxyLite, ... etc)

```
yarn task deploy:sidechain:L2 --wait <WAIT_N_BLOCKS>
```

3. Set the config and trusted remotes for the canonical chain

```

yarn task deploy:sidechain:config:L1 --wait <WAIT_N_BLOCKS> --sidechainid <CHAIN_ID> --network <CANONICAL_NETWORK_NAME>

```

4. Set the config and trusted remotes for the sidechain

```
yarn task deploy:sidechain:config:L2 --wait <WAIT_N_BLOCKS> --canonicalchainid <CHAIN_ID> --network <SIDECHAIN_NETWORK_NAME>
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

#### Local->Remote info

Lookup OFT information for a local->remote chain. For this task remote chain id has to be any of the side chains.
It is also required that the environment variable REMOTE_NODE_URL is set.

For example if I want to lookup the information of mainnet->arbitrum I would set NODE_URL to a mainnet RPC and
REMOTE_NODE_URL to an arbitrum RPC and then pass in the arbitrum chain ID as remotechainid

```
yarn task sidechain:aura-oft-info --remotechainid <REMOTE_CHAIN_ID>
```

## Deployments

#### Ethereum Mainnet (1)

| Contract           | Address                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| L1Coordinator      | [0x0000000000000000000000000000000000000000](https://etherscan.io/address/)                                           |
| AuraOFT (ProxyOFT) | [0x0000000000000000000000000000000000000000](https://etherscan.io/address/0x2da25f5B2ba3aa776Bdda0bfAA33900F8195c8F3) |

#### Arbitrum (42161)

| Contract        | Address                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| create2Factory  | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/) |
| L2Coordinator   | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/) |
| AuraOFT         | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/) |
| BoosterLite     | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/) |
| VoterProxyLite  | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/) |
| TokenFactory    | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/) |
| ProxyFactory    | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/) |
| StashFactory    | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/) |
| PoolManagerLite | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/) |
| BoosterOwner    | [0x0000000000000000000000000000000000000000](https://arbiscan.io/address/) |

### Testnets

#### Goerli (5)

| Contract           | Address                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| L1Coordinator      | [0x197170cA2Bf97B36a1e9Bb131Bf7EF3c98a06d1b](https://goerli.etherscan.io/address/0x197170cA2Bf97B36a1e9Bb131Bf7EF3c98a06d1b) |
| AuraOFT (ProxyOFT) | [0x1fbfDb4e94d3bA76C832baafE13Fbb38264fBAfF](https://goerli.etherscan.io/address/0x1fbfDb4e94d3bA76C832baafE13Fbb38264fBAfF) |

#### Goerli (Sidechain) (5)

| Contract        | Address                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| create2Factory  | [0xaec901fBc8f83612011641d8aABa5B8432Dc228c](https://goerli.etherscan.io/address/0xaec901fBc8f83612011641d8aABa5B8432Dc228c) |
| L2Coordinator   | [0x714636c864F3b02e001798b2d16370E74E4379e4](https://goerli.etherscan.io/address/0x714636c864F3b02e001798b2d16370E74E4379e4) |
| AuraOFT         | [0x7E7460187F97532828aBc06af691a494F82Cf7f2](https://goerli.etherscan.io/address/0x7E7460187F97532828aBc06af691a494F82Cf7f2) |
| BoosterLite     | [0x2386716accFdEb113913A0468f7deb5303679A60](https://goerli.etherscan.io/address/0x2386716accFdEb113913A0468f7deb5303679A60) |
| VoterProxyLite  | [0x6334c9b535C5c2e294554b54e62e778A040f8b43](https://goerli.etherscan.io/address/0x6334c9b535C5c2e294554b54e62e778A040f8b43) |
| TokenFactory    | [0x44F57984cbDbf63174C0bC3B8Db1Bfa4a1e20609](https://goerli.etherscan.io/address/0x44F57984cbDbf63174C0bC3B8Db1Bfa4a1e20609) |
| ProxyFactory    | [0x787633684fdd5F5B01255942AB5207eC5700375e](https://goerli.etherscan.io/address/0x787633684fdd5F5B01255942AB5207eC5700375e) |
| StashFactory    | [0xEBA33C82D890dBE19465a381F24428DDD1A62b59](https://goerli.etherscan.io/address/0xEBA33C82D890dBE19465a381F24428DDD1A62b59) |
| RewardFactory   | [0xeB01eD361B226252087646E2872e5306e82b314A](https://goerli.etherscan.io/address/0xeB01eD361B226252087646E2872e5306e82b314A) |
| PoolManagerLite | [0xDC446885f43a3bB969141a746d536A0edf34b8De](https://goerli.etherscan.io/address/0xDC446885f43a3bB969141a746d536A0edf34b8De) |
| BoosterOwner    | [0x5E7BF6380E6E24eDe10BE628C96b2d4943464149](https://goerli.etherscan.io/address/0x5E7BF6380E6E24eDe10BE628C96b2d4943464149) |
