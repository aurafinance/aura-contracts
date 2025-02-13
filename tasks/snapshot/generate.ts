import { Contract } from "ethers";
import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

import {
    getGaugeChoices,
    getGaugeSnapshot,
    parseLabel,
    saveGaugeChoices,
    sortGaugeList,
    compareAddresses,
    GaugeChoice,
    GaugeDetails,
} from "./utils";
import { getSigner } from "../utils";
import { config } from "../deploy/mainnet-config";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import { IGaugeController__factory, MockCurveGauge__factory, Multicall3__factory } from "../../types";
import { removedGauges, validNetworks } from "./constants";
import { uniq, uniqBy } from "lodash";
import { Call3Struct } from "types/generated/Multicall3";
import { ResultStruct } from "types/generated/KeeperMulticall3";

const gaugeFilterNetworks = (gauge: any) => validNetworks.includes(gauge.network);
const gaugeFilterPoolType = (gauge: any) => gauge.pool.poolType !== "Element";
const gaugeFormatRow = (gauge: any) => ({ address: gauge.address, label: parseLabel(gauge) });

task("snapshot:generate").setAction(async function (_: TaskArguments, hre: HardhatRuntime) {
    const signer = await getSigner(hre);
    const gaugeSnapshot = await getGaugeSnapshot();

    const validNetworkGauges = gaugeSnapshot
        .filter(gaugeFilterNetworks)
        .filter(gaugeFilterPoolType)
        .filter((gauge: GaugeDetails) => !gauge.isKilled);

    const sortedGauges = sortGaugeList(validNetworkGauges);

    const cleanedGauges = [];
    const length = sortedGauges.length;
    const maxCalls = 100;
    const multicall = Multicall3__factory.connect("0xcA11bde05977b3631167028862bE2a173976CA11", signer);

    console.log("Generating snapshot...", length, length / maxCalls);
    const decodeFunctionResult = (encodedResult: ResultStruct) =>
        MockCurveGauge__factory.createInterface().decodeFunctionResult(
            "is_killed",
            encodedResult.returnData,
        )[0] as boolean;
    const encodeFunctionData = (sortedGauge): Call3Struct => {
        const gauge = MockCurveGauge__factory.connect(sortedGauge.address, signer);
        return {
            target: gauge.address,
            allowFailure: false,
            callData: gauge.interface.encodeFunctionData("is_killed"),
        };
    };

    for (let i = 0; i < length / maxCalls; i++) {
        const batchGauges = sortedGauges.slice(i * maxCalls, i * maxCalls + maxCalls);
        // Get is_killed for each gauge
        const results = await multicall.callStatic.aggregate3(batchGauges.map(encodeFunctionData));
        const decodedResults = results.map(decodeFunctionResult);
        for (let j = 0; j < decodedResults.length; j++) {
            const g = batchGauges[j];
            if (decodedResults[j]) continue;
            if (removedGauges.includes(g.address.toLowerCase())) continue;
            /////////////////////////////////////
            // The gauge is valid so we add it //
            /////////////////////////////////////
            cleanedGauges.push(g);
        }
    }

    const formattedGauges = uniqBy(cleanedGauges.map(gaugeFormatRow), "address");
    const deduplicateGauges = deduplicateLabels(formattedGauges);
    saveGaugeChoices(deduplicateGauges);
});

task("snapshot:validate").setAction(async function (_: TaskArguments, hre: HardhatRuntime) {
    const signer = await getSigner(hre);
    const gauges = getGaugeChoices();
    const gaugeController = IGaugeController__factory.connect(config.addresses.gaugeController, signer);

    const count = Number((await gaugeController.n_gauges()).toString());

    console.log("GaugeController gauges: ", count);
    console.log("Validating gauges choices...");
    let nCount = 0;
    for (let i = 0; i < count; i++) {
        const addr = await gaugeController.gauges(i);
        const gauge = new Contract(addr, ["function is_killed() external view returns (bool)"], signer);

        if (await gauge.is_killed()) continue;

        const found = gauges.find((g: GaugeChoice) => compareAddresses(addr, g.address));
        const isRemoved = removedGauges.find(g => compareAddresses(g, addr));
        if (!found && !isRemoved) {
            nCount++;
            console.log("Missing:", i, addr);
        }
    }
    console.log(`Validation complete missing ${nCount} gauges`);
});
function deduplicateLabels(formattedGauges: { address: string; label: string }[]) {
    const gaugeChoices = [].concat(...formattedGauges);
    const choices = gaugeChoices.map((gauge: GaugeChoice, index: number) => ({ label: gauge.label, index }));
    if (choices.length !== uniq(choices.map(c => c.label)).length) {
        choices.forEach(choice => {
            const duplicates = choices.filter(({ label }) => label === choice.label);
            if (duplicates.length > 1) {
                console.log("Duplicate:", choice);
                duplicates.forEach(({ index, label }) => {
                    gaugeChoices[index].label = `${label} (${gaugeChoices[index].address.slice(0, 4)})`;
                    console.log("Fixed:", index, gaugeChoices[index].address, gaugeChoices[index].label);
                });
            }
        });
    }
    return gaugeChoices;
}
