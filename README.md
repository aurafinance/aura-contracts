# Aura Finance

## Security

Smart contract security is a top priority for Aura, [see Security documentation](https://docs.aura.finance/aura/security) .

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

### Ethereum Mainnet (1)

| Contract                  | Address                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| voterProxy                | [0xaF52695E1bB01A16D33D7194C28C42b10e0Dbec2](https://etherscan.io/address/0xaF52695E1bB01A16D33D7194C28C42b10e0Dbec2) |
| aura                      | [0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF](https://etherscan.io/address/0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF) |
| minter                    | [0x59A5ccD34943CD0AdCf5ce703EE9F06889E13707](https://etherscan.io/address/0x59A5ccD34943CD0AdCf5ce703EE9F06889E13707) |
| booster                   | [0x7818A1DA7BD1E64c199029E86Ba244a9798eEE10](https://etherscan.io/address/0x7818A1DA7BD1E64c199029E86Ba244a9798eEE10) |
| boosterOwner              | [0xFa838Af70314135159b309bf27f1DbF1F954eC34](https://etherscan.io/address/0xFa838Af70314135159b309bf27f1DbF1F954eC34) |
| rewardFactory             | [0x45aaD11F2FA2C215bc9686eb6f06D46E0474F356](https://etherscan.io/address/0x45aaD11F2FA2C215bc9686eb6f06D46E0474F356) |
| tokenFactory              | [0xb6CE51DEE8BD4A2Fd11c01205414dc26f0b453AC](https://etherscan.io/address/0xb6CE51DEE8BD4A2Fd11c01205414dc26f0b453AC) |
| proxyFactory              | [0x7eD9003C6003EaCe1e8C3ae99F0Bb19894377b0F](https://etherscan.io/address/0x7eD9003C6003EaCe1e8C3ae99F0Bb19894377b0F) |
| stashFactory              | [0x95171c9Ef5cA540A6d3502e9547fcFE022458Eb5](https://etherscan.io/address/0x95171c9Ef5cA540A6d3502e9547fcFE022458Eb5) |
| extraRewardStashV3        | [0xF9C0f3431F859e773eD052758052e06B6D175742](https://etherscan.io/address/0xF9C0f3431F859e773eD052758052e06B6D175742) |
| arbitratorVault           | [0x5d208cD54f5132f2BD0c1F1e8d8c864Bb6BEdc40](https://etherscan.io/address/0x5d208cD54f5132f2BD0c1F1e8d8c864Bb6BEdc40) |
| auraBAL                   | [0x616e8BfA43F920657B3497DBf40D6b1A02D4608d](https://etherscan.io/address/0x616e8BfA43F920657B3497DBf40D6b1A02D4608d) |
| auraBALBpt                | [0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd](https://etherscan.io/address/0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd) |
| cvxCrvRewards             | [0x5e5ea2048475854a5702F5B8468A51Ba1296EFcC](https://etherscan.io/address/0x5e5ea2048475854a5702F5B8468A51Ba1296EFcC) |
| initialCvxCrvStaking      | [0xC47162863a12227E5c3B0860715F9cF721651C0c](https://etherscan.io/address/0xC47162863a12227E5c3B0860715F9cF721651C0c) |
| crvDepositor              | [0xeAd792B55340Aa20181A80d6a16db6A0ECd1b827](https://etherscan.io/address/0xeAd792B55340Aa20181A80d6a16db6A0ECd1b827) |
| crvDepositorWrapper       | [0x68655AD9852a99C87C0934c7290BB62CFa5D4123](https://etherscan.io/address/0x68655AD9852a99C87C0934c7290BB62CFa5D4123) |
| poolManager               | [0xf843F61508Fc17543412DE55B10ED87f4C28DE50](https://etherscan.io/address/0xf843F61508Fc17543412DE55B10ED87f4C28DE50) |
| auraLocker (vlAURA)       | [0x3Fa73f1E5d8A792C80F426fc8F84FBF7Ce9bBCAC](https://etherscan.io/address/0x3Fa73f1E5d8A792C80F426fc8F84FBF7Ce9bBCAC) |
| cvxStakingProxy           | [0xd9e863B7317a66fe0a4d2834910f604Fd6F89C6c](https://etherscan.io/address/0xd9e863B7317a66fe0a4d2834910f604Fd6F89C6c) |
| chef                      | [0x1ab80F7Fb46B25b7e0B2cfAC23Fc88AC37aaf4e9](https://etherscan.io/address/0x1ab80F7Fb46B25b7e0B2cfAC23Fc88AC37aaf4e9) |
| lbpBpt                    | [0x6fc73b9d624b543f8b6b88fc3ce627877ff169ee](https://etherscan.io/address/0x6fc73b9d624b543f8b6b88fc3ce627877ff169ee) |
| balLiquidityProvider      | [0xa7429af4DeB16827dAd0e71D8AEEa9C2bF70e32c](https://etherscan.io/address/0xa7429af4DeB16827dAd0e71D8AEEa9C2bF70e32c) |
| penaltyForwarder          | [0x4043569200F7a7a1D989AbbaBC2De2Bde1C20D1E](https://etherscan.io/address/0x4043569200F7a7a1D989AbbaBC2De2Bde1C20D1E) |
| extraRewardsDistributor   | [0xA3739b206097317c72EF416F0E75BB8f58FbD308](https://etherscan.io/address/0xA3739b206097317c72EF416F0E75BB8f58FbD308) |
| poolManagerProxy          | [0x16A04E58a77aB1CE561A37371dFb479a8594947A](https://etherscan.io/address/0x16A04E58a77aB1CE561A37371dFb479a8594947A) |
| poolManagerSecondaryProxy | [0xdc274F4854831FED60f9Eca12CaCbD449134cF67](https://etherscan.io/address/0xdc274F4854831FED60f9Eca12CaCbD449134cF67) |
| vestedEscrows             | [0x5bd3fCA8D3d8c94a6419d85E0a76ec8Da52d836a](https://etherscan.io/address/0x5bd3fCA8D3d8c94a6419d85E0a76ec8Da52d836a) |
|                           | [0x24346652e0e2aE0CE05c781501fDF4Fe4553fAc6](https://etherscan.io/address/0x24346652e0e2aE0CE05c781501fDF4Fe4553fAc6) |
|                           | [0x45025Ebc38647bcf7Edd2b40CfDaF3fbfE1538F5](https://etherscan.io/address/0x45025Ebc38647bcf7Edd2b40CfDaF3fbfE1538F5) |
|                           | [0x43B17088503F4CE1AED9fB302ED6BB51aD6694Fa](https://etherscan.io/address/0x43B17088503F4CE1AED9fB302ED6BB51aD6694Fa) |
|                           | [0xFd72170339AC6d7bdda09D1eACA346B21a30D422](https://etherscan.io/address/0xFd72170339AC6d7bdda09D1eACA346B21a30D422) |
| drops                     | [0x45EB1A004373b1D8457134A2C04a42d69D287724](https://etherscan.io/address/0x45EB1A004373b1D8457134A2C04a42d69D287724) |
|                           | [0x1a661CF8D8cd69dD2A423F3626A461A24280a8fB](https://etherscan.io/address/0x1a661CF8D8cd69dD2A423F3626A461A24280a8fB) |
| auraClaimZap              | [0x623B83755a39B12161A63748f3f595A530917Ab2](https://etherscan.io/address/0x623B83755a39B12161A63748f3f595A530917Ab2) |
| claimFeesHelper           | [0x999dBcE0A18F721F04E793f916C30e72A9D0f56E](https://etherscan.io/address/0x999dBcE0A18F721F04E793f916C30e72A9D0f56E) |
| rewardPoolDepositWrapper  | [0xB188b1CB84Fb0bA13cb9ee1292769F903A9feC59](https://etherscan.io/address/0xB188b1CB84Fb0bA13cb9ee1292769F903A9feC59) |

### Kovan (42)

| Contract                | Address                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| voterProxy              | [0xAf133908d1B435e1B58C91316AF3f17688a47A50](https://kovan.etherscan.io/address/0xAf133908d1B435e1B58C91316AF3f17688a47A50) |
| aura                    | [0xfA0C33c6BAeFE4a41F68039d24CA116a4E4B49DE](https://kovan.etherscan.io/address/0xfA0C33c6BAeFE4a41F68039d24CA116a4E4B49DE) |
| minter                  | [0xE86f1e7fAaD932E071Fd37Ec5dA3A2877a31c51F](https://kovan.etherscan.io/address/0xE86f1e7fAaD932E071Fd37Ec5dA3A2877a31c51F) |
| booster                 | [0xAF4AAf0559187aBd973dD60d2F44513aF3a2490d](https://kovan.etherscan.io/address/0xAF4AAf0559187aBd973dD60d2F44513aF3a2490d) |
| boosterOwner            | [0xC586a417a512BC234a7327112E41284F2E98B953](https://kovan.etherscan.io/address/0xC586a417a512BC234a7327112E41284F2E98B953) |
| auraBAL                 | [0xe7cA8d829ff4f644b0E312536770630Fa63EdAab](https://kovan.etherscan.io/address/0xe7cA8d829ff4f644b0E312536770630Fa63EdAab) |
| auraBALBpt              | [0x0ba216e69a1289be9090dfe88cb37d8a542cb74b](https://kovan.etherscan.io/address/0x0ba216e69a1289be9090dfe88cb37d8a542cb74b) |
| cvxCrvRewards           | [0x676CBbdc03D5547B519290B03b3d0a865eE2fE10](https://kovan.etherscan.io/address/0x676CBbdc03D5547B519290B03b3d0a865eE2fE10) |
| initialCvxCrvStaking    | [0xe66f0579Fb7FCccED6e18E9a0e610493811Bfe79](https://kovan.etherscan.io/address/0xe66f0579Fb7FCccED6e18E9a0e610493811Bfe79) |
| crvDepositor            | [0xd2902C5c9632Fa6638465e4D2DE5AcDcCf8Ca673](https://kovan.etherscan.io/address/0xd2902C5c9632Fa6638465e4D2DE5AcDcCf8Ca673) |
| crvDepositorWrapper     | [0x6b6e02E5B62257f12efd0098C9C836D31E21eB6F](https://kovan.etherscan.io/address/0x6b6e02E5B62257f12efd0098C9C836D31E21eB6F) |
| poolManager             | [0x2F2C0D5a60914FfD62d2BB48d189b1cd87BedE61](https://kovan.etherscan.io/address/0x2F2C0D5a60914FfD62d2BB48d189b1cd87BedE61) |
| auraLocker              | [0x4890af9a0DF624AaCaF8537F6F9caC56A723cb2F](https://kovan.etherscan.io/address/0x4890af9a0DF624AaCaF8537F6F9caC56A723cb2F) |
| cvxStakingProxy         | [0x3a38c699e2B464D21A13Efbd35cC71021994b032](https://kovan.etherscan.io/address/0x3a38c699e2B464D21A13Efbd35cC71021994b032) |
| chef                    | [0x0422a859FeCF2576e2201209AE02eFff916AfCF4](https://kovan.etherscan.io/address/0x0422a859FeCF2576e2201209AE02eFff916AfCF4) |
| lbpBpt                  | [0x8ea94258c47efe0c56af6b0f529e05298f5aca64](https://kovan.etherscan.io/address/0x8ea94258c47efe0c56af6b0f529e05298f5aca64) |
| balLiquidityProvider    | [0x179ae0B233bf0D14Fb9d87f3Ad2BF7625aF96623](https://kovan.etherscan.io/address/0x179ae0B233bf0D14Fb9d87f3Ad2BF7625aF96623) |
| penaltyForwarder        | [0x3E1dCA7a5CcE431e0Bd0fA5ddb4C3575E20A07C4](https://kovan.etherscan.io/address/0x3E1dCA7a5CcE431e0Bd0fA5ddb4C3575E20A07C4) |
| extraRewardsDistributor | [0x4742c75CEc81B0ee80e3e1c8e8E7Cd5aeB218F41](https://kovan.etherscan.io/address/0x4742c75CEc81B0ee80e3e1c8e8E7Cd5aeB218F41) |
| pool8020Bpt             | [0x4bddf01cbc15f3a2e78570c5bed14c67a16327f6](https://kovan.etherscan.io/address/0x4bddf01cbc15f3a2e78570c5bed14c67a16327f6) |
| claimZap                | [0x57d174f436d7950FaA1F91d9E9f40716E199B28c](https://kovan.etherscan.io/address/0x57d174f436d7950FaA1F91d9E9f40716E199B28c) |
| vestedEscrows           | [0x0e0837C8DA3C1931831Cc9aC2c19265AAa16cF97](https://kovan.etherscan.io/address/0x0e0837C8DA3C1931831Cc9aC2c19265AAa16cF97) |
|                         | [0x1fad8b2Af546f6F56115A5F17aB7A6e6946A771a](https://kovan.etherscan.io/address/0x1fad8b2Af546f6F56115A5F17aB7A6e6946A771a) |
|                         | [0x156c44B88FBA5B65083758e7D1634c9fD27F0a31](https://kovan.etherscan.io/address/0x156c44B88FBA5B65083758e7D1634c9fD27F0a31) |
|                         | [0x700C22100691ae23498d2182F317A7bC2829043a](https://kovan.etherscan.io/address/0x700C22100691ae23498d2182F317A7bC2829043a) |
| drops                   | [0xBe227b7851570a9f5adFB923E9a2d4583EB6630F](https://kovan.etherscan.io/address/0xBe227b7851570a9f5adFB923E9a2d4583EB6630F) |
|                         | [0xEC1a6e61f7c4864Cf8bfcf5BcEEFeE6259D6A2B6](https://kovan.etherscan.io/address/0xEC1a6e61f7c4864Cf8bfcf5BcEEFeE6259D6A2B6) |

### Goerli (5)

| Contract                | Address                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| voterProxy              | [0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9](https://goerli.etherscan.io/address/0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9) |
| AuraToken               | [0xFf3653ee692F541efB7c2214D72FE05A7A6EC01f](https://goerli.etherscan.io/address/0xFf3653ee692F541efB7c2214D72FE05A7A6EC01f) |
| AuraMinter              | [0x3366EfDdc7d268759a1A1273740aE5C626b2DFbA](https://goerli.etherscan.io/address/0x3366EfDdc7d268759a1A1273740aE5C626b2DFbA) |
| Booster                 | [0x2ad214dA65effA92159057957E50994440E99A1b](https://goerli.etherscan.io/address/0x2ad214dA65effA92159057957E50994440E99A1b) |
| RewardFactory           | [0x78868AcEe480928E3A5a9e50545bf2f53903e350](https://goerli.etherscan.io/address/0x78868AcEe480928E3A5a9e50545bf2f53903e350) |
| TokenFactory            | [0xFA226c6ec7d74E5a18839D3E5a2b35B9AE8d65d9](https://goerli.etherscan.io/address/0xFA226c6ec7d74E5a18839D3E5a2b35B9AE8d65d9) |
| ProxyFactory            | [0x9D246b32686f424162cB8e48A519E3a49c9AB000](https://goerli.etherscan.io/address/0x9D246b32686f424162cB8e48A519E3a49c9AB000) |
| ExtraRewardStashV3      | [0x317E288F53a8E6ced9CA2524983dA2D3314f7848](https://goerli.etherscan.io/address/0x317E288F53a8E6ced9CA2524983dA2D3314f7848) |
| CvxCrv                  | [0xf80D3083b18fe3f11196E57438258330Ba4f15Ec](https://goerli.etherscan.io/address/0xf80D3083b18fe3f11196E57438258330Ba4f15Ec) |
| CrvDepositor            | [0xD2e06829a8464bd802Ef68A6C900F36db3a86cb1](https://goerli.etherscan.io/address/0xD2e06829a8464bd802Ef68A6C900F36db3a86cb1) |
| BaseRewardPool          | [0x09421e5D9C2B11f502482DcE2B718b037fD10a25](https://goerli.etherscan.io/address/0x09421e5D9C2B11f502482DcE2B718b037fD10a25) |
| PoolManagerProxy        | [0x073b3903BC9747B4e7e974698a202cA2c591FEC1](https://goerli.etherscan.io/address/0x073b3903BC9747B4e7e974698a202cA2c591FEC1) |
| PoolManagerProxy        | [0x0Fc3C95E512E44EAA12C4e5543643B17Aa20a1D6](https://goerli.etherscan.io/address/0x0Fc3C95E512E44EAA12C4e5543643B17Aa20a1D6) |
| PoolManagerV3           | [0x0B4566B619Dc12381E386564E45df62316259E71](https://goerli.etherscan.io/address/0x0B4566B619Dc12381E386564E45df62316259E71) |
| BoosterOwner            | [0x6931835d072f50d98D7a7BF7B2C4faFdA86628d7](https://goerli.etherscan.io/address/0x6931835d072f50d98D7a7BF7B2C4faFdA86628d7) |
| ArbitratorVault         | [0xc2939C598e2D044A87C8E22a90A9e36b9579F197](https://goerli.etherscan.io/address/0xc2939C598e2D044A87C8E22a90A9e36b9579F197) |
| AuraLocker              | [0x1e5B33222977642Bf64EC80846BBF83A016727A0](https://goerli.etherscan.io/address/0x1e5B33222977642Bf64EC80846BBF83A016727A0) |
| CrvDepositorWrapper     | [0x4AC5c047CfA39b14fb06564DEC7D85e6fA2b045a](https://goerli.etherscan.io/address/0x4AC5c047CfA39b14fb06564DEC7D85e6fA2b045a) |
| AuraStakingProxy        | [0x1A8bB30F2AfF498ef026D2BCCc8971a30144b93C](https://goerli.etherscan.io/address/0x1A8bB30F2AfF498ef026D2BCCc8971a30144b93C) |
| ExtraRewardsDistributor | [0xbdfFBBD7Ac592a53405AE152B6D23CF3F6B8a738](https://goerli.etherscan.io/address/0xbdfFBBD7Ac592a53405AE152B6D23CF3F6B8a738) |
| AuraPenaltyForwarder    | [0xCEB49C1F8716C9D90e349eBcAeE589E7Bb6ec6f2](https://goerli.etherscan.io/address/0xCEB49C1F8716C9D90e349eBcAeE589E7Bb6ec6f2) |
| AuraVestedEscrow        | [0x7372EcE4C18bEABc19981A53b557be90dcBd2b66](https://goerli.etherscan.io/address/0x7372EcE4C18bEABc19981A53b557be90dcBd2b66) |
| AuraVestedEscrow        | [0x6FC5a70BC896645D529CD9CAfa1D3755438E7D83](https://goerli.etherscan.io/address/0x6FC5a70BC896645D529CD9CAfa1D3755438E7D83) |
| AuraVestedEscrow        | [0xdEB339E69e87A010Cab637f922d270A981A37891](https://goerli.etherscan.io/address/0xdEB339E69e87A010Cab637f922d270A981A37891) |
| AuraVestedEscrow        | [0x8F2cE52277b2bC044Ca0B2e26B9b5d230067c6f4](https://goerli.etherscan.io/address/0x8F2cE52277b2bC044Ca0B2e26B9b5d230067c6f4) |
| AuraBalRewardPool       | [0xe0b4823F9a872FD2a33aE11708C67e1a2Af3C147](https://goerli.etherscan.io/address/0xe0b4823F9a872FD2a33aE11708C67e1a2Af3C147) |
| CvxCrvBPT               | [0xAc98C986d8318ff08109AE6F4E7043468dA9d0a2](https://goerli.etherscan.io/address/0xAc98C986d8318ff08109AE6F4E7043468dA9d0a2) |
| Bootstrap               | [0xa3fCaFCa8150636C3B736A16Cd73d49cC8A7E10E](https://goerli.etherscan.io/address/0xa3fCaFCa8150636C3B736A16Cd73d49cC8A7E10E) |
| AuraMerkleDrop          | [0x89f67f3054bFD662971854190Dbc18dcaBb416f6](https://goerli.etherscan.io/address/0x89f67f3054bFD662971854190Dbc18dcaBb416f6) |
| AuraMerkleDrop          | [0x29d1f271D823b4989416E1d2076d0CE666f8fC16](https://goerli.etherscan.io/address/0x29d1f271D823b4989416E1d2076d0CE666f8fC16) |
