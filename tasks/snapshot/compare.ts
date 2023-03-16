import fetch from "node-fetch";
import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import { difference } from "lodash";

const BASE_URL = "https://snapshot.mypinata.cloud/ipfs/";

async function getChoicesFromIpfs(hash: string): Promise<string[]> {
    const resp = await fetch(`${BASE_URL}${hash}`);
    const json = (await resp.json()) as any;
    return json.data.message.choices;
}

const red = (str: string) => `\u001b[31m - ${str} \u001b[0m`;
const green = (str: string) => `\u001b[32m + ${str} \u001b[0m`;

function printList(list: string[], removed = false) {
    list.forEach(str => console.log(removed ? red(str) : green(str)));
}

task("snapshot:compare")
    .addPositionalParam("hash0")
    .addPositionalParam("hash1")
    .setAction(async function (taskArguments: TaskArguments, __: HardhatRuntime) {
        const choices0 = await getChoicesFromIpfs(taskArguments.hash0);
        const choices1 = await getChoicesFromIpfs(taskArguments.hash1);

        const notIn0 = difference(choices1, choices0);
        const notIn1 = difference(choices0, choices1);

        const SEP = "----------------------------------------";

        console.log(SEP);
        console.log("Difference");
        console.log(SEP);
        console.log("Additional choices (new)");
        printList(notIn0);
        console.log(SEP);
        console.log("Removed choices (old)");
        printList(notIn1, true);
    });
