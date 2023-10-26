# Aura Finance

[![Test Coverage](https://github.com/aurafinance/aura-contracts/actions/workflows/test-coverage.yaml/badge.svg)](https://github.com/aurafinance/aura-contracts/actions/workflows/test-coverage.yaml)

## Security

Smart contract security is a top priority for Aura, [see Security documentation](https://docs.aura.finance/aura/security) .
Aura has partnered up with [@chainalysis](https://twitter.com/chainalysis) to adopt an [Incident Response Plan](https://vote.aura.finance/#/proposal/0x2fbb1422b9efea30fc91b714645ef9591a8291c896e5f0e70efdf43d9a322f05) for the protocol to add an extra layer of security, Aura will be able to deter hackers and have an asset recovery plan in potential events.

If you have any feedback or concerns, reach out to `security@aura.finance`

## Dev

### Pre Requisites

### Submodule

```sh
$ git submodule init
$ git submodule update
```

### Install

```sh
$ yarn install
```

### Compile

Compile the smart contracts with Hardhat:

```sh
$ yarn compile
```

### TypeChain

Compile the smart contracts and generate TypeChain artifacts:

```sh
$ yarn typechain
```

### Lint Solidity

Lint the Solidity code:

```sh
$ yarn lint:sol
```

### Lint TypeScript

Lint the TypeScript code:

```sh
$ yarn lint:ts
```

### Test

Run the Mocha tests:

```sh
$ yarn test
```

Run fork tests

```sh
$ yarn test:fork:all
```

### Tasks

Running in fork mode

```sh
$ NODE_URL=<FORK_URL> yarn task:fork <TASK_NAME>
```

Running task normally

```
$ NODE_URL=<NODE_URL> yarn task --network <NETWORK> <TASK_NAME>
```

### Coverage

Generate the code coverage report:

```sh
$ yarn coverage
```

### Clean

Delete the smart contract artifacts, the coverage reports and the Hardhat cache:

```sh
$ yarn clean
```

## Local Fork

This runs a local node on your system, that can be used with Metamask, etc.

Run a local fork:

```
npx hardhat node --fork https://eth-mainnet.alchemyapi.io/v2/<API_KEY> --port <PORT>
```

Once you stake or lock CVX you may want to progress timestamps to check rewards stuff

```
export NODE_URL=<LOCAL_NODE_URL>
yarn task timeTravel --duration 69420 --network forking
```

## Diagrams

[Booster Reward Flow](https://docs.google.com/drawings/d/1RjtogmP2EO4j0AIR_uRnOr9jorUwTBn2iBdk4dnK7d8/edit?usp=sharing)
<img src="https://docs.google.com/drawings/d/e/2PACX-1vTEfuureekx70YBgcDBjOsgGYPGYXFzEcjzm-exmcHhe49F9QskgEl6Qn4O5kSHAOvihToEo-4_n5bj/pub?w=2052&h=1032" />

[Cvx Reward Flow](https://docs.google.com/drawings/d/1csXH2TP74UeIhQie1j8fmJvBsBAvGzHAB_-FkfXJ7k8/edit?usp=sharing)
<img src="https://docs.google.com/drawings/d/e/2PACX-1vTGNgox8tvYi1kRxkBnPB8Rwas6Tb5Ic2pCquqG7oIYqLrBF8I9r3n-2fQKtjKfY7xhQrvFKV0Yn5_j/pub?w=1629&h=960" />

## Deployments

-   [Ethereum Mainnet (1)](deployments/1.json)
-   [Arbitrum (42161)](deployments/42161.json)
-   [Goerli (5)](deployments/5.json)
-   [Arbitrum Goerli (42163)](deployments/42163.json)
-   [Ethereum Mainnet (1) @deprecated](<deployments/1-deprecated(v1).json>)
-   [Ethereum Mainnet (2) @deprecated](<deployments/1-deprecated(v2).json>)
-   [Goerli (5) @deprecated](<deployments/5-deprecated(v1).json>)

## Notes

### Warnings

-   auraBAL and vlAURA reward contracts are not on the 4626 standard

-   StashToken contracts are not ERC20 compliant. `convex-platform/contracts/contracts/StashToken.sol` it is designed to interact only with VirtualBalanceRewardPool and ExtraRewardStashV3.
    Any `extraRewards` is distributed by a VirtualBalanceRewardPool, which is linked to a StashToken, the StashToken wraps the `extraReward` as a `baseToken`.
