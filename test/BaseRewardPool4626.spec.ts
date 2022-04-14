import { simpleToExactAmount } from "./../test-utils/math";
import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4, SystemDeployed } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { Booster, ERC20__factory, BaseRewardPool4626__factory } from "../types/generated";
import { Signer } from "ethers";

type Pool = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    stash: string;
    shutdown: boolean;
};

describe("BaseRewardPool4626", () => {
    let accounts: Signer[];
    let booster: Booster;
    let mocks: DeployMocksResult;
    let pool: Pool;
    let contracts: SystemDeployed;

    let deployer: Signer;
    let deployerAddress: string;

    let alice: Signer;
    let aliceAddress: string;

    const setup = async () => {
        mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], accounts[6]);
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
        await phase3.poolManager.connect(accounts[6]).setProtectPool(false);
        contracts = await deployPhase4(hre, deployer, phase3, mocks.addresses);

        ({ booster } = contracts);

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

    let alternateReceiver: Signer;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();

        await setup();
        alternateReceiver = accounts[7];
    });

    it("has 4626 config setup", async () => {
        const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
        expect(await crvRewards.asset()).eq(pool.lptoken);
    });

    describe("depositing raw LP token", () => {
        it("allows direct deposits", async () => {
            const amount = ethers.utils.parseEther("10");
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const depositToken = ERC20__factory.connect(pool.token, alice);

            const depositTokenBalanceBefore = await depositToken.balanceOf(pool.crvRewards);
            const balanceBefore = await crvRewards.balanceOf(aliceAddress);
            const lpBalanceBefore = await mocks.lptoken.balanceOf(aliceAddress);

            await mocks.lptoken.connect(alice).approve(pool.crvRewards, amount);
            await crvRewards.deposit(amount, aliceAddress);

            const depositTokenBalanceAfter = await depositToken.balanceOf(pool.crvRewards);
            const balanceAfter = await crvRewards.balanceOf(aliceAddress);
            const lpBalanceAfter = await mocks.lptoken.balanceOf(aliceAddress);

            expect(balanceAfter.sub(balanceBefore)).eq(amount);
            expect(depositTokenBalanceAfter.sub(depositTokenBalanceBefore)).eq(amount);
            expect(lpBalanceBefore.sub(lpBalanceAfter)).eq(amount);
        });

        it("allows direct deposits via mint()", async () => {
            const amount = ethers.utils.parseEther("10");
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const depositToken = ERC20__factory.connect(pool.token, alice);

            const depositTokenBalanceBefore = await depositToken.balanceOf(pool.crvRewards);
            const balanceBefore = await crvRewards.balanceOf(aliceAddress);

            await mocks.lptoken.connect(alice).approve(pool.crvRewards, amount);
            await crvRewards.mint(amount, aliceAddress);

            const depositTokenBalanceAfter = await depositToken.balanceOf(pool.crvRewards);
            const balanceAfter = await crvRewards.balanceOf(aliceAddress);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
            expect(depositTokenBalanceAfter.sub(depositTokenBalanceBefore)).eq(amount);
        });

        it("allows direct deposits on behalf of alternate reciever", async () => {
            const amount = ethers.utils.parseEther("10");
            const alternateReceiverAddress = await alternateReceiver.getAddress();

            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const balanceBefore = await crvRewards.balanceOf(alternateReceiverAddress);

            await mocks.lptoken.connect(alice).approve(pool.crvRewards, amount);
            await crvRewards.deposit(amount, alternateReceiverAddress);

            const balanceAfter = await crvRewards.balanceOf(alternateReceiverAddress);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
        });

        it("allows direct withdraws", async () => {
            const amount = ethers.utils.parseEther("10");
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const balanceBefore = await mocks.lptoken.balanceOf(aliceAddress);
            await crvRewards["withdraw(uint256,address,address)"](amount, aliceAddress, aliceAddress);
            const balanceAfter = await mocks.lptoken.balanceOf(aliceAddress);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
        });

        it("allows direct withdraws via redeem()", async () => {
            const amount = ethers.utils.parseEther("5");
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const balanceBefore = await mocks.lptoken.balanceOf(aliceAddress);
            await crvRewards["redeem(uint256,address,address)"](amount, aliceAddress, aliceAddress);
            const balanceAfter = await mocks.lptoken.balanceOf(aliceAddress);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
        });

        it("allows withdraws to receipient", async () => {
            const amount = ethers.utils.parseEther("5");
            const alternateReceiverAddress = await alternateReceiver.getAddress();
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const balanceBefore = await mocks.lptoken.balanceOf(alternateReceiverAddress);
            const rwdBalanaceBefore = await crvRewards.balanceOf(aliceAddress);
            expect(rwdBalanaceBefore).eq(simpleToExactAmount(5));
            await crvRewards["redeem(uint256,address,address)"](amount, alternateReceiverAddress, aliceAddress);
            const balanceAfter = await mocks.lptoken.balanceOf(alternateReceiverAddress);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
            const rwdBalanaceAfter = await crvRewards.balanceOf(aliceAddress);
            expect(rwdBalanaceAfter).eq(0);
        });

        it("fails if sender is not owner", async () => {
            const alternateReceiverAddress = await alternateReceiver.getAddress();
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            await expect(
                crvRewards["redeem(uint256,address,address)"](1, alternateReceiverAddress, alternateReceiverAddress),
            ).to.be.revertedWith("!owner");
        });

        it("allows direct withdraws for alternate reciever", async () => {
            const amount = ethers.utils.parseEther("10");
            const alternateReceiverAddress = await alternateReceiver.getAddress();

            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const balanceBefore = await mocks.lptoken.balanceOf(alternateReceiverAddress);
            await crvRewards
                .connect(alternateReceiver)
                ["withdraw(uint256,address,address)"](amount, alternateReceiverAddress, alternateReceiverAddress);
            const balanceAfter = await mocks.lptoken.balanceOf(alternateReceiverAddress);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
        });
    });
});
