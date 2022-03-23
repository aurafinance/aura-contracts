import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { Booster, ERC20__factory, BaseRewardPool__factory } from "../types/generated";
import { Signer } from "ethers";
import { increaseTime } from "../test-utils/time";
import { simpleToExactAmount } from "../test-utils/math";

type Pool = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    stash: string;
    shutdown: boolean;
};

describe("Booster", () => {
    let accounts: Signer[];
    let booster: Booster;
    let mocks: DeployMocksResult;
    let pool: Pool;

    let deployer: Signer;
    let deployerAddress: string;

    let alice: Signer;
    let aliceAddress: string;

    const setup = async () => {
        mocks = await deployMocks(deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(deployer, mocks.addresses);
        const phase2 = await deployPhase2(deployer, phase1, multisigs, mocks.namingConfig);
        const phase3 = await deployPhase3(
            hre,
            deployer,
            phase2,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );
        const contracts = await deployPhase4(deployer, phase3, mocks.addresses);

        booster = contracts.booster;

        pool = await booster.poolInfo(0);

        // transfer LP tokens to accounts
        const balance = await mocks.lptoken.balanceOf(deployerAddress);
        for (const account of accounts) {
            const accountAddress = await account.getAddress();
            const share = balance.div(accounts.length);
            const tx = await mocks.lptoken.transfer(accountAddress, share);
            await tx.wait();
        }

        alice = accounts[1];
        aliceAddress = await alice.getAddress();
    };

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();
    });

    describe("managing system revenue fees", async () => {
        before(async () => {
            await setup();
        });
        it("has the correct initial config");
        it("allows feeManager to set the fees");
        it("enforces bounds on each fee type");
        it("doesn't allow just anyone to change fees");
        it("distributes the fees to the correct places");
    });

    describe("managing fee distributors to cvxCRV", async () => {
        before(async () => {
            await setup();
        });

        it("has both native token and distro in the initial config");
        describe("setting fee info fails if", () => {
            it("not called by owner");
            it("distro contract already added");
            it("system hasn't been initialised");
            it("distro has no fee token");
        });
        describe("setting fee info", () => {
            it("sets directly to cvxCrv if the reward token is crv");
            it("creates a token rewards otherwise");
        });
        describe("updating fee info", () => {
            it("fails if not owner");
            it("fails if distro does not exist");
            it("sets the active status on a distro");
        });
        describe("earmarking fees", () => {
            it("allows for crv to be earmarked to cvxCrv rewards");
            it("sends 100% of the rewards to the reward contract");
            it("fails if the distro is inactive");
            it("fails if the distro does not exist");
            it("fails if the distro does not exist");
        });
    });
    describe("performing core functions", async () => {
        before(async () => {
            await setup();
        });

        it("@method Booster.deposit", async () => {
            const stake = false;
            const amount = ethers.utils.parseEther("10");
            let tx = await mocks.lptoken.connect(alice).approve(booster.address, amount);
            await tx.wait();

            tx = await booster.connect(alice).deposit(0, amount, stake);
            await tx.wait();

            const depositToken = ERC20__factory.connect(pool.token, deployer);
            const balance = await depositToken.balanceOf(aliceAddress);

            expect(balance).to.equal(amount);
        });

        it("@method BaseRewardPool.stake", async () => {
            const depositToken = ERC20__factory.connect(pool.token, alice);
            const balance = await depositToken.balanceOf(aliceAddress);
            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, alice);

            let tx = await depositToken.approve(crvRewards.address, balance);
            await tx.wait();

            tx = await crvRewards.stake(balance);
            await tx.wait();

            const stakedBalance = await crvRewards.balanceOf(aliceAddress);

            expect(stakedBalance).to.equal(balance);
        });

        it("@method Booster.earmarkRewards", async () => {
            await increaseTime(60 * 60 * 24);

            const deployerBalanceBefore = await mocks.crv.balanceOf(deployerAddress);

            const tx = await booster.earmarkRewards(0);
            await tx.wait();

            const rate = await mocks.crvMinter.rate();

            const stakerRewards = await booster.stakerRewards();
            const lockRewards = await booster.lockRewards();

            const deployerBalanceAfter = await mocks.crv.balanceOf(deployerAddress);
            const deployerBalanceDelta = deployerBalanceAfter.sub(deployerBalanceBefore);

            const rewardPoolBalance = await mocks.crv.balanceOf(pool.crvRewards);
            const stakerRewardsBalance = await mocks.crv.balanceOf(stakerRewards);
            const lockRewardsBalance = await mocks.crv.balanceOf(lockRewards);

            const totalCrvBalance = rewardPoolBalance
                .add(deployerBalanceDelta)
                .add(stakerRewardsBalance)
                .add(lockRewardsBalance);

            expect(totalCrvBalance).to.equal(rate);
        });

        it("@method BaseRewardPool.getReward", async () => {
            const claimExtras = false;

            await increaseTime(60 * 60 * 24);

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, alice);
            const tx = await crvRewards["getReward(address,bool)"](aliceAddress, claimExtras);
            await tx.wait();

            const crvBalance = await mocks.crv.balanceOf(aliceAddress);

            const balance = await crvRewards.balanceOf(aliceAddress);
            const rewardPerToken = await crvRewards.rewardPerToken();
            const expectedRewards = rewardPerToken.mul(balance).div(simpleToExactAmount(1));

            expect(expectedRewards).to.equal(crvBalance);
        });
    });
});
