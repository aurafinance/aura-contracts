module.exports = {
    istanbulReporter: ["html", "lcov"],
    providerOptions: {
        mnemonic: process.env.MNEMONIC,
    },
    skipFiles: [
        "mocks",
        "test",
        "convex-platform/contracts/contracts/interfaces",
        "BoosterHelper.sol",
        "ChefForwarder.sol",
        "ClaimFeesHelper.sol",
        "MasterChefRewardHook.sol",
        "RewardPoolDepositWrapper.sol",
        "SiphonToken.sol",
    ],
    configureYulOptimizer: true,
};
