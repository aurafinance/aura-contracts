import { expect } from "chai";
import { Signer } from "ethers";
import hre, { network } from "hardhat";
import { deployAuraLockerModule } from "../../scripts/deployPeripheral";
import { Phase2Deployed } from "../../scripts/deploySystem";
import { config } from "../../tasks/deploy/mainnet-config";
import { impersonate, increaseTime, increaseTimeTo, ONE_DAY } from "../../test-utils";
import { AuraLockerModule, ISafe, ISafe__factory } from "../../types";

describe("AuraLockerModule", () => {
    let treasuryMultisig: Signer;
    let deployer: Signer;
    let deployerAddress: string;
    let contracts: Phase2Deployed;
    let auraLockerModule: AuraLockerModule;
    let safe: ISafe;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 22167715,
                    },
                },
            ],
        });
        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        deployer = await impersonate(deployerAddress, true);
        treasuryMultisig = await impersonate(config.multisigs.treasuryMultisig, true);
        contracts = await config.getPhase2(deployer);

        safe = ISafe__factory.connect(config.multisigs.treasuryMultisig, treasuryMultisig);
    });
    describe("setup", async () => {
        it("deploys module", async () => {
            ({ auraLockerModule } = await deployAuraLockerModule(hre, deployer, config.multisigs, {
                cvxLocker: contracts.cvxLocker,
            }));

            expect(await auraLockerModule.owner(), "owner").to.be.eq(config.multisigs.treasuryMultisig);
            expect(await auraLockerModule.safeWallet(), "safeWallet").to.be.eq(config.multisigs.treasuryMultisig);
            expect(await auraLockerModule.auraLocker(), "safeWallet").to.be.eq(contracts.cvxLocker.address);
        });

        it("configures the module", async () => {
            expect(await safe.isModuleEnabled(auraLockerModule.address), "isEnabled").to.be.eq(false);
            await safe.enableModule(auraLockerModule.address);
            expect(await safe.isModuleEnabled(auraLockerModule.address), "isEnabled").to.be.eq(true);
        });
    });
    describe("module functions", async () => {
        it("fails if keeper is not the caller", async () => {
            const authorizedKeepers = await auraLockerModule.authorizedKeepers(await deployer.getAddress());
            expect(authorizedKeepers, "authorizedKeepers").to.be.eq(false);
            await expect(auraLockerModule.connect(deployer).processExpiredLocks()).to.be.revertedWith("!keeper");
        });
        it("retrieve lockedBalances", async () => {
            const expectedLockedBalances = await contracts.cvxLocker.lockedBalances(config.multisigs.treasuryMultisig);
            const lockedBalances = await auraLockerModule.lockedBalances();

            expect(expectedLockedBalances.total, "total ").to.be.eq(lockedBalances.total);
            expect(expectedLockedBalances.unlockable, "unlockable ").to.be.eq(lockedBalances.unlockable);
            expect(expectedLockedBalances.locked, "locked ").to.be.eq(lockedBalances.locked);
        });

        it("hasExpiredLocks", async () => {
            const lockedBalances = await auraLockerModule.lockedBalances();
            const hasExpiredLocks = await auraLockerModule.hasExpiredLocks();

            if (lockedBalances.unlockable.gt(0)) {
                expect(hasExpiredLocks, "hasExpiredLocks").to.be.eq(true);
            } else {
                expect(hasExpiredLocks, "hasExpiredLocks").to.be.eq(false);
            }
        });

        it("processExpiredLocks fails if there is nothing to lock", async () => {
            const hasExpiredLocks = await auraLockerModule.hasExpiredLocks();
            expect(hasExpiredLocks, "hasExpiredLocks").to.be.eq(false);

            const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
            await expect(auraLockerModule.connect(keeper).processExpiredLocks()).to.be.revertedWith("NothingToLock");
        });

        it("only keeper can execute processExpiredLocks", async () => {
            //  first relock should happens on 05 Jun 2025
            const auraLocker = contracts.cvxLocker;
            const relockTime = new Date("2025-06-04T00:00:00Z").getTime() / 1000;

            await increaseTimeTo(relockTime);
            expect(await auraLockerModule.hasExpiredLocks(), "hasExpiredLocks").to.be.eq(false);

            //  Increase one day, when the relock time is reached, the hasExpiredLocks should be true
            await increaseTime(ONE_DAY);
            expect(await auraLockerModule.hasExpiredLocks(), "hasExpiredLocks").to.be.eq(true);

            const balances = await auraLockerModule.lockedBalances();

            const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
            const tx = await auraLockerModule.connect(keeper).processExpiredLocks();

            await expect(tx)
                .emit(auraLocker, "Withdrawn")
                .withArgs(config.multisigs.treasuryMultisig, balances.unlockable, true);
            await expect(tx)
                .emit(auraLocker, "Staked")
                .withArgs(config.multisigs.treasuryMultisig, balances.unlockable, balances.unlockable);
        });
    });
});
