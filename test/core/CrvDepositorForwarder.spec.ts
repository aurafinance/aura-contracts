import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    deployCrvDepositorWrapperForwarder,
    deployPhase1,
    deployPhase2,
    deployPhase3,
    MultisigConfig,
} from "../../scripts/deploySystem";
import { ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import {
    BaseRewardPool,
    CrvDepositor,
    CrvDepositorWrapperForwarder,
    CvxCrvToken,
    ERC20,
    MockERC20__factory,
} from "../../types/generated";

describe("CrvDepositor", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let crvDepositor: CrvDepositor;
    let cvxCrv: CvxCrvToken;
    let deployer: Signer;
    let deployerAddress: string;
    let alice: Signer;
    let aliceAddress: string;
    let multisigs: MultisigConfig;
    let crv: ERC20;
    let crvDepositorWrapper: CrvDepositorWrapperForwarder;
    let cvxCrvStaking: BaseRewardPool;
    let forwardToAddress: string;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();

        mocks = await deployMocks(hre, deployer);
        multisigs = await getMockMultisigs(accounts[1], accounts[2], accounts[3]);
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
        const contracts = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);

        forwardToAddress = multisigs.daoMultisig;
        const { crvDepositorWrapperForwarder } = await deployCrvDepositorWrapperForwarder(
            hre,
            deployer,
            phase2,
            mocks.addresses,
            forwardToAddress,
        );

        alice = accounts[0];
        aliceAddress = await alice.getAddress();

        crvDepositor = contracts.crvDepositor.connect(alice);
        cvxCrv = contracts.cvxCrv.connect(alice);
        crv = mocks.crv.connect(alice);
        crvDepositorWrapper = crvDepositorWrapperForwarder.connect(alice);
        cvxCrvStaking = contracts.cvxCrvRewards;

        const tx = await mocks.crvBpt.connect(alice).approve(crvDepositor.address, ethers.constants.MaxUint256);
        await tx.wait();

        const crvBalance = await mocks.crvBpt.balanceOf(deployerAddress);

        const calls = [await mocks.crvBpt.transfer(aliceAddress, crvBalance.mul(90).div(100))];

        await Promise.all(calls.map(tx => tx.wait()));
    });
    describe("setting setters", () => {
        it("anyone set approvals", async () => {
            const crvBpt = MockERC20__factory.connect(mocks.addresses.tokenBpt, deployer);
            expect(
                await crvBpt.allowance(crvDepositorWrapper.address, crvDepositor.address),
                "initial allowance",
            ).to.be.eq(ZERO);

            await crvDepositorWrapper.setApprovals();

            expect(await crvBpt.allowance(crvDepositorWrapper.address, crvDepositor.address), "allowance").to.be.gt(
                ZERO,
            );
        });
    });

    describe("depositing via wrapper", () => {
        it("allows the sender to deposit crv, wrap to crvBpt and deposit", async () => {
            const lock = true;
            const stakeAddress = ZERO_ADDRESS;
            const balance = await crv.balanceOf(aliceAddress);
            const amount = balance.mul(10).div(100);

            const cvxCrvBalanceBefore = await cvxCrv.balanceOf(aliceAddress);
            const cvxCrvForwardBalanceBefore = await cvxCrv.balanceOf(forwardToAddress);

            const minOut = await crvDepositorWrapper.getMinOut(amount, "10000");

            await crv.approve(crvDepositorWrapper.address, amount);
            // Test
            await crvDepositorWrapper.deposit(amount, minOut, lock, stakeAddress);

            const cvxCrvBalanceAfter = await cvxCrv.balanceOf(aliceAddress);
            const cvxCrvForwardBalanceAfter = await cvxCrv.balanceOf(forwardToAddress);

            const cvxCrvBalanceDelta = cvxCrvBalanceAfter.sub(cvxCrvBalanceBefore);
            const cvxCrvForwardBalanceDelta = cvxCrvForwardBalanceAfter.sub(cvxCrvForwardBalanceBefore);

            expect(cvxCrvBalanceDelta, "cvxCrv caller balance should not change").to.equal(ZERO);
            expect(cvxCrvForwardBalanceDelta, "cvxCrv forwardToAddress balance should increase").to.equal(minOut);
        });

        it("stakes on behalf of user should not be possible", async () => {
            const lock = true;
            const stakeAddress = cvxCrvStaking.address;
            const balance = await crv.balanceOf(aliceAddress);
            const amount = balance.mul(10).div(100);
            const tx = crvDepositorWrapper.deposit(amount, amount, lock, stakeAddress);
            await expect(tx).to.be.revertedWith("!_stakeAddress");
        });
    });
});
