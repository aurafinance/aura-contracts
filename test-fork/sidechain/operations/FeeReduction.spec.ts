import { ethers, network } from "hardhat";
import { expect } from "chai";
import { config as mainnetConfig } from "../../../tasks/deploy/mainnet-config";
import { impersonateAccount, simpleToExactAmount, ZERO_ADDRESS } from "../../../test-utils";
import { Account } from "../../../types";

describe("FeeReduction", () => {
    const ethBlockNumber: number = 17591447;

    let deployer: Account;
    let dao: Account;
    let multiplier;
    const sidechainFees = 2500;
    const mainnetFees = 2250;
    let originalAura;

    describe("Adjust Sidechain Mint Rate", () => {
        it("Should be able to see current mint rate based on a pending distribute", async () => {
            await network.provider.request({
                method: "hardhat_reset",
                params: [
                    {
                        forking: {
                            jsonRpcUrl: process.env.ETHEREUM_NODE_URL,
                            blockNumber: ethBlockNumber,
                        },
                    },
                ],
            });

            const accounts = await ethers.getSigners();
            deployer = await impersonateAccount(await accounts[0].getAddress());
            dao = await impersonateAccount(mainnetConfig.multisigs.daoMultisig);

            const sidechain = await mainnetConfig.getSidechain(deployer.signer);

            await sidechain.l1Coordinator.connect(dao.signer).setDistributor(deployer.address, true);
            const tx = await sidechain.l1Coordinator
                .connect(deployer.signer)
                .distributeAura(110, ZERO_ADDRESS, ZERO_ADDRESS, "0x", { value: simpleToExactAmount("0.1") });
            const logs = (await tx.wait()).logs;

            let distributedAura;
            let fees;

            for (let i = 0; i < logs.length; i++) {
                const log = logs[i];
                if (log.address == sidechain.l1Coordinator.address) {
                    const parsed = sidechain.l1Coordinator.interface.parseLog(log);

                    if (parsed.name == "AuraDistributed") {
                        fees = parsed.args.amount;
                    }
                }
                if (log.address == sidechain.auraProxyOFT.address) {
                    const parsed = sidechain.auraProxyOFT.interface.parseLog(log);

                    if (parsed.name == "SendToChain") {
                        distributedAura = parsed.args._amount;
                    }
                }
            }

            originalAura = distributedAura;

            console.log("Multiplier: " + 10000);
            console.log("Aura Sent: " + Number(distributedAura) / 1e18);
            console.log("Bal Fees: " + Number(fees) / 1e18);
        });

        it("Should be able to adjust the mint rate to account for fees", async () => {
            await network.provider.request({
                method: "hardhat_reset",
                params: [
                    {
                        forking: {
                            jsonRpcUrl: process.env.ETHEREUM_NODE_URL,
                            blockNumber: ethBlockNumber,
                        },
                    },
                ],
            });

            const accounts = await ethers.getSigners();
            deployer = await impersonateAccount(await accounts[0].getAddress());
            dao = await impersonateAccount(mainnetConfig.multisigs.daoMultisig);

            const sidechain = await mainnetConfig.getSidechain(deployer.signer);

            const adjustmentNeeded = 1.0 - (sidechainFees / mainnetFees / (sidechainFees - mainnetFees)) * 10;
            multiplier = Math.floor(adjustmentNeeded * 10000);

            await sidechain.l1Coordinator.connect(dao.signer).setRewardMultiplier(multiplier);
            expect(await sidechain.l1Coordinator.rewardMultiplier()).eq(multiplier);

            await sidechain.l1Coordinator.connect(dao.signer).setDistributor(deployer.address, true);
            const tx = await sidechain.l1Coordinator
                .connect(deployer.signer)
                .distributeAura(110, ZERO_ADDRESS, ZERO_ADDRESS, "0x", { value: simpleToExactAmount("0.1") });
            const logs = (await tx.wait()).logs;

            let distributedAura;
            let fees;

            for (let i = 0; i < logs.length; i++) {
                const log = logs[i];
                if (log.address == sidechain.l1Coordinator.address) {
                    const parsed = sidechain.l1Coordinator.interface.parseLog(log);

                    if (parsed.name == "AuraDistributed") {
                        fees = parsed.args.amount;
                    }
                }
                if (log.address == sidechain.auraProxyOFT.address) {
                    const parsed = sidechain.auraProxyOFT.interface.parseLog(log);

                    if (parsed.name == "SendToChain") {
                        distributedAura = parsed.args._amount;
                    }
                }
            }

            console.log("New Multiplier: " + multiplier);
            console.log("New Aura Sent: " + Number(distributedAura) / 1e18);
            console.log("Change In Aura Sent: " + -(Number(originalAura) - Number(distributedAura)) / 1e18);
            console.log("Bal Fees: " + Number(fees) / 1e18);
        });
    });
});
