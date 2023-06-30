import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, network } from "hardhat";
import chalk from "chalk";

import { Account } from "../../../types";
import { config as mainnetConfig } from "../../../tasks/deploy/mainnet-config";
import { CanonicalPhase1Deployed, CanonicalPhase2Deployed } from "scripts/deploySidechain";
import { impersonateAccount, simpleToExactAmount, ZERO_ADDRESS } from "../../../test-utils";
import { formatEther } from "ethers/lib/utils";

describe("FeeReduction", () => {
    const ethBlockNumber: number = 17591447;

    let deployer: Account;
    let dao: Account;
    const sidechainFees = 2500;
    const mainnetFees = 2250;
    let originalAura: BigNumber;
    let canonical: CanonicalPhase1Deployed & CanonicalPhase2Deployed;

    beforeEach(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: ethBlockNumber,
                    },
                },
            ],
        });

        const accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        dao = await impersonateAccount(mainnetConfig.multisigs.daoMultisig);

        canonical = mainnetConfig.getSidechain(deployer.signer);
        await canonical.l1Coordinator.connect(dao.signer).setDistributor(deployer.address, true);
    });

    const distributeAura = async () => {
        const tx = await canonical.l1Coordinator
            .connect(deployer.signer)
            .distributeAura(110, ZERO_ADDRESS, ZERO_ADDRESS, "0x", { value: simpleToExactAmount("0.1") });
        const logs = (await tx.wait()).logs;

        let distributedAura: BigNumber;
        let fees: BigNumber;

        for (let i = 0; i < logs.length; i++) {
            const log = logs[i];
            if (log.address == canonical.l1Coordinator.address) {
                const parsed = canonical.l1Coordinator.interface.parseLog(log);

                if (parsed.name == "AuraDistributed") {
                    fees = BigNumber.from(parsed.args.amount);
                }
            }
            if (log.address == canonical.auraProxyOFT.address) {
                const parsed = canonical.auraProxyOFT.interface.parseLog(log);

                if (parsed.name == "SendToChain") {
                    distributedAura = BigNumber.from(parsed.args._amount);
                }
            }
        }

        return { distributedAura, fees };
    };

    describe("Adjust Sidechain Mint Rate", () => {
        it("Should be able to see current mint rate based on a pending distribute", async () => {
            const { distributedAura, fees } = await distributeAura();

            originalAura = distributedAura;

            // prettier-ignore
            {
              console.log(`Multiplier:            ${1000}`);
              console.log(`New Aura Sent:         ${formatEther(distributedAura)}`);
              console.log(`Bal Fees:              ${formatEther(fees)}`);
            }
        });

        it("Should be able to adjust the mint rate to account for fees", async () => {
            const adjustmentNeeded = 1.0 - (sidechainFees / mainnetFees / (sidechainFees - mainnetFees)) * 10;
            const multiplier = Math.floor(adjustmentNeeded * 10000);

            await canonical.l1Coordinator.connect(dao.signer).setRewardMultiplier(multiplier);
            expect(await canonical.l1Coordinator.rewardMultiplier()).eq(multiplier);

            const { distributedAura, fees } = await distributeAura();

            // prettier-ignore
            {
              console.log(`New Multiplier:        ${multiplier}`);
              console.log(`New Aura Sent:         ${formatEther(distributedAura)}`);
              console.log(`Change In Aura Sent:   ${chalk.red("-")}${chalk.red(formatEther(originalAura.sub(distributedAura)))}`);
              console.log(`Bal Fees:              ${formatEther(fees)}`);
            }
        });
    });
});
