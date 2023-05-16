import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { Account, SidechainMultisigConfig } from "types";

import { DeployL2MocksResult } from "../../scripts/deploySidechainMocks";
import { DEAD_ADDRESS, ONE_DAY, ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import { impersonateAccount } from "../../test-utils/fork";
import {
    BoosterLite,
    BoosterOwnerLite,
    BoosterOwnerLite__factory,
    ExtraRewardStashV3__factory,
    IERC20__factory,
    MockERC20__factory,
} from "../../types/generated";
import { CanonicalPhaseDeployed, SidechainDeployed, sidechainTestSetup } from "../sidechain/sidechainTestSetup";

describe("BoosterLite", () => {
    let accounts: Signer[];
    let booster: BoosterLite;
    let boosterOwner: BoosterOwnerLite;
    let l2mocks: DeployL2MocksResult;
    let l2Multisigs: SidechainMultisigConfig;
    let deployer: Account;
    let dao: Account;

    // Sidechain Contracts
    let sidechain: SidechainDeployed;
    let canonical: CanonicalPhaseDeployed;

    const setup = async () => {
        accounts = await ethers.getSigners();
        const testSetup = await sidechainTestSetup(hre, accounts);
        deployer = testSetup.deployer;
        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);
        canonical = testSetup.l1.canonical;
        l2mocks = testSetup.l2.mocks;
        l2Multisigs = testSetup.l2.multisigs;
        sidechain = testSetup.l2.sidechain;

        ({ booster, boosterOwner } = sidechain);
        // transfer LP tokens to accounts
        const balance = await l2mocks.bpt.balanceOf(deployer.address);
        for (const account of accounts) {
            const accountAddress = await account.getAddress();
            const share = balance.div(accounts.length);
            const tx = await l2mocks.bpt.transfer(accountAddress, share);
            await tx.wait();
        }
    };
    describe("constructor", async () => {
        before(async () => {
            await setup();
        });

        it("should properly store valid arguments", async () => {
            expect(await boosterOwner.poolManager(), "poolManager").to.eq(sidechain.poolManager.address);
            expect(await boosterOwner.booster(), "booster").to.eq(sidechain.booster.address);
            expect(await boosterOwner.stashFactory(), "stashFactory").to.eq(sidechain.factories.stashFactory.address);
            expect(await boosterOwner.rescueStash(), "rescueStash").to.eq(ZERO_ADDRESS);
            expect(await boosterOwner.owner(), "owner").to.eq(dao.address);
            expect(await boosterOwner.pendingowner(), "pendingowner").to.eq(ZERO_ADDRESS);
            expect(await boosterOwner.isSealed(), "isSealed").to.eq(true);
            expect(await boosterOwner.FORCE_DELAY(), "FORCE_DELAY").to.eq(ONE_DAY.mul(30));
            expect(await boosterOwner.isForceTimerStarted(), "isForceTimerStarted").to.eq(false);
            expect(await boosterOwner.forceTimestamp(), "forceTimestamp").to.eq(ZERO);
        });
    });
    describe("Ownership", async () => {
        it("fails if owner is not the caller", async () => {
            boosterOwner = boosterOwner.connect(deployer.signer);
            const owner = await boosterOwner.owner();
            const ERROR_ONLY_OWNER = "!owner";

            expect(owner, " owner ").to.not.be.eq(deployer.address);

            await expect(boosterOwner.sealOwnership(), "fails sealOwnership").to.be.revertedWith(ERROR_ONLY_OWNER);
            await expect(boosterOwner.setBoosterOwner(), "fails setBoosterOwner").to.be.revertedWith(ERROR_ONLY_OWNER);
            await expect(
                boosterOwner.setFactories(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS),
                "fails setFactories",
            ).to.be.revertedWith(ERROR_ONLY_OWNER);
            await expect(boosterOwner.setFeeManager(ZERO_ADDRESS), "fails setFeeManager").to.be.revertedWith(
                ERROR_ONLY_OWNER,
            );
            await expect(boosterOwner.shutdownSystem(), "fails shutdownSystem").to.be.revertedWith(ERROR_ONLY_OWNER);
            await expect(boosterOwner.queueForceShutdown(), "fails queueForceShutdown").to.be.revertedWith(
                ERROR_ONLY_OWNER,
            );
            await expect(boosterOwner.forceShutdownSystem(), "fails forceShutdownSystem").to.be.revertedWith(
                ERROR_ONLY_OWNER,
            );
            await expect(boosterOwner.execute(ZERO_ADDRESS, ZERO_ADDRESS, "0x"), "fails execute").to.be.revertedWith(
                ERROR_ONLY_OWNER,
            );
            await expect(
                boosterOwner.setRescueTokenDistribution(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS),
                "fails setRescueTokenDistribution",
            ).to.be.revertedWith(ERROR_ONLY_OWNER);
            await expect(
                boosterOwner.setRescueTokenReward(ZERO_ADDRESS, ZERO),
                "fails setRescueTokenReward",
            ).to.be.revertedWith(ERROR_ONLY_OWNER);
            await expect(
                boosterOwner.setStashExtraReward(ZERO_ADDRESS, ZERO_ADDRESS),
                "fails setStashExtraReward",
            ).to.be.revertedWith(ERROR_ONLY_OWNER);
            await expect(
                boosterOwner.setStashRewardHook(ZERO_ADDRESS, ZERO_ADDRESS),
                "fails setStashRewardHook",
            ).to.be.revertedWith(ERROR_ONLY_OWNER);
            await expect(
                boosterOwner.setStashFactoryImplementation(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS),
                "fails setStashFactoryImplementation",
            ).to.be.revertedWith(ERROR_ONLY_OWNER);
            await expect(boosterOwner.transferOwnership(ZERO_ADDRESS), "fails transferOwnership").to.be.revertedWith(
                ERROR_ONLY_OWNER,
            );
        });
        it("transferOwnership should ", async () => {
            const owner = await boosterOwner.owner();
            expect(owner, "owner").to.be.eq(dao.address);

            // Transfer ownership
            let tx = await boosterOwner.connect(dao.signer).transferOwnership(deployer.address);
            await expect(tx).to.emit(boosterOwner, "TransferOwnership").withArgs(deployer.address);

            const pendingowner = await boosterOwner.pendingowner();
            expect(pendingowner, "pending owner").to.be.eq(deployer.address);

            // Only pending owner can accepts ownership
            await expect(
                boosterOwner.connect(dao.signer).acceptOwnership(),
                "fails acceptOwnership",
            ).to.be.revertedWith("!pendingowner");

            tx = await boosterOwner.connect(deployer.signer).acceptOwnership();
            await expect(tx).to.emit(boosterOwner, "AcceptedOwnership").withArgs(deployer.address);

            expect(await boosterOwner.pendingowner(), "pending owner").to.be.eq(ZERO_ADDRESS);
        });
        describe("seal booster ownership", async () => {
            let boosterOwnerOwnerAcc: Account;
            let boosterOwnerAcc: Account;
            before(async () => {
                boosterOwnerOwnerAcc = await impersonateAccount(await boosterOwner.owner());
                boosterOwnerAcc = await impersonateAccount(await booster.owner());
            });
            it("transfer back booster ownership to eoa", async () => {
                const bOwner = await new BoosterOwnerLite__factory(deployer.signer).deploy(
                    deployer.address,
                    ZERO_ADDRESS,
                    booster.address,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    false,
                );
                expect(await bOwner.isSealed(), "booster owner is not sealed").to.be.eq(false);

                // Force setting the booster owner to the new boosterOwner contract.
                await booster.connect(boosterOwnerAcc.signer).setOwner(bOwner.address);

                const tx = await bOwner.setBoosterOwner();
                await expect(tx).to.emit(booster, "OwnerUpdated").withArgs(boosterOwnerOwnerAcc.address);
                expect(await boosterOwner.owner()).to.be.eq(await booster.owner());

                // revert changes
                await booster.connect(boosterOwnerOwnerAcc.signer).setOwner(boosterOwner.address);
            });

            it("seal booster ownership forever", async () => {
                let tx = await boosterOwner.connect(boosterOwnerOwnerAcc.signer).sealOwnership();
                await expect(tx).to.emit(boosterOwner, "OwnershipSealed");
            });
            it("fails setting booster owner if it is sealed ", async () => {
                expect(await boosterOwner.isSealed(), "booster owner is sealed").to.be.eq(true);
                await expect(
                    boosterOwner.connect(boosterOwnerOwnerAcc.signer).setBoosterOwner(),
                    "setBoosterOwner fails",
                ).to.be.revertedWith("ownership sealed");
            });
        });
    });
    describe("allows boosterOwner to call all fns on booster", async () => {
        let boosterOwnerOwnerAcc: Account;
        before(async () => {
            boosterOwnerOwnerAcc = await impersonateAccount(await boosterOwner.owner());
        });
        it("setFactories", async () => {
            const tx = await boosterOwner
                .connect(boosterOwnerOwnerAcc.signer)
                .setFactories(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS);
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(booster, "FactoriesUpdated").withArgs(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS);
            expect(await booster.stashFactory()).eq(ZERO_ADDRESS);
            expect(await booster.tokenFactory()).not.eq(ZERO_ADDRESS);
            expect(await booster.rewardFactory()).not.eq(ZERO_ADDRESS);
        });
        it("setFeeManager", async () => {
            const tx = await boosterOwner.connect(boosterOwnerOwnerAcc.signer).setFeeManager(l2Multisigs.daoMultisig);
            expect(await booster.feeManager()).eq(l2Multisigs.daoMultisig);

            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(booster, "FeeManagerUpdated").withArgs(l2Multisigs.daoMultisig);
            expect(await booster.feeManager()).eq(l2Multisigs.daoMultisig);
        });
    });
    describe("execute an arbitrary fn ", async () => {
        let boosterOwnerOwnerAcc: Account;
        before(async () => {
            boosterOwnerOwnerAcc = await impersonateAccount(await boosterOwner.owner());
        });
        it("Can call execute", async () => {
            const token = IERC20__factory.connect(l2mocks.addresses.token, dao.signer);
            expect(await token.allowance(boosterOwner.address, booster.address)).eq(0);

            const calldata = token.interface.encodeFunctionData("approve", [booster.address, 100]);

            await boosterOwner.connect(boosterOwnerOwnerAcc.signer).execute(token.address, 0, calldata);
            expect(await token.allowance(boosterOwner.address, booster.address)).to.be.eq(100);
        });
        it("fails if target booster", async () => {
            await expect(
                boosterOwner.connect(boosterOwnerOwnerAcc.signer).execute(booster.address, 0, "0x"),
                "fails due to ",
            ).to.be.revertedWith("!invalid target");
        });
    });
    describe("helper functions for other systems", async () => {
        let boosterOwnerOwnerAcc: Account;
        before(async () => {
            boosterOwnerOwnerAcc = await impersonateAccount(await boosterOwner.owner());
            boosterOwner = boosterOwner.connect(boosterOwnerOwnerAcc.signer);
        });
        xit("can call rescueStash, needs ExtraRewardStashTokenRescue", async () => {
            let tx = await boosterOwner.setRescueTokenDistribution(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS);
            tx = await boosterOwner.setRescueTokenReward(ZERO_ADDRESS, ZERO);

            tx = await boosterOwner.setStashFactoryImplementation(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS);
        });
        it("set stash extra rewards", async () => {
            const token = await new MockERC20__factory(deployer.signer).deploy(
                "mockWETH",
                "mockWETH",
                18,
                deployer.address,
                10000000,
            );
            const poolInfo = await booster.poolInfo(0);
            const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer.signer);
            const tokenCount = await stash.tokenCount();
            // When sets an extra reward

            await boosterOwner.setStashExtraReward(poolInfo.stash, token.address);

            // Then
            const tokenInfo = await stash.tokenInfo(token.address);
            expect(await stash.tokenCount(), "stash token count").to.be.eq(tokenCount.add(1));
            expect(tokenInfo.token, "token").to.be.eq(token.address);
        });

        it("set stash reward hook", async () => {
            const poolInfo = await booster.poolInfo(0);
            const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer.signer);

            // When sets an extra reward
            await boosterOwner.setStashRewardHook(poolInfo.stash, DEAD_ADDRESS);

            // Then
            expect(await stash.rewardHook(), "rewardHook").to.be.eq(DEAD_ADDRESS);
        });
    });
    describe.skip("shutdownSystem", async () => {
        // shutdownSystem, queueForceShutdown, forceShutdownSystem
    });
});
