import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    Phase6Deployed,
    SystemDeployed,
    deployCrvDepositorWrapperSwapper,
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
} from "../../scripts/deploySystem";
import { anyValue, assertBNClose, BN, impersonateAccount, increaseTime, simpleToExactAmount } from "../../test-utils";
import { ONE_WEEK, ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import {
    AuraBalVault,
    BaseRewardPool__factory,
    CrvDepositorWrapper,
    CrvDepositorWrapperSwapper,
} from "../../types/generated";
import { AuraClaimZapV3, ClaimRewardsAmountsStruct, OptionsStruct } from "../../types/generated/AuraClaimZapV3";
import { deployVault } from "../../scripts/deployVault";
import { deployAuraClaimZapV3Swapper } from "../../scripts/deployAuraClaimZapV3";
import { Account } from "index";
import { parseEther } from "ethers/lib/utils";

const defaultOptions: OptionsStruct = {
    claimCvxCrv: false,
    claimLockedCvx: false,
    lockCvxCrv: false,
    lockCrvDeposit: false,
    useAllWalletFunds: false,
    useCompounder: false,
    lockCvx: false,
};
const DEBUG = false;

describe("AuraClaimZapV3", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let deployer: Signer;
    let phase4: SystemDeployed;
    let alice: Account;
    let vault: AuraBalVault;
    let crvDepositorWrapper: CrvDepositorWrapperSwapper | CrvDepositorWrapper;
    // Testing contract
    let claimZapV3: AuraClaimZapV3;
    const pid = 0;

    async function depositIntoBasePoolReward(account: Account, amount: BN) {
        const lock = true;
        const stakeAddress = phase4.cvxCrvRewards.address;
        const minOut = await crvDepositorWrapper.connect(account.signer).getMinOut(amount, "10000");
        await mocks.crv.connect(account.signer).approve(crvDepositorWrapper.address, amount);
        await crvDepositorWrapper.connect(account.signer).deposit(amount, minOut, lock, stakeAddress);

        const cvxCrvRewardsBalance = await phase4.cvxCrvRewards.balanceOf(account.address);

        return cvxCrvRewardsBalance;
    }
    async function depositIntoPool(account: Account, amount: BN) {
        const stake = true;
        await mocks.lptoken.transfer(account.address, amount);
        await mocks.lptoken.connect(account.signer).approve(phase4.booster.address, amount);
        await phase4.booster.connect(account.signer).deposit(pid, amount, stake);
        await phase4.booster.earmarkRewards(pid);
    }

    const snapData = async (account: Account) => {
        const crvBalance = await mocks.crv.balanceOf(account.address);
        const cvxCrvBalance = await phase4.cvxCrv.balanceOf(account.address);
        const cvxBalance = await phase4.cvx.balanceOf(account.address);
        const cvxCrvRewardsBalance = await phase4.cvxCrvRewards.balanceOf(account.address);
        const cvxCrvRewardsEarned = await phase4.cvxCrvRewards.earned(account.address);
        return { crvBalance, cvxCrvBalance, cvxBalance, cvxCrvRewardsBalance, cvxCrvRewardsEarned };
    };
    before(async () => {
        accounts = await ethers.getSigners();

        alice = { signer: accounts[1], address: await accounts[1].getAddress() };

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
        phase4 = await deployPhase4(hre, deployer, phase3, mocks.addresses);

        const testConfig = {
            addresses: mocks.addresses,
            multisigs,
            getPhase2: async (__: Signer) => phase2,
            getPhase4: async (__: Signer) => phase4,
            getPhase6: async (__: Signer) => {
                const phase6: Partial<Phase6Deployed> = {};
                phase6.cvxCrvRewards = phase4.cvxCrvRewards;
                return phase6 as Phase6Deployed;
            },
        };

        // Deploy test contract.
        ({ vault } = await deployVault(testConfig, hre, deployer, DEBUG));
        ({ crvDepositorWrapperSwapper: crvDepositorWrapper } = await deployCrvDepositorWrapperSwapper(
            hre,
            deployer,
            phase2,
            mocks.addresses,
            DEBUG,
        ));

        ({ claimZapV3 } = await deployAuraClaimZapV3Swapper(
            testConfig,
            hre,
            deployer,
            { vault: vault.address, crvDepositorWrapper: crvDepositorWrapper.address },
            DEBUG,
        ));

        // Send some balance to  prepare the test
        await mocks.crv.transfer(alice.address, simpleToExactAmount(100));
        await mocks.crv.transfer(mocks.balancerVault.address, simpleToExactAmount(100));

        // dirty trick to get some crvCvx balance.
        const crvDepositorAccount = await impersonateAccount(phase2.crvDepositor.address);
        const cvxCrvConnected = phase2.cvxCrv.connect(crvDepositorAccount.signer);
        await cvxCrvConnected.mint(mocks.balancerVault.address, simpleToExactAmount(100));

        await phase4.cvxCrv.transfer(alice.address, simpleToExactAmount(10));
        await phase4.cvxCrv.transfer(mocks.balancerVault.address, simpleToExactAmount(10));

        const operatorAccount = await impersonateAccount(phase4.booster.address);
        await phase4.cvx.connect(operatorAccount.signer).mint(alice.address, simpleToExactAmount(100));
        await mocks.balancerVault.setTokens(phase4.cvxCrv.address, mocks.crv.address);
        await mocks.crvBpt.setPrice(parseEther("1"));

        // Approvals

        await mocks.crv.connect(alice.signer).approve(claimZapV3.address, ethers.constants.MaxUint256);
        await phase4.cvx.connect(alice.signer).approve(claimZapV3.address, ethers.constants.MaxUint256);
        await phase4.cvxCrv.connect(alice.signer).approve(claimZapV3.address, ethers.constants.MaxUint256);
    });

    it("initial configuration is correct", async () => {
        expect(await claimZapV3.getName()).to.be.eq("ClaimZap V3.0");
        expect(await claimZapV3.crv()).to.be.eq(mocks.addresses.token);
        expect(await claimZapV3.cvx()).to.be.eq(phase4.cvx.address);
        expect(await claimZapV3.crvDepositWrapper()).to.be.eq(crvDepositorWrapper.address);
        expect(await claimZapV3.cvxCrvRewards()).to.be.eq(phase4.cvxCrvRewards.address);
        expect(await claimZapV3.locker()).to.be.eq(phase4.cvxLocker.address);
        expect(await claimZapV3.owner()).to.be.eq(await deployer.getAddress());
        expect(await claimZapV3.compounder()).to.be.eq(vault.address);
    });
    it("set approval for deposits", async () => {
        await claimZapV3.setApprovals();
        expect(await mocks.crv.allowance(claimZapV3.address, crvDepositorWrapper.address)).eq(
            ethers.constants.MaxUint256,
        );
        expect(await phase4.cvxCrv.allowance(claimZapV3.address, phase4.cvxCrvRewards.address)).eq(
            ethers.constants.MaxUint256,
        );
        expect(await phase4.cvxCrv.allowance(claimZapV3.address, vault.address)).eq(ethers.constants.MaxUint256);
        expect(await phase4.cvx.allowance(claimZapV3.address, phase4.cvxLocker.address)).eq(
            ethers.constants.MaxUint256,
        );
    });
    it("claim rewards from cvxCrvStaking and stake crv, cvxCrv", async () => {
        const amount = simpleToExactAmount(10);
        const cvxCrvRewardsBalance = await depositIntoBasePoolReward(alice, amount);
        await phase4.booster.earmarkRewards(pid);
        await increaseTime(ONE_WEEK.mul("4"));
        const dataBefore = await snapData(alice);

        const options = { ...defaultOptions, claimCvxCrv: true, lockCrvDeposit: true, lockCvxCrv: true, lockCvx: true };
        const minBptAmountOut = await crvDepositorWrapper.getMinOut(dataBefore.cvxCrvRewardsEarned, 10000);

        const amounts: ClaimRewardsAmountsStruct = {
            minAmountOut: minBptAmountOut,
            depositCrvMaxAmount: ethers.constants.MaxUint256,
            depositCvxMaxAmount: ethers.constants.MaxUint256,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
        };

        const tx = await claimZapV3.connect(alice.signer).claimRewards([], [], [], [], amounts, options);

        const dataAfter = await snapData(alice);

        await expect(tx, "claimCvxCrv: true")
            .to.emit(phase4.cvxCrvRewards, "RewardPaid")
            .withArgs(alice.address, dataBefore.cvxCrvRewardsEarned);
        await expect(tx, "lockCvxCrv: true + useAllWalletFunds: false")
            .to.emit(phase4.cvxCrvRewards, "Staked")
            .withArgs(alice.address, anyValue);

        // useAllWalletFunds: false checks , and lock crv, cvx, cvxCrv, no change on balances.
        expect(dataBefore.crvBalance, "crv balance").to.be.eq(dataAfter.crvBalance);
        expect(dataBefore.cvxBalance, "cvx balance").to.be.eq(dataAfter.cvxBalance);
        expect(dataBefore.cvxCrvBalance, "cvxCrv balance").to.be.eq(dataAfter.cvxCrvBalance);

        assertBNClose(
            dataAfter.cvxCrvRewardsBalance,
            minBptAmountOut.add(cvxCrvRewardsBalance),
            simpleToExactAmount(1, 16),
            "cvxCrvRewards balance",
        );
    });
    it("claim rewards from cvxCrvStaking and stake crv, cvxCrv with wallet funds", async () => {
        await phase4.booster.earmarkRewards(pid);
        await increaseTime(ONE_WEEK.mul("4"));

        const dataBefore = await snapData(alice);
        const depositCvxCrvFromWalletAmount = 5000;
        const depositCvxCrvMaxAmount = dataBefore.cvxCrvRewardsEarned.add(depositCvxCrvFromWalletAmount);

        const options = {
            ...defaultOptions,
            claimCvxCrv: true,
            lockCrvDeposit: true,
            lockCvxCrv: true,
            lockCvx: true,
            useAllWalletFunds: true,
        };
        const minBptAmountOut = await crvDepositorWrapper.getMinOut(depositCvxCrvMaxAmount, 10000);

        const amounts: ClaimRewardsAmountsStruct = {
            minAmountOut: minBptAmountOut,
            depositCrvMaxAmount: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: depositCvxCrvMaxAmount,
        };

        const tx = await claimZapV3.connect(alice.signer).claimRewards([], [], [], [], amounts, options);

        const dataAfter = await snapData(alice);

        await expect(tx, "claimCvxCrv: true")
            .to.emit(phase4.cvxCrvRewards, "RewardPaid")
            .withArgs(alice.address, dataBefore.cvxCrvRewardsEarned);
        await expect(tx, "lockCvxCrv: true + useAllWalletFunds: true")
            .to.emit(phase4.cvxCrvRewards, "Staked")
            .withArgs(alice.address, depositCvxCrvMaxAmount);

        // useAllWalletFunds: true checks
        expect(dataBefore.crvBalance, "crv balance").to.be.lte(dataAfter.crvBalance); // depositCrvMaxAmount: 0,
        expect(dataBefore.cvxBalance, "cvx balance").to.be.lte(dataAfter.cvxBalance); // depositCvxMaxAmount: 0,
        expect(dataBefore.cvxCrvBalance, "cvxCrv balance").to.be.gte(dataAfter.cvxCrvBalance); // depositCvxCrvMaxAmount: depositCvxCrvMaxAmount

        expect(dataAfter.cvxCrvRewardsBalance).gte(dataBefore.cvxCrvRewardsBalance);
    });
    it("claim from lp staking pool no stake cvxCrvRewards", async () => {
        const amount = ethers.utils.parseEther("10");

        await depositIntoPool(alice, amount);
        await increaseTime(ONE_WEEK.mul("2"));

        const pool = await phase4.booster.poolInfo(pid);
        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);
        const cvxCrvRewards = BaseRewardPool__factory.connect(await phase4.claimZap.cvxCrvRewards(), deployer);

        const dataBefore = await snapData(alice);
        const expectedRewards = await crvRewards.earned(alice.address);

        const options = { ...defaultOptions };
        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: 0,
        };

        const tx = await claimZapV3.connect(alice.signer).claimRewards([pool.crvRewards], [], [], [], amounts, options);

        const dataAfter = await snapData(alice);
        await expect(tx, "rewardPhase4[pool.crvRewards]")
            .to.emit(crvRewards, "RewardPaid")
            .withArgs(alice.address, expectedRewards);
        await expect(tx, "lockCvxCrv: false").to.not.emit(cvxCrvRewards, "Staked");

        expect(dataAfter.crvBalance.sub(dataBefore.crvBalance)).eq(expectedRewards);
        expect(dataBefore.cvxBalance, "cvx balance").to.be.lt(dataAfter.cvxBalance);
        expect(dataBefore.cvxCrvBalance, "cvxCrv balance").to.be.eq(dataAfter.cvxCrvBalance);
    });
    it("claim from lp staking pool and stake cvxCrvRewards", async () => {
        const amount = ethers.utils.parseEther("10");
        await depositIntoPool(alice, amount);
        // await depositIntoBasePoolReward(alice, amount)
        await phase4.booster.earmarkRewards(pid);
        await increaseTime(ONE_WEEK.mul("2"));

        const pool = await phase4.booster.poolInfo(pid);
        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);

        const expectedRewards = await crvRewards.earned(alice.address);

        const dataBefore = await snapData(alice);
        const options = { ...defaultOptions, claimLockedCvx: true, claimCvxCrv: true };
        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
        };

        const tx = await claimZapV3.connect(alice.signer).claimRewards([pool.crvRewards], [], [], [], amounts, options);
        const dataAfter = await snapData(alice);
        await expect(tx, "rewardPhase4[pool.crvRewards]")
            .to.emit(crvRewards, "RewardPaid")
            .withArgs(alice.address, expectedRewards);
        // Use
        await expect(tx, "lockCvxCrv").to.not.emit(phase4.cvxCrvRewards, "Staked");

        expect(dataAfter.crvBalance).gt(dataBefore.crvBalance);
        expect(dataBefore.cvxBalance, "cvx balance").to.be.lt(dataAfter.cvxBalance);
        expect(dataBefore.cvxCrvBalance, "cvxCrv balance, not staked").to.be.eq(dataAfter.cvxCrvBalance);
    });
    it("claim from lp staking pool and stake full cvxCrvRewards balance", async () => {
        const amount = ethers.utils.parseEther("10");
        await depositIntoPool(alice, amount);

        await phase4.booster.earmarkRewards(pid);
        const pool = await phase4.booster.poolInfo(pid);
        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);

        await increaseTime(ONE_WEEK.mul("2"));

        const balanceBefore = await mocks.crv.balanceOf(alice.address);
        const expectedRewards = await crvRewards.earned(alice.address);

        // add some cvxCrv to alice.signer
        const cvxCrvBal = await phase4.cvxCrv.balanceOf(await deployer.getAddress());
        await phase4.cvxCrv.transfer(alice.address, cvxCrvBal);
        await phase4.cvxCrv.connect(alice.signer).approve(claimZapV3.address, ethers.constants.MaxUint256);

        const options = { ...defaultOptions, claimLockedCvx: true, lockCvxCrv: true, useAllWalletFunds: true };
        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
        };
        const tx = await claimZapV3.connect(alice.signer).claimRewards([pool.crvRewards], [], [], [], amounts, options);

        const balanceAfter = await mocks.crv.balanceOf(alice.address);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);
        // User waller funds option was provided, hence zero balance is expected.
        expect(await phase4.cvxCrv.balanceOf(alice.address)).eq(ZERO);
        await expect(tx, "lockCvxCrv: true + useAllWalletFunds: true").to.emit(phase4.cvxCrvRewards, "Staked");
    });
    it("claim from pools and then deposit into new vault", async () => {
        const poolId = 0;
        await phase4.booster.earmarkRewards(poolId);
        const pool = await phase4.booster.poolInfo(poolId);

        const cvxCrvRewards = BaseRewardPool__factory.connect(await claimZapV3.cvxCrvRewards(), deployer);

        await increaseTime(ONE_WEEK.mul("2"));

        await phase4.cvxCrv.connect(alice.signer).approve(claimZapV3.address, ethers.constants.MaxUint256);
        const balanceBefore = await vault.balanceOf(alice.address);

        const options: OptionsStruct = {
            claimCvxCrv: true,
            claimLockedCvx: true,
            lockCvxCrv: true,
            lockCrvDeposit: false,
            useAllWalletFunds: true,
            useCompounder: true,
            lockCvx: false,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: ethers.constants.MaxUint256,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
        };

        const tx = await claimZapV3.connect(alice.signer).claimRewards([pool.crvRewards], [], [], [], amounts, options);

        const balanceAfter = await vault.balanceOf(alice.address);
        expect(balanceAfter).to.be.gt(balanceBefore);

        expect(await phase4.cvxCrv.balanceOf(alice.address)).eq(ZERO);
        await expect(tx).to.emit(cvxCrvRewards, "Staked");
        await expect(tx).to.emit(vault, "Deposit");
    });
    it("verifies only owner can set approvals", async () => {
        expect(await claimZapV3.owner()).not.eq(alice.address);
        await expect(claimZapV3.connect(alice.signer).setApprovals()).to.be.revertedWith("!auth");
    });
    it("fails if claim rewards are incorrect", async () => {
        const options = { ...defaultOptions };
        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: 0,
        };
        await expect(
            claimZapV3.connect(alice.signer).claimRewards([], [], [], [ZERO_ADDRESS], amounts, options),
        ).to.be.revertedWith("!parity");
    });
});
