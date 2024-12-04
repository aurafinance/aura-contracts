import * as fs from "fs";
import * as path from "path";
import { Wallet } from "ethers";
import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import snapshot from "@snapshot-labs/snapshot.js";

import { getGaugeChoices, ordinalSuffix, GaugeChoice } from "./utils";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import { configs, months } from "./constants";
import { createInterface } from "readline";
import { uniq } from "lodash";

const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
});

task("snapshot:create")
    .addParam("hub", "test or main config")
    .addOptionalParam("snapshot", "The block to snapshot")
    .addFlag("latestblock", "Use the latest block to generate the snapshot")
    .addFlag("noninteractive", "Do not ask for confirmation")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
        const config = configs[taskArgs.hub];

        if (!config) {
            console.log("Invalid config value:", taskArgs.config);
            return;
        }

        const wallet = new Wallet(process.env.PRIVATE_KEY);
        const account = wallet.address;

        const networkName = hre.network.name;
        if (networkName !== "mainnet") {
            console.log(`Invalid network ID. Found ${networkName} Expecting mainnet`);
            return;
        }

        // get gauges
        const latestBlock = await await hre.ethers.provider.getBlockNumber();
        console.log("Getting gauges choices at block", latestBlock);

        const gaugeList = getGaugeChoices();
        console.log("Gauge list:");
        gaugeList.forEach((gauge: GaugeChoice, i: number) => console.log(`${i + 1}) ${gauge.label}`));

        // create proposal
        console.log("Creating proposal on snapshot");

        const snapshotBlock = taskArgs.snapshot ?? (taskArgs.latestblock ? latestBlock : null);

        if (!snapshotBlock) {
            throw new Error(`Invalid snapshot provided. Found ${snapshotBlock}`);
        }

        const client = new snapshot.Client712(config.hub);
        const space = config.space;

        const localDate = new Date();
        const startDate = new Date(
            Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate()),
        );
        const dayCurr = startDate.getUTCDay();
        const dayTarget = 4; // Thursday
        const dayDelta = dayTarget - dayCurr;
        startDate.setDate(startDate.getDate() + dayDelta);
        startDate.setUTCHours(2);
        startDate.setUTCMinutes(0);

        const validStartDate = startDate.toUTCString().startsWith("Thu");
        if (!validStartDate) {
            console.log("Invalid start date:", startDate.toUTCString());
            console.log("Voting should start on a Thursday");
            return;
        }
        console.log("Start date:", startDate.toUTCString());

        const endDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
        endDate.setUTCDate(endDate.getUTCDate() + 5);
        endDate.setUTCHours(2);
        endDate.setUTCMinutes(0);

        const validEndDate = endDate.toUTCString().startsWith("Tue");
        if (!validEndDate) {
            console.log("Invalid end date:", endDate.toUTCString());
            console.log("Voting should end on a Tuesday");
            return;
        }
        console.log("End date:", endDate.toUTCString());
        console.log(`Snapshot: ${snapshotBlock}`);
        console.log(`Space: ${space}`);
        console.log(`Account: ${account}`);
        console.log(`Hub: ${config.hub}`);

        const title = `Gauge Weight for Week of ${ordinalSuffix(startDate.getUTCDate())} ${
            months[startDate.getUTCMonth()]
        } ${startDate.getUTCFullYear()}`;
        console.log(`Title: ${title}`);

        const body =
            "Please read gauge voting rules before voting: https://docs.aura.finance/aura/governance/gauge-voting#gauge-voting-rules-and-information\n\nBe sure to also consult the voting dashboard for gauge voting insights: https://app.aura.finance/#/lock";
        console.log("Body:", body);

        const choices = gaugeList.map((gauge: GaugeChoice) => gauge.label);
        if (choices.length !== uniq(choices).length) {
            choices.forEach((choice: string) => {
                const count = choices.filter((c: string) => c === choice).length;
                if (count > 1) console.log("Duplicate:", choice);
            });
            console.log("Duplicate labels not allowed");
            return;
        }
        async function createSnapshotProposal() {
            try {
                const start = Math.floor(startDate.getTime() / 1000);
                const end = Math.floor(endDate.getTime() / 1000);
                const snapshot = Number(snapshotBlock);

                const proposal = {
                    space,
                    type: "weighted",
                    title,
                    body,
                    discussion: "",
                    choices,
                    start,
                    end,
                    snapshot,
                    network: "1",
                    strategies: JSON.stringify({}),
                    plugins: JSON.stringify({}),
                    metadata: JSON.stringify({}),
                };
                console.log("Proposal:", JSON.stringify(proposal));
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const receipt: any = await client.proposal(wallet, account, proposal);

                console.log(receipt);

                // Save the proposal receipt to proposal.json file
                const savedProposalPath = path.resolve(__dirname, "./proposals.json");
                const saved = fs.readFileSync(savedProposalPath, "utf8");
                const savedJSON = JSON.parse(saved);
                const newSaved = [
                    {
                        id: receipt.id,
                        title,
                        start,
                        end,
                        snapshot,
                    },
                    ...savedJSON,
                ];
                fs.writeFileSync(savedProposalPath, JSON.stringify(newSaved));

                console.log(receipt);
            } catch (error) {
                console.log("Submitting failed");
                console.log(error);
            }
        }

        if (taskArgs.noninteractive) {
            await createSnapshotProposal();
            return;
        } else {
            await new Promise(res => {
                readline.question(`Do you want to submit this proposal [y/n]: `, async answer => {
                    if (answer.toLowerCase() === "y") {
                        console.log("Submitting to snapshot hub");
                        await createSnapshotProposal();
                        readline.close();
                        res(null);
                    } else {
                        console.log("Cancelled");
                        readline.close();
                        res(null);
                    }
                });
            });
        }
    });
