import hre, { network } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { BigNumberish, ethers } from "ethers";
import { parseEther } from "ethers/lib/utils";

import { Account, IERC20, IERC20__factory, AuraClaimZapV2, AuraBalVault } from "../types";
import { simpleToExactAmount } from "../test-utils/math";
import { Phase2Deployed, Phase4Deployed, Phase6Deployed } from "../scripts/deploySystem";
import { impersonateAccount, increaseTime } from "../test-utils";
import { ZERO_ADDRESS, ZERO, ONE_WEEK } from "../test-utils/constants";
import { deployVault } from "../scripts/deployVault";
import { deployAuraClaimZapV2 } from "../scripts/deployAuraClaimZapV2";
import { ClaimRewardsAmountsStruct, OptionsStruct } from "types/generated/AuraClaimZapV2";
import { BaseRewardPool__factory } from "../types/generated/";
import { config } from "../tasks/deploy/mainnet-config";

// Constants
const DEBUG = false;
const FORK_BLOCK = 16700000;
const DEPOSIT_AMOUNT = simpleToExactAmount(10);
const DEPLOYER = "0xA28ea848801da877E1844F954FF388e857d405e5";

describe("AuraClaimZapV2", () => {
    let claimZapV2: AuraClaimZapV2;
    let vault: AuraBalVault;
    let dao: Account;
    let deployer: Account;
    let depositor: Account;
    let phase2: Phase2Deployed;
    let phase4: Phase4Deployed;
    let phase6: Phase6Deployed;
    let balToken: IERC20;
    let alice: Signer;
    let aliceAddress: string;
    let LPTokenAddress: string;
    let LPToken: IERC20;

    /* -------------------------------------------------------------------------
     * Helper functions
     * ----------------------------------------------------------------------- */

    async function getAuraBal(to: string, amount: BigNumberish) {
        const auraBalWhaleAddr = "0xcaab2680d81df6b3e2ece585bb45cee97bf30cd7";
        const auraBalWhale = await impersonateAccount(auraBalWhaleAddr);
        await phase2.cvxCrv.connect(auraBalWhale.signer).transfer(to, amount);
    }

    async function getBal(to: string, amount: BigNumberish) {
        const balWhaleAddr = "0x740a4AEEfb44484853AA96aB12545FC0290805F3";
        const balWhale = await impersonateAccount(balWhaleAddr);
        await IERC20__factory.connect(config.addresses.token, balWhale.signer).transfer(to, amount);
    }

    async function getDolaUsdcLP(to: string, amount: BigNumberish) {
        const whaleAddress = "0x11EC78492D53c9276dD7a184B1dbfB34E50B710D";
        const whale = await impersonateAccount(whaleAddress);
        await IERC20__factory.connect(LPTokenAddress, whale.signer).transfer(to, amount);
    }

    async function getCvxCrv(to: string, amount: BigNumberish) {
        const TokenAddress = "0x616e8BfA43F920657B3497DBf40D6b1A02D4608d";
        const whaleAddress = "0xCAab2680d81dF6b3e2EcE585bB45cEe97BF30cD7";
        const whale = await impersonateAccount(whaleAddress);
        await IERC20__factory.connect(TokenAddress, whale.signer).transfer(to, amount);
    }

    /* -------------------------------------------------------------------------
     * Before
     * ----------------------------------------------------------------------- */

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: FORK_BLOCK,
                    },
                },
            ],
        });

        const accounts = await hre.ethers.getSigners();

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        deployer = await impersonateAccount(DEPLOYER, true);
        depositor = await impersonateAccount(await accounts[0].getAddress(), true);
        dao = await impersonateAccount(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(dao.signer);
        phase4 = await config.getPhase4(dao.signer);
        phase6 = await config.getPhase6(dao.signer);
        balToken = IERC20__factory.connect(config.addresses.token, dao.signer);

        LPTokenAddress = "0xff4ce5aaab5a627bf82f4a571ab1ce94aa365ea6";
        LPToken = await IERC20__factory.connect(LPTokenAddress, dao.signer);

        await getAuraBal(deployer.address, parseEther("100"));
        await getAuraBal(depositor.address, parseEther("100"));
    });

    /* -------------------------------------------------------------------------
     * Tests
     * ----------------------------------------------------------------------- */

    it("deploy vault", async () => {
        const result = await deployVault(config, hre, deployer.signer, DEBUG);
        vault = result.vault;
    });

    it("Deploy Claimzap", async () => {
        //Deploy
        const result = await deployAuraClaimZapV2(config, hre, deployer.signer, vault.address, DEBUG);
        claimZapV2 = result.claimZapV2;
    });

    it("initial configuration is correct", async () => {
        expect(await claimZapV2.getName()).to.be.eq("ClaimZap V3.0");
        expect(await claimZapV2.compounder()).to.be.eq(vault.address);
    });

    it("set approval for deposits", async () => {
        await claimZapV2.setApprovals();
        expect(await balToken.allowance(claimZapV2.address, phase4.crvDepositorWrapper.address)).gte(
            ethers.constants.MaxUint256,
        );
        expect(await phase2.cvxCrv.allowance(claimZapV2.address, phase6.cvxCrvRewards.address)).gte(
            ethers.constants.MaxUint256,
        );
        expect(await phase4.cvx.allowance(claimZapV2.address, phase4.cvxLocker.address)).gte(
            ethers.constants.MaxUint256,
        );
        expect(await phase4.cvxCrv.allowance(claimZapV2.address, vault.address)).gte(ethers.constants.MaxUint256);
    });

    it("claim rewards from cvxCrvStaking", async () => {
        const lock = true;

        await getBal(aliceAddress, ethers.utils.parseUnits("1", "ether"));
        const stakeAddress = phase6.cvxCrvRewards.address;
        const balance = await balToken.balanceOf(aliceAddress);

        const minOut = await phase4.crvDepositorWrapper.connect(alice).getMinOut(balance, "9900");
        await balToken.connect(alice).approve(phase4.crvDepositorWrapper.address, balance);
        await phase4.crvDepositorWrapper.connect(alice).deposit(balance, minOut, lock, stakeAddress);

        const rewardBalance = await phase6.cvxCrvRewards.balanceOf(aliceAddress);
        expect(Number(rewardBalance)).to.be.greaterThanOrEqual(Number(minOut));

        await phase6.booster.earmarkRewards(1);

        await increaseTime(ONE_WEEK.mul("4"));

        const expectedRewards = await phase6.cvxCrvRewards.earned(aliceAddress);

        await balToken.connect(alice).approve(claimZapV2.address, ethers.constants.MaxUint256);

        const options: OptionsStruct = {
            claimCvxCrv: true,
            claimLockedCvx: false,
            lockCvxCrv: false,
            lockCrvDeposit: true,
            useAllWalletFunds: true,
            useCompounder: false,
            lockCvx: false,
        };

        const minBptAmountOut = await phase4.crvDepositorWrapper.getMinOut(expectedRewards, 9900);
        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: expectedRewards,
            minAmountOut: minBptAmountOut,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: 0,
        };
        await claimZapV2.connect(alice).claimRewards([], [], [], [], amounts, options);

        const newRewardBalance = await phase6.cvxCrvRewards.balanceOf(aliceAddress);

        expect(Number(newRewardBalance)).to.be.greaterThanOrEqual(Number(minBptAmountOut.add(rewardBalance)));
    });

    it("claim from lp staking pool", async () => {
        const stake = true;
        const amount = ethers.utils.parseEther("2");
        const poolId = 45;

        await getDolaUsdcLP(aliceAddress, amount);

        await LPToken.connect(alice).approve(phase6.booster.address, amount);
        await phase6.booster.connect(alice).deposit(poolId, amount, stake);

        await phase6.booster.earmarkRewards(poolId);
        const pool = await phase6.booster.poolInfo(poolId);
        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, dao.signer);
        await increaseTime(ONE_WEEK.mul("2"));

        const balanceBefore = await balToken.balanceOf(aliceAddress);
        const expectedRewards = await crvRewards.earned(aliceAddress);

        const options: OptionsStruct = {
            claimCvxCrv: false,
            claimLockedCvx: false,
            lockCvxCrv: false,
            lockCrvDeposit: false,
            useAllWalletFunds: false,
            useCompounder: false,
            lockCvx: false,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: 0,
        };
        await claimZapV2.connect(alice).claimRewards([pool.crvRewards], [], [], [], amounts, options);

        const balanceAfter = await balToken.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);
    });

    it("claim from lp staking pool no stake cvxCrvRewards", async () => {
        const stake = true;
        const amount = ethers.utils.parseEther("2");
        const poolId = 45;

        await getDolaUsdcLP(aliceAddress, amount);

        await LPToken.connect(alice).approve(phase6.booster.address, amount);
        await phase6.booster.connect(alice).deposit(poolId, amount, stake);

        await phase6.booster.earmarkRewards(poolId);
        const pool = await phase6.booster.poolInfo(poolId);

        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, dao.signer);
        const cvxCrvRewards = BaseRewardPool__factory.connect(await claimZapV2.cvxCrvRewards(), dao.signer);

        await increaseTime(ONE_WEEK.mul("2"));

        const balanceBefore = await balToken.balanceOf(aliceAddress);
        const expectedRewards = await crvRewards.earned(aliceAddress);

        await getCvxCrv(aliceAddress, ethers.utils.parseEther("5"));

        await phase2.cvxCrv.connect(alice).approve(claimZapV2.address, ethers.constants.MaxUint256);
        const cvxCrvBalBefore = await phase2.cvxCrv.balanceOf(aliceAddress);

        const options: OptionsStruct = {
            claimCvxCrv: false,
            claimLockedCvx: true,
            lockCvxCrv: false,
            lockCrvDeposit: false,
            useAllWalletFunds: false,
            useCompounder: false,
            lockCvx: false,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
        };
        const tx = await claimZapV2.connect(alice).claimRewards([pool.crvRewards], [], [], [], amounts, options);
        const cvxCrvBalAfter = await phase2.cvxCrv.balanceOf(aliceAddress);

        const balanceAfter = await balToken.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);

        expect(cvxCrvBalAfter, "cvxcrv balance").eq(cvxCrvBalBefore);
        await expect(tx).to.not.emit(cvxCrvRewards, "Staked");
    });

    it("claim from lp staking pool and stake cvxCrvRewards", async () => {
        const stake = true;
        const amount = ethers.utils.parseEther("2");
        const poolId = 45;

        await getDolaUsdcLP(aliceAddress, amount);

        await LPToken.connect(alice).approve(phase6.booster.address, amount);
        await phase6.booster.connect(alice).deposit(poolId, amount, stake);

        await phase6.booster.earmarkRewards(poolId);
        const pool = await phase6.booster.poolInfo(poolId);

        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, dao.signer);
        const cvxCrvRewards = BaseRewardPool__factory.connect(await claimZapV2.cvxCrvRewards(), dao.signer);

        await increaseTime(ONE_WEEK.mul("2"));

        const balanceBefore = await balToken.balanceOf(aliceAddress);
        const expectedRewards = await crvRewards.earned(aliceAddress);

        await phase2.cvxCrv.connect(alice).approve(claimZapV2.address, ethers.constants.MaxUint256);
        const cvxCrvBalBefore = await phase2.cvxCrv.balanceOf(aliceAddress);

        const options: OptionsStruct = {
            claimCvxCrv: false,
            claimLockedCvx: true,
            lockCvxCrv: true,
            lockCrvDeposit: false,
            useAllWalletFunds: false,
            useCompounder: false,
            lockCvx: false,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
        };
        const tx = await claimZapV2.connect(alice).claimRewards([pool.crvRewards], [], [], [], amounts, options);
        const cvxCrvBalAfter = await phase2.cvxCrv.balanceOf(aliceAddress);

        const balanceAfter = await balToken.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);

        expect(cvxCrvBalAfter, "cvxcrv balance").eq(cvxCrvBalBefore);
        await expect(tx).to.not.emit(cvxCrvRewards, "Staked");
    });

    it("claim from lp staking pool and stake full cvxCrvRewards balance", async () => {
        const stake = true;
        const amount = ethers.utils.parseEther("2");
        const poolId = 45;

        await getDolaUsdcLP(aliceAddress, amount);

        await LPToken.connect(alice).approve(phase6.booster.address, amount);
        await phase6.booster.connect(alice).deposit(poolId, amount, stake);

        await phase6.booster.earmarkRewards(poolId);
        const pool = await phase6.booster.poolInfo(poolId);

        const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, dao.signer);
        const cvxCrvRewards = BaseRewardPool__factory.connect(await claimZapV2.cvxCrvRewards(), dao.signer);

        await increaseTime(ONE_WEEK.mul("2"));

        const balanceBefore = await balToken.balanceOf(aliceAddress);
        const expectedRewards = await crvRewards.earned(aliceAddress);

        await phase2.cvxCrv.connect(alice).approve(claimZapV2.address, ethers.constants.MaxUint256);

        const options: OptionsStruct = {
            claimCvxCrv: false,
            claimLockedCvx: true,
            lockCvxCrv: true,
            lockCrvDeposit: false,
            useAllWalletFunds: true,
            useCompounder: false,
            lockCvx: false,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
        };
        const tx = await claimZapV2.connect(alice).claimRewards([pool.crvRewards], [], [], [], amounts, options);

        const balanceAfter = await balToken.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);

        expect(await phase2.cvxCrv.balanceOf(aliceAddress)).eq(ZERO);
        await expect(tx).to.emit(cvxCrvRewards, "Staked");
    });

    it("claim from pools and then deposit into new vault", async () => {
        const stake = true;
        const amount = ethers.utils.parseEther("2");
        const poolId = 45;

        await getDolaUsdcLP(aliceAddress, amount);

        await LPToken.connect(alice).approve(phase6.booster.address, amount);
        await phase6.booster.connect(alice).deposit(poolId, amount, stake);

        await phase6.booster.earmarkRewards(poolId);
        const pool = await phase6.booster.poolInfo(poolId);

        const cvxCrvRewards = BaseRewardPool__factory.connect(await claimZapV2.cvxCrvRewards(), dao.signer);

        await increaseTime(ONE_WEEK.mul("2"));

        await phase2.cvxCrv.connect(alice).approve(claimZapV2.address, ethers.constants.MaxUint256);
        const balanceBefore = await vault.balanceOf(aliceAddress);

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
        const tx = await claimZapV2.connect(alice).claimRewards([pool.crvRewards], [], [], [], amounts, options);

        const balanceAfter = await vault.balanceOf(aliceAddress);
        expect(balanceAfter).to.be.gt(balanceBefore);

        expect(await phase2.cvxCrv.balanceOf(aliceAddress)).eq(ZERO);
        await expect(tx).to.emit(cvxCrvRewards, "Staked");
    });

    it("verifies only owner can set approvals", async () => {
        expect(await claimZapV2.owner()).not.eq(aliceAddress);
        await expect(claimZapV2.connect(alice).setApprovals()).to.be.revertedWith("!auth");
    });

    it("fails if claim rewards are incorrect", async () => {
        const options: OptionsStruct = {
            claimCvxCrv: false,
            claimLockedCvx: false,
            lockCvxCrv: false,
            lockCrvDeposit: false,
            useAllWalletFunds: false,
            useCompounder: false,
            lockCvx: false,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: 0,
        };
        await expect(
            claimZapV2.connect(alice).claimRewards([], [], [], [ZERO_ADDRESS], amounts, options),
        ).to.be.revertedWith("!parity");
    });
});
