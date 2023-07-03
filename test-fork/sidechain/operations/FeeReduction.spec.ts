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
    let actualMintRate;
    //const mainnetFees = 2250;
    let originalAura: BigNumber;
    let canonical: CanonicalPhase1Deployed & CanonicalPhase2Deployed;

    function calcMintRate(fees, distributedAura) {
        const feePercentage = sidechainFees / 10000;
        const invertedFee = Number(fees) / feePercentage;
        const effectiveMintRate = Number(distributedAura) / (invertedFee - invertedFee * feePercentage);
        return effectiveMintRate;
    }

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
            const effectiveMintRate = calcMintRate(fees, distributedAura);
            actualMintRate = effectiveMintRate;

            // prettier-ignore
            {
              console.log(`Multiplier:            ${1000}`);
              console.log(`Mint Rate:             ${effectiveMintRate}`);
              console.log(`New Aura Sent:         ${formatEther(distributedAura)}`);
              console.log(`Bal Fees:              ${formatEther(fees)}`);
            }
        });

        it("Should be able to adjust the mint rate to account for fees", async () => {
            let auraMining = await mainnetConfig.getAuraMining(deployer.signer);
            const expectedMintRate = Number(
                formatEther(await auraMining.auraMining.convertCrvToCvx(simpleToExactAmount("1"))),
            );
            const adjustmentNeeded = expectedMintRate / actualMintRate;
            const multiplier = Math.floor(adjustmentNeeded * 10000);

            await canonical.l1Coordinator.connect(dao.signer).setRewardMultiplier(multiplier);
            expect(await canonical.l1Coordinator.rewardMultiplier()).eq(multiplier);

            const phase2 = await mainnetConfig.getPhase2(deployer.signer);
            const startTreasuryBalance = await phase2.cvx.balanceOf(mainnetConfig.multisigs.treasuryMultisig);

            const { distributedAura, fees } = await distributeAura();
            const effectiveMintRate = calcMintRate(fees, distributedAura);

            const endTreasuryBalance = await phase2.cvx.balanceOf(mainnetConfig.multisigs.treasuryMultisig);

            expect(endTreasuryBalance.sub(startTreasuryBalance)).eq(originalAura.sub(distributedAura));

            // prettier-ignore
            {
              console.log(`New Multiplier:        ${multiplier}`);
              console.log(`New Aura Sent:         ${formatEther(distributedAura)}`);
              console.log(`Mint Rate:             ${effectiveMintRate}`);
              console.log(`Change In Aura Sent:   ${chalk.red("-")}${chalk.red(formatEther(originalAura.sub(distributedAura)))}`);
              console.log(`Treasury Aura Change:  ${chalk.green("+")}${chalk.green(formatEther(endTreasuryBalance.sub(startTreasuryBalance)))}`);
              console.log(`Bal Fees:              ${formatEther(fees)}`);
            }
        });
    });
});
