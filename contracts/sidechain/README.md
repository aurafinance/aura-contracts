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
| L1Coordinator              | [0xaA54f3b282805822419265208e669d12372a3811](https://etherscan.io/address/0xaA54f3b282805822419265208e669d12372a3811) |
| AuraProxyOFT (ProxyOFT)    | [0xB401f0cff9F05d10699c0e2c88a81dD923c1FFFf](https://etherscan.io/address/0xB401f0cff9F05d10699c0e2c88a81dD923c1FFFf) |
| AuraBalProxyOFT (ProxyOFT) | [0xdF9080B6BfE4630a97A0655C0016E0e9B43a7C68](https://etherscan.io/address/0xdF9080B6BfE4630a97A0655C0016E0e9B43a7C68) |
| TestDistributeAura         | [0xc9e61174B8751003f493D25c2Ef49794aB6b1aC7](https://etherscan.io/address/0xc9e61174B8751003f493D25c2Ef49794aB6b1aC7) |
| BridgeDelegateReceiver     | [0x397A2D4d23C6fD1316cE25000820779006e80cD7](https://etherscan.io/address/0x397A2D4d23C6fD1316cE25000820779006e80cD7) |
| Sudo                       | [0xb370Ebd7ded0c87b4509FF6f13F07B7F1693Bf46](https://etherscan.io/address/0xb370Ebd7ded0c87b4509FF6f13F07B7F1693Bf46) |
| View                       | [0x208024E643564fb4C990481eB4F9ec1957f64c11](https://etherscan.io/address/0x208024E643564fb4C990481eB4F9ec1957f64c11) |
| AuraDistributor            | [0x96D15D08538A17A03B0210FD1626D5f42bdba9a4](https://etherscan.io/address/0x96D15D08538A17A03B0210FD1626D5f42bdba9a4) |

#### Arbitrum (42161)

| Contract                 | Address                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| create2Factory           | [0x53C09096b1dC52e2Ef223b2969a714eE75Da364f](https://arbiscan.io/address/0x53C09096b1dC52e2Ef223b2969a714eE75Da364f) |
| L2Coordinator            | [0xeC1c780A275438916E7CEb174D80878f29580606](https://arbiscan.io/address/0xeC1c780A275438916E7CEb174D80878f29580606) |
| AuraOFT                  | [0x1509706a6c66CA549ff0cB464de88231DDBe213B](https://arbiscan.io/address/0x1509706a6c66CA549ff0cB464de88231DDBe213B) |
| AuraBalOFT               | [0x223738a747383d6F9f827d95964e4d8E8AC754cE](https://arbiscan.io/address/0x223738a747383d6F9f827d95964e4d8E8AC754cE) |
| AuraBalVault             | [0x4EA9317D90b61fc28C418C247ad0CA8939Bbb0e9](https://arbiscan.io/address/0x4EA9317D90b61fc28C418C247ad0CA8939Bbb0e9) |
| AuraBalStrategy          | [0x4B5D2848678Db574Fbc2d2f629143d969a4f41Cb](https://arbiscan.io/address/0x4B5D2848678Db574Fbc2d2f629143d969a4f41Cb) |
| VirtualRewardsFactory    | [0x05589CbbE1cC0357986DF6de4031B953819079c2](https://arbiscan.io/address/0x05589CbbE1cC0357986DF6de4031B953819079c2) |
| BoosterLite              | [0x98Ef32edd24e2c92525E59afc4475C1242a30184](https://arbiscan.io/address/0x98Ef32edd24e2c92525E59afc4475C1242a30184) |
| VoterProxyLite           | [0xC181Edc719480bd089b94647c2Dc504e2700a2B0](https://arbiscan.io/address/0xC181Edc719480bd089b94647c2Dc504e2700a2B0) |
| TokenFactory             | [0x87299312C820607f1E7E4d0c6715CEB594306FE9](https://arbiscan.io/address/0x87299312C820607f1E7E4d0c6715CEB594306FE9) |
| ProxyFactory             | [0x731886426a3199b988194831031dfb993F25D961](https://arbiscan.io/address/0x731886426a3199b988194831031dfb993F25D961) |
| RewardFactory            | [0xda2e6bA0B1aBBCA925b70E9747AFbD481C16e7dB](https://arbiscan.io/address/0xda2e6bA0B1aBBCA925b70E9747AFbD481C16e7dB) |
| StashFactory             | [0x779aa2880d7a701FB46d320C710944a72E2A049b](https://arbiscan.io/address/0x779aa2880d7a701FB46d320C710944a72E2A049b) |
| PoolManagerLite          | [0xf24074a1A6ad620aDC14745F9cc1fB1e7BA6CA71](https://arbiscan.io/address/0xf24074a1A6ad620aDC14745F9cc1fB1e7BA6CA71) |
| BoosterOwner             | [0x3af95Ba5C362075Bb28E5A2A42D7Cd1e201A1b66](https://arbiscan.io/address/0x3af95Ba5C362075Bb28E5A2A42D7Cd1e201A1b66) |
| ProtocolDAO              | [0xD1A6e8cA5D4d6C1fA0CD1f6937A49D3f380DAc62](https://arbiscan.io/address/0xD1A6e8cA5D4d6C1fA0CD1f6937A49D3f380DAc62) |
| ClaimZap                 | [0x617963D46B882ecE880Ab18Bc232f513E91FDd47](https://arbiscan.io/address/0x617963D46B882ecE880Ab18Bc232f513E91FDd47) |
| Treasury                 | [0x57ACb721FcF3d900B480A90A55191CF8F37ad478](https://arbiscan.io/address/0x57ACb721FcF3d900B480A90A55191CF8F37ad478) |
| RewardPoolDepositWrapper | [0x6b02fEFd2F2e06f51E17b7d5b8B20D75fd6916be](https://arbiscan.io/address/0x6b02fEFd2F2e06f51E17b7d5b8B20D75fd6916be) |
| BridgeSender             | [0x713E883C22fa543fb28cE96E0677aE347096fBe6](https://arbiscan.io/address/0x713E883C22fa543fb28cE96E0677aE347096fBe6) |
| View                     | [0x0a6bcB3a0C03aB2Bc8A058ee02ed11D50b494083](https://arbiscan.io/address/0x0a6bcB3a0C03aB2Bc8A058ee02ed11D50b494083) |
| KeeperMulticall3         | [0x5C97f09506d60B90a817EB547ea4F03Ae990E798](https://arbiscan.io/address/0x5C97f09506d60B90a817EB547ea4F03Ae990E798) |

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
| VoterProxyLite     | [0x363Fcb8B79cd67956F95923a1764A5062b9b7C0C](https://gnosisscan.io/address/0x363Fcb8B79cd67956F95923a1764A5062b9b7C0C) |
| TokenFactory       | [0xA18b88E087206BaA2f939BA0091A0aE261B239FC](https://gnosisscan.io/address/0xA18b88E087206BaA2f939BA0091A0aE261B239FC) |
| ProxyFactory       | [0xb28aAF076ca6Dff559DC1e9855ba2bceFb4b951a](https://gnosisscan.io/address/0xb28aAF076ca6Dff559DC1e9855ba2bceFb4b951a) |
| StashFactory       | [0x875882F7ccB5c494694cdf307290e41788857914](https://gnosisscan.io/address/0x875882F7ccB5c494694cdf307290e41788857914) |
| RewardFactory      | [0x88786239559FcEd792f256e029B66DaD09F605C1](https://gnosisscan.io/address/0x88786239559FcEd792f256e029B66DaD09F605C1) |
| PoolManagerLite    | [0x1F85614f2C79056EC538C127f505f0d9109c6979](https://gnosisscan.io/address/0x1F85614f2C79056EC538C127f505f0d9109c6979) |
| BoosterOwner       | [0xb2Ae2a8004359B30fa32a8b51AD822f2a5e06c41](https://gnosisscan.io/address/0xb2Ae2a8004359B30fa32a8b51AD822f2a5e06c41) |
| ProtocolDAO        | [0xD1A6e8cA5D4d6C1fA0CD1f6937A49D3f380DAc62](https://gnosisscan.io/address/0xD1A6e8cA5D4d6C1fA0CD1f6937A49D3f380DAc62) |

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

#### Arbitrum (42161) @deprecated

| Contract          | Address                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| ClaimZap          | [0x809195e57ce1c7ca9f339a4dbee5b3636cbff70d](https://arbiscan.io/address/0x809195e57ce1c7ca9f339a4dbee5b3636cbff70d) |
| BoosterLiteHelper | [0x5A0F54Eef14c3F6F0b2EefB6C618cd80B9B95e42](https://arbiscan.io/address/0x5A0F54Eef14c3F6F0b2EefB6C618cd80B9B95e42) |

## Deployment Diagram

![SideChain Deployment Diagram](../../docs/sidechain/sidechainDeployment.svg)
