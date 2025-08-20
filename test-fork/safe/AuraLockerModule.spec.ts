import { expect } from "chai";
import { Signer } from "ethers";
import hre, { network } from "hardhat";
import { deployAuraLockerModule } from "../../scripts/deployPeripheral";
import { Phase2Deployed } from "../../scripts/deploySystem";
import { config } from "../../tasks/deploy/mainnet-config";
import { BN, getTimestamp, impersonate, increaseTimeTo, ONE_WEEK, ZERO } from "../../test-utils";
import { AuraLockerModule, ISafe, ISafe__factory } from "../../types";
import { LockedBalanceStructOutput } from "../../types/generated/AuraLockerModule";

function evaluateExpiredLocks(
    lockedBalances: [BN, BN, BN, LockedBalanceStructOutput[]] & {
        total: BN;
        unlockable: BN;
        locked: BN;
        lockData: LockedBalanceStructOutput[];
    },
    now: BN,
) {
    let hasExpiredLocks = false;
    let relockAmount = BN.from(0);
    const len = lockedBalances.lockData.length;
    for (let i = 0; i < len; i++) {
        const relockTime = BN.from(lockedBalances.lockData[i].unlockTime).sub(ONE_WEEK);
        if (now.gt(relockTime)) {
            hasExpiredLocks = true;
            relockAmount = relockAmount.add(lockedBalances.lockData[i].amount);
        }
    }
    return { hasExpiredLocks, relockAmount };
}

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
                        blockNumber: 23100000, // Aug-09-2025
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
            //  first relock should happens on 20 August 2025
            const relockTime = new Date("2025-08-20T16:00:00Z").getTime() / 1000;

            await increaseTimeTo(relockTime);

            const lockedBalances = await auraLockerModule.lockedBalances();
            const canRelockExpiredLocks = await auraLockerModule.hasExpiredLocks();
            const now = await getTimestamp();
            const { hasExpiredLocks, relockAmount } = evaluateExpiredLocks(lockedBalances, now);
            expect(hasExpiredLocks, "canRelockExpiredLocks").to.be.eq(canRelockExpiredLocks);
            expect(relockAmount, "relockAmount").to.be.gt(ZERO);
        });

        it("processExpiredLocks fails if there is nothing to lock", async () => {
            const hasExpiredLocks = await auraLockerModule.hasExpiredLocks();
            expect(hasExpiredLocks, "hasExpiredLocks").to.be.eq(false);

            const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
            await expect(auraLockerModule.connect(keeper).processExpiredLocks()).to.be.revertedWith("NothingToLock");
        });

        it("only keeper can execute processExpiredLocks", async () => {
            const auraLocker = contracts.cvxLocker;

            const now = await getTimestamp();
            expect(await auraLockerModule.hasExpiredLocks(), "hasExpiredLocks").to.be.eq(true);

            const lockedBalances = await auraLockerModule.lockedBalances();

            const { relockAmount } = evaluateExpiredLocks(lockedBalances, now);

            const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
            const tx = await auraLockerModule.connect(keeper).processExpiredLocks();

            await expect(tx)
                .emit(auraLocker, "Withdrawn")
                .withArgs(config.multisigs.treasuryMultisig, relockAmount, true);
            await expect(tx)
                .emit(auraLocker, "Staked")
                .withArgs(config.multisigs.treasuryMultisig, relockAmount, relockAmount);
        });
    });
});
