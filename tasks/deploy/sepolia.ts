import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { logContracts } from "../utils/deploy-utils";
import { getSigner } from "../utils";
import { deployPhase1, deployPhase2, deployPhase4 } from "../../scripts/deploySystem";
import { config } from "./sepolia-config";

task("deploy:sepolia:1")
    .addParam("wait", "wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);

        // ~~~~~~~~~~~~~~~
        // ~~~ PHASE 1 ~~~
        // ~~~~~~~~~~~~~~~
        const phase1 = await deployPhase1(hre, deployer, config.addresses, false, true, tskArgs.wait);
        logContracts(phase1 as unknown as { [key: string]: { address: string } });
    });
task("deploy:sepolia:2")
    .addParam("wait", "wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);

        const phase1 = await config.getPhase1(deployer);

        // ~~~~~~~~~~~~~~~
        // ~~~ PHASE 2 ~~~
        // ~~~~~~~~~~~~~~~
        const phase2 = await deployPhase2(
            hre,
            deployer,
            phase1,
            config.distroList,
            config.multisigs,
            config.naming,
            config.addresses,
            true,
            tskArgs.wait,
        );
        logContracts(phase2 as unknown as { [key: string]: { address: string } });
    });
task("deploy:sepolia:4")
    .addParam("wait", "wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);

        const phase3 = await config.getPhase3(deployer);

        // ~~~~~~~~~~~~~~~
        // ~~~ PHASE 4 ~~~
        // ~~~~~~~~~~~~~~~
        const phase4 = await deployPhase4(hre, deployer, phase3, config.addresses, true, tskArgs.wait);
        logContracts(phase4 as unknown as { [key: string]: { address: string } });
    });
