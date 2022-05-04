module.exports = {
    istanbulReporter: ["html", "lcov"],
    providerOptions: {
        mnemonic: process.env.MNEMONIC,
    },
    skipFiles: ["mocks", "test", "convex-platform/contracts/contracts/interfaces"],
    configureYulOptimizer: true,
};
