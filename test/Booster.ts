import { ethers } from "hardhat";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult } from "../scripts/deployMocks";
import { Booster, PoolManagerV3, ERC20__factory } from "../types/generated";
import { Signer } from "ethers";

type Pool = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    stash: string;
    shutdown: boolean;
};

describe("PoolManagerV3", () => {
    let accounts: Signer[];
    let booster: Booster;
    let poolManager: PoolManagerV3;
    let mocks: DeployMocksResult;
    let pool: Pool;
    let deployer: Signer;
    let deployerAddress: string;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();

        mocks = await deployMocks(deployer);

        const phase1 = await deployPhase1(deployer, mocks.addresses);
        const phase2 = await deployPhase2(deployer, phase1, mocks.namingConfig);
        const contracts = await deployPhase3(deployer, phase2, mocks.namingConfig, mocks.addresses);

        booster = contracts.booster;
        poolManager = contracts.poolManager;

        // add mock gauge to the booster
        const gauge = mocks.gauge;
        let tx = await poolManager["addPool(address)"](gauge.address);
        await tx.wait();

        pool = await booster.poolInfo("0");

        // transfer LP tokens to accounts
        const balance = await mocks.lptoken.balanceOf(deployerAddress);
        for (const account of accounts) {
            const accountAddress = await account.getAddress();
            const share = balance.div(accounts.length.toString());
            const tx = await mocks.lptoken.transfer(accountAddress, share);
            await tx.wait();
        }

        // transfer CRV to mock minter
        const crvBalance = await mocks.crv.balanceOf(deployerAddress);
        tx = await mocks.crv.transfer(mocks.crvMinter.address, crvBalance);
        await tx.wait();
    });

    it("@method deposit", async () => {
        const alice = accounts[1];
        const aliceAddress = await alice.getAddress();

        const stake = false;
        const amount = ethers.utils.parseEther("10");
        let tx = await mocks.lptoken.connect(alice).approve(booster.address, amount);
        await tx.wait();

        tx = await booster.connect(alice).deposit("0", amount, stake);
        await tx.wait();

        const depositToken = ERC20__factory.connect(pool.token, deployer);
        const balance = await depositToken.balanceOf(aliceAddress);

        expect(balance.toString()).to.equal(amount.toString());
    });

    it("@method earmarkRewards", async () => {
        let tx = await booster.earmarkRewards("0");
        await tx.wait();

        const rate = await mocks.crvMinter.rate();

        const pool = await booster.poolInfo("0");
        const stakerRewards = await booster.stakerRewards();
        const lockRewards = await booster.lockRewards();

        const rewardPoolBalance = await mocks.crv.balanceOf(pool.crvRewards);
        const deployerBalance = await mocks.crv.balanceOf(deployerAddress);
        const stakerRewardsBalance = await mocks.crv.balanceOf(stakerRewards);
        const lockRewardsBalance = await mocks.crv.balanceOf(lockRewards);

        const totalCrvBalance = rewardPoolBalance
            .add(deployerBalance)
            .add(stakerRewardsBalance)
            .add(lockRewardsBalance);

        expect(totalCrvBalance.toString()).to.equal(rate.toString());
    });
});
