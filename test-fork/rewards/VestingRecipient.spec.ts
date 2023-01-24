import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers, network } from "hardhat";
import { config } from "../../tasks/deploy/mainnet-config";

import {
    AuraLocker,
    AuraMerkleDropV2,
    AuraMerkleDropV2__factory,
    AuraVestedEscrow,
    AuraVestedEscrow__factory,
    ERC20,
    IAuraBribe__factory,
    IDelegateRegistry__factory,
    VestingRecipient,
    VestingRecipientFactory,
    VestingRecipientFactory__factory,
    VestingRecipient__factory,
} from "../../types/generated";
import { Account } from "../../types";
import { deployContract } from "../../tasks/utils";
import { impersonate, impersonateAccount } from "../../test-utils/fork";
import { BN, simpleToExactAmount } from "../../test-utils/math";
import { ONE_WEEK, ZERO_ADDRESS } from "../../test-utils/constants";
import { getTimestamp, increaseTime, increaseTimeTo } from "../../test-utils/time";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import MerkleTree from "merkletreejs";
import { createTreeWithAccounts, getAccountBalanceProof } from "../../test-utils";

const debug = false;
const ALCHEMY_API_KEY = process.env.NODE_URL;

describe("AuraVestedEscrow", () => {
    let phase2: Phase2Deployed;
    let contracts: Phase6Deployed;
    let aura: ERC20;
    let auraLocker: AuraLocker;
    let vestedEscrow: AuraVestedEscrow;

    let deployTime: BN;

    let deployer: Signer;
    let rando: Account;
    let deployerAddress: string;

    let fundAdminAddress: string;
    let protocolDao: Signer;

    let vestingRecipient: VestingRecipient;
    let vestingRecipientFactory: VestingRecipientFactory;
    let initTime: number;

    before(async () => {
        // Resets network
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: ALCHEMY_API_KEY,
                        blockNumber: 16469700,
                    },
                },
            ],
        });
        // Setup configurations
        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        deployer = await impersonate(deployerAddress);

        await impersonateAccount(config.multisigs.daoMultisig);
        protocolDao = await ethers.getSigner(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(protocolDao);
        contracts = await config.getPhase6(protocolDao);

        fundAdminAddress = config.multisigs.daoMultisig;

        // boosterV2
        const operatorAccount = await impersonateAccount(contracts.booster.address);

        await phase2.cvx.connect(operatorAccount.signer).mint(deployerAddress, simpleToExactAmount(10000, 18));

        aura = phase2.cvx.connect(deployer) as ERC20;
        auraLocker = phase2.cvxLocker.connect(deployer);

        deployTime = await getTimestamp();
        vestedEscrow = await new AuraVestedEscrow__factory(deployer).deploy(
            aura.address,
            fundAdminAddress,
            auraLocker.address,
            deployTime.add(ONE_WEEK),
            deployTime.add(ONE_WEEK.mul(53)),
        );

        rando = await impersonateAccount("0x0000000000000000000000000000000000000002");

        // Deploys vesting recipient
        const vestingRecipientImplementation = await deployContract<VestingRecipient>(
            hre,
            new VestingRecipient__factory(deployer),
            "VestingRecipient",
            [vestedEscrow.address, auraLocker.address],
            {},
            debug,
        );

        vestingRecipientFactory = await deployContract<VestingRecipientFactory>(
            hre,
            new VestingRecipientFactory__factory(deployer),
            "vestingRecipientFactory",
            [vestingRecipientImplementation.address],
            {},
            debug,
        );

        const tx = await vestingRecipientFactory.create(deployerAddress);
        const resp = await tx.wait();
        initTime = (await ethers.provider.getBlock(tx.blockNumber)).timestamp;
        const createEvent = resp.events.find(({ event }) => event === "Created");
        vestingRecipient = VestingRecipient__factory.connect(createEvent.args.vestingRecipient, deployer);
    });
    it("has correct initial config", async () => {
        const unlockTime = await vestingRecipient.UNLOCK_DURATION();
        expect(await vestingRecipient.owner()).eq(deployerAddress);
        expect(await vestingRecipient.vesting()).eq(vestedEscrow.address);
        expect(await vestingRecipient.auraLocker()).eq(auraLocker.address);
        expect(await vestingRecipient.unlockTime()).eq(unlockTime.add(initTime));
    });
    describe("admin fns", () => {
        it("cannot re-init", async () => {
            await expect(vestingRecipient.init("0x0000000000000000000000000000000000000002")).to.be.revertedWith(
                "Initializable: contract is already initialized",
            );
        });
        it("cannot execute forbidden contracts", async () => {
            await expect(vestingRecipient.execute(phase2.cvx.address, 0, [])).to.be.revertedWith("to==rewardToken");
            await expect(vestingRecipient.execute(auraLocker.address, 0, [])).to.be.revertedWith("to==auraLocker");
        });
        it("owner protected functions", async () => {
            const vestingRecipientNotOwner = vestingRecipient.connect(rando.signer);
            await expect(vestingRecipientNotOwner.setOwner(ZERO_ADDRESS)).to.be.revertedWith("!owner");
            await expect(vestingRecipientNotOwner.claim(false)).to.be.revertedWith("!owner");
            await expect(vestingRecipientNotOwner.withdrawERC20(phase2.cvx.address, 1)).to.be.revertedWith("!owner");
            await expect(vestingRecipientNotOwner.lock(1)).to.be.revertedWith("!owner");
            await expect(vestingRecipientNotOwner.processExpiredLocks(true)).to.be.revertedWith("!owner");
            await expect(vestingRecipientNotOwner.delegate(ZERO_ADDRESS)).to.be.revertedWith("!owner");
            await expect(vestingRecipientNotOwner.execute(ZERO_ADDRESS, 0, [])).to.be.revertedWith("!owner");
        });
    });
    describe("basic flow", async () => {
        it("fund on vested escrow", async () => {
            const balBefore = await aura.balanceOf(vestedEscrow.address);
            await aura.approve(vestedEscrow.address, simpleToExactAmount(200));
            await vestedEscrow.fund([vestingRecipient.address], [simpleToExactAmount(200)]);
            const balAfter = await aura.balanceOf(vestedEscrow.address);
            expect(balAfter).eq(balBefore.add(simpleToExactAmount(200)));

            expect(
                await vestedEscrow.totalLocked(vestingRecipient.address),
                "vested total locked eq to funded amount",
            ).eq(simpleToExactAmount(200));
        });
        it("claim rewards", async () => {
            // Claim rewards from the vestedEscrow  into  vestingRecipient
            await increaseTime(ONE_WEEK.mul(27));

            const available = await vestedEscrow.available(vestingRecipient.address);
            const balBefore = await phase2.cvx.balanceOf(vestingRecipient.address);
            const withdrawableBefore = await vestingRecipient.maxWithdrawable();
            expect(withdrawableBefore, "vesting recipient withdrawable").eq(0);
            // Claim without locking
            await vestingRecipient.claim(false);
            const balAfter = await phase2.cvx.balanceOf(vestingRecipient.address);
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
            const cvxBalBefore = await phase2.cvx.balanceOf(vestingRecipient.address);
            const balBefore = await auraLocker.balances(vestingRecipient.address);
            expect(balBefore.locked, "vestingRecipient locked aura").eq(0);

            // Test
            await vestingRecipient.lock(cvxBalBefore);

            const balAfter = await auraLocker.balances(vestingRecipient.address);
            expect(balAfter.locked).eq(cvxBalBefore);
        });
        it("delegate aura locker votes", async () => {
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
            const balBefore = await phase2.cvx.balanceOf(vestingRecipient.address);
            const withdrawableBefore = await vestingRecipient.maxWithdrawable();
            const totalClaimedBefore = await vestedEscrow.totalClaimed(vestingRecipient.address);

            expect(withdrawableBefore, "vesting recipient withdrawable").gt(0);

            // Test claim without locking for the second time.
            await vestingRecipient.claim(false);
            const balAfter = await phase2.cvx.balanceOf(vestingRecipient.address);
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
            await expect(vestingRecipient.withdrawERC20(phase2.cvx.address, totalClaimed)).to.be.revertedWith(
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

            const balBefore = await phase2.cvx.balanceOf(deployerAddress);
            await vestingRecipient.withdrawERC20(phase2.cvx.address, withdrawAmount);
            const balAfter = await phase2.cvx.balanceOf(deployerAddress);
            expect(balAfter.sub(balBefore), "withdrawERC20").eq(withdrawAmount);
        });
        it("withdraw rewards after unlock time", async () => {
            const unlockTime = await vestingRecipient.unlockTime();
            await increaseTimeTo(unlockTime);

            const balance = await phase2.cvx.balanceOf(vestingRecipient.address);
            const balBefore = await phase2.cvx.balanceOf(deployerAddress);
            // Test
            await vestingRecipient.withdrawERC20(phase2.cvx.address, balance);
            const balAfter = await phase2.cvx.balanceOf(deployerAddress);
            expect(balAfter.sub(balBefore)).eq(balance);
        });
        it("withdraw rewards from locker and vesting recipient", async () => {
            await vestingRecipient.processExpiredLocks(false);

            const balance = await phase2.cvx.balanceOf(vestingRecipient.address);

            const balBefore = await phase2.cvx.balanceOf(deployerAddress);
            await vestingRecipient.withdrawERC20(phase2.cvx.address, balance);
            const balAfter = await phase2.cvx.balanceOf(deployerAddress);
            expect(balAfter.sub(balBefore)).eq(balance);
        });
    });
    context("external integrations", async () => {
        describe("claims MerkleDrop via execute fn", () => {
            let tree: MerkleTree;
            let dropAmount: BN;
            let merkleDrop: AuraMerkleDropV2;

            before(async () => {
                dropAmount = simpleToExactAmount(300);
                const amount = simpleToExactAmount(100);
                tree = createTreeWithAccounts({
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
                expect(await aura.balanceOf(vestingRecipient.address), "user aura balance").to.eq(
                    userAuraBalanceBefore,
                );
                expect((await auraLocker.balances(vestingRecipient.address)).locked, "user aura locked balance").to.eq(
                    userBalanceBefore.locked.add(amount),
                );
                expect(await merkleDrop.hasClaimed(vestingRecipient.address), "user claimed").to.eq(true);
            });
        });
        describe("hidden hands", () => {
            // 0x0b139682D5C9Df3e735063f46Fb98c689540Cf3A IHHRewardDistributor
            const auraBribeAddress = "0x642c59937A62cf7dc92F70Fd78A13cEe0aa2Bd9c";

            it("set rewardForward", async () => {
                const auraBribe = IAuraBribe__factory.connect(auraBribeAddress, deployer);
                const oldRewardForwarding = await auraBribe.rewardForwarding(vestingRecipient.address);
                expect(oldRewardForwarding).to.be.eq(ZERO_ADDRESS);

                // Sets EOA on hidden hands
                const encodedCallData = auraBribe.interface.encodeFunctionData("setRewardForwarding", [
                    deployerAddress,
                ]);

                await vestingRecipient.execute(auraBribe.address, 0, encodedCallData);

                expect(await auraBribe.rewardForwarding(vestingRecipient.address), "rewardForwarding").to.eq(
                    deployerAddress,
                );
            });
        });
        describe("snapshot", () => {
            const snapShotId = "0x6175726166696e616e63652e6574680000000000000000000000000000000000"; // aura snapshot id
            const delegateeAddress = "0x2ad55394E12016c510D3C35d91Da7d90A758b7FD"; // delegate.aurafinance.eth
            const delegateRegistryAddress = "0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446";

            it("set delegatee", async () => {
                const delegateRegistry = IDelegateRegistry__factory.connect(delegateRegistryAddress, deployer);
                const oldDelegatee = await delegateRegistry.delegation(vestingRecipient.address, snapShotId);
                expect(oldDelegatee).to.be.eq(ZERO_ADDRESS);
                // Test
                const encodedCallData = delegateRegistry.interface.encodeFunctionData("setDelegate", [
                    snapShotId,
                    delegateeAddress,
                ]);

                await vestingRecipient.execute(delegateRegistry.address, 0, encodedCallData);

                expect(await delegateRegistry.delegation(vestingRecipient.address, snapShotId), "delegatee").to.eq(
                    delegateeAddress,
                );
            });
        });
    });
});
