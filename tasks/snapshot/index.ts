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
import { getSigner } from "../../tasks/utils";
import { IGaugeController__factory, MockCurveGauge__factory } from "../../types/generated";
import uniqBy from "lodash/uniqBy";

const configs = {
    main: {
        hub: "https://hub.snapshot.org",
        space: "aurafinance.eth",
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

const networkLabels = { 137: "p", 42161: "a", 10: "o" };

type Token = {
    weight: string;
    symbol: string;
};
type Pool = {
    symbol: string;
    poolType: string;
    tokens: Token[];
};
interface Gauge {
    pool: Pool;
    network: string;
}

const parseLabel = (gauge: Gauge) => {
    if (gauge.pool.symbol === "veBAL") return "veBAL";

    const networkStr = networkLabels[gauge.network] ? `${networkLabels[gauge.network]}-` : "";
    const weightStr =
        gauge.pool.poolType === "Weighted"
            ? gauge.pool.tokens.map(token => Math.floor(Number(token.weight) * 100)).join("/")
            : gauge.pool.poolType;

    const tokenStr = gauge.pool.tokens.map(token => token.symbol).join("/");
    if (gauge.pool.poolType === "StablePhantom") {
        return [networkStr, tokenStr].join("");
    }

    return [networkStr, weightStr, " ", tokenStr].join("");
};

const sortGaugeList = (gaugeList: Gauge[]) => {
    return gaugeList.map(gauge => {
        // Deal with stable pools
        if (gauge.pool.tokens[0].weight === "null") {
            return gauge;
        }

        // Deal with WETH 50/50 pools
        const hasWeth = gauge.pool.tokens.some(token => token.symbol === "WETH");
        const is5050 = gauge.pool.tokens.filter(token => token.weight === "0.5").length == 2;
        if (hasWeth && is5050) {
            const tokens = gauge.pool.tokens.sort(a => (a.symbol === "WETH" ? 1 : -1));
            return { ...gauge, pool: { ...gauge.pool, tokens } };
        }

        // Sort all other pools by descending weight eg 80/20
        const tokens = gauge.pool.tokens.sort((a, b) => Number(b.weight) - Number(a.weight));
        return { ...gauge, pool: { ...gauge.pool, tokens } };
    });
};

const ordinalSuffix = (i: number) => {
    const j = i % 10;
    const k = i % 100;
    if (j == 1 && k != 11) {
        return i + "st";
    }
    if (j == 2 && k != 12) {
        return i + "nd";
    }
    if (j == 3 && k != 13) {
        return i + "rd";
    }
    return i + "th";
};

task("snapshot:create")
    .addParam("snapshot", "The block to snapshot")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
        const wallet = new Wallet(process.env.PRIVATE_KEY);
        const account = wallet.address;

        const networkName = hre.network.name;
        if (networkName !== "mainnet") {
            console.log(`Invalid network ID. Found ${networkName} Expecting mainnet`);
            return;
        }

        // get gauges
        console.log("Getting gauges from gauge controller");
        const savePath = path.resolve(__dirname, "gauge_snapshot.json");
        let gaugeList = JSON.parse(fs.readFileSync(savePath, "utf-8"));
        const validNetworks = [1, 10, 42161, 137];
        gaugeList = gaugeList.filter(
            gauge => validNetworks.includes(gauge.network) && gauge.pool.poolType !== "Element",
        );
        gaugeList = sortGaugeList(gaugeList);
        console.log("Gauge list:");
        gaugeList.forEach((gauge, i) => console.log(`${i + 1}) ${parseLabel(gauge)} (chain:${gauge.network})`));

        // create proposal
        console.log("Creating proposal on snapshot");
        const latestBlock = taskArgs.snapshot;
        if (!latestBlock) {
            console.log(`Invalid snashot provided. Found ${snapshot}`);
        }
        const config = configs.main;
        const client = new snapshot.Client712(config.hub);

        const space = config.space;

        const localDate = new Date();

        const startDate = new Date(
            Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate()),
        );
        const dayCurr = startDate.getDay();
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
        const title = `Gauge Weight for Week of ${ordinalSuffix(startDate.getUTCDate())} ${
            months[startDate.getUTCMonth()]
        } ${startDate.getUTCFullYear()}`;
        console.log(`Title: ${title}`);

        const body =
            "Please read gauge voting rules before voting: https://docs.aura.finance/aura/governance/gauge-voting#gauge-voting-rules-and-information\n\nBe sure to also consult the voting dashboard for gauge voting insights: https://app.aura.finance/#/lock";
        console.log("Body:", body);

        await new Promise(res => {
            readline.question(`Do you want to submit this proposal [y/n]: `, async answer => {
                if (answer.toLowerCase() === "y") {
                    console.log("Submitting to snapshot hub");
                    try {
                        const start = Math.floor(startDate.getTime() / 1000);
                        const end = Math.floor(endDate.getTime() / 1000);
                        const snapshot = Number(latestBlock);

                        const proposal = {
                            space,
                            type: "weighted",
                            title,
                            body,
                            discussion: "",
                            choices: gaugeList.map(gauge => parseLabel(gauge)),
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

task("snapshot:result", "Get results for the first proposal that uses non standard labels")
    .addParam("proposal", "The proposal ID of the snapshot")
    .addOptionalParam("debug", "Debug mode", "false")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
        const signer = await getSigner(hre);

        const query = gql`
            query Proposal($proposal: String) {
                proposal(id: $proposal) {
                    id
                    scores_total
                    scores
                    choices
                    scores_state
                }
            }
        `;

        const config = configs.main;
        const proposalId = taskArgs.proposal;
        const debug = taskArgs.debug === "true";
        const data = await request(`${config.hub}/graphql`, query, { proposal: proposalId });
        const proposal = data.proposal;
        if (proposal.scores_state !== "final" && !debug) {
            console.log("Scores not final");
            console.log("Exiting...");
            return;
        }

        // ----------------------------------------------------------
        // Get Gauge Weight Votes
        // ----------------------------------------------------------
        let gaugeList = JSON.parse(fs.readFileSync(path.resolve(__dirname, "./gauge_snapshot.json"), "utf-8"));
        gaugeList = sortGaugeList(gaugeList);

        const results: { choice: string; score: number; percentage: number; address: string }[] = [];

        for (let i = 0; i < proposal.choices.length; i++) {
            const score = proposal.scores[i];
            const choice = proposal.choices[i];
            const percentage = score / proposal.scores_total;
            const resp = gaugeList.find(gauge => parseLabel(gauge) === choice);

            results.push({ choice, score, percentage, address: resp?.address });
        }

        const successfulGauges = results
            .filter(({ percentage }) => percentage > 0.002)
            .sort((a, b) => b.percentage - a.percentage);

        // ----------------------------------------------------------
        // Get Existing Votes
        // Look up the existing vote weight that was previous given to all the gauges
        // ----------------------------------------------------------

        const removedGaugesPath = path.resolve(__dirname, "./gauge_removed.json");
        const removedGauges = JSON.parse(fs.readFileSync(removedGaugesPath, "utf8"));
        const voterProxyAddress = "0xaF52695E1bB01A16D33D7194C28C42b10e0Dbec2";
        const gaugeControllerAddress = "0xc128468b7ce63ea702c1f104d55a2566b13d3abd";
        const gaugeController = IGaugeController__factory.connect(gaugeControllerAddress, signer);
        const gaugesWithExistingWeights = await Promise.all(
            [...gaugeList, ...removedGauges].map(async gauge => {
                const [, power] = await gaugeController.vote_user_slopes(voterProxyAddress, gauge.address);
                return { ...gauge, existingWeight: power };
            }),
        );

        // ----------------------------------------------------------
        // Get New Votes
        // ----------------------------------------------------------

        const totalVotes = 10000;
        const sumOfPercentages = successfulGauges.reduce((acc, x) => acc + x.percentage, 0);
        const weights = successfulGauges.map(gauge => Math.floor((totalVotes * gauge.percentage) / sumOfPercentages));
        const totalWeightBefore = weights.reduce((acc, x) => acc + x, 0);

        const voteDelta = totalVotes - totalWeightBefore;
        weights[0] += voteDelta;

        const totalWeightAfter = weights.reduce((acc, x) => acc + x, 0);

        if (totalWeightAfter !== totalVotes) {
            console.log("Total weight is not equal to total votes.");
            console.log("Exiting...");
            return;
        }

        // ----------------------------------------------------------
        // Order Votes
        // gauges that don't have any votes in this epoch need to be sent with weight 0
        // gauges that have decreased in vote weight have to be sent first
        // ----------------------------------------------------------

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let votes: any[] = [];
        for (const gauge of gaugesWithExistingWeights) {
            const idx = successfulGauges.findIndex(g => gauge.address === g.address);
            if (~idx) {
                // Gauge that we want to cast a vote for this time
                const voteWeight = weights[idx];
                const voteGauge = successfulGauges[idx];
                const voteDelta = voteWeight - gauge.existingWeight;
                votes.push({ gauge, voteDelta, voteWeight, percentage: voteGauge.percentage });
            } else if (gauge.existingWeight.gt(0)) {
                // Gauge not found in vote list but it has a weight already
                // so we need to send a vote to reset it to 0.
                votes.push({ gauge, voteDelta: gauge.existingWeight, voteWeight: 0, percentage: 0 });
            }
        }

        // sort votes by lowest delta first
        votes = votes.sort((a, b) => a.voteDelta - b.voteDelta);
        votes = votes.sort(a => (a.voteWeight === 0 ? -1 : 1));

        // ----------------------------------------------------------
        // Processing
        // ----------------------------------------------------------

        console.log("Successfull gauge votes");
        const tableData = [
            ["Gauge", "voteDelta", "percentage", "address", "weight"],
            ...votes.map(({ gauge, voteDelta, voteWeight, percentage }) => [
                parseLabel(gauge),
                voteDelta,
                (percentage * 100).toFixed(2) + "%",
                gauge.address,
                voteWeight,
            ]),
        ];
        console.log(table(tableData));

        console.log(JSON.stringify(votes.map(v => v.gauge.address)));
        console.log(JSON.stringify(votes.map(v => v.voteWeight)));
    });

task("snapshot:clean", "Clean up expired gauges").setAction(async function (
    taskArgs: TaskArguments,
    hre: HardhatRuntime,
) {
    const signer = await getSigner(hre);
    console.log("Getting gauges");
    const savePath = path.resolve(__dirname, "gauge_snapshot.json");
    const gaugeList = JSON.parse(fs.readFileSync(savePath, "utf-8"));

    // Gauges that have been removed because of the new 2% cap gauges
    // but they haven't been killed yet so we just manually remove them
    const removeNotKilled = [
        "0xA6468eca7633246Dcb24E5599681767D27d1F978",
        "0x158772F59Fe0d3b75805fC11139b46CBc89F70e5",
        "0x055d483D00b0FFe0c1123c96363889Fb03fa13a4",
        "0x397649FF00de6d90578144103768aaA929EF683d",
        "0xC6FB8C72d3BD24fC4891C51c2cb3a13F49c11335",
        "0x7DfaDb8c3230890a81Dc9593110b63Bc088740d4",
        "0xEad3C3b6c829d54ad0a4c18762c567F728eF0535",
        "0xD13A839BB48d69A296a1fa6D615B6C39B170096B",
        "0xAF50825B010Ae4839Ac444f6c12D44b96819739B",
        "0xC5f8B1de80145e3a74524a3d1a772a31eD2B50cc",
        "0x7CDc9dC877b69328ca8b1Ff11ebfBe2a444Cf350",
        "0x6cb1A77AB2e54d4560fda893E9c738ad770da0B0",
        "0xE273d4aCC555A245a80cB494E9E0dE5cD18Ed530",
        "0xb154d9D7f6C5d618c08D276f94239c03CFBF4575",
        "0x5204f813cF58a4722E481b3b1cDfBBa45088fE36",
        "0x86EC8Bd97622dc80B4a7346bc853760d99D14C7F",
        "0x40AC67ea5bD1215D99244651CC71a03468bce6c0",
        "0xa57453737849A4029325dfAb3F6034656644E104",
        "0xe3A3Ca91794a995fe0bB24060987e73931B15f3D",
        "0xbD0DAe90cb4a0e08f1101929C2A01eB165045660",
        "0x5A481455E62D5825429C8c416f3B8D2938755B64",
        "0xc43d32BC349cea7e0fe829F53E26096c184756fa",
        "0x899F737750db562b88c1E412eE1902980D3a4844",
        "0xACFDA9Fd773C23c01f5d0CAE304CBEbE6b449677",
        "0x68d019f64A7aa97e2D4e7363AEE42251D08124Fb",
        "0xc3bB46B8196C3F188c6A373a6C4Fde792CA78653",
        "0xf01541837CF3A64BC957F53678b0AB113e92911b",
        "0xB0de49429fBb80c635432bbAD0B3965b28560177",
    ].map(x => x.toLowerCase());

    const removedGauges = [];

    const list = await Promise.all(
        gaugeList.map(async g => {
            if ([1, 137, 42161].includes(g.network)) {
                const gauge = MockCurveGauge__factory.connect(g.address, signer);
                if ((await gauge.is_killed()) || removeNotKilled.includes(g.address.toLowerCase())) {
                    console.log("Gauge killed:", g.pool.symbol, g.address);
                    removedGauges.push(g);
                    return false;
                } else {
                    return g;
                }
            } else {
                return g;
            }
        }),
    );

    fs.writeFileSync(savePath, JSON.stringify(list.filter(Boolean), null, 2));
    const removePath = path.resolve(__dirname, "gauge_removed.json");
    const removed = JSON.parse(fs.readFileSync(removePath, "utf8"));
    fs.writeFileSync(removePath, JSON.stringify(uniqBy([...removed, ...removedGauges], "address"), null, 2));
});
