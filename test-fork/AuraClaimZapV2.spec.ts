import hre, { network } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { BigNumberish, ethers } from "ethers";
import { parseEther } from "ethers/lib/utils";

import {
    Account,
    IBalancerVault,
    MockERC20__factory,
    IBalancerVault__factory,
    IERC20,
    IERC20__factory,
    AuraClaimZapV2,
    ZapRewardSwapHandler,
} from "../types";
import { simpleToExactAmount } from "../test-utils/math";
import {
    Phase2Deployed,
    Phase3Deployed,
    Phase4Deployed,
    Phase6Deployed,
    Phase7Deployed,
    Phase8Deployed,
} from "../scripts/deploySystem";
import { impersonate, impersonateAccount, increaseTime } from "../test-utils";
import { ZERO_ADDRESS, DEAD_ADDRESS, ZERO, ONE_WEEK } from "../test-utils/constants";
import { deployAuraClaimZapV2 } from "../scripts/deployAuraClaimZapV2";
import { ClaimRewardsAmountsStruct, OptionsStruct } from "types/generated/AuraClaimZapV2";
import { BaseRewardPool__factory } from "../types/generated/";
import { config } from "../tasks/deploy/mainnet-config";

// Constants
const DEBUG = false;
const FORK_BLOCK = 16700000;
const DEPOSIT_AMOUNT = simpleToExactAmount(10);
const DEPLOYER = "0xA28ea848801da877E1844F954FF388e857d405e5";

async function impersonateAndTransfer(tokenAddress: string, from: string, to: string, amount: BigNumberish) {
    const tokenWhaleSigner = await impersonateAccount(from);
    const token = MockERC20__factory.connect(tokenAddress, tokenWhaleSigner.signer);
    await token.transfer(to, amount);
}

