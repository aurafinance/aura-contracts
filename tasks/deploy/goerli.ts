import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { getSigner } from "../utils";
import { deployContract, logContracts, waitForTx } from "./../utils/deploy-utils";
import {
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    DistroList,
    ExtSystemConfig,
    MultisigConfig,
    NamingConfig,
    Phase1Deployed,
} from "../../scripts/deploySystem";
import { getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import { simpleToExactAmount } from "./../../test-utils/math";
import { VoterProxy__factory, ERC20__factory, UniswapMigrator, UniswapMigrator__factory } from "../../types/generated";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { config } from "./goerli-config";
const debug = true;
const goerliBalancerConfig: ExtSystemConfig = {
    authorizerAdapter: "0x5d90225de345ee24d1d2b6f45de90b056f5265a1",
    token: "0xfA8449189744799aD2AcE7e0EBAC8BB7575eff47",
    tokenBpt: "0xf8a0623ab66f985effc1c69d05f1af4badb01b00",
    minter: "0xdf0399539A72E2689B8B2DD53C3C2A0883879fDd",
    votingEscrow: "0x33A99Dcc4C85C014cf12626959111D5898bbCAbF",
    voteOwnership: ZERO_ADDRESS,
    voteParameter: ZERO_ADDRESS,
    feeDistribution: ZERO_ADDRESS,
    gaugeController: "0xBB1CE49b16d55A1f2c6e88102f32144C7334B116",
    gauges: [],
    balancerVault: "0xba12222222228d8ba445958a75a0704d566bf2c8",
    balancerPoolId: "0xf8a0623ab66f985effc1c69d05f1af4badb01b00000200000000000000000060",
    balancerMinOutBps: "9975",
    balancerPoolFactories: {
        weightedPool2Tokens: "0xA5bf2ddF098bb0Ef6d120C98217dD6B141c74EE0",
        stablePool: "0xD360B8afb3d7463bE823bE1Ec3c33aA173EbE86e",
        bootstrappingPool: "0xb48Cc42C45d262534e46d5965a9Ac496F1B7a830",
    },
    weth: "0xdFCeA9088c8A88A76FF74892C1457C17dfeef9C1",
};

const forking = false;
const waitForBlocks = forking ? undefined : 3;

task("deploy:goerli:1").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();
    console.log(deployerAddress);

    const phase1 = await deployPhase1(hre, deployer, goerliBalancerConfig, false, true, waitForBlocks);
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

    const tokenBptBal = await ERC20__factory.connect(goerliBalancerConfig.tokenBpt, deployer).balanceOf(
        deployerAddress,
    );
    tx = await ERC20__factory.connect(goerliBalancerConfig.tokenBpt, deployer).approve(
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
        goerliBalancerConfig,
        true,
        waitForBlocks,
    );

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 3 ~~~
    // ~~~~~~~~~~~~~~~

    const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, goerliBalancerConfig, true, waitForBlocks);

    // POST-PHASE-3

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 4 ~~~
    // ~~~~~~~~~~~~~~~

    // PRE-PHASE-4
    const tx = await phase3.poolManager.connect(deployer).setProtectPool(false);
    await waitForTx(tx, true, waitForBlocks);

    const phase4 = await deployPhase4(hre, deployer, phase3, goerliBalancerConfig, true, waitForBlocks);
    return phase4;
}

task("goerli:deploy:uniswapMigrator").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const { addresses } = config;
    const constructorArguments = [
        addresses.balancerPoolFactories.weightedPool,
        addresses.balancerVault,
        addresses.balancerGaugeFactory,
        addresses.uniswapRouter,
        addresses.sushiswapRouter,
        addresses.balancerPoolOwner,
    ];
    const uniswapMigrator = await deployContract<UniswapMigrator>(
        hre,
        new UniswapMigrator__factory(deployer),
        "UniswapMigrator",
        constructorArguments,
        {},
        debug,
        waitForBlocks,
    );

    console.log("update uniswapMigrator address to:", uniswapMigrator.address);
});
