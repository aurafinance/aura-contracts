import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { BigNumber as BN } from "ethers";
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
import { impersonateAccount } from "../../test-utils/fork";
import { AssetHelpers } from "@balancer-labs/balancer-js";
import {
    IWalletChecker__factory,
    ICurveVoteEscrow__factory,
    MockERC20__factory,
    MockWalletChecker,
    MockWalletChecker__factory,
    ILBP__factory,
    VoterProxy__factory,
    ERC20__factory,
    BaseRewardPool__factory,
    MockERC20,
    IERC20__factory,
} from "../../types/generated";
import { ONE_DAY, ZERO_ADDRESS } from "../../test-utils/constants";

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
    balancerPoolId: null,
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

task("deploy:kovan:1").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();
    console.log(deployerAddress);

    const phase1 = await deployPhase1(hre, deployer, goerliBalancerConfig, false, true, waitForBlocks);
    console.log(phase1.voterProxy.address);
});

task("deploy:kovan:234").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();

    const phase1 = {
        voterProxy: await VoterProxy__factory.connect("", deployer),
    };

    const contracts = await deployKovan234(
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
    const lp = await ERC20__factory.connect(poolInfo.lptoken, deployer);

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

    tx = await lp.approve(contracts.booster.address, simpleToExactAmount(1));
    await waitForTx(tx, true, waitForBlocks);

    tx = await contracts.booster.deposit(0, simpleToExactAmount(1), true);
    await waitForTx(tx, true, waitForBlocks);

    tx = await BaseRewardPool__factory.connect(poolInfo.crvRewards, deployer)["getReward()"]();
    await waitForTx(tx, true, waitForBlocks);

    const bal = await contracts.cvx.balanceOf(deployerAddress);
    if (bal.lte(0)) {
        throw console.error("No CVX");
    }

    tx = await contracts.cvx.approve(contracts.cvxLocker.address, bal);
    await waitForTx(tx, true, waitForBlocks);

    tx = await contracts.cvxLocker.lock(await deployer.getAddress(), bal);
    await waitForTx(tx, true, waitForBlocks);

    tx = await IERC20__factory.connect(contracts.cvxCrvBpt.address, deployer).approve(
        contracts.chef.address,
        simpleToExactAmount(1),
    );
    await waitForTx(tx, true, waitForBlocks);

    tx = await contracts.chef.deposit(0, simpleToExactAmount(1));
    await waitForTx(tx, true, waitForBlocks);
});

task("deploy:kovan:mocka").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockCRV",
        ["sdfsdf", "sdfsdf", 18, await deployer.getAddress(), 10000000],
        {},
        true,
    );
});

task("deploy:kovan").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();
    console.log(deployerAddress);

    const distroList = getMockDistro();
    const multisigs = await getMockMultisigs(deployer, deployer, deployer);
    const naming = {
        cvxName: "Slipknot Finance",
        cvxSymbol: "SLK",
        vlCvxName: "Tightly tied Slipknot",
        vlCvxSymbol: "ttSLK",
        cvxCrvName: "Slipknot BUL",
        cvxCrvSymbol: "slkBUL",
        tokenFactoryNamePostfix: " Slipknot rope",
    };

    // ~~~~~~~~~~~~~~~~~~
    // ~~~ DEPLOYMENT ~~~
    // ~~~~~~~~~~~~~~~~~~

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 1 ~~~
    // ~~~~~~~~~~~~~~~
    const phase1 = await deployPhase1(hre, deployer, goerliBalancerConfig, false, true);

    // POST-PHASE-1
    // Whitelist the VoterProxy in the Curve system
    const walletChecker = await deployContract<MockWalletChecker>(
        hre,
        new MockWalletChecker__factory(deployer),
        "MockWalletChecker",
        [],
        {},
    );
    let tx = await walletChecker.approveWallet(phase1.voterProxy.address);
    await tx.wait();
    const aa = await impersonateAccount(goerliBalancerConfig.authorizerAdapter);
    const ve = ICurveVoteEscrow__factory.connect(goerliBalancerConfig.votingEscrow, aa.signer);
    tx = await ve.commit_smart_wallet_checker(walletChecker.address);
    await tx.wait();
    tx = await ve.apply_smart_wallet_checker();
    await tx.wait();

    await deployKovan234(hre, phase1, distroList, multisigs, naming);
});

async function deployKovan234(
    hre: HardhatRuntimeEnvironment,
    phase1: Phase1Deployed,
    distroList: DistroList,
    multisigs: MultisigConfig,
    naming: NamingConfig,
) {
    const { ethers } = hre;
    const deployer = await getSigner(hre);
    const balHelper = new AssetHelpers(goerliBalancerConfig.weth);

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
    // POST-PHASE-2
    const lbp = ILBP__factory.connect(phase2.lbpBpt.address, deployer);
    const currentTime = BN.from((await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp);
    const [, weights] = balHelper.sortTokens(
        [phase2.cvx.address, goerliBalancerConfig.weth],
        [simpleToExactAmount(10, 16), simpleToExactAmount(90, 16)],
    );
    let tx = await lbp.updateWeightsGradually(currentTime.add(3600), currentTime.add(ONE_DAY.mul(4)), weights as BN[]);
    await waitForTx(tx, true, waitForBlocks);
    tx = await lbp.setSwapEnabled(true);
    await waitForTx(tx, true, waitForBlocks);

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 3 ~~~
    // ~~~~~~~~~~~~~~~

    // PRE-PHASE-3
    const weth = await MockERC20__factory.connect(goerliBalancerConfig.weth, deployer);
    tx = await weth.transfer(phase2.balLiquidityProvider.address, simpleToExactAmount(400));
    await waitForTx(tx, true, waitForBlocks);

    const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, goerliBalancerConfig, true, waitForBlocks);

    // POST-PHASE-3

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 4 ~~~
    // ~~~~~~~~~~~~~~~

    // PRE-PHASE-4
    tx = await phase3.poolManager.connect(deployer).setProtectPool(false);
    await waitForTx(tx, true, waitForBlocks);

    const phase4 = await deployPhase4(hre, deployer, phase3, goerliBalancerConfig, true, waitForBlocks);
    return phase4;
}