describe("AuraClaimZapV2", () => {
    let claimZapV2: AuraClaimZapV2;
    let zapRewardSwapHandler: ZapRewardSwapHandler;
    let dao: Account;
    let deployer: Account;
    let depositor: Account;
    let phase2: Phase2Deployed;
    let phase4: Phase4Deployed;
    let phase3: Phase3Deployed;
    let phase6: Phase6Deployed;
    let phase7: Phase7Deployed;
    let phase8: Phase8Deployed;
    let bVault: IBalancerVault;
    let wethToken: IERC20;
    let balToken: IERC20;
    let balWethBptToken: IERC20;
    let alice: Signer;
    let aliceAddress: string;
    let LPToken: IERC20;

    /* -------------------------------------------------------------------------
     * Helper functions
     * ----------------------------------------------------------------------- */

    async function getEth(recipient: string, amount: BigNumberish) {
        const ethWhale = await impersonate(config.addresses.weth);
        await ethWhale.sendTransaction({
            to: recipient,
            value: amount,
        });
    }

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
        const LPAddress = "0xff4ce5aaab5a627bf82f4a571ab1ce94aa365ea6";
        const whaleAddress = "0x11EC78492D53c9276dD7a184B1dbfB34E50B710D";
        const whale = await impersonateAccount(whaleAddress);
        await IERC20__factory.connect(LPAddress, whale.signer).transfer(to, amount);
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
        phase3 = await config.getPhase3(dao.signer);
        phase4 = await config.getPhase4(dao.signer);
        phase6 = await config.getPhase6(dao.signer);
        phase7 = await config.getPhase7(dao.signer);
        phase8 = await config.getPhase8(dao.signer);

        bVault = IBalancerVault__factory.connect(config.addresses.balancerVault, dao.signer);
        wethToken = IERC20__factory.connect(config.addresses.weth, dao.signer);
        balToken = IERC20__factory.connect(config.addresses.token, dao.signer);
        balWethBptToken = IERC20__factory.connect(config.addresses.tokenBpt, dao.signer);

        const LPAddress = "0xff4ce5aaab5a627bf82f4a571ab1ce94aa365ea6";
        LPToken = await IERC20__factory.connect(LPAddress, dao.signer);

        await getAuraBal(deployer.address, parseEther("100"));
        await getAuraBal(depositor.address, parseEther("100"));
    });

    /* -------------------------------------------------------------------------
     * Tests
     * todo: Clean up
     * ----------------------------------------------------------------------- */

    it("Deploy", async () => {
        //Deploy
        const result = await deployAuraClaimZapV2(hre, deployer.signer, DEBUG);
        claimZapV2 = result.claimZapV2;
        zapRewardSwapHandler = result.zapRewardSwapHandler;
    });

    it("Setup zapRewardHandler", async () => {
        var bbusd = "0xA13a9247ea42D743238089903570127DdA72fE44";
        var wsteth = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
        var weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
        var bal = config.addresses.token;
        var aura = phase2.cvx.address;

        var bb_wsteth = "0x25accb7943fd73dda5e23ba6329085a3c24bfb6a000200000000000000000387";
        var wsteth_weth = "0x32296969ef14eb0c6d29669c550d4a0449130230000200000000000000000080";
        var weth_bal = "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014";
        var aura_weth = "0xcfca23ca9ca720b6e98e3eb9b6aa0ffc4a5c08b9000200000000000000000274";

        var path0 = [bbusd, wsteth, weth, bal];
        var path1 = [aura, weth, bal];
        var path2 = [bal, weth, aura];
        var pathList = [path0, path1, path2];

        var token0s = [bbusd, wsteth, weth, aura];
        var token1s = [wsteth, weth, bal, weth];
        var poolIds = [bb_wsteth, wsteth_weth, weth_bal, aura_weth];

        await zapRewardSwapHandler.connect(deployer.signer).setMultiplePoolIds(token0s, token1s, poolIds);
        await zapRewardSwapHandler.connect(deployer.signer).addMultiplePaths(pathList);
        await zapRewardSwapHandler.connect(deployer.signer).toggleOperators(claimZapV2.address, true);
    });

    it("initial configuration is correct", async () => {
        expect(await claimZapV2.getName()).to.be.eq("ClaimZap V3.0");
        expect(await claimZapV2.zapRewardSwapHandler()).to.be.eq(zapRewardSwapHandler.address);
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
            claimLockedCvxStake: false,
            lockCrvDeposit: true,
            useAllWalletFunds: true,
            zapCvxToCrv: false,
            zapCrvToCvx: false,
            lockCvx: false,
        };

        const minBptAmountOut = await phase4.crvDepositorWrapper.getMinOut(expectedRewards, 9900);
        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: expectedRewards,
            minAmountOut: minBptAmountOut,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: 0,
            zapCvxMaxAmount: 0,
            zapCrvMaxAmount: 0,
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
            claimLockedCvxStake: false,
            lockCrvDeposit: false,
            useAllWalletFunds: false,
            zapCvxToCrv: false,
            zapCrvToCvx: false,
            lockCvx: false,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: 0,
            zapCvxMaxAmount: 0,
            zapCrvMaxAmount: 0,
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

        // add some cvxCrv to alice
        //const cvxCrvBal = await phase2.cvxCrv.balanceOf(await dao.signer.getAddress());
        //await phase2.cvxCrv.connect(dao.signer).transfer(aliceAddress, cvxCrvBal);
        await getCvxCrv(aliceAddress, ethers.utils.parseEther("5"));

        await phase2.cvxCrv.connect(alice).approve(claimZapV2.address, ethers.constants.MaxUint256);
        const cvxCrvBalBefore = await phase2.cvxCrv.balanceOf(aliceAddress);

        const options: OptionsStruct = {
            claimCvxCrv: false,
            claimLockedCvx: true,
            claimLockedCvxStake: false,
            lockCrvDeposit: false,
            useAllWalletFunds: false,
            zapCvxToCrv: false,
            zapCrvToCvx: false,
            lockCvx: false,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
            zapCvxMaxAmount: 0,
            zapCrvMaxAmount: 0,
        };
        const tx = await claimZapV2.connect(alice).claimRewards([pool.crvRewards], [], [], [], amounts, options);
        const cvxCrvBalAfter = await phase2.cvxCrv.balanceOf(aliceAddress);

        const balanceAfter = await balToken.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);
        // cvxCrv balance should not change as the option to use wallet funds was not provided
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

        // add some cvxCrv to alice
        await phase2.cvxCrv.connect(alice).approve(claimZapV2.address, ethers.constants.MaxUint256);
        const cvxCrvBalBefore = await phase2.cvxCrv.balanceOf(aliceAddress);

        const options: OptionsStruct = {
            claimCvxCrv: false,
            claimLockedCvx: true,
            claimLockedCvxStake: true,
            lockCrvDeposit: false,
            useAllWalletFunds: false,
            zapCvxToCrv: false,
            zapCrvToCvx: false,
            lockCvx: false,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
            zapCvxMaxAmount: 0,
            zapCrvMaxAmount: 0,
        };
        const tx = await claimZapV2.connect(alice).claimRewards([pool.crvRewards], [], [], [], amounts, options);
        const cvxCrvBalAfter = await phase2.cvxCrv.balanceOf(aliceAddress);

        const balanceAfter = await balToken.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);
        // cvxCrv balance should not change as the option to use wallet funds was not provided
        expect(cvxCrvBalAfter, "cvxcrv balance").eq(cvxCrvBalBefore);
        await expect(tx).to.not.emit(cvxCrvRewards, "Staked");
    });

    it("claim rewards and then zap AURA to BAL and then deposit for AuraBal", async () => {
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

        // add some cvxCrv to alice
        await phase2.cvxCrv.connect(alice).approve(claimZapV2.address, ethers.constants.MaxUint256);
        const cvxCrvBalBefore = await phase2.cvxCrv.balanceOf(aliceAddress);

        const options: OptionsStruct = {
            claimCvxCrv: false,
            claimLockedCvx: true,
            claimLockedCvxStake: true,
            lockCrvDeposit: false,
            useAllWalletFunds: true,
            zapCvxToCrv: false,
            zapCrvToCvx: false,
            lockCvx: false,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
            zapCvxMaxAmount: 0,
            zapCrvMaxAmount: 0,
        };
        const tx = await claimZapV2.connect(alice).claimRewards([pool.crvRewards], [], [], [], amounts, options);

        const balanceAfter = await balToken.balanceOf(aliceAddress);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedRewards);
        // User waller funds option was provided, hence  zero balance is expected.
        expect(await phase2.cvxCrv.balanceOf(aliceAddress)).eq(ZERO);
        await expect(tx).to.emit(cvxCrvRewards, "Staked");
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

        // add some cvxCrv to alice
        await phase2.cvx.connect(alice).approve(claimZapV2.address, ethers.constants.MaxUint256);
        const balanceBefore = await phase6.cvxCrvRewards.balanceOf(aliceAddress);

        const options: OptionsStruct = {
            claimCvxCrv: false,
            claimLockedCvx: false,
            claimLockedCvxStake: false,
            lockCrvDeposit: false,
            useAllWalletFunds: true,
            zapCvxToCrv: true,
            zapCrvToCvx: false,
            lockCvx: false,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: ethers.constants.MaxUint256,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
            zapCvxMaxAmount: ethers.constants.MaxUint256,
            zapCrvMaxAmount: 0,
        };

        const tx = await claimZapV2.connect(alice).claimRewards([pool.crvRewards], [], [], [], amounts, options);
        const balanceAfter = await phase6.cvxCrvRewards.balanceOf(aliceAddress);

        // cvxCrv balance should not change as the option to use wallet funds was not provided
        expect(Number(balanceAfter)).to.be.greaterThan(Number(balanceBefore));

        await expect(tx).to.emit(cvxCrvRewards, "Staked");
    });

    it("claim rewards and then zap BAL claimed for AURA and stake it", async () => {
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

        // add some cvxCrv to alice
        await phase2.cvx.connect(alice).approve(claimZapV2.address, ethers.constants.MaxUint256);
        const balanceBefore = await phase4.cvxLocker.balances(aliceAddress);

        const options: OptionsStruct = {
            claimCvxCrv: false,
            claimLockedCvx: false,
            claimLockedCvxStake: false,
            lockCrvDeposit: false,
            useAllWalletFunds: true,
            zapCvxToCrv: false,
            zapCrvToCvx: true,
            lockCvx: true,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: ethers.constants.MaxUint256,
            depositCvxCrvMaxAmount: 0,
            zapCvxMaxAmount: 0,
            zapCrvMaxAmount: ethers.constants.MaxUint256,
        };

        const tx = await claimZapV2.connect(alice).claimRewards([pool.crvRewards], [], [], [], amounts, options);
        const balanceAfter = await phase4.cvxLocker.balances(aliceAddress);

        // cvxCrv balance should not change as the option to use wallet funds was not provided
        expect(Number(balanceAfter.locked)).to.be.greaterThan(Number(balanceBefore.locked));

        await expect(tx).to.emit(phase4.cvxLocker, "Staked");
    });

    it("verifies only owner can set approvals", async () => {
        expect(await claimZapV2.owner()).not.eq(aliceAddress);
        await expect(claimZapV2.connect(alice).setApprovals()).to.be.revertedWith("!auth");
    });

    it("fails if claim rewards are incorrect", async () => {
        const options: OptionsStruct = {
            claimCvxCrv: false,
            claimLockedCvx: false,
            claimLockedCvxStake: false,
            lockCrvDeposit: false,
            useAllWalletFunds: false,
            zapCvxToCrv: false,
            zapCrvToCvx: true,
            lockCvx: true,
        };

        const amounts: ClaimRewardsAmountsStruct = {
            depositCrvMaxAmount: 0,
            minAmountOut: 0,
            depositCvxMaxAmount: 0,
            depositCvxCrvMaxAmount: 0,
            zapCvxMaxAmount: 0,
            zapCrvMaxAmount: 0,
        };
        await expect(
            claimZapV2.connect(alice).claimRewards([], [], [], [ZERO_ADDRESS], amounts, options),
        ).to.be.revertedWith("!parity");
    });
});
