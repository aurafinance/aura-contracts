import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    deployCrvDepositorWrapperSwapper,
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    MultisigConfig,
    SystemDeployed,
} from "../../scripts/deploySystem";
import { impersonateAccount, simpleToExactAmount } from "../../test-utils";
import { ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import { BaseRewardPool, CrvDepositorWrapperSwapper, CvxCrvToken, ERC20 } from "../../types/generated";

describe("CrvDepositorWrapperSwapper", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let cvxCrv: CvxCrvToken;
    let deployer: Signer;
    let dao: Signer;
    let deployerAddress: string;
    let alice: Signer;
    let aliceAddress: string;
    let multisigs: MultisigConfig;
    let crv: ERC20;
    let crvDepositorWrapper: CrvDepositorWrapperSwapper;
    let cvxCrvStaking: BaseRewardPool;
    let contracts: SystemDeployed;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();
        dao = accounts[3];

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
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.connect(dao).setProtectPool(false);
        await phase3.boosterOwner.connect(dao).setFeeInfo(mocks.lptoken.address, mocks.feeDistribution.address);
        await phase3.boosterOwner.connect(dao).setFeeInfo(mocks.crv.address, mocks.feeDistribution.address);
        contracts = await deployPhase4(hre, deployer, phase3, mocks.addresses);

        const { crvDepositorWrapperSwapper: crvDepositorWrapperForwarder } = await deployCrvDepositorWrapperSwapper(
            hre,
            deployer,
            phase2,
            mocks.addresses,
        );

        alice = accounts[0];
        aliceAddress = await alice.getAddress();

        cvxCrv = contracts.cvxCrv.connect(alice);
        crv = mocks.crv.connect(alice);
        crvDepositorWrapper = crvDepositorWrapperForwarder.connect(alice);
        cvxCrvStaking = contracts.cvxCrvRewards;

        // dirty trick to get some crvCvx balance.
        const crvDepositorAccount = await impersonateAccount(contracts.crvDepositor.address);
        const cvxCrvConnected = contracts.cvxCrv.connect(crvDepositorAccount.signer);
        await cvxCrvConnected.mint(deployerAddress, simpleToExactAmount(100));

        const calls = [
            await crv.transfer(mocks.balancerVault.address, simpleToExactAmount(10)),
            await mocks.crvBpt.transfer(mocks.balancerVault.address, simpleToExactAmount(10)),
            await cvxCrv.transfer(mocks.balancerVault.address, simpleToExactAmount(50)),
        ];
        await Promise.all(calls.map(tx => tx.wait()));

        // transfer LP tokens to accounts
        const balance = await mocks.lptoken.balanceOf(deployerAddress);
        for (const account of accounts) {
            const accountAddress = await account.getAddress();
            const share = balance.div(accounts.length);
            const tx = await mocks.lptoken.transfer(accountAddress, share);
            await tx.wait();
        }

        // Setup balancer vault mocks
        await mocks.crvBpt.setPrice(simpleToExactAmount(1));
        await mocks.balancerVault.setTokens(crv.address, mocks.crvBpt.address);
    });
    describe("setting setters", () => {
        it("initial configuration is correct", async () => {
            expect(await crvDepositorWrapper.AURABAL()).to.equal(cvxCrv.address);
            expect(await crvDepositorWrapper.AURABAL_BAL_ETH_BPT_POOL_ID()).to.equal(contracts.cvxCrvBpt.poolId);
            expect(await crvDepositorWrapper.BALANCER_POOL_TOKEN()).to.equal(mocks.crvBpt.address);
            expect(await crvDepositorWrapper.BAL_ETH_POOL_ID()).to.equal(mocks.addresses.balancerPoolId);
            expect(await crvDepositorWrapper.BALANCER_VAULT()).to.equal(mocks.addresses.balancerVault);
        });

        it("anyone set approvals", async () => {
            expect(
                await mocks.crvBpt.allowance(crvDepositorWrapper.address, mocks.balancerVault.address),
                "allowance",
            ).to.be.gt(ZERO);
        });
    });

    describe("depositing via wrapper", () => {
        it("verifies the mocks are properly set up", async () => {
            const cvxCrvVaultBalance = await cvxCrv.balanceOf(mocks.balancerVault.address);
            const crvVaultBalance = await crv.balanceOf(mocks.balancerVault.address);
            const crvBptBalance = await mocks.crvBpt.balanceOf(mocks.balancerVault.address);

            expect(cvxCrvVaultBalance, "cvxCrvVaultBalance").to.gt(ZERO);
            expect(crvVaultBalance, "crvVaultBalance").to.gt(ZERO);
            expect(crvBptBalance, "crvBptBalance").to.gt(ZERO);
        });
        it("allows the sender to swap crv for crvCvx without minting", async () => {
            const lock = true;
            const stakeAddress = ZERO_ADDRESS;
            const amount = simpleToExactAmount(1);

            const cvxCrvBalanceBefore = await cvxCrv.balanceOf(aliceAddress);
            const crvBalanceBefore = await crv.balanceOf(aliceAddress);

            const minOut = await crvDepositorWrapper.getMinOut(amount, "10000");

            await crv.approve(crvDepositorWrapper.address, amount);
            // Test
            await crvDepositorWrapper.deposit(amount, minOut, lock, stakeAddress);

            const cvxCrvBalanceAfter = await cvxCrv.balanceOf(aliceAddress);
            const crvBalanceAfter = await crv.balanceOf(aliceAddress);

            const cvxCrvBalanceDelta = cvxCrvBalanceAfter.sub(cvxCrvBalanceBefore);
            const crvBalanceDelta = crvBalanceBefore.sub(crvBalanceAfter);

            expect(cvxCrvBalanceDelta, "cvxCrv caller balance should have increased").to.equal(amount);
            expect(crvBalanceDelta, "crv caller balance should have decreased").to.gt(ZERO);
        });

        it("stakes on behalf of user should  be possible", async () => {
            const lock = true; // lock is not used in the staking contract
            const stakeAddress = cvxCrvStaking.address;

            const amount = simpleToExactAmount(1);
            const minOut = await crvDepositorWrapper.getMinOut(amount, "10000");
            await crv.approve(crvDepositorWrapper.address, amount);

            const tx = await crvDepositorWrapper.deposit(amount, minOut, lock, stakeAddress);
            await expect(tx).to.emit(cvxCrvStaking, "Staked");
        });
    });
});
