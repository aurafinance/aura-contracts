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
    IInvestmentPool__factory,
    VoterProxy__factory,
    ERC20__factory,
    BaseRewardPool__factory,
    MockERC20,
} from "../../types/generated";
import { ONE_DAY, ZERO_ADDRESS } from "../../test-utils/constants";

const kovanBalancerConfig: ExtSystemConfig = {
    authorizerAdapter: "0xeAF536c3202099365369597DD8207c4f5952e91e",
    token: "0xcb355677E36f390Ccc4a5d4bEADFbF1Eb2071c81",
    tokenBpt: "0xDC2EcFDf2688f92c85064bE0b929693ACC6dBcA6",
    minter: "0xE1008f2871F5f5c3da47f806dEbA3cD83Fe0E55B",
    votingEscrow: "0x0BA4d28a89b0aB0c48253f4f36B204DE24354651",
    voteOwnership: ZERO_ADDRESS,
    voteParameter: ZERO_ADDRESS,
    feeDistribution: ZERO_ADDRESS,
    gaugeController: "0x28bE1a58A534B281c3A22df28d3720323bfF331D",
    gauges: [
        "0xe190e5363c925513228bf25e4633c8cca4809c9a",
        "0x5e7b7b41377ce4b76d6008f7a91ff9346551c853",
        "0xf34d5e5715cc6cc9493f5bd252185e8acdc1de0d",
    ],
    balancerVault: "0xba12222222228d8ba445958a75a0704d566bf2c8",
    balancerPoolId: "0xdc2ecfdf2688f92c85064be0b929693acc6dbca6000200000000000000000701",
    balancerMinOutBps: "9975",
    balancerPoolFactories: {
        weightedPool2Tokens: "0xA5bf2ddF098bb0Ef6d120C98217dD6B141c74EE0",
        stablePool: "0x751dfDAcE1AD995fF13c927f6f761C6604532c79",
        investmentPool: "0xb08E16cFc07C684dAA2f93C70323BAdb2A6CBFd2",
    },
    weth: "0xdFCeA9088c8A88A76FF74892C1457C17dfeef9C1",
};

task("deploy:kovan:1").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();
    console.log(deployerAddress);

    const phase1 = await deployPhase1(hre, deployer, kovanBalancerConfig, false, true, 3);
    console.log(phase1.voterProxy.address);
});

task("deploy:kovan:234").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();

    const phase1 = {
        voterProxy: await VoterProxy__factory.connect("0xAf133908d1B435e1B58C91316AF3f17688a47A50", deployer),
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
    await waitForTx(tx, true, 3);

    tx = await contracts.booster.deposit(0, simpleToExactAmount(1), true);
    await waitForTx(tx, true, 3);

    tx = await contracts.booster.earmarkRewards(0);
    await waitForTx(tx, true, 3);

    const tokenBptBal = await ERC20__factory.connect(kovanBalancerConfig.tokenBpt, deployer).balanceOf(deployerAddress);
    tx = await ERC20__factory.connect(kovanBalancerConfig.tokenBpt, deployer).approve(
        contracts.crvDepositor.address,
        tokenBptBal,
    );
    await waitForTx(tx, true, 3);

    tx = await contracts.crvDepositor["deposit(uint256,bool,address)"](
        tokenBptBal,
        true,
        contracts.initialCvxCrvStaking.address,
    );
    await waitForTx(tx, true, 3);

    tx = await lp.approve(contracts.booster.address, simpleToExactAmount(1));
    await waitForTx(tx, true, 3);

    tx = await contracts.booster.deposit(0, simpleToExactAmount(1), true);
    await waitForTx(tx, true, 3);

    tx = await BaseRewardPool__factory.connect(poolInfo.crvRewards, deployer)["getReward()"]();
    await waitForTx(tx, true, 3);

    const bal = await contracts.cvx.balanceOf(deployerAddress);
    if (bal.lte(0)) {
        throw console.error("No CVX");
    }

    tx = await contracts.cvx.approve(contracts.cvxLocker.address, bal);
    await waitForTx(tx, true, 3);

    tx = await contracts.cvxLocker.lock(await deployer.getAddress(), bal);
    await waitForTx(tx, true, 3);
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
    const phase1 = await deployPhase1(hre, deployer, kovanBalancerConfig, false, true);

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
    const aa = await impersonateAccount(kovanBalancerConfig.authorizerAdapter);
    const ve = ICurveVoteEscrow__factory.connect(kovanBalancerConfig.votingEscrow, aa.signer);
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
    const balHelper = new AssetHelpers(kovanBalancerConfig.weth);

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
        kovanBalancerConfig,
        true,
        3,
    );
    // POST-PHASE-2
    const lbp = IInvestmentPool__factory.connect(phase2.lbpBpt.address, deployer);
    const currentTime = BN.from((await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp);
    const [, weights] = balHelper.sortTokens(
        [phase2.cvx.address, kovanBalancerConfig.weth],
        [simpleToExactAmount(10, 16), simpleToExactAmount(90, 16)],
    );
    let tx = await lbp.updateWeightsGradually(currentTime.add(3600), currentTime.add(ONE_DAY.mul(4)), weights as BN[]);
    await waitForTx(tx, true, 3);
    tx = await lbp.setSwapEnabled(true);
    await waitForTx(tx, true, 3);

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 3 ~~~
    // ~~~~~~~~~~~~~~~

    // PRE-PHASE-3
    const weth = await MockERC20__factory.connect(kovanBalancerConfig.weth, deployer);
    tx = await weth.transfer(phase2.balLiquidityProvider.address, simpleToExactAmount(400));
    await waitForTx(tx, true, 3);

    const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, kovanBalancerConfig, true, 3);

    // POST-PHASE-3

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 4 ~~~
    // ~~~~~~~~~~~~~~~

    // PRE-PHASE-4
    tx = await phase3.poolManager.connect(deployer).setProtectPool(false);
    await waitForTx(tx, true, 3);

    const phase4 = await deployPhase4(hre, deployer, phase3, kovanBalancerConfig, true, 3);
    return phase4;
}
