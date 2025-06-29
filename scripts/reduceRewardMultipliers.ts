import * as fs from "fs";
import * as path from "path";
import { config } from "../tasks/deploy/mainnet-config";
import { getSigner } from "../tasks/utils";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const getGnosisTxTemplate = (rewardContracts: string[]) => ({
    version: "1.0",
    chainId: "1",
    createdAt: 1746691629000,
    meta: {
        name: "Transactions Batch",
        description: "",
        txBuilderVersion: "1.16.1",
        createdFromSafeAddress: "0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0",
        createdFromOwnerAddress: "",
        checksum: "",
    },
    transactions: [...rewardContracts.map(setRewardMultiplier)],
});

const setRewardMultiplier = (rewardContract: string) => ({
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
    contractInputsValues: { rewardContract, multiplier: "100" },
});

export async function reduceRewardMultipliers(hre: HardhatRuntimeEnvironment) {
    const deployer = await getSigner(hre);
    const phase6 = await config.getPhase6(deployer);

    const poolLength = await phase6.booster.poolLength();
    const rewardContracts = (
        await Promise.all(
            Array(poolLength.toNumber())
                .fill(0)
                .map(async (_, i) => {
                    if (i < 59) return null; // Skip first n pools, all are shutdown
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

    const BATCH_SIZE = 40; // Define the batch size
    for (let index = 0; index < rewardContracts.length; index += BATCH_SIZE) {
        console.log(`Processing batch ${Math.ceil((index + 1) / BATCH_SIZE)}...`, index, index + BATCH_SIZE);
        const batch = rewardContracts.slice(index, index + BATCH_SIZE);
        const json = getGnosisTxTemplate(batch);
        const fileName = `./gnosis-reduce-reward-multipliers-batch-${Math.ceil((index + 1) / BATCH_SIZE)}.json`;
        fs.writeFileSync(path.resolve(__dirname, fileName), JSON.stringify(json, null, 2));
    }
}
