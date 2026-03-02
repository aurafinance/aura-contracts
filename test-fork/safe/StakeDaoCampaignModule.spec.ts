import { expect } from "chai";
import { Contract, Signer, utils } from "ethers";
import hre, { network } from "hardhat";

import { config } from "../../tasks/deploy/mainnet-config";
import { deployStakeDaoCampaignModule } from "../../scripts/deployPeripheral";
import { INCENTIVE_GAUGES } from "../../tasks/information/incentiveGauges";
import { impersonate } from "../../test-utils";
import { ISafe, ISafe__factory } from "../../types";

describe("StakeDaoCampaignModule", () => {
    let incentivesMultisig: Signer;
    let keeper: Signer;
    let deployer: Signer;
    let safe: ISafe;

    let moduleContract: Contract;
    let mockRewardToken: Contract;
    let mockRemoteManager: Contract;

    const destinationChainId = 8453;
    const additionalGasLimit = 1_950_000;
    const maxRewardPerVote = "72214649693911450";
    const nativeValue = "389633901739532";

    const gaugeCreate = INCENTIVE_GAUGES.AURA_WETH_50_50.gauge;
    const gaugeDuplicateSameEpoch = INCENTIVE_GAUGES.AURABAL_BAL_WETH_STABLE.gauge;
    const gaugeDuplicateNextEpoch = INCENTIVE_GAUGES.ARB_AURABAL_WSTETH_55_45.gauge;
    const gaugeNonKeeper = "0x8368dca5ce2a4db530c0f6f82c8aef24d32ee4ef";
    const manager = "0x327db4c2e4918920533a05f0f6aa9edfb717bb41";
    const hook = "0x7a3830c1383312985cc2256f22ba6a0ce25c4304";
    const votemarket = config.addresses.stakeDaoVoteMarket;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 24541320,
                    },
                },
            ],
        });

        deployer = await impersonate("0xA28ea848801da877E1844F954FF388e857d405e5", true);
        incentivesMultisig = await impersonate(config.multisigs.incentivesMultisig, true);
        keeper = await impersonate(config.multisigs.defender.keeperMulticall3, true);

        safe = ISafe__factory.connect(config.multisigs.incentivesMultisig, incentivesMultisig);

        const tokenFactory = await hre.ethers.getContractFactory("MockERC20", deployer);
        mockRewardToken = await tokenFactory.deploy(
            "Mock AURA",
            "mAURA",
            18,
            config.multisigs.incentivesMultisig,
            100_000,
        );
        await mockRewardToken.deployTransaction.wait();

        const remoteManagerFactory = await hre.ethers.getContractFactory("MockStakeDaoCampaignRemoteManager", deployer);
        mockRemoteManager = await remoteManagerFactory.deploy();
        await mockRemoteManager.deployTransaction.wait();

        const result = await deployStakeDaoCampaignModule(
            hre,
            deployer,
            config.multisigs,
            {
                campaignRemoteManager: mockRemoteManager.address,
                rewardToken: mockRewardToken.address,
                votemarket,
                campaignManager: manager,
                gaugeConfigs: [
                    { gauge: gaugeCreate, chainId: 1, maxTotalRewardAmount: utils.parseEther("50000") },
                    { gauge: gaugeDuplicateSameEpoch, chainId: 1, maxTotalRewardAmount: utils.parseEther("50000") },
                    { gauge: gaugeDuplicateNextEpoch, chainId: 42161, maxTotalRewardAmount: utils.parseEther("50000") },
                    { gauge: gaugeNonKeeper, chainId: 1, maxTotalRewardAmount: utils.parseEther("50000") },
                ],
            },
            false,
            0,
        );
        moduleContract = result.stakeDaoCampaignModule;

        await safe.enableModule(moduleContract.address);
    });

    it("configures and enables the module", async () => {
        expect(await safe.isModuleEnabled(moduleContract.address), "isEnabled").to.eq(true);

        expect(await moduleContract.authorizedKeepers(await keeper.getAddress()), "keeper").to.eq(true);
        expect(await moduleContract.rewardToken(), "rewardToken").to.eq(mockRewardToken.address);
        expect((await moduleContract.campaignManager()).toLowerCase(), "campaignManager").to.eq(manager.toLowerCase());
        expect((await moduleContract.votemarket()).toLowerCase(), "votemarket").to.eq(votemarket.toLowerCase());
        expect(await moduleContract.DESTINATION_CHAIN_ID(), "destinationChainId").to.eq(destinationChainId);
    });

    it("creates a campaign via safe module", async () => {
        const totalRewardAmount = utils.parseEther("1000");
        const params = {
            gauge: gaugeCreate,
            totalRewardAmount,
            addresses: [],
            maxRewardPerVote,
            additionalGasLimit,
            hook,
            isWhitelist: false,
        };

        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue)).to.not.be.reverted;

        expect(await mockRemoteManager.lastDestinationChainId(), "destinationChainId").to.eq(destinationChainId);
        expect(await mockRemoteManager.lastAdditionalGasLimit(), "additionalGasLimit").to.eq(additionalGasLimit);
        expect((await mockRemoteManager.lastVotemarket()).toLowerCase(), "votemarket").to.eq(votemarket.toLowerCase());
        expect(await mockRemoteManager.lastValue(), "nativeValue").to.eq(nativeValue);

        expect(await mockRemoteManager.totalCalls(), "totalCalls").to.eq(1);
        expect(await mockRewardToken.balanceOf(mockRemoteManager.address), "reward-token-balance").to.eq(
            totalRewardAmount,
        );
    });

    it("reverts for duplicate campaign in same epoch", async () => {
        const totalRewardAmount = utils.parseEther("500");
        const params = {
            gauge: gaugeDuplicateSameEpoch,
            totalRewardAmount,
            addresses: [],
            maxRewardPerVote,
            additionalGasLimit,
            hook,
            isWhitelist: false,
        };

        await moduleContract.connect(keeper).createCampaign(params, nativeValue);
        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue)).to.be.revertedWith("!epoch");
    });

    it("allows duplicate campaign on next epoch", async () => {
        const totalRewardAmount = utils.parseEther("250");
        const params = {
            gauge: gaugeDuplicateNextEpoch,
            totalRewardAmount,
            addresses: [],
            maxRewardPerVote,
            additionalGasLimit,
            hook,
            isWhitelist: false,
        };

        await moduleContract.connect(keeper).createCampaign(params, nativeValue);
        await network.provider.send("evm_increaseTime", [14 * 24 * 60 * 60]);
        await network.provider.send("evm_mine");
        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue)).to.not.be.reverted;
    });

    it("reverts for non keeper", async () => {
        const params = {
            gauge: gaugeNonKeeper,
            totalRewardAmount: utils.parseEther("1"),
            addresses: [],
            maxRewardPerVote,
            additionalGasLimit,
            hook,
            isWhitelist: false,
        };

        await expect(moduleContract.createCampaign(params, nativeValue)).to.be.revertedWith("!keeper");
    });
});
