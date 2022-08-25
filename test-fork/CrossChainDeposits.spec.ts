import { increaseTime } from "./../test-utils/time";
import { MockERC20 } from "./../types/generated/MockERC20";
import { network } from "hardhat";
import { expect } from "chai";
import {
    BaseRewardPool,
    SiphonGauge__factory,
    SiphonGauge,
    SiphonDepositor,
    SiphonDepositor__factory,
    MockERC20__factory,
    SiphonToken,
    SiphonToken__factory,
    BaseRewardPool__factory,
} from "../types/generated";
import { BigNumberish, ethers, Signer } from "ethers";
import { waitForTx } from "../tasks/utils";
import { Phase2Deployed, SystemDeployed } from "../scripts/deploySystem";
import { config } from "../tasks/deploy/mainnet-config";
import { impersonate, impersonateAccount, simpleToExactAmount, ONE_WEEK } from "../test-utils";
import { formatUnits } from "ethers/lib/utils";

const debug = true;

describe("Full Deployment", () => {
    let deployer: Signer;
    let deployerAddress: string;
    let phase2: Phase2Deployed;
    let phase4: SystemDeployed;
    let siphonGauge: SiphonGauge;
    let siphonToken: SiphonToken;
    let siphonDepositor: SiphonDepositor;
    let crvToken: MockERC20;
    let pid: BigNumberish;
    let crvRewards: BaseRewardPool;
    let totalIncentiveAmount: BigNumberish;
    let rCvx: MockERC20;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15271655,
                    },
                },
            ],
        });
        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        deployer = await impersonate(deployerAddress);
        phase4 = await config.getPhase4(deployer);
        phase2 = await config.getPhase2(deployer);

        await getCrv(deployerAddress, simpleToExactAmount(5000));
        crvToken = MockERC20__factory.connect(config.addresses.token, deployer);

        siphonToken = await new SiphonToken__factory(deployer).deploy(deployerAddress, simpleToExactAmount(1));
        siphonGauge = await new SiphonGauge__factory(deployer).deploy(siphonToken.address);
        rCvx = await new MockERC20__factory(deployer).deploy(
            "rAURA",
            "rAURA",
            18,
            deployerAddress,
            simpleToExactAmount(1000),
        );

        pid = await phase4.booster.poolLength();
    });

    const getCrv = async (recipient: string, amount = simpleToExactAmount(250)) => {
        await getEth(config.addresses.balancerVault);

        const tokenWhaleSigner = await impersonateAccount(config.addresses.balancerVault);
        const crv = MockERC20__factory.connect(config.addresses.token, tokenWhaleSigner.signer);
        const tx = await crv.transfer(recipient, amount);
        await waitForTx(tx, debug);
    };

    const getEth = async (recipient: string) => {
        const ethWhale = await impersonate(config.addresses.weth);
        await ethWhale.sendTransaction({
            to: recipient,
            value: simpleToExactAmount(1),
        });
    };

    it("adds the gauge", async () => {
        const admin = await impersonate(config.multisigs.daoMultisig);
        const length = await phase4.booster.poolLength();
        await phase4.poolManager.connect(admin).forceAddPool(siphonToken.address, siphonGauge.address, 3);

        expect(length).eq(pid);

        const pool = await phase4.booster.poolInfo(pid);

        // save pool rewards
        crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);

        expect(pool.gauge).eq(siphonGauge.address);
        expect(pool.lptoken).eq(siphonToken.address);
    });
    it("deploy the siphonDepositor", async () => {
        siphonDepositor = await new SiphonDepositor__factory(deployer).deploy(
            siphonToken.address,
            crvToken.address,
            phase4.booster.address,
            phase2.cvx.address,
            rCvx.address,
            pid,
        );
        // send it the siphon token
        await siphonToken.transfer(siphonDepositor.address, simpleToExactAmount(1));
    });
    it("deposit LP tokens into the pool", async () => {
        const bal = await siphonToken.balanceOf(siphonDepositor.address);
        await siphonDepositor.deposit();
        const rewardBal = await crvRewards.balanceOf(siphonDepositor.address);
        expect(rewardBal).eq(bal);
    });
    it("fund the siphonDepositor with BAL", async () => {
        const balance = await crvToken.balanceOf(config.multisigs.treasuryMultisig);
        console.log("Treasury CRV balance:", formatUnits(balance));

        const treasury = await impersonateAccount(config.multisigs.treasuryMultisig);
        await crvToken.connect(treasury.signer).transfer(siphonDepositor.address, balance);

        const siphonBalance = await crvToken.balanceOf(siphonDepositor.address);
        console.log("SiphonDepositor CRV balance:", formatUnits(siphonBalance));
        expect(siphonBalance).eq(balance);
    });
    it("siphon CVX", async () => {
        const FEE_DENOMINATOR = await phase4.booster.FEE_DENOMINATOR();
        const earmarkIncentive = await phase4.booster.earmarkIncentive();
        const stakerIncentive = await phase4.booster.stakerIncentive();
        const lockIncentive = await phase4.booster.lockIncentive();

        const siphonBalanceBefore = await crvToken.balanceOf(siphonDepositor.address);
        const earmarkIncentiveAmount = siphonBalanceBefore.mul(earmarkIncentive).div(FEE_DENOMINATOR);
        const stakerIncentiveAmount = siphonBalanceBefore.mul(stakerIncentive).div(FEE_DENOMINATOR);
        const lockIncentiveAmount = siphonBalanceBefore.mul(lockIncentive).div(FEE_DENOMINATOR);
        totalIncentiveAmount = earmarkIncentiveAmount.add(stakerIncentiveAmount).add(lockIncentiveAmount);

        await siphonDepositor.siphon();
        const siphonBalance = await crvToken.balanceOf(siphonDepositor.address);
        expect(siphonBalance).eq(earmarkIncentiveAmount);

        const rewardBalance = await crvToken.balanceOf(crvRewards.address);
        expect(rewardBalance).eq(siphonBalanceBefore.sub(totalIncentiveAmount));
    });
    it("claim CVX and CRV into siphonDepositor", async () => {
        await increaseTime(ONE_WEEK);

        const crvBalBefore = await crvToken.balanceOf(siphonDepositor.address);
        const cvxBalBefore = await phase2.cvx.balanceOf(siphonDepositor.address);

        await siphonDepositor.getReward();

        const crvBalAfter = await crvToken.balanceOf(siphonDepositor.address);
        const cvxBalAfter = await phase2.cvx.balanceOf(siphonDepositor.address);

        const cvxBal = cvxBalAfter.sub(cvxBalBefore);
        const crvBal = crvBalAfter.sub(crvBalBefore);

        console.log("CVX balance:", formatUnits(cvxBal));
        console.log("CRV balance:", formatUnits(crvBal));
        console.log("CRV debt:", formatUnits(totalIncentiveAmount));
    });
    it("convert rAURA to AURA", async () => {
        const amountIn = simpleToExactAmount(100);
        const amountOut = await siphonDepositor.getAmountOut(amountIn);
        console.log("rCVX Amount In:", formatUnits(amountIn));
        console.log("CVX Amount out:", formatUnits(amountOut));

        await rCvx.approve(siphonDepositor.address, ethers.constants.MaxUint256);
        await siphonDepositor.convert(amountIn, false);

        const rCvxBal = await rCvx.balanceOf(siphonDepositor.address);
        const cvxBal = await phase2.cvx.balanceOf(deployerAddress);

        expect(rCvxBal).eq(amountIn);
        expect(cvxBal).eq(amountOut);
    });
});