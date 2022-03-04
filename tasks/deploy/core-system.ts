import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { getSigner } from "../utils";
import {
    deployForkSystem,
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    ExtSystemConfig,
} from "../../scripts/deploySystem";
import { deployMocks, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";

task("deploy:core").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    console.log(await deployer.getAddress());
    await deployForkSystem(hre, deployer, getMockDistro(), await getMockMultisigs(deployer, deployer, deployer), {
        cvxName: "Convex Finance",
        cvxSymbol: "CVX",
        vlCvxName: "Vote Locked Convex",
        vlCvxSymbol: "vlCVX",
        cvxCrvName: "Convex CRV",
        cvxCrvSymbol: "cvxCRV",
        tokenFactoryNamePostfix: " Convex Deposit",
    });
});

function logExtSystem(system: ExtSystemConfig) {
    const keys = Object.keys(system);
    console.log(`\n~~~~~~~~~~~~~~~~~~~~~~~~~~~`);
    console.log(`~~~~~~~ EXT  SYSTEM ~~~~~~~`);
    console.log(`~~~~~~~~~~~~~~~~~~~~~~~~~~~\n`);
    keys.map(k => {
        console.log(`${k}:\t${system[k]}`);
    });
}

function logContracts(contracts: { [key: string]: { address: string } }) {
    const keys = Object.keys(contracts);
    console.log(`\n~~~~~~~~~~~~~~~~~~~~~~~~~~~`);
    console.log(`~~~~ SYSTEM DEPLOYMENT ~~~~`);
    console.log(`~~~~~~~~~~~~~~~~~~~~~~~~~~~\n`);
    keys.map(k => {
        console.log(`${k}:\t${contracts[k].address}`);
    });
}

task("deploy:testnet").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    console.log(await deployer.getAddress());

    const mocks = await deployMocks(deployer, true);
    const multisigs = await getMockMultisigs(deployer, deployer, deployer);
    const distro = getMockDistro();

    const phase1 = await deployPhase1(deployer, mocks.addresses, true, true);
    const phase2 = await deployPhase2(deployer, phase1, multisigs, mocks.namingConfig, true);
    const phase3 = await deployPhase3(
        hre,
        deployer,
        phase2,
        distro,
        multisigs,
        mocks.namingConfig,
        mocks.addresses,
        true,
    );
    const contracts = await deployPhase4(deployer, phase3, mocks.addresses, true);

    logExtSystem(mocks.addresses);
    logContracts(contracts as any as { [key: string]: { address: string } });
});
