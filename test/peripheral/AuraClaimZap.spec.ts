import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import { SystemDeployed, deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../../scripts/deploySystem";
import { increaseTime, simpleToExactAmount } from "../../test-utils";
import { ONE_WEEK, ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import { BaseRewardPool__factory } from "../../types/generated";
import { ClaimRewardsAmountsStruct } from "types/generated/AuraClaimZap";

const Options = {
    None: 0,
    ClaimCvxCrv: 1,
    ClaimLockedCvx: 2,
    ClaimLockedCvxStake: 4,
    LockCrvDeposit: 8,
    UseAllWalletFunds: 16,
    LockCvx: 32,
};
describe("AuraClaimZap", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let deployer: Signer;
    let contracts: SystemDeployed;
    let alice: Signer;
    let aliceAddress: string;

    before(async () => {
        accounts = await ethers.getSigners();

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        deployer = accounts[0];
        mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();
        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        const phase2 = await deployPhase2(
            hre,
            deployer,
            phase1,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.setProtectPool(false);
        contracts = await deployPhase4(hre, deployer, phase3, mocks.addresses);

        await mocks.crv.transfer(aliceAddress, simpleToExactAmount(1));
        await mocks.crv.transfer(mocks.balancerVault.address, simpleToExactAmount(10));
        await contracts.cvxCrv.transfer(mocks.balancerVault.address, simpleToExactAmount(10));

        await mocks.balancerVault.setTokens(contracts.cvxCrv.address, mocks.crv.address);
    });

    it("initial configuration is correct", async () => {
        expect(await contracts.claimZap.getName()).to.be.eq("ClaimZap V2.0");
    });

    it("set approval for deposits", async () => {
        await contracts.claimZap.setApprovals();
        expect(await mocks.crv.allowance(contracts.claimZap.address, contracts.crvDepositorWrapper.address)).gte(
            ethers.constants.MaxUint256,
        );
        expect(await contracts.cvxCrv.allowance(contracts.claimZap.address, contracts.cvxCrvRewards.address)).gte(
            ethers.constants.MaxUint256,
        );
        expect(await contracts.cvx.allowance(contracts.claimZap.address, contracts.cvxLocker.address)).gte(
            ethers.constants.MaxUint256,
        );
    });

    it("claim rewards from cvxCrvStaking", async () => {
        const lock = true;
        const stakeAddress = contracts.cvxCrvRewards.address;
        const balance = await mocks.crv.balanceOf(aliceAddress);

        const minOut = await contracts.crvDepositorWrapper.connect(alice).getMinOut(balance, "10000");
        await mocks.crv.connect(alice).approve(contracts.crvDepositorWrapper.address, balance);
        await contracts.crvDepositorWrapper.connect(alice).deposit(balance, minOut, lock, stakeAddress);

        const rewardBalance = await contracts.cvxCrvRewards.balanceOf(aliceAddress);
        expect(rewardBalance).eq(minOut);

        await contracts.booster.earmarkRewards(0);

        await increaseTime(ONE_WEEK.mul("4"));

        const expectedRewards = await contracts.cvxCrvRewards.earned(aliceAddress);

        await mocks.crv.connect(alice).approve(contracts.claimZap.address, ethers.constants.MaxUint256);
        const options = Options.ClaimCvxCrv + Options.LockCrvDeposit + Options.UseAllWalletFunds;
        const minBptAmountOut = await contracts.crvDepositorWrapper.getMinOut(expectedRewards, 10000);
        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: expectedRewards,
            minAmountOut: minBptAmountOut,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: 0,
        };
        await contracts.claimZap.connect(alice).claimRewards([], [], [], [], amounts, options);

        const newRewardBalance = await contracts.cvxCrvRewards.balanceOf(aliceAddress);
        expect(newRewardBalance).eq(minBptAmountOut.add(rewardBalance));
    });

    it("claim from lp staking pool", async () => {
        const stake = true;
        const amount = ethers.utils.parseEther("10");
        await mocks.lptoken.transfer(aliceAddress, amount);
        await mocks.lptoken.connect(alice).approve(contracts.booster.address, amount);
        await contracts.booster.connect(alice).deposit(0, amount, stake);

        await contracts.booster.earmarkRewards(0);
        const pool = await contracts.booster.poolInfo(0);
        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);
        await increaseTime(ONE_WEEK.mul("2"));

        const balanceBefore = await mocks.crv.balanceOf(aliceAddress);
        const expectedRewards = await crvRewards.earned(aliceAddress);

        const options = Options.None;
        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: 0,
        };
        await contracts.claimZap.connect(alice).claimRewards([pool.crvRewards], [], [], [], amounts, options);

        const balanceAfter = await mocks.crv.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);
    });
    it("claim from lp staking pool no stake cvxCrvRewards", async () => {
        const stake = true;
        const amount = ethers.utils.parseEther("10");
        await mocks.lptoken.transfer(aliceAddress, amount);
        await mocks.lptoken.connect(alice).approve(contracts.booster.address, amount);
        await contracts.booster.connect(alice).deposit(0, amount, stake);

        await contracts.booster.earmarkRewards(0);
        const pool = await contracts.booster.poolInfo(0);
        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);
        const cvxCrvRewards = BaseRewardPool__factory.connect(await contracts.claimZap.cvxCrvRewards(), deployer);

        await increaseTime(ONE_WEEK.mul("2"));

        const balanceBefore = await mocks.crv.balanceOf(aliceAddress);
        const expectedRewards = await crvRewards.earned(aliceAddress);

        // add some cvxCrv to alice
        const cvxCrvBal = await contracts.cvxCrv.balanceOf(await deployer.getAddress());
        await contracts.cvxCrv.transfer(aliceAddress, cvxCrvBal);
        await contracts.cvxCrv.connect(alice).approve(contracts.claimZap.address, ethers.constants.MaxUint256);
        const cvxCrvBalBefore = await contracts.cvxCrv.balanceOf(aliceAddress);

        const options = Options.ClaimLockedCvx;
        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
        };
        const tx = await contracts.claimZap
            .connect(alice)
            .claimRewards([pool.crvRewards], [], [], [], amounts, options);
        const cvxCrvBalAfter = await contracts.cvxCrv.balanceOf(aliceAddress);

        const balanceAfter = await mocks.crv.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);
        // cvxCrv balance should not change as the option to use wallet funds was not provided
        expect(cvxCrvBalAfter, "cvxcrv balance").eq(cvxCrvBalBefore);
        await expect(tx).to.not.emit(cvxCrvRewards, "Staked");
    });
    it("claim from lp staking pool and stake cvxCrvRewards", async () => {
        const stake = true;
        const amount = ethers.utils.parseEther("10");
        await mocks.lptoken.transfer(aliceAddress, amount);
        await mocks.lptoken.connect(alice).approve(contracts.booster.address, amount);
        await contracts.booster.connect(alice).deposit(0, amount, stake);

        await contracts.booster.earmarkRewards(0);
        const pool = await contracts.booster.poolInfo(0);
        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);
        const cvxCrvRewards = BaseRewardPool__factory.connect(await contracts.claimZap.cvxCrvRewards(), deployer);

        await increaseTime(ONE_WEEK.mul("2"));

        const balanceBefore = await mocks.crv.balanceOf(aliceAddress);
        const expectedRewards = await crvRewards.earned(aliceAddress);

        // add some cvxCrv to alice
        const cvxCrvBal = await contracts.cvxCrv.balanceOf(await deployer.getAddress());
        await contracts.cvxCrv.transfer(aliceAddress, cvxCrvBal);
        await contracts.cvxCrv.connect(alice).approve(contracts.claimZap.address, ethers.constants.MaxUint256);
        const cvxCrvBalBefore = await contracts.cvxCrv.balanceOf(aliceAddress);

        const options = Options.ClaimLockedCvx + Options.ClaimLockedCvxStake;
        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
        };
        const tx = await contracts.claimZap
            .connect(alice)
            .claimRewards([pool.crvRewards], [], [], [], amounts, options);
        const cvxCrvBalAfter = await contracts.cvxCrv.balanceOf(aliceAddress);

        const balanceAfter = await mocks.crv.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);
        // cvxCrv balance should not change as the option to use wallet funds was not provided
        expect(cvxCrvBalAfter, "cvxcrv balance").eq(cvxCrvBalBefore);
        await expect(tx).to.not.emit(cvxCrvRewards, "Staked");
    });
    it("claim from lp staking pool and stake full cvxCrvRewards balance", async () => {
        const stake = true;
        const amount = ethers.utils.parseEther("10");
        await mocks.lptoken.transfer(aliceAddress, amount);
        await mocks.lptoken.connect(alice).approve(contracts.booster.address, amount);
        await contracts.booster.connect(alice).deposit(0, amount, stake);

        await contracts.booster.earmarkRewards(0);
        const pool = await contracts.booster.poolInfo(0);
        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);
        const cvxCrvRewards = BaseRewardPool__factory.connect(await contracts.claimZap.cvxCrvRewards(), deployer);

        await increaseTime(ONE_WEEK.mul("2"));

        const balanceBefore = await mocks.crv.balanceOf(aliceAddress);
        const expectedRewards = await crvRewards.earned(aliceAddress);

        // add some cvxCrv to alice
        const cvxCrvBal = await contracts.cvxCrv.balanceOf(await deployer.getAddress());
        await contracts.cvxCrv.transfer(aliceAddress, cvxCrvBal);
        await contracts.cvxCrv.connect(alice).approve(contracts.claimZap.address, ethers.constants.MaxUint256);

        const options = Options.ClaimLockedCvx + Options.ClaimLockedCvxStake + Options.UseAllWalletFunds;
        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
        };
        const tx = await contracts.claimZap
            .connect(alice)
            .claimRewards([pool.crvRewards], [], [], [], amounts, options);

        const balanceAfter = await mocks.crv.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);
        // User waller funds option was provided, hence  zero balance is expected.
        expect(await contracts.cvxCrv.balanceOf(aliceAddress)).eq(ZERO);
        await expect(tx).to.emit(cvxCrvRewards, "Staked");
    });
    it("verifies only owner can set approvals", async () => {
        expect(await contracts.claimZap.owner()).not.eq(aliceAddress);
        await expect(contracts.claimZap.connect(alice).setApprovals()).to.be.revertedWith("!auth");
    });
    it("fails if claim rewards are incorrect", async () => {
        const options = Options.None;
        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: 0,
        };
        await expect(
            contracts.claimZap.connect(alice).claimRewards([], [], [], [ZERO_ADDRESS], amounts, options),
        ).to.be.revertedWith("!parity");
    });
});
