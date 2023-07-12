import { expect } from "chai";
import { BigNumber, Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { Account, PoolInfo } from "types";
import { DeployL2MocksResult } from "../../scripts/deploySidechainMocks";
import { increaseTime, increaseTimeTo, simpleToExactAmount } from "../../test-utils";
import { DEAD_ADDRESS, ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import { impersonate, impersonateAccount } from "../../test-utils/fork";
import { CanonicalPhaseDeployed, SidechainDeployed, sidechainTestSetup } from "../sidechain/sidechainTestSetup";
import { BaseRewardPool__factory, BoosterLite, ERC20__factory } from "../../types/generated";

const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;

describe("BoosterLite", () => {
    let accounts: Signer[];
    let booster: BoosterLite;
    let pool: PoolInfo;

    let alice: Signer;
    let aliceAddress: string;

    let l2mocks: DeployL2MocksResult;
    let deployer: Account;
    let dao: Account;

    // Sidechain Contracts
    let sidechain: SidechainDeployed;
    let canonical: CanonicalPhaseDeployed;
    let idSnapShot: number;

    const mintrMintAmount = simpleToExactAmount(1); // Rate of the MockCurveMinter.
    const setup = async () => {
        if (idSnapShot) {
            await hre.ethers.provider.send("evm_revert", [idSnapShot]);
            idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
            return;
        }

        accounts = await ethers.getSigners();
        const testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID);
        deployer = testSetup.deployer;
        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);
        l2mocks = testSetup.l2.mocks;
        canonical = testSetup.l1.canonical;
        sidechain = testSetup.l2.sidechain;

        ({ booster } = sidechain);
        pool = await booster.poolInfo(0);
        // transfer LP tokens to accounts
        const balance = await l2mocks.bpt.balanceOf(deployer.address);
        for (const account of accounts) {
            const accountAddress = await account.getAddress();
            const share = balance.div(accounts.length);
            const tx = await l2mocks.bpt.transfer(accountAddress, share);
            await tx.wait();
        }

        alice = accounts[5];
        aliceAddress = await alice.getAddress();
        idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
    };
    async function toFeeAmount(n: BigNumber) {
        const lockIncentive = await sidechain.booster.lockIncentive();
        const stakerIncentive = await sidechain.booster.stakerIncentive();
        const platformFee = await sidechain.booster.platformFee();
        const feeDenom = await sidechain.booster.FEE_DENOMINATOR();

        const totalIncentive = lockIncentive.add(stakerIncentive).add(platformFee);
        return n.mul(totalIncentive).div(feeDenom);
    }
    after(async () => {
        await hre.ethers.provider.send("evm_revert", [idSnapShot]);
    });
    describe("managing system revenue fees", async () => {
        before(async () => {
            await setup();
        });
        it("has the correct initial config", async () => {
            const lockFee = await booster.lockIncentive();
            expect(lockFee).eq(1850);
            const stakerFee = await booster.stakerIncentive();
            expect(stakerFee).eq(400);
            const callerFee = await booster.earmarkIncentive();
            expect(callerFee).eq(50);
            const platformFee = await booster.platformFee();
            expect(platformFee).eq(200);

            const feeManager = await booster.feeManager();
            expect(feeManager).eq(await dao.signer.getAddress());
        });
        it("doesn't allow just anyone to change fees", async () => {
            await expect(booster.connect(accounts[5]).setFees(1, 2, 3, 4)).to.be.revertedWith("!auth");
        });
        it("allows feeManager to set the fees", async () => {
            const tx = await booster.connect(dao.signer).setFees(500, 300, 25, 0);
            await expect(tx).to.emit(booster, "FeesUpdated").withArgs(500, 300, 25, 0);
        });
        it("enforces 40% upper bound", async () => {
            await expect(booster.connect(dao.signer).setFees(2500, 1500, 50, 0)).to.be.revertedWith(">MaxFees");

            const tx = await booster.connect(dao.signer).setFees(1500, 900, 50, 0);
            await expect(tx).to.emit(booster, "FeesUpdated").withArgs(1500, 900, 50, 0);
        });
        it("enforces bounds on each fee type", async () => {
            // lockFees 300-1500
            await expect(booster.connect(dao.signer).setFees(200, 500, 50, 0)).to.be.revertedWith("!lockFees");
            // stakerFees 300-1500
            await expect(booster.connect(dao.signer).setFees(500, 200, 50, 0)).to.be.revertedWith("!stakerFees");
            // callerFees 10-100
            await expect(booster.connect(dao.signer).setFees(500, 500, 2, 0)).to.be.revertedWith("!callerFees");
            await expect(booster.connect(dao.signer).setFees(500, 500, 110, 0)).to.be.revertedWith("!callerFees");
            // platform 0-200
            await expect(booster.connect(dao.signer).setFees(500, 500, 50, 250)).to.be.revertedWith("!platform");
        });
        it("earmark rewards sends fees to l2Coordinator's bridgeDelegate", async () => {
            await booster.connect(dao.signer).setFees(1500, 900, 50, 50);
            const bridgeDelegate = await sidechain.l2Coordinator.bridgeDelegate();
            expect(bridgeDelegate, "bridge delegate").to.not.be.eq(ZERO_ADDRESS);

            const amountOfFees = await toFeeAmount(mintrMintAmount);
            // bals before
            const balsBefore = await Promise.all([
                await l2mocks.token.balanceOf((await booster.poolInfo(0)).crvRewards), // [0] reward pool
                await l2mocks.token.balanceOf(aliceAddress), // [1] _callIncentive
                await l2mocks.token.balanceOf(await booster.treasury()), // [2] platform
                await l2mocks.token.balanceOf(bridgeDelegate), // [3] _totalIncentive
                await l2mocks.token.balanceOf(await booster.rewards()), // [4] rewards == l2Coordinator
            ]);

            // collect the rewards
            await booster.connect(dao.signer).setTreasury(DEAD_ADDRESS);

            const feeDebtBefore = await canonical.l1Coordinator.feeDebtOf(L2_CHAIN_ID);
            await booster.connect(alice).earmarkRewards(0, ZERO_ADDRESS, { value: NATIVE_FEE });
            const feeDebtAfter = await canonical.l1Coordinator.feeDebtOf(L2_CHAIN_ID);

            // bals after
            const balsAfter = await Promise.all([
                await l2mocks.token.balanceOf((await booster.poolInfo(0)).crvRewards), // reward pool
                await l2mocks.token.balanceOf(aliceAddress), // _callIncentive
                await l2mocks.token.balanceOf(await booster.treasury()), // platform
                await l2mocks.token.balanceOf(bridgeDelegate), // rewards == l2Coordinator
                await l2mocks.token.balanceOf(await booster.rewards()), // rewards == l2Coordinator
            ]);

            expect(balsAfter[0], "reward pool no changes").eq(
                balsBefore[0].add(simpleToExactAmount(1).div(10000).mul(7500)),
            );
            expect(balsAfter[1], "_callIncentive").eq(balsBefore[1].add(simpleToExactAmount(1).div(10000).mul(50)));
            expect(balsAfter[2], "platform no changes").eq(balsBefore[2]);
            expect(balsAfter[3], "_totalIncentive").eq(balsBefore[3].add(amountOfFees));
            expect(balsAfter[4], "l2Coordinator == rewards").eq(ZERO);
            expect(feeDebtAfter.sub(feeDebtBefore)).eq(amountOfFees);
        });
    });
    describe("performing core functions", async () => {
        before(async () => {
            await setup();
        });

        it("@method Booster.deposit", async () => {
            const stake = false;
            const pid = 0;
            const amount = ethers.utils.parseEther("10");
            let tx = await l2mocks.bpt.connect(alice).approve(booster.address, amount);

            tx = await booster.connect(alice).deposit(pid, amount, stake);
            await expect(tx).to.emit(booster, "Deposited").withArgs(aliceAddress, pid, amount);

            const depositToken = ERC20__factory.connect(pool.token, deployer.signer);
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
            await expect(tx).to.emit(crvRewards, "Staked").withArgs(aliceAddress, balance);

            const stakedBalance = await crvRewards.balanceOf(aliceAddress);

            expect(stakedBalance).to.equal(balance);
        });

        it("Booster.earmarkRewards sends fees to coordinator", async () => {
            await increaseTime(60 * 60 * 24);
            const deployerBalanceBefore = await l2mocks.token.balanceOf(deployer.address);
            const rewardPoolBalanceBefore = await l2mocks.token.balanceOf(pool.crvRewards);
            const feeDebtBefore = await canonical.l1Coordinator.feeDebtOf(L2_CHAIN_ID);
            const bridgeDelegate = await sidechain.l2Coordinator.bridgeDelegate();
            const bridgeDelegateBalanceBefore = await l2mocks.token.balanceOf(bridgeDelegate);

            // When earmarkRewards
            const tx = await booster.earmarkRewards(0, ZERO_ADDRESS, { value: NATIVE_FEE });
            await tx.wait();

            // Then sends
            const feeDebtAfter = await canonical.l1Coordinator.feeDebtOf(L2_CHAIN_ID);
            const rate = await l2mocks.minter.rate();
            const callIncentive = rate
                .mul(await sidechain.booster.earmarkIncentive())
                .div(await booster.FEE_DENOMINATOR());

            const totalIncentive = await toFeeAmount(rate);
            const rewards = await booster.rewards();
            const deployerBalanceAfter = await l2mocks.token.balanceOf(deployer.address);
            const deployerBalanceDelta = deployerBalanceAfter.sub(deployerBalanceBefore);

            const rewardPoolBalanceAfter = await l2mocks.token.balanceOf(pool.crvRewards);
            const bridgeDelegateBalanceAfter = await l2mocks.token.balanceOf(bridgeDelegate);
            const bridgeDelegateBalanceDelta = bridgeDelegateBalanceAfter.sub(bridgeDelegateBalanceBefore);

            const rewardsBalance = await l2mocks.token.balanceOf(rewards);
            const totalCrvBalance = rewardPoolBalanceAfter
                .sub(rewardPoolBalanceBefore)
                .add(deployerBalanceDelta)
                .add(rewardsBalance)
                .add(bridgeDelegateBalanceDelta);

            expect(feeDebtAfter.sub(feeDebtBefore), "fees sent to coordinator").eq(totalIncentive);
            expect(totalCrvBalance, "total crv balance").to.equal(rate);
            expect(deployerBalanceDelta, "call incentive").to.equal(callIncentive);
            expect(rewardPoolBalanceAfter, "crv to reward contract").to.equal(
                rate.sub(totalIncentive).sub(callIncentive),
            );
        });
        it("updates accumulated aura", async () => {
            const { l2Coordinator } = sidechain;
            const lzEndpoint = await impersonateAccount(await l2Coordinator.lzEndpoint(), true);

            // Send some AURA OFT
            const PT_SEND = await sidechain.auraOFT.PT_SEND();
            const toAddress = ethers.utils.solidityPack(["address"], [l2Coordinator.address]);
            const auraOftPayload = ethers.utils.defaultAbiCoder.encode(
                ["uint16", "bytes", "uint256"],
                [PT_SEND, toAddress, simpleToExactAmount(100)],
            );

            const signer = await impersonate(sidechain.auraOFT.address, true);
            await sidechain.auraOFT
                .connect(signer)
                .nonblockingLzReceive(L1_CHAIN_ID, lzEndpoint.address, 0, auraOftPayload);

            // Update mintRate
            const payload = ethers.utils.defaultAbiCoder.encode(
                ["bytes4", "uint8", "uint256"],
                ["0x7a7f9946", "2", simpleToExactAmount(1)],
            );
            const accAuraBefore = await l2Coordinator.accAuraRewards();

            await l2Coordinator
                .connect(dao.signer)
                .setTrustedRemoteAddress(L1_CHAIN_ID, canonical.l1Coordinator.address);
            await l2Coordinator
                .connect(lzEndpoint.signer)
                .lzReceive(L1_CHAIN_ID, await l2Coordinator.trustedRemoteLookup(L1_CHAIN_ID), 0, payload);
            const accAuraAfter = await l2Coordinator.accAuraRewards();
            expect(accAuraAfter.sub(accAuraBefore)).eq(simpleToExactAmount(1));
        });
        it("Get reward from BaseRewardPool", async () => {
            const claimExtras = false;

            await increaseTime(60 * 60 * 24);

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, alice);
            const tx = await crvRewards["getReward(address,bool)"](aliceAddress, claimExtras);
            await tx.wait();

            const crvBalance = await l2mocks.token.balanceOf(aliceAddress);

            const balance = await crvRewards.balanceOf(aliceAddress);
            const rewardPerToken = await crvRewards.rewardPerToken();
            const expectedRewards = rewardPerToken.mul(balance).div(simpleToExactAmount(1));

            expect(expectedRewards).to.equal(crvBalance);
        });

        it("@method BaseRewardPool.processIdleRewards()", async () => {
            await l2mocks.minter.setRate(1000);

            await booster.earmarkRewards(0, ZERO_ADDRESS, { value: NATIVE_FEE });
            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, alice);

            const queuedRewards = await crvRewards.queuedRewards();
            const historicalRewards = await crvRewards.historicalRewards();
            expect(queuedRewards, "must have some queue rewards").gt(0);
            // Given that the period finish has passed
            const periodFinish = await crvRewards.periodFinish();
            await increaseTimeTo(periodFinish);
            // When processing idle rewards
            const tx = await crvRewards.processIdleRewards();
            // Then notify rewards
            await expect(tx).to.emit(crvRewards, "RewardAdded").withArgs(queuedRewards);
            // and update state
            expect(await crvRewards.historicalRewards(), "historic rewards").to.be.eq(
                historicalRewards.add(queuedRewards),
            );
            expect(await crvRewards.queuedRewards(), "queued rewards").to.be.eq(ZERO);
            expect(await crvRewards.currentRewards(), "current rewards").to.be.eq(queuedRewards);
        });
    });

    describe("edge cases", async () => {
        before(async () => {
            await setup();
        });
        it("initialize fails if initialize is caller is not the owner", async () => {
            await expect(
                booster.connect(deployer.signer).initialize(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS),
                "onlyOwner",
            ).to.be.revertedWith("!auth");
        });
        it("initialize fails if called more than once", async () => {
            const boosterOwner = await booster.owner();
            const ownerAccount = await impersonateAccount(boosterOwner);
            expect(await booster.crv(), "crv").to.not.be.eq(ZERO_ADDRESS);
            await expect(
                booster.connect(ownerAccount.signer).initialize(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS),
                "only once",
            ).to.be.revertedWith("Only once");
        });
    });
});
