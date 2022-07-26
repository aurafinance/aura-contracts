import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getSigner } from "../utils";
import { logContracts, waitForTx } from "./../utils/deploy-utils";
import {
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    DistroList,
    MultisigConfig,
    NamingConfig,
    Phase1Deployed,
} from "../../scripts/deploySystem";
import { getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import { simpleToExactAmount } from "./../../test-utils/math";
import { VoterProxy__factory, ERC20__factory } from "../../types/generated";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { config } from "./goerli-config";

const forking = false;
const waitForBlocks = forking ? undefined : 3;

task("deploy:goerli:1").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();
    console.log(deployerAddress);

    const phase1 = await deployPhase1(hre, deployer, config.addresses, false, true, waitForBlocks);
    console.log(phase1.voterProxy.address);
});

task("deploy:goerli:234").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();

    const phase1 = {
        voterProxy: VoterProxy__factory.connect("0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9", deployer),
    };

    const contracts = await deployGoerli234(
        hre,
        phase1,
        getMockDistro(),
        await getMockMultisigs(deployer, deployer, deployer),
        {
            cvxName: "Slipknot Finance",
            cvxSymbol: "SLK",
            vlCvxName: "Tightly tied Slipknot",
            vlCvxSymbol: "ttSLK",
            cvxCrvName: "Slipknot BUL",
            cvxCrvSymbol: "slkBUL",
            tokenFactoryNamePostfix: " Slipknot rope",
        },
    );

    logContracts(contracts as unknown as { [key: string]: { address: string } });

    const poolInfo = await contracts.booster.poolInfo(0);
    const lp = ERC20__factory.connect(poolInfo.lptoken, deployer);

    let tx = await lp.approve(contracts.booster.address, simpleToExactAmount(1));
    await waitForTx(tx, true, waitForBlocks);

    tx = await contracts.booster.deposit(0, simpleToExactAmount(1), true);
    await waitForTx(tx, true, waitForBlocks);

    tx = await contracts.booster.earmarkRewards(0);
    await waitForTx(tx, true, waitForBlocks);

    const tokenBptBal = await ERC20__factory.connect(config.addresses.tokenBpt, deployer).balanceOf(deployerAddress);
    tx = await ERC20__factory.connect(config.addresses.tokenBpt, deployer).approve(
        contracts.crvDepositor.address,
        tokenBptBal,
    );
    await waitForTx(tx, true, waitForBlocks);

    tx = await contracts.crvDepositor["deposit(uint256,bool,address)"](
        tokenBptBal,
        true,
        contracts.initialCvxCrvStaking.address,
    );
    await waitForTx(tx, true, waitForBlocks);
});

async function deployGoerli234(
    hre: HardhatRuntimeEnvironment,
    phase1: Phase1Deployed,
    distroList: DistroList,
    multisigs: MultisigConfig,
    naming: NamingConfig,
) {
    const deployer = await getSigner(hre);

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 2 ~~~
    // ~~~~~~~~~~~~~~~

    const phase2 = await deployPhase2(
        hre,
        deployer,
        phase1,
        distroList,
        multisigs,
        naming,
        config.addresses,
        true,
        waitForBlocks,
    );

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 3 ~~~
    // ~~~~~~~~~~~~~~~

    const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, config.addresses, true, waitForBlocks);

    // POST-PHASE-3

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 4 ~~~
    // ~~~~~~~~~~~~~~~

    // PRE-PHASE-4
    const tx = await phase3.poolManager.connect(deployer).setProtectPool(false);
    await waitForTx(tx, true, waitForBlocks);

    const phase4 = await deployPhase4(hre, deployer, phase3, config.addresses, true, waitForBlocks);
    return phase4;
}
