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
import { ZERO_ADDRESS, DEAD_ADDRESS, ONE_WEEK } from "../test-utils/constants";
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
     * ----------------------------------------------------------------------- */

    it("deploy", async () => {
        const result = await deployAuraClaimZapV2(hre, deployer.signer, DEBUG);

        claimZapV2 = result.claimZapV2;
    });

    it("initial configuration is correct", async () => {
        expect(await claimZapV2.getName()).to.be.eq("ClaimZap V2.1");
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
        console.log(Number(newRewardBalance));
        console.log(Number(rewardBalance));
        expect(Number(newRewardBalance)).to.be.greaterThanOrEqual(Number(minBptAmountOut.add(rewardBalance)));
    });

    it("claim from lp staking pool", async () => {
        const stake = true;
        const amount = ethers.utils.parseEther("10");
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
    /*
        const options: OptionsStruct = {
            claimCvxCrv: false,
            claimLockedCvx:false,
            claimLockedCvxStake:false,
            lockCrvDeposit:false,
            useAllWalletFunds:false,
            lockCvx:false,
        };
        */
});
