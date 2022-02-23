import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { getSigner } from "../utils";
import { deployForkSystem } from "../../scripts/deploySystem";
import { getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";

task("deploy:core").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    console.log(await deployer.getAddress());
    await deployForkSystem(hre, deployer, getMockDistro(), await getMockMultisigs(deployer, deployer, deployer), {
        cvxName: "Convex Finance",
        cvxSymbol: "CVX",
        cvxCrvName: "Convex CRV",
        cvxCrvSymbol: "cvxCRV",
        tokenFactoryNamePostfix: " Convex Deposit",
    });
});
