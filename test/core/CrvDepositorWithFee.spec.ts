import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import {
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    deployPhase5,
    MultisigConfig,
    Phase5Deployed,
} from "../../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    CrvDepositor,
    VoterProxy,
    CvxCrvToken,
    ERC20,
    CrvDepositorWrapperWithFee,
    BaseRewardPool,
} from "../../types/generated";
import { getTimestamp, increaseTime } from "../../test-utils/time";
import { ONE_WEEK, ZERO_ADDRESS } from "../../test-utils/constants";
import { BN, simpleToExactAmount } from "../../test-utils/math";
import { assertBNClose } from "../../test-utils";

describe("CrvDepositor", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let crvDepositor: CrvDepositor;
    let cvxCrv: CvxCrvToken;
    let voterProxy: VoterProxy;
    let deployer: Signer;
    let deployerAddress: string;
    let alice: Signer;
    let aliceAddress: string;
    let multisigs: MultisigConfig;
    let crv: ERC20;
    let crvDepositorWrapperWithFee: CrvDepositorWrapperWithFee;
    let cvxCrvStaking: BaseRewardPool;
    let contracts: Phase5Deployed;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();

        mocks = await deployMocks(hre, deployer);
        multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const daoMultisig = await ethers.getSigner(multisigs.daoMultisig);

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
        await phase3.poolManager.connect(daoMultisig).setProtectPool(false);
        await phase3.boosterOwner.connect(daoMultisig).setFeeInfo(mocks.lptoken.address, mocks.feeDistribution.address);
        await phase3.boosterOwner.connect(daoMultisig).setFeeInfo(mocks.crv.address, mocks.feeDistribution.address);

        const phase4 = await deployPhase4(hre, deployer, phase3, mocks.addresses);
        contracts = await deployPhase5(hre, deployer, phase4, multisigs, mocks.addresses);

        alice = accounts[0];
        aliceAddress = await alice.getAddress();

        crvDepositor = contracts.crvDepositor.connect(alice);
        cvxCrv = contracts.cvxCrv.connect(alice);
        crv = mocks.crv.connect(alice);
        voterProxy = contracts.voterProxy;
        crvDepositorWrapperWithFee = contracts.crvDepositorWrapperWithFee.connect(alice);
        cvxCrvStaking = contracts.cvxCrvRewards;

        const tx = await mocks.crvBpt.connect(alice).approve(crvDepositor.address, ethers.constants.MaxUint256);
        await tx.wait();

        const crvBalance = await mocks.crvBpt.balanceOf(deployerAddress);

        const calls = [await mocks.crvBpt.transfer(aliceAddress, crvBalance.mul(90).div(100))];

        await Promise.all(calls.map(tx => tx.wait()));
    });

    describe("basic flow of locking", () => {
        it("locks up for a year initially", async () => {
            const unlockTime = await mocks.votingEscrow.lockTimes(voterProxy.address);
            const now = await getTimestamp();
            expect(unlockTime).gt(now.add(ONE_WEEK.mul(51)));
            expect(unlockTime).lt(now.add(ONE_WEEK.mul(53)));
        });

        it("deposit", async () => {
            const lock = true;
            const stakeAddress = "0x0000000000000000000000000000000000000000";
            const crvBalance = await mocks.crvBpt.balanceOf(aliceAddress);
            const amount = crvBalance.mul(10).div(100);
            const cvxCrvBefore = await cvxCrv.balanceOf(aliceAddress);

            const tx = await crvDepositor["deposit(uint256,bool,address)"](amount, lock, stakeAddress);
            await tx.wait();

            const cvxCrvAfter = await cvxCrv.balanceOf(aliceAddress);
            expect(cvxCrvAfter.sub(cvxCrvBefore)).to.equal(amount);
        });
        it("increases lock to a year again", async () => {
            const unlockTimeBefore = await mocks.votingEscrow.lockTimes(voterProxy.address);

            await increaseTime(ONE_WEEK.mul(2));

            const tx = await crvDepositor["deposit(uint256,bool,address)"](simpleToExactAmount(1), true, ZERO_ADDRESS);
            await tx.wait();

            const unlockTimeAfter = await mocks.votingEscrow.lockTimes(voterProxy.address);
            expect(unlockTimeAfter).gt(unlockTimeBefore);

            const after = await getTimestamp();
            expect(unlockTimeAfter).gt(after.add(ONE_WEEK.mul(51)));
            expect(unlockTimeAfter).lt(after.add(ONE_WEEK.mul(53)));
        });
    });

    describe("depositing via wrapper", () => {
        const fees = [0, 5000]; // 50%
        const applyFee = (input: BN, feeRatio: BN): { newInput: BN; feeAmount: BN } => {
            const feeAmount = input.mul(feeRatio).div(10000);
            const newInput = input.sub(feeAmount);
            return { newInput, feeAmount };
        };

        fees.forEach(fee => {
            it(`allows the sender to deposit crv, wrap to crvBpt and deposit, fee ${fee}`, async () => {
                const lock = true;
                const stakeAddress = "0x0000000000000000000000000000000000000000";
                const balance = await crv.balanceOf(aliceAddress);
                const amount = balance.mul(10).div(100);

                const cvxCrvBalanceBefore = await cvxCrv.balanceOf(aliceAddress);

                const feeDistro = await contracts.booster.feeTokens(crv.address);
                const feeCrvBalanceBefore = await crv.balanceOf(feeDistro.rewards);
                await crvDepositorWrapperWithFee.setFeeRatio(fee);
                const feeRatio = await crvDepositorWrapperWithFee.feeRatio();
                const { feeAmount } = applyFee(amount, feeRatio);
                const minOut = await crvDepositorWrapperWithFee.getMinOut(amount, "10000");
                const minOutFees = applyFee(minOut, feeRatio);

                await crv.approve(crvDepositorWrapperWithFee.address, amount);
                await crvDepositorWrapperWithFee.deposit(amount, minOut, lock, stakeAddress);

                const cvxCrvBalanceAfter = await cvxCrv.balanceOf(aliceAddress);
                const cvxCrvBalanceDelta = cvxCrvBalanceAfter.sub(cvxCrvBalanceBefore);
                const feeCrvBalanceAfter = await crv.balanceOf(feeDistro.rewards);

                expect(cvxCrvBalanceDelta).to.equal(minOutFees.newInput);
                assertBNClose(feeCrvBalanceBefore.add(feeAmount), feeCrvBalanceAfter, simpleToExactAmount(1), "fees");
            });

            it(`stakes on behalf of user , fee ${fee}`, async () => {
                const lock = true;
                const stakeAddress = cvxCrvStaking.address;
                const balance = await crv.balanceOf(aliceAddress);
                const amount = balance.mul(10).div(100);

                const stakedBalanceBefore = await cvxCrvStaking.balanceOf(aliceAddress);
                const feeRatio = await crvDepositorWrapperWithFee.feeRatio();
                const feeDistro = await contracts.booster.feeTokens(crv.address);
                const feeCrvBalanceBefore = await crv.balanceOf(feeDistro.rewards);

                const { feeAmount } = applyFee(amount, feeRatio);
                const minOut = await crvDepositorWrapperWithFee.getMinOut(amount, "10000");
                const minOutFees = applyFee(minOut, feeRatio);

                await crv.approve(crvDepositorWrapperWithFee.address, amount);
                await crvDepositorWrapperWithFee.deposit(amount, minOut, lock, stakeAddress);

                const stakedBalanceAfter = await cvxCrvStaking.balanceOf(aliceAddress);
                const feeCrvBalanceAfter = await crv.balanceOf(feeDistro.rewards);

                expect(stakedBalanceAfter.sub(stakedBalanceBefore)).to.equal(minOutFees.newInput);

                assertBNClose(feeCrvBalanceBefore.add(feeAmount), feeCrvBalanceAfter, simpleToExactAmount(1), "fees");
            });
        });
    });
    describe("calling depositFor", () => {
        it("allows deposits on behalf of another user", async () => {
            const user = accounts[7];
            const userAddress = await user.getAddress();

            const lock = true;
            const stakeAddress = "0x0000000000000000000000000000000000000000";
            const crvBalance = await mocks.crvBpt.balanceOf(aliceAddress);
            const amount = crvBalance.mul(10).div(100);

            const cvxCrvBalanceBefore = await cvxCrv.balanceOf(userAddress);

            await crvDepositor.connect(alice).depositFor(userAddress, amount, lock, stakeAddress);

            const cvxCrvBalanceAfter = await cvxCrv.balanceOf(userAddress);
            const cvxCrvBalanceDelta = cvxCrvBalanceAfter.sub(cvxCrvBalanceBefore);
            expect(cvxCrvBalanceDelta).to.equal(amount);
        });
    });

    describe("system cool down", () => {
        it("setCooldown only callable by dao", async () => {
            const tx = crvDepositor.connect(accounts[5]).setCooldown(true);
            await expect(tx).to.revertedWith("!auth");
        });

        it("setCooldown called", async () => {
            const daoMultisig = await ethers.getSigner(multisigs.daoMultisig);
            const tx = await crvDepositor.connect(daoMultisig).setCooldown(true);
            await tx.wait();
            const cooldown = await crvDepositor.cooldown();
            expect(cooldown).to.equal(true);
        });

        it("lock reverts", async () => {
            const tx = crvDepositor.lockCurve();
            await expect(tx).to.revertedWith("cooldown");
        });

        it("deposit skips lock", async () => {
            const tx = crvDepositor["deposit(uint256,bool,address)"](simpleToExactAmount(1), true, ZERO_ADDRESS);
            await expect(tx).to.revertedWith("cooldown");
        });
    });
    describe("setting setters", () => {
        it("allows daoOperator to set daoOperator", async () => {
            expect(await crvDepositor.daoOperator()).eq(multisigs.daoMultisig);
            const daoMultisig = await ethers.getSigner(multisigs.daoMultisig);
            await crvDepositor.connect(daoMultisig).setDaoOperator(multisigs.treasuryMultisig);
            expect(await crvDepositor.daoOperator()).eq(multisigs.treasuryMultisig);
        });
        it("allows fails to set daoOperator if not daoOperator", async () => {
            const tx = crvDepositor.connect(accounts[4]).setDaoOperator(multisigs.treasuryMultisig);
            await expect(tx).to.revertedWith("!auth");
        });
        it("allows feeManager to set feeManager", async () => {
            expect(await crvDepositor.feeManager()).eq(multisigs.daoMultisig);
            const daoMultisig = await ethers.getSigner(multisigs.daoMultisig);
            await crvDepositor.connect(daoMultisig).setFeeManager(multisigs.treasuryMultisig);
            expect(await crvDepositor.feeManager()).eq(multisigs.treasuryMultisig);
        });
        it("fails to set feeManager if not feeManager", async () => {
            const tx = crvDepositor.connect(accounts[4]).setFeeManager(multisigs.treasuryMultisig);
            await expect(tx).to.revertedWith("!auth");
        });
        it("allows feeManager to set feeManager", async () => {
            expect(await crvDepositorWrapperWithFee.owner()).eq(multisigs.daoMultisig);
            const daoMultisig = await ethers.getSigner(multisigs.daoMultisig);
            const feeRatio = 0;
            await crvDepositorWrapperWithFee.connect(daoMultisig).setFeeRatio(feeRatio);
            expect(await crvDepositorWrapperWithFee.feeRatio()).eq(feeRatio);
        });
        it("fails to set setFeeRatio if it is not the owner", async () => {
            const tx = crvDepositorWrapperWithFee.connect(accounts[4]).setFeeRatio(multisigs.treasuryMultisig);
            await expect(tx).to.revertedWith("Ownable: caller is not the owner");
        });
        it("fails to set setFeeRatio if it is too high", async () => {
            const daoMultisig = await ethers.getSigner(multisigs.daoMultisig);
            const tx = crvDepositorWrapperWithFee.connect(daoMultisig).setFeeRatio(10000);
            await expect(tx).to.revertedWith("Invalid ratio");
        });
    });
});
