import * as fs from "fs";
import * as path from "path";
import { table } from "table";
import { Wallet } from "ethers";
import { task } from "hardhat/config";
import { createInterface } from "readline";
import { TaskArguments } from "hardhat/types";
import { request, gql } from "graphql-request";
import snapshot from "@snapshot-labs/snapshot.js";
import { HardhatRuntime } from "../utils/networkAddressFactory";

const configs = {
    main: {
        hub: "https://hub.snapshot.org",
        space: "",
    },
    test: {
        hub: "https://testnet.snapshot.org",
        space: "432423532464535344321.eth",
    },
};

const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
});

const networkLabels = { 137: "p", 42161: "a" };

const parseLabel = (gauge: any) => {
    const networkStr = networkLabels[gauge.network] ? `${networkLabels[gauge.network]}-` : "";
    const weightStr =
        gauge.pool.poolType === "Weighted"
            ? gauge.pool.tokens.map(token => Math.floor(Number(token.weight) * 100)).join("/")
            : gauge.pool.poolType;

    const tokenStr = gauge.pool.tokens.map(token => token.symbol).join("/");
    return [networkStr, weightStr, " ", tokenStr].join("");
};

task("snapshot:create").setAction(async function (_: TaskArguments, hre: HardhatRuntime) {
    const wallet = new Wallet(process.env.PRIVATE_KEY);
    const account = wallet.address;

    const { ethers } = hre;

    const networkName = hre.network.name;
    if (networkName !== "mainnet") {
        console.log(`Invalid network ID. Found ${networkName} Expecting mainnet`);
        return;
    }

    // get gauges
    console.log("Getting gauges from gauge controller");
    const savePath = path.resolve(__dirname, "gauge_snapshot.json");
    let gaugeList = JSON.parse(fs.readFileSync(savePath, "utf-8"));
    const validNetworks = [1, 42161, 137];
    gaugeList = gaugeList.filter(gauge => validNetworks.includes(gauge.network));
    console.log("Gauge list:");
    gaugeList.forEach((gauge, i) => console.log(`${i + 1}) ${parseLabel(gauge)} (chain:${gauge.network})`));

    // create proposal
    console.log("Creating proposal on snapshot");
    const latestBlock = await ethers.provider.getBlockNumber();
    const config = configs.test;
    const client = new snapshot.Client712(config.hub);

    const space = config.space;

    const localDate = new Date();

    const startDate = new Date(Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate()));
    const dayCurr = startDate.getDay();
    const dayTarget = 4; // Thursday
    const dayDelta = dayTarget - dayCurr;
    startDate.setDate(startDate.getDate() + dayDelta);
    startDate.setUTCHours(12);
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
    endDate.setUTCHours(12);
    endDate.setUTCMinutes(0);

    const validEndDate = endDate.toUTCString().startsWith("Tue");
    if (!validEndDate) {
        console.log("Invalid end date:", endDate.toUTCString());
        console.log("Voting should end on a Tuesday");
        return;
    }
    console.log("End date:", endDate.toUTCString());
    console.log(`Snapshot: ${latestBlock}`);
    console.log(`Space: ${space}`);
    console.log(`Account: ${account}`);
    console.log(`Hub: ${config.hub}`);

    const months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    const title = `Gauge Weight for Week of ${
        months[startDate.getUTCMonth()]
    } ${startDate.getUTCDate()} ${startDate.getUTCFullYear()}`;
    console.log(`Title: ${title}`);

    const body =
        "Please read gauge voting rules before voting: https://docs.aura.finance/aura/governance/gauge-voting#gauge-voting-rules-and-information\n\nBe sure to also consult the voting dashboard for gauge voting insights: https://app.aura.finance/#/lock";
    console.log("Body:", body);

    await new Promise(res => {
        readline.question(`Do you want to submit this proposal [y/n]: `, async answer => {
            if (answer.toLowerCase() === "y") {
                console.log("Submitting to snapshot hub");
                try {
                    const proposal = {
                        space,
                        type: "weighted",
                        title,
                        body,
                        discussion: "",
                        choices: gaugeList.map(gauge => parseLabel(gauge)),
                        start: Math.floor(startDate.getTime() / 1000),
                        end: Math.floor(endDate.getTime() / 1000),
                        snapshot: latestBlock,
                        network: "1",
                        strategies: JSON.stringify({}),
                        plugins: JSON.stringify({}),
                        metadata: JSON.stringify({}),
                    };
                    console.log("Proposal:", JSON.stringify(proposal));
                    const receipt = await client.proposal(wallet, account, proposal);

                    console.log(receipt);
                } catch (error) {
                    console.log("Submitting failed");
                    console.log(error);
                }
                readline.close();
                res(null);
            } else {
                console.log("Cancelled");
                readline.close();
                res(null);
            }
        });
    });
});

task("snapshot:result:legacy", "Get results for the first proposal that uses non standard labels")
    .addParam("proposal", "The proposal ID of the snapshot")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
        const { ethers } = hre;

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
        const labels = JSON.parse(fs.readFileSync(path.resolve(__dirname, "./labels.json"), "utf-8"));

        const results: { choice: string; score: number; percentage: number; address: string }[] = [];

        for (let i = 0; i < proposal.choices.length; i++) {
            const score = proposal.scores[i];
            const choice = proposal.choices[i];
            const percentage = score / proposal.scores_total;
            const resp = labels.find(({ label }) => label.toLowerCase() === choice.toLowerCase());

            results.push({ choice, score, percentage, address: resp?.address });
        }

        const successfulGauges = results
            .filter(({ percentage }) => percentage > 0.005)
            .sort((a, b) => b.percentage - a.percentage);

        const totalVotes = 10000;
        const sumOfPercentages = successfulGauges.reduce((acc, x) => acc + x.percentage, 0);
        const gauges = successfulGauges.map(gauge => gauge.address);
        const weights = successfulGauges.map(gauge => Math.floor((totalVotes * gauge.percentage) / sumOfPercentages));
        const totalWeightBefore = weights.reduce((acc, x) => acc + x, 0);

        const voteDelta = totalVotes - totalWeightBefore;
        weights[0] += voteDelta;

        const totalWeightAfter = weights.reduce((acc, x) => acc + x, 0);

        if (totalWeightAfter !== totalVotes) {
            console.log("Total weight is not equal to total votes.");
            return;
        }

        console.log("Successfull gauge votes");
        const tableData = successfulGauges.map(({ choice, score, percentage, address }, i) => [
            choice,
            score,
            (percentage * 100).toFixed(2) + "%",
            address,
            weights[i],
        ]);
        console.log(table(tableData));

        // encode function data
        const boosterAddress = "0x7818A1DA7BD1E64c199029E86Ba244a9798eEE10";
        const boosterAbi = ["function voteGaugeWeight(address[] _gauge, uint256[] _weight) external returns(bool)"];
        const booster = new ethers.Contract(boosterAddress, boosterAbi);
        const encoded = await booster.interface.encodeFunctionData("voteGaugeWeight", [gauges, weights]);
        console.log(encoded);
    });
