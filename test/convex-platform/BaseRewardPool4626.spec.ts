import { simpleToExactAmount } from "../../test-utils/math";
import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4, SystemDeployed } from "../../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    Booster,
    ERC20__factory,
    BaseRewardPool4626__factory,
    BaseRewardPool4626,
    MockERC20,
    MockERC20__factory,
    VirtualBalanceRewardPool__factory,
} from "../../types/generated";
import { Signer } from "ethers";
import { DEAD_ADDRESS, ONE_WEEK, ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import { deployContract } from "../../tasks/utils";
import { impersonateAccount, increaseTime } from "../../test-utils";
import { Account, PoolInfo } from "types";

describe("BaseRewardPool4626", () => {
    let accounts: Signer[];
    let booster: Booster;
    let mocks: DeployMocksResult;
    let pool: PoolInfo;
    let contracts: SystemDeployed;

    let dao: Account;
    let deployer: Signer;
    let deployerAddress: string;

    let alice: Signer;
    let aliceAddress: string;

    const setup = async () => {
        mocks = await deployMocks(hre, deployer);
        dao = await impersonateAccount(await accounts[6].getAddress());
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], dao.signer);
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
        await phase3.poolManager.connect(dao.signer).setProtectPool(false);
        await phase3.boosterOwner.connect(dao.signer).setFeeInfo(mocks.lptoken.address, mocks.feeDistribution.address);
        await phase3.boosterOwner.connect(dao.signer).setFeeInfo(mocks.crv.address, mocks.feeDistribution.address);
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

    describe("checking compliance", () => {
        it("has 4626 config setup", async () => {
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            expect(await crvRewards.asset()).eq(pool.lptoken);
        });
        it("has the correct name and symbol", async () => {
            const auraBPT = ERC20__factory.connect(pool.token, deployer);
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            expect(await crvRewards.name()).eq(`${await auraBPT.name()} Vault`);
            expect(await crvRewards.symbol()).eq(`${await auraBPT.symbol()}-vault`);
        });
        it("does support approval and allowances", async () => {
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const tx = await crvRewards.approve(deployerAddress, 1);
            await expect(tx).to.emit(crvRewards, "Approval");

            let allowance = await crvRewards.allowance(aliceAddress, deployerAddress);
            expect(allowance).eq(1);

            await crvRewards.approve(deployerAddress, 0);
            allowance = await crvRewards.allowance(aliceAddress, deployerAddress);
            expect(allowance).eq(0);
        });
        it("returns the amount of decimals", async () => {
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            expect(await crvRewards.decimals()).eq(18);
        });
        it("returns the correct amount of assets on convertToAssets 1:1", async () => {
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const amount = simpleToExactAmount(1, 18);
            const assets = await crvRewards.convertToAssets(amount);
            expect(assets).eq(amount);
        });
        it("returns the correct amount of shares on convertToShares 1:1", async () => {
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const amount = simpleToExactAmount(1, 18);
            const shares = await crvRewards.convertToShares(amount);
            expect(shares).eq(amount);
        });
        // gets the maxDeposit of the pool
        it("returns the correct amount of maxDeposit/maxMint for any user", async () => {
            const aliceAddress = await alice.getAddress();
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            expect(await crvRewards.maxDeposit(aliceAddress)).eq(ethers.constants.MaxUint256);
            expect(await crvRewards.maxMint(aliceAddress)).eq(ethers.constants.MaxUint256);

            expect(await crvRewards.maxDeposit(ZERO_ADDRESS)).eq(ethers.constants.MaxUint256);
            expect(await crvRewards.maxMint(ZERO_ADDRESS)).eq(ethers.constants.MaxUint256);
        });
    });

    describe("checking flow from crvLP deposits", () => {
        it("add extra rewards", async () => {
            let crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);

            const rewardManagerAddress = await contracts.factories.rewardFactory.operator();
            const rewardManager = await impersonateAccount(rewardManagerAddress);
            crvRewards = crvRewards.connect(rewardManager.signer);
            const randomTtn = await deployContract<MockERC20>(
                hre,
                new MockERC20__factory(deployer),
                `RandomToken${0}`,
                ["randomToken", "randomToken", 18, await deployer.getAddress(), 10000000],
                {},
                false,
            );

            await contracts.factories.rewardFactory
                .connect(rewardManager.signer)
                .CreateTokenRewards(randomTtn.address, crvRewards.address, contracts.booster.address);

            expect(await crvRewards.extraRewardsLength(), "extra rewards").to.be.eq(1);
        });
        it("allows direct deposits", async () => {
            const amount = ethers.utils.parseEther("10");
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const depositToken = ERC20__factory.connect(pool.token, alice);

            const depositTokenBalanceBefore = await depositToken.balanceOf(pool.crvRewards);
            const balanceBefore = await crvRewards.balanceOf(aliceAddress);
            const totalSupplyBefore = await crvRewards.totalSupply();
            const lpBalanceBefore = await mocks.lptoken.balanceOf(aliceAddress);

            await mocks.lptoken.connect(alice).approve(pool.crvRewards, amount);

            // shares/assets ration is 1:1
            const shares = await crvRewards.previewDeposit(amount);
            const totalAssetsBefore = await crvRewards.totalAssets();

            await crvRewards.deposit(amount, aliceAddress);

            const depositTokenBalanceAfter = await depositToken.balanceOf(pool.crvRewards);
            const balanceAfter = await crvRewards.balanceOf(aliceAddress);
            const totalSupplyAfter = await crvRewards.totalSupply();
            const totalAssetsAfter = await crvRewards.totalAssets();

            const lpBalanceAfter = await mocks.lptoken.balanceOf(aliceAddress);

            expect(balanceAfter.sub(balanceBefore)).eq(shares);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
            expect(totalSupplyAfter.sub(totalSupplyBefore)).eq(amount);
            expect(totalAssetsAfter.sub(totalAssetsBefore)).eq(amount);
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
            // shares/assets ration is 1:1
            const assets = await crvRewards.previewMint(amount);
            const totalAssetsBefore = await crvRewards.totalAssets();

            await crvRewards.mint(amount, aliceAddress);

            const depositTokenBalanceAfter = await depositToken.balanceOf(pool.crvRewards);
            const balanceAfter = await crvRewards.balanceOf(aliceAddress);
            const totalAssetsAfter = await crvRewards.totalAssets();

            expect(balanceAfter.sub(balanceBefore)).eq(amount);
            expect(assets).eq(amount);
            expect(totalAssetsAfter.sub(totalAssetsBefore)).eq(assets);
            expect(depositTokenBalanceAfter.sub(depositTokenBalanceBefore)).eq(amount);
            expect(await crvRewards.maxWithdraw(aliceAddress)).eq(balanceAfter);
            expect(await crvRewards.maxRedeem(aliceAddress)).eq(balanceAfter);
        });

        it("allows direct deposits on behalf of alternate receiver", async () => {
            const amount = ethers.utils.parseEther("10");
            const alternateReceiverAddress = await alternateReceiver.getAddress();

            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const balanceBefore = await crvRewards.balanceOf(alternateReceiverAddress);
            const totalSupplyBefore = await crvRewards.totalSupply();

            await mocks.lptoken.connect(alice).approve(pool.crvRewards, amount);
            await crvRewards.deposit(amount, alternateReceiverAddress);

            const balanceAfter = await crvRewards.balanceOf(alternateReceiverAddress);
            const totalSupplyAfter = await crvRewards.totalSupply();
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
            expect(totalSupplyAfter.sub(totalSupplyBefore)).eq(amount);
        });

        it("allows direct withdraws", async () => {
            const amount = ethers.utils.parseEther("10");
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const balanceBefore = await mocks.lptoken.balanceOf(aliceAddress);
            // shares/assets ration is 1:1
            const shares = await crvRewards.previewWithdraw(amount);
            await crvRewards["withdraw(uint256,address,address)"](amount, aliceAddress, aliceAddress);
            const balanceAfter = await mocks.lptoken.balanceOf(aliceAddress);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
            expect(balanceAfter.sub(balanceBefore)).eq(shares);
            expect(await crvRewards.maxWithdraw(aliceAddress)).eq(await crvRewards.balanceOf(aliceAddress));
            expect(await crvRewards.maxRedeem(aliceAddress)).eq(await crvRewards.balanceOf(aliceAddress));
        });

        it("allows direct withdraws via redeem()", async () => {
            const amount = ethers.utils.parseEther("5");
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const balanceBefore = await mocks.lptoken.balanceOf(aliceAddress);
            // shares/assets ration is 1:1
            const assets = await crvRewards.previewRedeem(amount);
            await crvRewards["redeem(uint256,address,address)"](amount, aliceAddress, aliceAddress);
            const balanceAfter = await mocks.lptoken.balanceOf(aliceAddress);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
            expect(balanceAfter.sub(balanceBefore)).eq(assets);
            expect(await crvRewards.maxWithdraw(aliceAddress)).eq(await crvRewards.balanceOf(aliceAddress));
            expect(await crvRewards.maxRedeem(aliceAddress)).eq(await crvRewards.balanceOf(aliceAddress));
        });

        it("allows withdraws to recipient", async () => {
            const amount = ethers.utils.parseEther("5");
            const alternateReceiverAddress = await alternateReceiver.getAddress();
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const balanceBefore = await mocks.lptoken.balanceOf(alternateReceiverAddress);
            const rwdBalanceBefore = await crvRewards.balanceOf(aliceAddress);
            expect(rwdBalanceBefore).eq(simpleToExactAmount(5));
            // shares/assets ration is 1:1
            const assets = await crvRewards.previewRedeem(amount);
            await crvRewards["redeem(uint256,address,address)"](amount, alternateReceiverAddress, aliceAddress);
            const balanceAfter = await mocks.lptoken.balanceOf(alternateReceiverAddress);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
            expect(balanceAfter.sub(balanceBefore)).eq(assets);
            const rwdBalanceAfter = await crvRewards.balanceOf(aliceAddress);
            expect(rwdBalanceAfter).eq(0);
            expect(await crvRewards.maxWithdraw(aliceAddress)).eq(rwdBalanceAfter);
            expect(await crvRewards.maxRedeem(aliceAddress)).eq(rwdBalanceAfter);
        });
        it("earmark rewards", async () => {
            await increaseTime(ONE_WEEK.mul(2));
            await booster.connect(dao.signer).setTreasury(DEAD_ADDRESS);
            await booster.earmarkRewards(0);
            await booster.earmarkFees(mocks.crv.address);
            await increaseTime(ONE_WEEK.mul(2));
            await booster.earmarkRewards(0);
        });

        it("allows transferFrom between accounts", async () => {
            const alternateReceiverAddress = await alternateReceiver.getAddress();
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alternateReceiver);
            const virtualBalanceRewardPool = VirtualBalanceRewardPool__factory.connect(
                await crvRewards.extraRewards(0),
                alice,
            );

            const aliceBalanceBefore = await crvRewards.balanceOf(aliceAddress);
            const alternateReceiverBalanceBefore = await crvRewards.balanceOf(alternateReceiverAddress);

            const aliceVirtualBalanceBefore = await virtualBalanceRewardPool.balanceOf(aliceAddress);
            const alternateReceiverVirtualBalanceBefore = await virtualBalanceRewardPool.balanceOf(
                alternateReceiverAddress,
            );
            // Rewards check
            const aliceEarnedBefore = await crvRewards.earned(aliceAddress);
            const aliceVirtualEarnedBefore = await virtualBalanceRewardPool.earned(aliceAddress);

            const alternateEarnedBefore = await crvRewards.earned(alternateReceiverAddress);
            const alternateVirtualEarnedBefore = await virtualBalanceRewardPool.earned(alternateReceiverAddress);

            const amount = alternateReceiverBalanceBefore.div(4);

            // Alternate approves deployer to transfer tokens
            await crvRewards.approve(deployerAddress, amount);
            // When the token is transfer from one account to another
            const tx = await crvRewards.connect(deployer).transferFrom(alternateReceiverAddress, aliceAddress, amount);

            await expect(tx).to.emit(crvRewards, "Transfer").withArgs(alternateReceiverAddress, aliceAddress, amount);
            // VirtualBalanceRewardPool Withdraw "from"
            await expect(tx).to.emit(virtualBalanceRewardPool, "Withdrawn").withArgs(alternateReceiverAddress, amount);
            // VirtualBalanceRewardPool Stake "to"
            await expect(tx).to.emit(virtualBalanceRewardPool, "Staked").withArgs(aliceAddress, amount);

            const aliceBalanceAfter = await crvRewards.balanceOf(aliceAddress);
            const alternateReceiverBalanceAfter = await crvRewards.balanceOf(alternateReceiverAddress);

            const aliceVirtualBalanceAfter = await virtualBalanceRewardPool.balanceOf(aliceAddress);
            const alternateReceiverVirtualBalanceAfter = await virtualBalanceRewardPool.balanceOf(
                alternateReceiverAddress,
            );

            expect(aliceBalanceAfter.sub(aliceBalanceBefore)).eq(amount);
            expect(alternateReceiverBalanceBefore.sub(alternateReceiverBalanceAfter)).eq(amount);

            expect(aliceVirtualBalanceAfter.sub(aliceVirtualBalanceBefore)).eq(amount);
            expect(alternateReceiverVirtualBalanceBefore.sub(alternateReceiverVirtualBalanceAfter)).eq(amount);

            // Verify the original holder (alternate) can still claim rewards.
            const aliceEarnedAfter = await crvRewards.earned(aliceAddress);
            const aliceVirtualEarnedAfter = await virtualBalanceRewardPool.earned(aliceAddress);

            const alternateEarnedAfter = await crvRewards.earned(alternateReceiverAddress);
            const alternateVirtualEarnedAfter = await virtualBalanceRewardPool.earned(alternateReceiverAddress);

            expect(alternateEarnedAfter, "from rewards earned").to.be.gte(alternateEarnedBefore);
            expect(aliceEarnedAfter, "to rewards earned").to.be.gte(aliceEarnedBefore);
            expect(alternateVirtualEarnedAfter, "from rewards earned").to.be.gte(alternateVirtualEarnedBefore);
            expect(aliceVirtualEarnedAfter, "to rewards earned").to.be.gte(aliceVirtualEarnedBefore);
        });
        it("earmark rewards", async () => {
            await increaseTime(ONE_WEEK.mul(2));
            await booster.connect(dao.signer).setTreasury(DEAD_ADDRESS);
            await booster.earmarkRewards(0);
            await booster.earmarkFees(mocks.crv.address);
            await increaseTime(ONE_WEEK.mul(2));
            await booster.earmarkRewards(0);
        });

        it("allows transfer between accounts", async () => {
            const alternateReceiverAddress = await alternateReceiver.getAddress();
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const virtualBalanceRewardPool = VirtualBalanceRewardPool__factory.connect(
                await crvRewards.extraRewards(0),
                alice,
            );

            const aliceBalanceBefore = await crvRewards.balanceOf(aliceAddress);
            const alternateReceiverBalanceBefore = await crvRewards.balanceOf(alternateReceiverAddress);

            const aliceVirtualBalanceBefore = await virtualBalanceRewardPool.balanceOf(aliceAddress);
            const aliceVirtualEarnedBefore = await virtualBalanceRewardPool.earned(aliceAddress);
            const alternateReceiverVirtualBalanceBefore = await virtualBalanceRewardPool.balanceOf(
                alternateReceiverAddress,
            );

            // Rewards check
            const aliceEarnedBefore = await crvRewards.earned(aliceAddress);
            const alternateEarnedBefore = await crvRewards.earned(alternateReceiverAddress);
            const alternateVirtualEarnedBefore = await virtualBalanceRewardPool.earned(alternateReceiverAddress);

            const amount = aliceBalanceBefore;

            // Alice transfer to alternate receiver
            const tx = await crvRewards.transfer(alternateReceiverAddress, amount);
            await expect(tx).to.emit(crvRewards, "Transfer").withArgs(aliceAddress, alternateReceiverAddress, amount);
            // VirtualBalanceRewardPool Withdraw "from"
            await expect(tx).to.emit(virtualBalanceRewardPool, "Withdrawn").withArgs(aliceAddress, amount);
            // VirtualBalanceRewardPool Stake "to"
            await expect(tx).to.emit(virtualBalanceRewardPool, "Staked").withArgs(alternateReceiverAddress, amount);

            const aliceBalanceAfter = await crvRewards.balanceOf(aliceAddress);
            const alternateReceiverBalanceAfter = await crvRewards.balanceOf(alternateReceiverAddress);

            const aliceVirtualBalanceAfter = await virtualBalanceRewardPool.balanceOf(aliceAddress);
            const alternateReceiverVirtualBalanceAfter = await virtualBalanceRewardPool.balanceOf(
                alternateReceiverAddress,
            );

            expect(aliceBalanceBefore.sub(aliceBalanceAfter)).eq(amount);
            expect(alternateReceiverBalanceAfter.sub(alternateReceiverBalanceBefore)).eq(amount);

            expect(aliceVirtualBalanceBefore.sub(aliceVirtualBalanceAfter)).eq(amount);
            expect(alternateReceiverVirtualBalanceAfter.sub(alternateReceiverVirtualBalanceBefore)).eq(amount);

            // Verify the original holder (alternate) can still claim rewards.
            let aliceEarnedAfter = await crvRewards.earned(aliceAddress);
            let alternateEarnedAfter = await crvRewards.earned(alternateReceiverAddress);
            let aliceVirtualEarnedAfter = await virtualBalanceRewardPool.earned(aliceAddress);
            let alternateVirtualEarnedAfter = await virtualBalanceRewardPool.earned(alternateReceiverAddress);

            expect(aliceEarnedAfter, "from rewards earned").to.be.gte(aliceEarnedBefore);
            expect(alternateEarnedAfter, "to rewards earned").to.be.gte(alternateEarnedBefore);

            expect(alternateVirtualEarnedAfter, "from rewards earned").to.be.gte(alternateVirtualEarnedBefore);
            expect(aliceVirtualEarnedAfter, "to rewards earned").to.be.gte(aliceVirtualEarnedBefore);
        });
        it("claim rewards after transfers", async () => {
            const alternateReceiverAddress = await alternateReceiver.getAddress();
            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);

            let aliceCrvBalanceBefore = await mocks.crv.balanceOf(aliceAddress);
            let alternateCrvBalanceBefore = await mocks.crv.balanceOf(alternateReceiverAddress);
            const aliceEarnedBefore = await crvRewards.earned(aliceAddress);
            const alternateEarnedBefore = await crvRewards.earned(alternateReceiverAddress);

            // When getting rewards
            await crvRewards.connect(alice)["getReward(address,bool)"](aliceAddress, true);
            await crvRewards.connect(alternateReceiver)["getReward(address,bool)"](alternateReceiverAddress, true);

            const aliceEarnedAfter = await crvRewards.earned(aliceAddress);
            const alternateEarnedAfter = await crvRewards.earned(alternateReceiverAddress);
            const aliceCrvBalanceAfter = await mocks.crv.balanceOf(aliceAddress);
            const alternateCrvBalanceAfter = await mocks.crv.balanceOf(alternateReceiverAddress);

            expect(aliceCrvBalanceAfter, "crv collected").to.be.gte(aliceCrvBalanceBefore.add(aliceEarnedBefore));
            expect(alternateCrvBalanceAfter, "crv collected").to.be.gte(
                alternateCrvBalanceBefore.add(alternateEarnedBefore),
            );
            expect(aliceEarnedAfter, "aliceEarnedAfter").to.be.eq(ZERO);
            expect(alternateEarnedAfter, "alternateEarnedAfter").to.be.eq(ZERO);
        });

        it("allows direct withdraws for alternate receiver", async () => {
            const amount = ethers.utils.parseEther("10");
            const alternateReceiverAddress = await alternateReceiver.getAddress();

            const crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const balanceBefore = await mocks.lptoken.balanceOf(alternateReceiverAddress);
            // shares/assets ration is 1:1
            const shares = await crvRewards.previewWithdraw(amount);
            await crvRewards
                .connect(alternateReceiver)
                ["withdraw(uint256,address,address)"](amount, alternateReceiverAddress, alternateReceiverAddress);
            const balanceAfter = await mocks.lptoken.balanceOf(alternateReceiverAddress);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
            expect(balanceAfter.sub(balanceBefore)).eq(shares);
        });
    });

    describe("checking withdrawal using allowance", () => {
        let depositor: Signer;
        let depositorAddress: string;
        let withdrawer: Signer;
        let withdrawerAddress: string;
        let rewardPool: BaseRewardPool4626;
        before(async () => {
            depositor = accounts[2];
            depositorAddress = await depositor.getAddress();
            withdrawer = accounts[3];
            withdrawerAddress = await withdrawer.getAddress();

            rewardPool = BaseRewardPool4626__factory.connect(pool.crvRewards, depositor);

            expect(await rewardPool.balanceOf(depositorAddress)).eq(0);
            expect(await rewardPool.balanceOf(withdrawerAddress)).eq(0);

            await mocks.lptoken.connect(depositor).approve(rewardPool.address, simpleToExactAmount(100));
            await rewardPool.deposit(simpleToExactAmount(10), depositorAddress);
        });
        it("withdrawing someone else requires approval", async () => {
            expect(await rewardPool.allowance(depositorAddress, withdrawerAddress)).eq(0);
            await expect(
                rewardPool
                    .connect(withdrawer)
                    ["withdraw(uint256,address,address)"](1, withdrawerAddress, depositorAddress),
            ).to.be.revertedWith("ERC4626: withdrawal amount exceeds allowance");
        });
        it("allows depositor to approve someone to withdraw", async () => {
            await rewardPool.approve(withdrawerAddress, simpleToExactAmount(5));
            expect(await rewardPool.allowance(depositorAddress, withdrawerAddress)).eq(simpleToExactAmount(5));

            const depositorPoolBalanceBefore = simpleToExactAmount(10);
            const withdrawerPoolBalanceBefore = simpleToExactAmount(0);
            const depositorLPBalanceBefore = await mocks.lptoken.balanceOf(depositorAddress);
            const withdrawerLPBalanceBefore = await mocks.lptoken.balanceOf(withdrawerAddress);
            const allowanceBefore = simpleToExactAmount(5);

            const withdrawalAmount = simpleToExactAmount(4);
            const tx = await rewardPool
                .connect(withdrawer)
                ["withdraw(uint256,address,address)"](withdrawalAmount, withdrawerAddress, depositorAddress);
            await expect(tx)
                .to.emit(rewardPool, "Withdraw")
                .withArgs(withdrawerAddress, withdrawerAddress, depositorAddress, withdrawalAmount, withdrawalAmount);

            const depositorPoolBalanceAfter = await rewardPool.balanceOf(depositorAddress);
            const withdrawerPoolBalanceAfter = await rewardPool.balanceOf(withdrawerAddress);
            const depositorLPBalanceAfter = await mocks.lptoken.balanceOf(depositorAddress);
            const withdrawerLPBalanceAfter = await mocks.lptoken.balanceOf(withdrawerAddress);
            const allowanceAfter = await rewardPool.allowance(depositorAddress, withdrawerAddress);

            expect(depositorPoolBalanceAfter).eq(depositorPoolBalanceBefore.sub(withdrawalAmount));
            expect(withdrawerPoolBalanceAfter).eq(withdrawerPoolBalanceBefore);
            expect(depositorLPBalanceAfter).eq(depositorLPBalanceBefore);
            expect(withdrawerLPBalanceAfter).eq(withdrawerLPBalanceBefore.add(withdrawalAmount));
            expect(allowanceAfter).eq(allowanceBefore.sub(withdrawalAmount));
        });
        it("withdrawing lowers the approval accordingly", async () => {
            expect(await rewardPool.allowance(depositorAddress, withdrawerAddress)).eq(simpleToExactAmount(1));
            await expect(
                rewardPool
                    .connect(withdrawer)
                    ["withdraw(uint256,address,address)"](simpleToExactAmount(2), withdrawerAddress, depositorAddress),
            ).to.be.revertedWith("ERC4626: withdrawal amount exceeds allowance");
            await rewardPool
                .connect(withdrawer)
                ["withdraw(uint256,address,address)"](simpleToExactAmount(1), withdrawerAddress, depositorAddress);
            expect(await rewardPool.allowance(depositorAddress, withdrawerAddress)).eq(0);
            await expect(
                rewardPool
                    .connect(withdrawer)
                    ["withdraw(uint256,address,address)"](simpleToExactAmount(1), withdrawerAddress, depositorAddress),
            ).to.be.revertedWith("ERC4626: withdrawal amount exceeds allowance");
        });
    });
    describe("checks methods", async () => {
        it("should not add more than 12 extra rewards", async () => {
            let crvRewards = BaseRewardPool4626__factory.connect(pool.crvRewards, alice);
            const maxExtraRewards = 12;
            const len = await crvRewards.extraRewardsLength();
            const rewardManagerAddress = await crvRewards.rewardManager();
            const rewardManager = await impersonateAccount(rewardManagerAddress);
            crvRewards = crvRewards.connect(rewardManager.signer);
            let randomTtn: MockERC20;

            for (let i = len.toNumber(); i < maxExtraRewards; i++) {
                randomTtn = await deployContract<MockERC20>(
                    hre,
                    new MockERC20__factory(deployer),
                    `RandomToken${i}`,
                    ["randomToken", "randomToken", 18, await deployer.getAddress(), 10000000],
                    {},
                    false,
                );
                await crvRewards.addExtraReward(randomTtn.address);
            }

            expect(await crvRewards.extraRewardsLength()).to.eq(maxExtraRewards);
            // Test adding an extra reward once the limit is reached
            await crvRewards.addExtraReward(DEAD_ADDRESS);
            expect(await crvRewards.extraRewardsLength(), "extra reward not added").to.eq(maxExtraRewards);
        });
    });
});
