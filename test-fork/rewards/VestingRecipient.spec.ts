import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers, network } from "hardhat";
import { config } from "../../tasks/deploy/mainnet-config";

import {
    AuraLocker,
    AuraMerkleDropV2,
    AuraMerkleDropV2__factory,
    AuraVestedEscrow,
    ERC20,
    IAuraBribe__factory,
    IDelegateRegistry__factory,
    VestingRecipient,
} from "../../types/generated";
import { Account } from "../../types";
import { impersonate, impersonateAccount } from "../../test-utils/fork";
import { BN, simpleToExactAmount } from "../../test-utils/math";
import { ONE_WEEK, ZERO_ADDRESS } from "../../test-utils/constants";
import { getTimestamp, increaseTime, increaseTimeTo } from "../../test-utils/time";
import { Phase2Deployed, Phase6Deployed, deployVestingRecipients } from "../../scripts/deploySystem";
import MerkleTree from "merkletreejs";
import { createTreeWithAccounts, getAccountBalanceProof } from "../../test-utils";

const debug = false;
const ALCHEMY_API_KEY = process.env.NODE_URL;

const testAccounts = {
    rando: "0x0000000000000000000000000000000000000002",
    alice: "0x0000000000000000000000000000000000000003",
    bob: "0x0000000000000000000000000000000000000004",
    deployer: "0xA28ea848801da877E1844F954FF388e857d405e5",
};

