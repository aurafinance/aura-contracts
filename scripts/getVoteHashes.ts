import * as fs from "fs";
import hre from "hardhat";
import { getSigner } from "../tasks/utils";
import { config } from "../tasks/deploy/mainnet-config";

async function main() {
    const signer = await getSigner(hre);
    const { voterProxy } = await config.getPhase2(signer);

    const voteSetEventfilter = voterProxy.filters.VoteSet();
    const filter = { fromBlock: 14620751, toBlock: "latest", ...voteSetEventfilter };
    const logs = await signer.provider.getLogs(filter);

    const hashes = logs.map(log => {
        const l = voterProxy.interface.parseLog(log);
        return l.args.hash;
    });

    const gnosisTx = {
        version: "1.0",
        chainId: "1",
        createdAt: Date.now(),
        meta: {
            name: "Set vote hashes",
            description: "Reset vote hashes to false",
            txBuilderVersion: "1.11.1",
            createdFromSafeAddress: "0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0",
            createdFromOwnerAddress: "",
            checksum: "",
        },
        transactions: hashes.map(hash => ({
            to: "0xA57b8d98dAE62B26Ec3bcC4a365338157060B234",
            value: "0",
            data: null,
            contractMethod: {
                inputs: [
                    {
                        internalType: "bytes32",
                        name: "_hash",
                        type: "bytes32",
                    },
                ],
                name: "setVote",
                payable: false,
            },
            contractInputsValues: {
                _hash: hash,
            },
        })),
    };

    console.log(gnosisTx);

    fs.writeFileSync("./gnosis-set-vote-hash.json", JSON.stringify(gnosisTx));
}

main().catch(() => console.error("failed"));
