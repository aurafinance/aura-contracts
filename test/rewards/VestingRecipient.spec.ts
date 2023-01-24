import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";

import {
    AuraLocker,
    AuraMerkleDropV2,
    AuraMerkleDropV2__factory,
    AuraVestedEscrow,
    AuraVestedEscrow__factory,
    ERC20,
    MockBalancerPoolToken__factory,
    MockBalancerVault__factory,
    VestingRecipient,
    VestingRecipientFactory,
    VestingRecipientFactory__factory,
    VestingRecipient__factory,
} from "../../types/generated";
import { Account } from "../../types";
import { deployContract } from "../../tasks/utils";
import { impersonateAccount } from "../../test-utils/fork";
import { BN, simpleToExactAmount } from "../../test-utils/math";
import { ONE_WEEK, ZERO_ADDRESS } from "../../test-utils/constants";
import { getTimestamp, increaseTime, increaseTimeTo } from "../../test-utils/time";
import { deployPhase1, deployPhase2, Phase2Deployed } from "../../scripts/deploySystem";
import { DeployMocksResult, deployMocks, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import MerkleTree from "merkletreejs";
import { createTreeWithAccounts, getAccountBalanceProof } from "../../test-utils";
import { JoinPoolRequestStruct } from "types/generated/MockBalancerVault";

const debug = false;

describe("AuraVestedEscrow", () => {
    let accounts: Signer[];

    let contracts: Phase2Deployed;
    let aura: ERC20;
    let auraLocker: AuraLocker;
    let vestedEscrow: AuraVestedEscrow;

    let deployTime: BN;

    let deployer: Signer;
    let rando: Account;
    let deployerAddress: string;

    let fundAdmin: Signer;
    let fundAdminAddress: string;

    let vestingRecipient: VestingRecipient;
    let vestingRecipientFactory: VestingRecipientFactory;
    let initTime: number;
    let mocks: DeployMocksResult;

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];

        mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(hre, deployer, mocks.addresses, true, debug);
        contracts = await deployPhase2(
            hre,
            deployer,
            phase1,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
            debug,
        );

        deployerAddress = await deployer.getAddress();

        fundAdmin = accounts[1];
        fundAdminAddress = await fundAdmin.getAddress();

        const operatorAccount = await impersonateAccount(contracts.booster.address);
        await contracts.cvx
            .connect(operatorAccount.signer)
            .mint(operatorAccount.address, simpleToExactAmount(100000, 18));
        await contracts.cvx.connect(operatorAccount.signer).transfer(deployerAddress, simpleToExactAmount(1000));

        aura = contracts.cvx.connect(deployer) as ERC20;
        auraLocker = contracts.cvxLocker.connect(deployer);

        deployTime = await getTimestamp();
        vestedEscrow = await new AuraVestedEscrow__factory(deployer).deploy(
            aura.address,
            fundAdminAddress,
            auraLocker.address,
            deployTime.add(ONE_WEEK),
            deployTime.add(ONE_WEEK.mul(53)),
        );

        rando = await impersonateAccount("0x0000000000000000000000000000000000000002");
    });

    it("deploy VestingRecipient", async () => {
        const vestingRecipientImplementation = await deployContract<VestingRecipient>(
            hre,
            new VestingRecipient__factory(deployer),
            "VestingRecipient",
            [vestedEscrow.address, auraLocker.address],
            {},
        );

        vestingRecipientFactory = await deployContract<VestingRecipientFactory>(
            hre,
            new VestingRecipientFactory__factory(deployer),
            "vestingRecipientFactory",
            [vestingRecipientImplementation.address],
            {},
        );

        const tx = await vestingRecipientFactory.create(deployerAddress);
        const resp = await tx.wait();
        initTime = (await ethers.provider.getBlock(tx.blockNumber)).timestamp;
        const createEvent = resp.events.find(({ event }) => event === "Created");
        vestingRecipient = VestingRecipient__factory.connect(createEvent.args.vestingRecipient, deployer);
    });
    it("vesting recipient factory setImplementation", async () => {
        const newImplementation = "0x0000000000000000000000000000000000000002";
        const currentImplementation = await vestingRecipientFactory.implementation();
        await expect(
            vestingRecipientFactory.connect(rando.signer).setImplementation(newImplementation),
        ).to.be.revertedWith("Ownable: caller is not the owner");

        await vestingRecipientFactory.setImplementation(newImplementation);
        expect(await vestingRecipientFactory.implementation()).eq(newImplementation);
        // reset
        await vestingRecipientFactory.setImplementation(currentImplementation);
    });
    it("cannot re-init", async () => {
        await expect(vestingRecipient.init("0x0000000000000000000000000000000000000002")).to.be.revertedWith(
            "Initializable: contract is already initialized",
        );
    });
    it("has the correct config", async () => {
        const unlockTime = await vestingRecipient.UNLOCK_DURATION();
        expect(await vestingRecipient.owner()).eq(deployerAddress);
        expect(await vestingRecipient.vesting()).eq(vestedEscrow.address);
        expect(await vestingRecipient.auraLocker()).eq(auraLocker.address);
        expect(await vestingRecipient.unlockTime()).eq(unlockTime.add(initTime));
    });
    it("fund on vested escrow", async () => {
        const balBefore = await aura.balanceOf(vestedEscrow.address);
        await aura.approve(vestedEscrow.address, simpleToExactAmount(200));
        await vestedEscrow.fund([vestingRecipient.address], [simpleToExactAmount(200)]);
        const balAfter = await aura.balanceOf(vestedEscrow.address);
        expect(balAfter).eq(balBefore.add(simpleToExactAmount(200)));

        expect(await vestedEscrow.totalLocked(vestingRecipient.address), "vested total locked eq to funded amount").eq(
            simpleToExactAmount(200),
        );
    });
    it("owner protected functions", async () => {
        const vestingRecipientNotOwner = vestingRecipient.connect(rando.signer);
        await expect(vestingRecipientNotOwner.setOwner(ZERO_ADDRESS)).to.be.revertedWith("!owner");
        await expect(vestingRecipientNotOwner.claim(false)).to.be.revertedWith("!owner");
        await expect(vestingRecipientNotOwner.withdrawERC20(contracts.cvx.address, 1)).to.be.revertedWith("!owner");
        await expect(vestingRecipientNotOwner.lock(1)).to.be.revertedWith("!owner");
        await expect(vestingRecipientNotOwner.processExpiredLocks(true)).to.be.revertedWith("!owner");
        await expect(vestingRecipientNotOwner.delegate(ZERO_ADDRESS)).to.be.revertedWith("!owner");
        await expect(vestingRecipientNotOwner.execute(ZERO_ADDRESS, 0, [])).to.be.revertedWith("!owner");
    });
    it("update owner", async () => {
        const currentOwner = await vestingRecipient.owner();
        const tx = await vestingRecipient.setOwner(rando.address);
        await expect(tx).to.emit(vestingRecipient, "SetOwner").withArgs(rando.address);

        expect(await vestingRecipient.owner()).eq(rando.address);
        await expect(vestingRecipient.setOwner(currentOwner)).to.be.revertedWith("!owner");
        await vestingRecipient.connect(rando.signer).setOwner(currentOwner);
    });
    it("cannot execute forbidden contracts", async () => {
        await expect(vestingRecipient.execute(contracts.cvx.address, 0, [])).to.be.revertedWith("to==rewardToken");
        await expect(vestingRecipient.execute(auraLocker.address, 0, [])).to.be.revertedWith("to==auraLocker");
    });
    it("withdraw ERC20", async () => {
        it("fund vesting recipient", async () => {
            const amount = simpleToExactAmount(10);
            await mocks.crv.transfer(vestingRecipient.address, amount);
            expect(await mocks.crv.balanceOf(vestingRecipient.address), "vesting recipient balance").to.be.eq(amount);
        });
        it("partial withdraw ERC20 without restrictions on unlock time", async () => {
            const unlockTime = await vestingRecipient.unlockTime();
            const ts = await getTimestamp();
            const balBefore = await mocks.crv.balanceOf(vestingRecipient.address);
            const withdrawAmount = balBefore.div(2);
            const claimedBefore = await vestingRecipient.claimed(mocks.crv.address);

            expect(unlockTime, "unlock time has not expired").gt(ts);
            expect(claimedBefore, "claimed tokens").to.be.eq(0);

            // Test
            await vestingRecipient.withdrawERC20(mocks.crv.address, withdrawAmount);
            const balAfter = mocks.crv.balanceOf(vestingRecipient.address);

            expect(balAfter, "vesting recipient balance").to.be.eq(balBefore.add(withdrawAmount));
            expect(await vestingRecipient.claimed(mocks.crv.address), "claimed tokens").to.be.eq(
                claimedBefore.add(withdrawAmount),
            );
        });
        it("total withdraw ERC20 without restrictions on unlock time", async () => {
            const unlockTime = await vestingRecipient.unlockTime();
            const ts = await getTimestamp();
            const balBefore = await mocks.crv.balanceOf(vestingRecipient.address);
            const withdrawAmount = balBefore;
            const claimedBefore = await vestingRecipient.claimed(mocks.crv.address);

            expect(unlockTime, "unlock time has not expired").gt(ts);
            expect(claimedBefore, "claimed tokens").to.be.gt(0);

            // Test
            await vestingRecipient.withdrawERC20(mocks.crv.address, withdrawAmount);
            const balAfter = mocks.crv.balanceOf(vestingRecipient.address);

            expect(balAfter, "vesting recipient balance").to.be.eq(balBefore.add(withdrawAmount));
            expect(await vestingRecipient.claimed(mocks.crv.address), "claimed tokens").to.be.eq(
                claimedBefore.add(withdrawAmount),
            );
        });
    });
    it("claim rewards", async () => {
        // Claim rewards from the vestedEscrow  into  vestingRecipient
        await increaseTime(ONE_WEEK.mul(27));

        const available = await vestedEscrow.available(vestingRecipient.address);
        const balBefore = await contracts.cvx.balanceOf(vestingRecipient.address);
        const withdrawableBefore = await vestingRecipient.maxWithdrawable();
        expect(withdrawableBefore, "vesting recipient withdrawable").eq(0);
        // Claim without locking
        await vestingRecipient.claim(false);
        const balAfter = await contracts.cvx.balanceOf(vestingRecipient.address);
        const withdrawableAfter = await vestingRecipient.maxWithdrawable();
        const totalClaimedAfter = await vestedEscrow.totalClaimed(vestingRecipient.address);
        const claimed = balAfter.sub(balBefore);

        expect(claimed).gt(0);
        // Claimed could be gte due to the block timestamp calculation.
        expect(claimed, "claimed amount").gte(available);
        expect(totalClaimedAfter).eq(claimed);
        expect(withdrawableAfter, "vesting recipient withdrawable").eq(totalClaimedAfter.div(2));
    });
    it("lock AURA", async () => {
        const cvxBalBefore = await contracts.cvx.balanceOf(vestingRecipient.address);
        const balBefore = await auraLocker.balances(vestingRecipient.address);
        expect(balBefore.locked, "vestingRecipient locked aura").eq(0);

        // Test
        await vestingRecipient.lock(cvxBalBefore);

        const balAfter = await auraLocker.balances(vestingRecipient.address);
        expect(balAfter.locked).eq(cvxBalBefore);
    });
    it("delegate", async () => {
        const currentDelegate = await auraLocker.delegates(vestingRecipient.address);
        expect(currentDelegate).eq(ZERO_ADDRESS);
        const newDelegate = rando.address;
        await vestingRecipient.delegate(newDelegate);
        expect(await auraLocker.delegates(vestingRecipient.address)).eq(newDelegate);
    });
    it("claim rewards more than once", async () => {
        // Claim rewards from the vestedEscrow  into  vestingRecipient
        await increaseTime(ONE_WEEK);

        const available = await vestedEscrow.available(vestingRecipient.address);
        const balBefore = await contracts.cvx.balanceOf(vestingRecipient.address);
        const withdrawableBefore = await vestingRecipient.maxWithdrawable();
        const totalClaimedBefore = await vestedEscrow.totalClaimed(vestingRecipient.address);

        expect(withdrawableBefore, "vesting recipient withdrawable").gt(0);

        // Test claim without locking for the second time.
        await vestingRecipient.claim(false);
        const balAfter = await contracts.cvx.balanceOf(vestingRecipient.address);
        const withdrawableAfter = await vestingRecipient.maxWithdrawable();
        const totalClaimedAfter = await vestedEscrow.totalClaimed(vestingRecipient.address);
        const claimed = balAfter.sub(balBefore);
        expect(totalClaimedAfter, "Total claimed increases").eq(totalClaimedBefore.add(claimed));
        // Claimed could be gte due to the block timestamp calculation.
        expect(claimed, "Claimed amount").gte(available);
        expect(withdrawableAfter, "vesting recipient withdrawable").eq(totalClaimedAfter.div(2));
    });
    it("re-lock AURA after being kicked", async () => {
        await increaseTime(ONE_WEEK.mul(20));
        await auraLocker.kickExpiredLocks(vestingRecipient.address);
        const balances = await auraLocker.balances(vestingRecipient.address);
        expect(balances.locked).eq(0);

        const lockAmount = simpleToExactAmount(10);
        await vestingRecipient.lock(lockAmount);
        const balances0 = await auraLocker.balances(vestingRecipient.address);
        expect(balances0.locked).eq(lockAmount);
    });
    it("fails to withdraw all rewards before unlock time", async () => {
        const ts = await getTimestamp();
        expect(await vestingRecipient.unlockTime()).gt(ts);
        const totalClaimed = await vestedEscrow.totalClaimed(vestingRecipient.address);
        await expect(vestingRecipient.withdrawERC20(contracts.cvx.address, totalClaimed)).to.be.revertedWith(
            "amount>maxWithdrawable",
        );
    });
    it("withdraw rewards before unlock time", async () => {
        const ts = await getTimestamp();
        expect(await vestingRecipient.unlockTime()).gt(ts);

        const withdrawable = await vestingRecipient.maxWithdrawable();
        const totalClaimed = await vestedEscrow.totalClaimed(vestingRecipient.address);
        expect(withdrawable).eq(totalClaimed.div(2));

        const withdrawAmount = simpleToExactAmount(1);
        expect(withdrawAmount).lt(withdrawable);

        const balBefore = await contracts.cvx.balanceOf(deployerAddress);
        await vestingRecipient.withdrawERC20(contracts.cvx.address, withdrawAmount);
        const balAfter = await contracts.cvx.balanceOf(deployerAddress);
        expect(balAfter.sub(balBefore), "withdrawERC20").eq(withdrawAmount);
    });
    it("withdraw rewards after unlock time", async () => {
        const unlockTime = await vestingRecipient.unlockTime();
        await increaseTimeTo(unlockTime);

        const balance = await contracts.cvx.balanceOf(vestingRecipient.address);
        const balBefore = await contracts.cvx.balanceOf(deployerAddress);
        // Test
        await vestingRecipient.withdrawERC20(contracts.cvx.address, balance);
        const balAfter = await contracts.cvx.balanceOf(deployerAddress);
        expect(balAfter.sub(balBefore)).eq(balance);
    });
    it("withdraw rewards from locker and vesting recipient", async () => {
        await vestingRecipient.processExpiredLocks(false);

        const balance = await contracts.cvx.balanceOf(vestingRecipient.address);

        const balBefore = await contracts.cvx.balanceOf(deployerAddress);
        await vestingRecipient.withdrawERC20(contracts.cvx.address, balance);
        const balAfter = await contracts.cvx.balanceOf(deployerAddress);
        expect(balAfter.sub(balBefore)).eq(balance);
    });
    it("before init cannot withdraw", async () => {
        const vestingRecipient = await new VestingRecipient__factory(deployer).deploy(
            vestedEscrow.address,
            auraLocker.address,
        );
        // as the contract has not ben initialized, the owner is not set, therefore it reverts.
        await expect(vestingRecipient.withdrawERC20(contracts.cvx.address, 1)).to.be.revertedWith("!owner");
    });
    describe("claims MerkleDrop via execute fn", () => {
        let tree: MerkleTree;
        let dropAmount: BN;
        let merkleDrop: AuraMerkleDropV2;

        before(async () => {
            dropAmount = simpleToExactAmount(300);
            const amount = simpleToExactAmount(100);
            tree = createTreeWithAccounts({
                [await accounts[2].getAddress()]: amount,
                [await accounts[3].getAddress()]: amount,
                [vestingRecipient.address]: amount,
            });
            merkleDrop = await new AuraMerkleDropV2__factory(deployer).deploy(
                deployerAddress,
                tree.getHexRoot(),
                aura.address,
                auraLocker.address,
                ONE_WEEK,
                ONE_WEEK.mul(16),
            );
            await aura.transfer(merkleDrop.address, dropAmount);
        });
        it("allows claiming and locking ", async () => {
            // Given a merkleDrop
            await increaseTime(ONE_WEEK);
            const amount = simpleToExactAmount(100);
            const lock = true;
            const userAuraBalanceBefore = await aura.balanceOf(vestingRecipient.address);
            const userBalanceBefore = await auraLocker.balances(vestingRecipient.address);
            expect(await merkleDrop.hasClaimed(vestingRecipient.address), "user  has not claimed").to.eq(false);

            // When owner of the vesting recipient claims the merkleDrop and locks it
            const proof = getAccountBalanceProof(tree, vestingRecipient.address, amount);
            const encodedClaimData = merkleDrop.interface.encodeFunctionData("claim", [
                proof,
                amount,
                lock,
                vestingRecipient.address,
            ]);
            const tx = await vestingRecipient.execute(merkleDrop.address, 0, encodedClaimData);

            // Then the locked amount of the vesting recipient increases.
            await expect(tx).to.emit(merkleDrop, "Claimed").withArgs(vestingRecipient.address, amount, lock);
            expect(await aura.balanceOf(vestingRecipient.address), "user aura balance").to.eq(userAuraBalanceBefore);
            expect((await auraLocker.balances(vestingRecipient.address)).locked, "user aura locked balance").to.eq(
                userBalanceBefore.locked.add(amount),
            );
            expect(await merkleDrop.hasClaimed(vestingRecipient.address), "user claimed").to.eq(true);
        });
        it("should revert if fall success fails", async () => {
            // Given a merkleDrop
            await increaseTime(ONE_WEEK);
            const crazyAmount = simpleToExactAmount(1000000);
            const lock = true;

            // When owner of the vesting recipient claims the merkleDrop and locks it
            const proof = getAccountBalanceProof(tree, vestingRecipient.address, crazyAmount);
            const encodedClaimData = merkleDrop.interface.encodeFunctionData("claim", [
                proof,
                crazyAmount,
                lock,
                vestingRecipient.address,
            ]);
            await expect(
                vestingRecipient.execute(merkleDrop.address, 0, encodedClaimData),
                "wrong amount",
            ).to.be.revertedWith("!success");
        });
    });
    it("join pool send eth on tx", async () => {
        const poolContract = await new MockBalancerPoolToken__factory(deployer).deploy(
            18,
            await deployer.getAddress(),
            simpleToExactAmount(0),
        );
        await poolContract.setPrice(simpleToExactAmount(1));

        const bVault = await new MockBalancerVault__factory(deployer).deploy(poolContract.address);
        const poolTokens = ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", poolContract.address];
        const maxAmountsIn = [simpleToExactAmount(1), simpleToExactAmount(1)];

        const joinPoolRequest: JoinPoolRequestStruct = {
            assets: poolTokens,
            maxAmountsIn: maxAmountsIn,
            userData: ethers.utils.defaultAbiCoder.encode(["uint256", "uint256[]"], [0, maxAmountsIn]),
            fromInternalBalance: false,
        };
        const encodedJoinPool = bVault.interface.encodeFunctionData("joinPool", [
            "0x06df3b2bbb68adc8b0e302443692037ed9f91b42000000000000000000000063",
            vestingRecipient.address,
            vestingRecipient.address,
            joinPoolRequest,
        ]);

        const balBefore = await poolContract.balanceOf(vestingRecipient.address);
        expect(balBefore, "balancer before").eq(0);

        await vestingRecipient.execute(bVault.address, maxAmountsIn[0], encodedJoinPool, { value: maxAmountsIn[0] });
        const balAfter = await poolContract.balanceOf(vestingRecipient.address);
        expect(balAfter, "balancer after").eq(maxAmountsIn[1]);
    });
});
