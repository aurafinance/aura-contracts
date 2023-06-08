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
} from "./utils";
import { getSigner } from "../utils";
import { config } from "../deploy/mainnet-config";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import { IGaugeController__factory, MockCurveGauge__factory } from "../../types";
import { removedGauges, validNetworks } from "./constants";
import { uniqBy } from "lodash";

const gaugeFilterNetworks = (gauge: any) => validNetworks.includes(gauge.network);
const gaugeFilterPoolType = (gauge: any) => gauge.pool.poolType !== "Element";
const gaugeFormatRow = (gauge: any) => ({ address: gauge.address, label: parseLabel(gauge) });

task("snapshot:generate").setAction(async function (_: TaskArguments, hre: HardhatRuntime) {
    const signer = await getSigner(hre);
    const gaugeSnapshot = getGaugeSnapshot();

    const validNetworkGauges = gaugeSnapshot
        .filter(gaugeFilterNetworks)
        .filter(gaugeFilterPoolType)
        .filter((gauge: any) => !gauge.isKilled);

    const sortedGauges = sortGaugeList(validNetworkGauges);

    const cleanedGauges = [];

    for (let i = 0; i < sortedGauges.length; i++) {
        const g = sortedGauges[i];

        try {
            const gauge = MockCurveGauge__factory.connect(g.address, signer);
            if (await gauge.is_killed()) {
                continue;
            }

            if (removedGauges.includes(g.address.toLowerCase())) {
                continue;
            }

            /////////////////////////////////////
            // The gauge is valid so we add it //
            /////////////////////////////////////
            cleanedGauges.push(g);
        } catch (e) {
            console.log("Snapshot generate task error:", i, e, g);
        }
    }

    const formattedGauges = cleanedGauges.map(gaugeFormatRow);
    saveGaugeChoices(uniqBy(formattedGauges, "address"));
});

task("snapshot:validate").setAction(async function (_: TaskArguments, hre: HardhatRuntime) {
    const signer = await getSigner(hre);
    const gauges = getGaugeChoices();
    const gaugeController = IGaugeController__factory.connect(config.addresses.gaugeController, signer);

    const count = Number((await gaugeController.n_gauges()).toString());

    for (let i = 0; i < count; i++) {
        const addr = await gaugeController.gauges(i);
        const gauge = new Contract(addr, ["function is_killed() external view returns (bool)"], signer);

        if (await gauge.is_killed()) continue;

        const found = gauges.find((g: GaugeChoice) => compareAddresses(addr, g.address));
        const isRemoved = removedGauges.find(g => compareAddresses(g, addr));
        if (!found && !isRemoved) {
            console.log("Missing:", i, addr);
        }
    }
});
