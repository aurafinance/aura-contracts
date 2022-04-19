# Aura Finance

## Dev

### Pre Requisites

Before running any command, you need to create a `.env` file and set a BIP-39 compatible mnemonic as an environment
variable. Follow the example in `.env.example`. If you don't already have a mnemonic, use this [website](https://iancoleman.io/bip39/) to generate one.

Then, proceed with installing dependencies:

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