describe("VestingRecipient", () => {
    let phase2: Phase2Deployed;
    let contracts: Phase6Deployed;
    let aura: ERC20;
    let auraLocker: AuraLocker;
    let vestedEscrow: AuraVestedEscrow;

    let deployer: Signer;
    let protocolDao: Signer;

    let rando: Account;
    let alice: Account;
    let bob: Account;

    let deployerAddress: string;

    let vestingRecipient: VestingRecipient;
    let bobVestingRecipient: VestingRecipient;
    let vestingRecipients: VestingRecipient[];

    let initTime: number;
    const eoaRecipients = [
        { address: testAccounts.alice, amount: simpleToExactAmount(100) },
        { address: testAccounts.bob, amount: simpleToExactAmount(200) },
    ];

    const vestingPeriod = ONE_WEEK.mul(53);

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
        deployerAddress = testAccounts.deployer;
        deployer = await impersonate(deployerAddress);
        alice = await impersonateAccount(testAccounts.alice);
        bob = await impersonateAccount(testAccounts.bob);
        rando = await impersonateAccount(testAccounts.rando);

        await impersonateAccount(config.multisigs.daoMultisig);
        protocolDao = await ethers.getSigner(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(protocolDao);
        contracts = await config.getPhase6(protocolDao);

        // boosterV2
        const operatorAccount = await impersonateAccount(contracts.booster.address);

        await phase2.cvx.connect(operatorAccount.signer).mint(deployerAddress, simpleToExactAmount(10000, 18));

        aura = phase2.cvx.connect(deployer) as ERC20;
        auraLocker = phase2.cvxLocker.connect(deployer);

        // 1- Deploy Vested Escrow
        // 2- Deploy Recipient Factory + Vesting Recipient Implementation
        // 3- Create Vesting Recipient for each EOA
        const vestingDeployed = await deployVestingRecipients(
            hre,
            deployer,
            phase2,
            config.multisigs,
            {
                vestedEscrow: { vestingPeriod },
                vesting: eoaRecipients.map(r => ({ vestingOwnerAddress: r.address })),
            },
            debug,
        );

        vestedEscrow = vestingDeployed.vestedEscrow;
        vestingRecipients = vestingDeployed.vestingRecipients;

        initTime = (await getTimestamp()).toNumber() - 1; // 1 blocks since creation

        // 4.- Fund the vested escrow, via the smart contract vesting recipients.
        await aura.approve(
            vestedEscrow.address,
            eoaRecipients.map(r => r.amount).reduce((a, b) => a.add(b)),
        );
        await vestedEscrow.fund(
            vestingRecipients.map(vr => vr.address),
            eoaRecipients.map(r => r.amount),
        );

        // For tests use the first vesting recipient
        vestingRecipient = vestingRecipients[0].connect(alice.signer);
        bobVestingRecipient = vestingRecipients[1].connect(bob.signer);
    });
    it("has correct initial config", async () => {
        const unlockTime = await vestingRecipient.UNLOCK_DURATION();
        expect(await vestingRecipient.owner()).eq(eoaRecipients[0].address);
        expect(await vestingRecipient.vesting()).eq(vestedEscrow.address);
        expect(await vestingRecipient.auraLocker()).eq(auraLocker.address);
        expect(await vestingRecipient.unlockTime()).eq(unlockTime.add(initTime));
    });
    describe("admin fns", () => {
        it("cannot re-init", async () => {
            await expect(vestingRecipient.init(vestedEscrow.address, testAccounts.rando)).to.be.revertedWith(
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
        it("verify funds on vested escrow", async () => {
            const balAfter = await aura.balanceOf(vestedEscrow.address);
            expect(balAfter, "vested total locked eq to funded amount").eq(simpleToExactAmount(300));
            expect(
                await vestedEscrow.totalLocked(vestingRecipient.address),
                "vested total locked for account index 0",
            ).eq(simpleToExactAmount(100));
        });
        it("alice claim rewards", async () => {
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
        it("bob claim rewards and locks", async () => {
            const available = await vestedEscrow.available(bobVestingRecipient.address);
            const balBefore = await phase2.cvx.balanceOf(bobVestingRecipient.address);
            const withdrawableBefore = await bobVestingRecipient.maxWithdrawable();
            const totalClaimedBefore = await vestedEscrow.totalClaimed(bobVestingRecipient.address);
            expect(withdrawableBefore, "vesting recipient withdrawable").eq(0);
            // Claim without locking
            await bobVestingRecipient.claim(true);
            const balAfter = await phase2.cvx.balanceOf(bobVestingRecipient.address);
            const withdrawableAfter = await bobVestingRecipient.maxWithdrawable();
            const totalClaimedAfter = await vestedEscrow.totalClaimed(bobVestingRecipient.address);
            const claimed = totalClaimedAfter.sub(totalClaimedBefore);

            expect(balAfter.sub(balBefore), "recipient balance does not increase").eq(0);
            // Claimed could be gte due to the block timestamp calculation.
            expect(claimed, "claimed amount").gte(available);
            expect(withdrawableAfter, "vesting recipient withdrawable").eq(totalClaimedAfter.div(2));
        });
        it("alice lock AURA", async () => {
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
            const bobWithdrawableBefore = await bobVestingRecipient.maxWithdrawable();
            const totalClaimedBefore = await vestedEscrow.totalClaimed(vestingRecipient.address);

            expect(withdrawableBefore, "vesting recipient withdrawable").gt(0);

            // Test claim without locking for the second time.
            await vestingRecipient.claim(false);

            // Then
            const balAfter = await phase2.cvx.balanceOf(vestingRecipient.address);
            const withdrawableAfter = await vestingRecipient.maxWithdrawable();
            const bobWithdrawableAfter = await bobVestingRecipient.maxWithdrawable();

            const totalClaimedAfter = await vestedEscrow.totalClaimed(vestingRecipient.address);
            const claimed = balAfter.sub(balBefore);
            expect(totalClaimedAfter, "Total claimed increases").eq(totalClaimedBefore.add(claimed));
            // Claimed could be gte due to the block timestamp calculation.
            expect(claimed, "Claimed amount").gte(available);
            expect(withdrawableAfter, "vesting recipient withdrawable").eq(totalClaimedAfter.div(2));
            expect(bobWithdrawableBefore, "Bob claimed amount should not change").eq(bobWithdrawableAfter);
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

            const balBefore = await phase2.cvx.balanceOf(alice.address);
            await vestingRecipient.withdrawERC20(phase2.cvx.address, withdrawAmount);
            const balAfter = await phase2.cvx.balanceOf(alice.address);
            expect(balAfter.sub(balBefore), "withdrawERC20").eq(withdrawAmount);
        });
        it("withdraw rewards after unlock time", async () => {
            const unlockTime = await vestingRecipient.unlockTime();
            await increaseTimeTo(unlockTime);

            const balance = await phase2.cvx.balanceOf(vestingRecipient.address);
            const balBefore = await phase2.cvx.balanceOf(alice.address);
            // Test
            await vestingRecipient.withdrawERC20(phase2.cvx.address, balance);
            const balAfter = await phase2.cvx.balanceOf(alice.address);
            expect(balAfter.sub(balBefore)).eq(balance);
        });
        it("withdraw rewards from locker and vesting recipient", async () => {
            await vestingRecipient.processExpiredLocks(false);

            const balance = await phase2.cvx.balanceOf(vestingRecipient.address);

            const balBefore = await phase2.cvx.balanceOf(alice.address);
            await vestingRecipient.withdrawERC20(phase2.cvx.address, balance);
            const balAfter = await phase2.cvx.balanceOf(alice.address);
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
            const auraBribeAddress = "0x642c59937A62cf7dc92F70Fd78A13cEe0aa2Bd9c";

            it("set rewardForward", async () => {
                const auraBribe = IAuraBribe__factory.connect(auraBribeAddress, deployer);
                const oldRewardForwarding = await auraBribe.rewardForwarding(vestingRecipient.address);
                expect(oldRewardForwarding).to.be.eq(ZERO_ADDRESS);

                // Sets EOA on hidden hands
                const encodedCallData = auraBribe.interface.encodeFunctionData("setRewardForwarding", [
                    testAccounts.alice,
                ]);

                await vestingRecipient.execute(auraBribe.address, 0, encodedCallData);

                expect(await auraBribe.rewardForwarding(vestingRecipient.address), "rewardForwarding").to.eq(
                    testAccounts.alice,
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
