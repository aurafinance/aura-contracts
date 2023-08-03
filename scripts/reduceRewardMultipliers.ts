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
    transactions: [
        {
            to: "0xCe96e48A2893C599fe2601Cc1918882e1D001EaD",
            value: "0",
            data: null,
            contractMethod: {
                inputs: [{ internalType: "address", name: "_voteDelegate", type: "address" }],
                name: "setVoteDelegate",
                payable: false,
            },
            contractInputsValues: { _voteDelegate: "0x82b5612db33B9CEe01c0440bF8521B8eb98A00D4" },
        },
        ...rewardContracts.map(rewardContract => getRewardMultiplier(rewardContract)),
    ],
});

const getRewardMultiplier = (rewardContract: string) => ({
    to: "0xA57b8d98dAE62B26Ec3bcC4a365338157060B234",
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
    contractInputsValues: { rewardContract, multiplier: "5000" },
});

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

    const deployer = await getSigner(hre);
    const phase6 = await config.getPhase6(deployer);

    const poolLength = await phase6.booster.poolLength();
    const rewardContracts = await Promise.all(
        Array(poolLength.toNumber())
            .fill(0)
            .map(async (_, i) => {
                const poolInfo = await phase6.booster.poolInfo(i);
                return poolInfo.crvRewards;
            }),
    );

    const json = getGnosisTxTemplate(rewardContracts);

    console.log(JSON.stringify(json, null, 2));
}

main().then(console.log).catch(console.error);
