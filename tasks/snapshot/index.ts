import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

import "./generate";
import "./create";
import "./result";
import "./compare";

task("snapshot:submit")
    .setDescription("Generate a snapshot and submit it to the Snapshot API")
    .setAction(async function (_: TaskArguments, hre: HardhatRuntimeEnvironment) {
        await hre.run("snapshot:generate", {});
        await hre.run("snapshot:create", { hub: "main", latestblock: true, noninteractive: true });
    });
