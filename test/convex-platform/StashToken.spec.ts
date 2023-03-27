import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";

import {
    StashToken,
    StashToken__factory,
    MockERC20__factory,
    MockERC20,
    BaseRewardPool__factory,
    IERC20,
    IERC20__factory,
} from "../../types/generated";
import {
    MultisigConfig,
    Phase2Deployed,
    Phase6Deployed,
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    deployPhase5,
    deployPhase6,
} from "../../scripts/deploySystem";
import { Account } from "../../types";
import { deployMocks, DeployMocksResult, getMockMultisigs, getMockDistro } from "../../scripts/deployMocks";
import {
    DEAD_ADDRESS,
    ONE_WEEK,
    ZERO,
    ZERO_ADDRESS,
    impersonateAccount,
    increaseTime,
    simpleToExactAmount,
} from "../../test-utils";

describe("StashToken", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let deployer: Signer;
    let multisigs: MultisigConfig;
    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    let lpToken: IERC20;
    let mockErc20: MockERC20;
    let operatorOwnerAccount: Account;
    let boosterAccount: Account;

    // Test token
    let stashToken: StashToken;

    const pid = 0;
    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        // Full deployment with mocks
        mocks = await deployMocks(hre, deployer);
        multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);

        const distro = getMockDistro();
        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        phase2 = await deployPhase2(hre, deployer, phase1, distro, multisigs, mocks.namingConfig, mocks.addresses);
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.setProtectPool(false);
        const phase4 = await deployPhase4(hre, deployer, phase3, mocks.addresses);
        await deployPhase5(hre, deployer, phase4, multisigs, mocks.addresses);
        phase6 = await deployPhase6(hre, deployer, phase2, multisigs, mocks.namingConfig, mocks.addresses);
        const voterProxyOwnerAccount = await impersonateAccount(await phase2.voterProxy.owner());
        operatorOwnerAccount = await impersonateAccount(phase6.boosterOwner.address);
        boosterAccount = await impersonateAccount(phase6.booster.address);

        // Shutdown system and change booster version on voter proxy
        mockErc20 = await new MockERC20__factory(deployer).deploy(
            "MockERC20",
            "mk20",
            18,
            await deployer.getAddress(),
            simpleToExactAmount(2, 39),
        );
        await phase2.booster.connect((await impersonateAccount(phase2.boosterOwner.address)).signer).shutdownSystem();
        await phase2.voterProxy.connect(voterProxyOwnerAccount.signer).setOperator(phase6.booster.address);
        const gauge = mocks.gauges[pid];
        await mocks.voting.vote_for_gauge_weights(gauge.address, 1);
        await phase6.poolManager["addPool(address)"](gauge.address);

        // Manually initialize
        await phase6.stashV3.initialize(
            pid,
            phase6.booster.address,
            phase2.voterProxy.address,
            gauge.address,
            phase6.factories.rewardFactory.address,
        );

        // Set extra reward, setToken => createStashToken
        // cheat the factory giving direct access to the stash
        await phase6.factories.rewardFactory
            .connect((await impersonateAccount(await phase6.factories.rewardFactory.operator())).signer)
            .setAccess(phase6.stashV3.address, true);
        await phase6.stashV3.connect(operatorOwnerAccount.signer).setExtraReward(mockErc20.address);
        const { stashToken: stashTokenAddress } = await phase6.stashV3.tokenInfo(mockErc20.address);

        stashToken = StashToken__factory.connect(stashTokenAddress, boosterAccount.signer);
        lpToken = IERC20__factory.connect(await gauge.lp_token(), deployer);
    });

    it("initial configuration is correct", async () => {
        // constructor
        expect(await stashToken.stash(), "stash").to.be.eq(phase6.stashV3.address);
        // init
        expect(await stashToken.operator(), "operator").to.be.eq(phase6.booster.address);
        const rewardPoolAddress = await stashToken.rewardPool();
        expect(rewardPoolAddress, "rewardPool").to.not.be.eq(ZERO_ADDRESS);
        expect(await stashToken.baseToken(), "baseToken").to.be.eq(mockErc20.address);
        expect(await stashToken.isValid(), "isValid").to.be.eq(true);
        expect(await stashToken.totalSupply(), "totalSupply").to.be.eq(ZERO);
        expect(await stashToken.name(), "name").to.be.eq("Stash Token ".concat(await mockErc20.name()));
        expect(await stashToken.symbol(), "symbol").to.be.eq("STASH-".concat(await mockErc20.symbol()));

        const rewardPool = BaseRewardPool__factory.connect(rewardPoolAddress, deployer);
        expect(await rewardPool.rewardToken()).eq(stashToken.address);
    });
    it("sets isValid on the stash", async () => {
        await stashToken.connect(operatorOwnerAccount.signer).setIsValid(false);
        expect(await stashToken.isValid(), "is valid stash").to.be.eq(false);
        // Revert change
        await stashToken.connect(operatorOwnerAccount.signer).setIsValid(true);
        expect(await stashToken.isValid(), "is valid stash").to.be.eq(true);
    });
    it("user deposits into the gauge with extra rewards stash", async () => {
        const amount = simpleToExactAmount(100);
        await lpToken.approve(phase6.booster.address, amount);
        const tx = await phase6.booster.deposit(pid, amount, true);
        await expect(tx)
            .to.emit(phase6.booster, "Deposited")
            .withArgs(await deployer.getAddress(), pid, amount);
    });
    it("process stash, mint stash token", async () => {
        // Given the stashV3 has some balance and the stash token is valid
        const amount = simpleToExactAmount(100);
        const stashBaseTokenBalBefore = await mockErc20.balanceOf(stashToken.address);
        const stashTokenTotalSupplyBefore = await stashToken.totalSupply();
        await mockErc20.transfer(phase6.stashV3.address, amount);

        const tokenInfo = await phase6.stashV3.tokenInfo(mockErc20.address);
        const rewardPool = BaseRewardPool__factory.connect(tokenInfo.rewardAddress, deployer);
        const queuedRewardsBefore = await rewardPool.queuedRewards();
        const historicalRewardsBefore = await rewardPool.historicalRewards();

        expect(tokenInfo.rewardAddress).to.not.be.eq(ZERO_ADDRESS);
        expect(await mockErc20.balanceOf(phase6.stashV3.address), " stashV3 has balance").to.be.gt(0);
        expect(await stashToken.isValid(), "stash is valid").to.be.eq(true);

        // When  it process the stash
        await phase6.stashV3.connect(boosterAccount.signer).processStash();

        // Then the stash token is minted
        const stashBaseTokenBalAfter = await mockErc20.balanceOf(stashToken.address);
        const stashTokenTotalSupplyAfter = await stashToken.totalSupply();

        const queuedRewardsAfter = await rewardPool.queuedRewards();
        const historicalRewardsAfter = await rewardPool.historicalRewards();

        expect(amount, "total supply").to.be.eq(stashTokenTotalSupplyAfter.sub(stashTokenTotalSupplyBefore));
        expect(amount, "base token balance").to.be.eq(stashBaseTokenBalAfter.sub(stashBaseTokenBalBefore));
        expect(amount, "base token balance").to.be.eq(stashBaseTokenBalAfter.sub(stashBaseTokenBalBefore));
        expect(amount, "queue / new  rewards on pool").to.be.eq(
            queuedRewardsAfter.sub(queuedRewardsBefore).add(historicalRewardsAfter.sub(historicalRewardsBefore)),
        );
    });
    it("claim rewards reduces stash token total supply", async () => {
        await increaseTime(ONE_WEEK.mul(2));
        const poolInfo = await phase6.booster.poolInfo(pid);
        const stashBaseTokenBalBefore = await mockErc20.balanceOf(await deployer.getAddress());
        const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, deployer);
        const stashTokenTotalSupplyBefore = await stashToken.totalSupply();

        // Test the stash token is send to the user
        await phase6.booster.earmarkRewards(pid);
        await crvRewards["getReward(address,bool)"](await deployer.getAddress(), true);

        const stashTokenTotalSupplyAfter = await stashToken.totalSupply();
        const stashBaseTokenBalAfter = await mockErc20.balanceOf(await deployer.getAddress());

        // expectations for StashToken.transfer(address, uint256), only callable by reward pool
        // token stash must transfer
        const stashTokenAmount = stashTokenTotalSupplyBefore.sub(stashTokenTotalSupplyAfter);
        expect(stashTokenTotalSupplyAfter, "stash token total supply").to.lt(stashTokenTotalSupplyBefore);
        expect(stashTokenAmount, "stash base token").to.eq(stashBaseTokenBalAfter.sub(stashBaseTokenBalBefore));
    });
    it("does not mint if stash is disabled", async () => {
        // Given the stashV3 has some balance and the stash token is valid
        const amount = simpleToExactAmount(100);
        const stashBaseTokenBalBefore = await mockErc20.balanceOf(stashToken.address);
        const stashTokenTotalSupplyBefore = await stashToken.totalSupply();
        await mockErc20.transfer(phase6.stashV3.address, amount);

        const tokenInfo = await phase6.stashV3.tokenInfo(mockErc20.address);

        expect(tokenInfo.rewardAddress).to.not.be.eq(ZERO_ADDRESS);
        expect(await mockErc20.balanceOf(phase6.stashV3.address), " stashV3 has balance").to.be.gt(0);
        expect(await stashToken.isValid(), "stash is valid").to.be.eq(true);

        // Disable Stash
        await stashToken.connect(operatorOwnerAccount.signer).setIsValid(false);

        // When  it process the stash
        await phase6.stashV3.connect(boosterAccount.signer).processStash();

        // Then the stash token is not minted
        const stashBaseTokenBalAfter = await mockErc20.balanceOf(stashToken.address);
        const stashTokenTotalSupplyAfter = await stashToken.totalSupply();
        expect(ZERO, "total supply").to.be.eq(stashTokenTotalSupplyAfter.sub(stashTokenTotalSupplyBefore));
        expect(ZERO, "base token balance").to.be.eq(stashBaseTokenBalAfter.sub(stashBaseTokenBalBefore));
    });
    describe("fails if", async () => {
        it("calls init more than once", async () => {
            await expect(stashToken.connect(deployer).init(DEAD_ADDRESS, DEAD_ADDRESS, DEAD_ADDRESS)).to.revertedWith(
                "Initializable: contract is already initialized",
            );
        });
        it("caller is not the owner, setIsValid", async () => {
            await expect(stashToken.connect(deployer).setIsValid(false)).to.revertedWith("!owner");
        });
        it("mint caller is not the stash", async () => {
            await expect(stashToken.connect(deployer).mint(1)).to.revertedWith("!stash");
        });
        it("if total supply is exceeded", async () => {
            const amount = await stashToken.MAX_TOTAL_SUPPLY();
            await mockErc20.transfer(phase6.stashV3.address, amount);
            await mockErc20
                .connect((await impersonateAccount(phase6.stashV3.address)).signer)
                .approve(stashToken.address, amount);
            await expect(
                stashToken.connect((await impersonateAccount(phase6.stashV3.address)).signer).mint(amount),
            ).to.revertedWith("totalSupply exceeded");
        });
        it("transfer caller is not the rewardPool, transfer", async () => {
            await expect(stashToken.connect(deployer).transfer(DEAD_ADDRESS, 0)).to.revertedWith("!rewardPool");
        });
    });
});
