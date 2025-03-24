import * as fs from "fs";
import * as path from "path";
import hre from "hardhat";
import { config } from "../tasks/deploy/mainnet-config";
import { getSigner } from "../tasks/utils";

const getGnosisTxTemplate = (rewardContracts: string[]) => ({
    version: "1.0",
    chainId: "1",
    createdAt: 1690553733262,
    meta: {
        name: "Transactions Batch",
        description: "",
        txBuilderVersion: "1.16.1",
        createdFromSafeAddress: "0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0",
        createdFromOwnerAddress: "",
        checksum: "",
    },
    transactions: [...rewardContracts.map(rewardContract => getRewardMultiplier(rewardContract))],
});

const getRewardMultiplier = (rewardContract: string) => ({
    to: "0xD0521C061958324D06b8915FFDAc3DB22C8Bd687",
    value: "0",
    data: null,
    contractMethod: {
        inputs: [
            { internalType: "address", name: "rewardContract", type: "address" },
            { internalType: "uint256", name: "multiplier", type: "uint256" },
        ],
        name: "setRewardMultiplier",
        payable: false,
    },
    contractInputsValues: { rewardContract, multiplier: "0" },
});

export async function reduceRewardMultipliers() {
    await hre.network.provider.request({
        method: "hardhat_reset",
        params: [
            {
                forking: {
                    jsonRpcUrl: process.env.NODE_URL,
                    blockNumber: 22088244,
                },
            },
        ],
    });

    const deployer = await getSigner(hre);
    const phase6 = await config.getPhase6(deployer);

    const poolLength = await phase6.booster.poolLength();
    const rewardContracts = (
        await Promise.all(
            Array(poolLength.toNumber())
                .fill(0)
                .map(async (_, i) => {
                    const poolInfo = await phase6.booster.poolInfo(i);
                    console.log(`Pool ${i}: ${poolInfo.crvRewards} shutdown: ${poolInfo.shutdown}`);
                    if (poolInfo.shutdown) return null;
                    return { pid: i, crvRewards: poolInfo.crvRewards };
                }),
        )
    )
        .filter(Boolean)
        .sort((a, b) => b.pid - a.pid)
        .map(pool => pool.crvRewards);

    const json = getGnosisTxTemplate(rewardContracts);
    fs.writeFileSync(path.resolve(__dirname, "./gnosis-reduce-reward-multipliers.json"), JSON.stringify(json, null, 2));
}

reduceRewardMultipliers().then(console.log).catch(console.error);
// npx hardhat run scripts/reduceRewardMultipliers.ts
