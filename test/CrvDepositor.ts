import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import { deployPhase1, deployPhase2, deployPhase3, MultisigConfig } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { CrvDepositor, CurveVoterProxy, CvxCrvToken } from "../types/generated";
import { increaseTimeTo } from "../test-utils/time";

describe("CrvDepositor", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let crvDepositor: CrvDepositor;
    let cvxCrv: CvxCrvToken;
    let voterProxy: CurveVoterProxy;
    let deployer: Signer;
    let deployerAddress: string;
    let alice: Signer;
    let aliceAddress: string;
    let multisigs: MultisigConfig;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();

        mocks = await deployMocks(deployer);
        multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(deployer, mocks.addresses);
        const phase2 = await deployPhase2(
            hre,
            deployer,
            phase1,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );
        const contracts = await deployPhase3(deployer, phase2, mocks.addresses);

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        crvDepositor = contracts.crvDepositor.connect(alice);
        cvxCrv = contracts.cvxCrv.connect(alice);
        voterProxy = contracts.voterProxy;

        const tx = await mocks.crv.connect(alice).approve(crvDepositor.address, ethers.constants.MaxUint256);
        await tx.wait();

        const crvBalance = await mocks.crv.balanceOf(deployerAddress);

        const calls = [await mocks.crv.transfer(aliceAddress, crvBalance.mul(90).div(100))];

        await Promise.all(calls.map(tx => tx.wait()));
    });

    it("deposit", async () => {
        const lock = true;
        const stakeAddress = "0x0000000000000000000000000000000000000000";
        const crvBalance = await mocks.crv.balanceOf(aliceAddress);
        const amount = crvBalance.mul(10).div(100);

        const tx = await crvDepositor["deposit(uint256,bool,address)"](amount, lock, stakeAddress);
        await tx.wait();

        const cvxCrvBalance = await cvxCrv.balanceOf(aliceAddress);
        expect(cvxCrvBalance).to.equal(amount);
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
            const lock = true;
            const stakeAddress = "0x0000000000000000000000000000000000000000";
            const crvBalance = await mocks.crv.balanceOf(aliceAddress);
            const amount = crvBalance.mul(10).div(100);

            const beforeLockTime = await mocks.votingEscrow.lockTimes(voterProxy.address);
            const beforeLockAmount = await mocks.votingEscrow.lockAmounts(voterProxy.address);
            const cvxCrvBalanceBefore = await cvxCrv.balanceOf(aliceAddress);

            const tx = await crvDepositor["deposit(uint256,bool,address)"](amount, lock, stakeAddress);
            await tx.wait();

            const cvxCrvBalanceAfter = await cvxCrv.balanceOf(aliceAddress);
            const cvxCrvBalanceDelta = cvxCrvBalanceAfter.sub(cvxCrvBalanceBefore);
            expect(cvxCrvBalanceDelta).to.equal(amount);

            const afterLockTime = await mocks.votingEscrow.lockTimes(voterProxy.address);
            const afterLockAmount = await mocks.votingEscrow.lockAmounts(voterProxy.address);

            const lockTimeDelta = afterLockTime.sub(beforeLockTime);
            const lockAmountDelta = afterLockAmount.sub(beforeLockAmount);

            expect(lockTimeDelta.toString()).to.equal("0");
            expect(lockAmountDelta.toString()).to.equal("0");
        });

        it("migrate only callable by dao", async () => {
            const tx = crvDepositor.connect(accounts[5]).migrate(aliceAddress);
            await expect(tx).to.revertedWith("!auth");
        });

        it("migrate to external address", async () => {
            const bob = accounts[5];
            const bobAddress = await bob.getAddress();

            const daoMultisig = await ethers.getSigner(multisigs.daoMultisig);
            const lockTime = await mocks.votingEscrow.lockTimes(voterProxy.address);
            await increaseTimeTo(lockTime.add(1));

            const veBalance = await mocks.votingEscrow.balanceOf(voterProxy.address);
            const voteProxyCrvBalance = await mocks.crv.balanceOf(voterProxy.address);

            const crvBalanceBefore = await mocks.crv.balanceOf(bobAddress);
            const tx = await crvDepositor.connect(daoMultisig).migrate(bobAddress);
            await tx.wait();
            const crvBalanceAfter = await mocks.crv.balanceOf(bobAddress);

            const crvDelta = crvBalanceAfter.sub(crvBalanceBefore);

            expect(crvDelta).to.equal(veBalance.add(voteProxyCrvBalance));
        });
    });
});
