import hre from "hardhat";
import { BigNumber } from "ethers";
import { formatEther, formatUnits, parseEther, parseUnits } from "ethers/lib/utils";
import * as fs from "fs";
import * as path from "path";
import { BaseRewardPool__factory } from "../types";
import { config } from "../tasks/deploy/mainnet-config";

const p = path.resolve(__dirname, "./auraEarned.json");
const f = fs.readFileSync(p, "utf8");
const data = JSON.parse(f);

const minBal = parseEther("5");

const accountsWithMinBal = [];
const accountsWithoutMinBal = [];

for (const pid in data.pools) {
    const { accounts } = data.pools[pid];
    for (const acc in accounts) {
        const account = accounts[acc];
        if (parseEther(account.bal).gt(minBal)) {
            accountsWithMinBal.push({ ...account, pid, address: acc });
        } else {
            accountsWithoutMinBal.push({ ...account, pid, address: acc });
        }
    }
}

const sumAccountsAura = (accounts: { aura: string }[]) =>
    accounts.reduce((acc, next) => acc.add(parseEther(next.aura)), BigNumber.from(0));

async function main() {
    await hre.network.provider.request({
        method: "hardhat_reset",
        params: [
            {
                forking: {
                    jsonRpcUrl: process.env.NODE_URL,
                    blockNumber: 17771600,
                },
            },
        ],
    });

    {
        const totalAura = sumAccountsAura(accountsWithMinBal);

        const [signer] = await hre.ethers.getSigners();

        const phase6 = await config.getPhase6(signer);
        const booster = phase6.booster;

        console.log("Querying pools...");
        const filteredPools = accountsWithMinBal.filter((_, i) => true);
        const res = await Promise.all(
            filteredPools.map(async acc => {
                const poolInfo = await booster.poolInfo(acc.pid);
                const pool = BaseRewardPool__factory.connect(poolInfo.crvRewards, signer);
                const tx = await pool["getReward(address,bool)"](acc.address, true, {
                    maxFeePerGas: 35000000000,
                });
                const r = await tx.wait();
                return {
                    cumulativeGasUsed: r.cumulativeGasUsed,
                };
            }),
        );

        let totalGas = BigNumber.from(0);

        console.log("Calculating totals...");
        for (const row of res) {
            totalGas = totalGas.add(row.cumulativeGasUsed);
        }

        console.log(`Accounts with more than ${formatEther(minBal)} BAL:`);
        console.log(`Count: ${accountsWithMinBal.length}`);
        console.log(`Aura amount: ${formatEther(totalAura)}`);
        console.log("");

        const gasPrice = 30;
        console.log(`Sim run on ${filteredPools.length} accounts`);

        const actualTotalGas = totalGas.mul(Math.floor(accountsWithMinBal.length / filteredPools.length));
        console.log(`Total gas: ${actualTotalGas}`);
        console.log(`Ave gas price: ${gasPrice} gwei`);
        console.log(`Ave gas used: ${actualTotalGas.div(accountsWithMinBal.length)}`);
        console.log(`Total cost: ${formatEther(actualTotalGas.mul(parseUnits(gasPrice.toString(), "gwei")))}`);
    }

    {
        console.log(`Accounts with less than ${formatEther(minBal)} BAL`);
        console.log(`Count: ${accountsWithoutMinBal.length}`);

        const totalAura = sumAccountsAura(accountsWithoutMinBal);
        console.log(`Aura amount: ${formatEther(totalAura)}`);
    }
}

main();
