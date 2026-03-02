import { expect } from "chai";
import { Signer, utils } from "ethers";
import hre, { ethers } from "hardhat";
import { deployContract } from "../../tasks/utils/deploy-utils";
import { increaseTime } from "../../test-utils/time";
import {
    MockERC20,
    MockERC20__factory,
    MockSafe,
    MockSafe__factory,
    MockStakeDaoCampaignRemoteManager,
    MockStakeDaoCampaignRemoteManager__factory,
    StakeDaoCampaignModule,
    StakeDaoCampaignModule__factory,
} from "../../types/generated";

describe("StakeDaoCampaignModule (unit)", () => {
    let owner: Signer;
    let keeper: Signer;
    let nonOwner: Signer;

    let safe: MockSafe;
    let rewardToken: MockERC20;
    let remoteManager: MockStakeDaoCampaignRemoteManager;
    let moduleContract: StakeDaoCampaignModule;

    const destinationChainId = 8453;
    const nativeValue = utils.parseEther("0.001");
    const gauge = "0x275dF57d2B23d53e20322b4bb71Bf1dCb21D0A00";
    const gaugeDuplicate = "0x0312AA8D0BA4a1969Fddb382235870bF55f7f242";
    const gaugeExtra = "0x175407b4710b5A1cB67a37C76859F17fb2ff6672";
    const gaugeUnconfigured = "0x8368dca5ce2a4db530c0f6f82c8aef24d32ee4ef";
    const campaignManager = "0x327db4c2e4918920533a05f0f6aa9edfb717bb41";
    const campaignManagerUpdated = "0x1111111111111111111111111111111111111111";
    const hook = "0x7a3830c1383312985cc2256f22ba6a0ce25c4304";
    const votemarket = "0xdd2fad5606cd8ec0c3b93eb4f9849572b598f4c7";

    before(async () => {
        [owner, keeper, nonOwner] = await ethers.getSigners();

        safe = await deployContract<MockSafe>(hre, new MockSafe__factory(owner), "MockSafe", [], {}, false);

        rewardToken = await deployContract<MockERC20>(
            hre,
            new MockERC20__factory(owner),
            "MockERC20",
            ["Mock AURA", "mAURA", 18, safe.address, 1_000_000],
            {},
            false,
        );

        remoteManager = await deployContract<MockStakeDaoCampaignRemoteManager>(
            hre,
            new MockStakeDaoCampaignRemoteManager__factory(owner),
            "MockStakeDaoCampaignRemoteManager",
            [],
            {},
            false,
        );

        moduleContract = await deployContract<StakeDaoCampaignModule>(
            hre,
            new StakeDaoCampaignModule__factory(owner),
            "StakeDaoCampaignModule",
            [
                await owner.getAddress(),
                safe.address,
                remoteManager.address,
                rewardToken.address,
                votemarket,
                campaignManager,
            ],
            {},
            false,
        );

        await safe.enableModule(moduleContract.address);
        await moduleContract.updateAuthorizedKeepers(await keeper.getAddress(), true);
        await moduleContract.setGaugeConfig(gauge, 1, utils.parseEther("50000"));
        await moduleContract.setGaugeConfig(gaugeDuplicate, 1, utils.parseEther("50000"));
        await moduleContract.setGaugeConfig(gaugeExtra, 42161, utils.parseEther("50000"));
        await owner.sendTransaction({ to: safe.address, value: nativeValue.mul(10) });
    });

    const buildParams = (targetGauge: string, overrides: Record<string, any> = {}) => ({
        gauge: targetGauge,
        totalRewardAmount: utils.parseEther("10"),
        addresses: [],
        maxRewardPerVote: "72214649693911450",
        additionalGasLimit: 1_950_000,
        hook,
        isWhitelist: false,
        ...overrides,
    });

    it("constructor reverts for zero addresses", async () => {
        const moduleFactory = await hre.ethers.getContractFactory("StakeDaoCampaignModule", owner);

        await expect(
            moduleFactory.deploy(
                await owner.getAddress(),
                safe.address,
                ethers.constants.AddressZero,
                rewardToken.address,
                votemarket,
                campaignManager,
            ),
        ).to.be.revertedWith("!campaignRemoteManager");

        await expect(
            moduleFactory.deploy(
                await owner.getAddress(),
                safe.address,
                remoteManager.address,
                ethers.constants.AddressZero,
                votemarket,
                campaignManager,
            ),
        ).to.be.revertedWith("!rewardToken");

        await expect(
            moduleFactory.deploy(
                await owner.getAddress(),
                safe.address,
                remoteManager.address,
                rewardToken.address,
                ethers.constants.AddressZero,
                campaignManager,
            ),
        ).to.be.revertedWith("!votemarket");

        await expect(
            moduleFactory.deploy(
                await owner.getAddress(),
                safe.address,
                remoteManager.address,
                rewardToken.address,
                votemarket,
                ethers.constants.AddressZero,
            ),
        ).to.be.revertedWith("!campaignManager");
    });

    it("creates campaign via module through safe", async () => {
        const totalRewardAmount = utils.parseEther("1000");
        const params = buildParams(gauge, { totalRewardAmount });

        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue)).to.not.be.reverted;

        expect(await remoteManager.lastDestinationChainId()).to.eq(destinationChainId);
        expect(await remoteManager.lastAdditionalGasLimit()).to.eq(params.additionalGasLimit);
        expect((await remoteManager.lastVotemarket()).toLowerCase()).to.eq(votemarket.toLowerCase());
        expect(await remoteManager.lastValue()).to.eq(nativeValue);
        expect(await remoteManager.totalCalls()).to.eq(1);
        expect(await rewardToken.balanceOf(remoteManager.address)).to.eq(totalRewardAmount);
    });

    it("emits CampaignCreated with current epoch", async () => {
        const params = buildParams(gaugeExtra);
        const epoch = await moduleContract.getCurrentEpoch();

        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue))
            .to.emit(moduleContract, "CampaignCreated")
            .withArgs(epoch, gaugeExtra, params.totalRewardAmount, nativeValue);
    });

    it("reverts for non keeper", async () => {
        const params = buildParams(gauge, { totalRewardAmount: utils.parseEther("1") });

        await expect(moduleContract.createCampaign(params, nativeValue)).to.be.revertedWith("!keeper");
    });

    it("reverts duplicate in same epoch and allows in next epoch", async () => {
        const params = buildParams(gaugeDuplicate);

        await moduleContract.connect(keeper).createCampaign(params, nativeValue);
        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue)).to.be.revertedWith("!epoch");

        await increaseTime(14 * 24 * 60 * 60);

        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue)).to.not.be.reverted;
    });

    it("reverts above configured max amount", async () => {
        const params = buildParams(gauge, { totalRewardAmount: utils.parseEther("50001") });

        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue)).to.be.revertedWith(
            "!maxAmount",
        );
    });

    it("reverts when gauge is not configured", async () => {
        const params = buildParams(gaugeUnconfigured);
        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue)).to.be.revertedWith("!gauge");
    });

    it("reverts when maxRewardPerVote is zero", async () => {
        const params = buildParams(gauge, { maxRewardPerVote: 0 });
        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue)).to.be.revertedWith(
            "!maxRewardPerVote",
        );
    });

    it("reverts when additionalGasLimit is zero", async () => {
        const params = buildParams(gauge, { additionalGasLimit: 0 });
        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue)).to.be.revertedWith(
            "!additionalGasLimit",
        );
    });

    it("setGaugeConfig enforces onlyOwner and input checks", async () => {
        await expect(
            moduleContract.connect(nonOwner).setGaugeConfig(gaugeUnconfigured, 1, utils.parseEther("1")),
        ).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(
            moduleContract.setGaugeConfig(ethers.constants.AddressZero, 1, utils.parseEther("1")),
        ).to.be.revertedWith("!gauge");
        await expect(moduleContract.setGaugeConfig(gaugeUnconfigured, 1, 0)).to.be.revertedWith("!maxAmount");
    });

    it("setCampaignManager updates value and validates access", async () => {
        await expect(moduleContract.connect(nonOwner).setCampaignManager(campaignManagerUpdated)).to.be.revertedWith(
            "Ownable: caller is not the owner",
        );
        await expect(moduleContract.setCampaignManager(ethers.constants.AddressZero)).to.be.revertedWith(
            "!campaignManager",
        );

        await expect(moduleContract.setCampaignManager(campaignManagerUpdated))
            .to.emit(moduleContract, "SetCampaignManager")
            .withArgs(campaignManagerUpdated);
        expect(await moduleContract.campaignManager()).to.eq(campaignManagerUpdated);
    });

    it("reverts with !module when module is disabled in safe", async () => {
        const isolatedGauge = "0x1111111111111111111111111111111111111112";
        await moduleContract.setGaugeConfig(isolatedGauge, 1, utils.parseEther("1000"));
        await safe.disableModule(ethers.constants.AddressZero, moduleContract.address);

        const params = buildParams(isolatedGauge, { totalRewardAmount: utils.parseEther("1") });
        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue)).to.be.revertedWith("!module");

        await safe.enableModule(moduleContract.address);
    });

    it("reverts with !success when safe call returns false", async () => {
        const isolatedGauge = "0x1111111111111111111111111111111111111114";
        await moduleContract.setGaugeConfig(isolatedGauge, 1, utils.parseEther("1000"));

        await safe.setForceFail(true);

        const params = buildParams(isolatedGauge, { totalRewardAmount: utils.parseEther("1") });
        await expect(moduleContract.connect(keeper).createCampaign(params, nativeValue)).to.be.revertedWith("!success");

        await safe.setForceFail(false);
    });

    it("reverts with !exec when remote manager call fails", async () => {
        const moduleFactory = await hre.ethers.getContractFactory("StakeDaoCampaignModule", owner);
        const failModule = await deployContract(
            hre,
            moduleFactory,
            "StakeDaoCampaignModule",
            [
                await owner.getAddress(),
                safe.address,
                rewardToken.address,
                rewardToken.address,
                votemarket,
                campaignManager,
            ],
            {},
            false,
        );

        await safe.enableModule(failModule.address);
        await failModule.updateAuthorizedKeepers(await keeper.getAddress(), true);

        const failGauge = "0x1111111111111111111111111111111111111113";
        await failModule.setGaugeConfig(failGauge, 1, utils.parseEther("1000"));

        const params = buildParams(failGauge, { totalRewardAmount: utils.parseEther("1") });
        await expect(failModule.connect(keeper).createCampaign(params, nativeValue)).to.be.revertedWith("!exec");
    });
});
