import * as fs from "fs";
import * as path from "path";
import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import snapshot from "@snapshot-labs/snapshot.js";
import { Wallet } from "ethers";
import isEqual from "lodash/isEqual";
import { request, gql } from "graphql-request";
import { table } from "table";

const wallet = new Wallet(process.env.PRIV_KEY);
const account = wallet.address;

const configs = {
    main: {
        hub: "https://hub.snapshot.org",
        space: "",
    },
    test: {
        hub: "https://testnet.snapshot.org",
        space: "4231423142314321432.eth",
    },
};

task("snapshot:create").setAction(async function (_: TaskArguments, hre: HardhatRuntime) {
    const { ethers } = hre;

    // get gauges
    console.log("Getting gauges from gauge controller");
    const provider = ethers.getDefaultProvider();

    const gaugeController = new ethers.Contract(
        "0xC128468b7Ce63eA702C1f104D55A2566b13D3ABD",
        ["function gauges(uint256 arg) view returns (address)", "function n_gauges() view returns (uint256)"],
        provider,
    );

    const nGauges = await gaugeController.n_gauges();
    const gaugeList: { address: string; symbol: string }[] = [];

    const gaugeInterface = ["function symbol() view returns (string)"];

    // skip the first 5 gauges
    for (let i = 4; i < Number(nGauges.toString()); i++) {
        const gaugeAddress = await gaugeController.gauges(i);
        const gauge = new ethers.Contract(gaugeAddress, gaugeInterface, provider);

        try {
            const symbol = await gauge.symbol();
            gaugeList.push({ address: gaugeAddress, symbol });
        } catch (error) {
            // TOOD: why do some of the gauges not have a symbol?
            // console.log(`bad gauge ${i} ${gaugeAddress}`);
        }
    }

    const savePath = path.resolve(__dirname, "gauge_snapshot.json");
    const existingGauges = JSON.parse(fs.readFileSync(savePath, "utf-8"));
    if (!isEqual(gaugeList, existingGauges)) {
        console.log("New gauges found. A new snapshot has been saved. Review the changes and rerun this task.");
        console.log("Snapshot saved to:", savePath);
        fs.writeFileSync(savePath, JSON.stringify(gaugeList));
        return;
    }

    // create proposal
    console.log("Creating proposal on snapshot");
    const latestBlock = await ethers.provider.getBlockNumber();
    const config = configs.test;
    const client = new snapshot.Client712(config.hub);

    const space = config.space;

    const localDate = new Date();

    const startDate = new Date(Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate()));
    startDate.setUTCHours(12);
    startDate.setUTCMinutes(0);

    const validStartDate = startDate.toUTCString().startsWith("Thu");
    if (!validStartDate) {
        console.log("Invalid start date:", startDate.toUTCString());
        console.log("Voting should start on a Thursday");
        return;
    }

    const endDate = new Date(Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate()));
    endDate.setUTCDate(endDate.getUTCDate() + 5);
    endDate.setUTCHours(12);
    endDate.setUTCMinutes(0);

    const validEndDate = endDate.toUTCString().startsWith("Tue");
    if (!validEndDate) {
        console.log("Invalid end date:", endDate.toUTCString());
        console.log("Voting should end on a Tuesday");
        return;
    }

    const receipt = await client.proposal(wallet, account, {
        space,
        type: "weighted",
        title: "Title",
        body: "Body",
        choices: gaugeList.map(choice => choice.symbol),
        start: startDate.getTime(),
        end: endDate.getTime(),
        snapshot: latestBlock,
        network: "1",
        strategies: JSON.stringify({}),
        plugins: JSON.stringify({}),
        metadata: JSON.stringify({}),
    });

    console.log(receipt);
});

task("snapshot:result")
    .addParam("proposal", "The proposal ID of the snapshot")
    .setAction(async function (taskArgs: TaskArguments, _: HardhatRuntime) {
        const query = gql`
            query Proposal($proposal: String) {
                proposal(id: $proposal) {
                    id
                    scores_total
                    scores
                    choices
                }
            }
        `;

        const config = configs.main;
        const proposalId = taskArgs.proposal;
        const data = await request(`${config.hub}/graphql`, query, { proposal: proposalId });
        const proposal = data.proposal;

        const results: { choice: string; score: number; percentage: number }[] = [];

        for (let i = 0; i < proposal.choices.length; i++) {
            const score = proposal.scores[i];
            const choice = proposal.choices[i];
            const percentage = score / proposal.scores_total;

            results.push({ choice, score, percentage });
        }

        console.log(
            table(
                results.map(({ choice, score, percentage }) => [
                    choice,
                    score,
                    `${percentage > 0.005 ? "\x1b[32m" : "\x1b[31m"} ${(percentage * 100).toFixed(2)} \x1b[0m`,
                ]),
            ),
        );
    });
