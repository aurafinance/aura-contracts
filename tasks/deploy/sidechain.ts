import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { logContracts } from "../utils/deploy-utils";
import { getSigner } from "../utils";
import { deployCreate2Factory } from "../../scripts/deploySystem";

task("deploy:sidechain:create2Factory").setAction(async function (_: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const debug = true;
    const waitForBlocks = 3;

    const phase = await deployCreate2Factory(hre, deployer, debug, waitForBlocks);
    logContracts(phase as unknown as { [key: string]: { address: string } });
});
