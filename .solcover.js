module.exports = {
    istanbulReporter: ["html", "lcov"],
    providerOptions: {
        mnemonic: process.env.MNEMONIC,
    },
    skipFiles: [
        "_mocks",
        "test",
        "convex-platform/contracts/contracts/interfaces",
        "convex-platform/contracts/contracts/ExtraRewardStashV3.sol",
        "convex-platform/contracts/contracts/ProxyFactory.sol",
        "convex-platform/contracts/contracts/RewardHook.sol",
        "interfaces",
        "chef",
        "peripheral/BoosterHelper.sol",
        "peripheral/ClaimFeesHelper.sol",
        "peripheral/RewardPoolDepositWrapper.sol",
        "peripheral/AuraMining.sol",
        "peripheral/UniswapMigrator.sol",
        "compounder/rewardHandlers/BBUSDHandler.sol",
    ],
    configureYulOptimizer: true,
};
