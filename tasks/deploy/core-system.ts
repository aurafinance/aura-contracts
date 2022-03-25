import { deployContract } from "./../utils/deploy-utils";
import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { BigNumber as BN, ContractReceipt, ContractTransaction } from "ethers";
import { getSigner } from "../utils";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4, ExtSystemConfig } from "../../scripts/deploySystem";
import { deployMocks, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
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
} from "../../types/generated";
import { ONE_DAY, ZERO_ADDRESS } from "../../test-utils/constants";

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

async function waitForTx(tx: ContractTransaction, debug = false): Promise<ContractReceipt> {
    const receipt = await tx.wait();
    if (debug) {
        console.log(`\nTRANSACTION: ${receipt.transactionHash}`);
        console.log(`to:: ${tx.to}`);
        console.log(`txData:: ${tx.data}`);
    }
    return receipt;
}

const curveSystem: ExtSystemConfig = {
    token: "0xD533a949740bb3306d119CC777fa900bA034cd52",
    tokenBpt: "0xD533a949740bb3306d119CC777fa900bA034cd52",
    tokenWhale: "0x7a16fF8270133F063aAb6C9977183D9e72835428",
    minter: "0xd061D61a4d941c39E5453435B6345Dc261C2fcE0",
    votingEscrow: "0x5f3b5DfEb7B28CDbD7FAba78963EE202a494e2A2",
    feeDistribution: "0xA464e6DCda8AC41e03616F95f4BC98a13b8922Dc",
    gaugeController: "0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB",
    voteOwnership: "0xe478de485ad2fe566d49342cbd03e49ed7db3356",
    voteParameter: "0xbcff8b0b9419b9a88c44546519b1e909cf330399",
    gauges: ["0xBC89cd85491d81C6AD2954E6d0362Ee29fCa8F53"],
    balancerVault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    balancerPoolId: "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014",
    balancerMinOutBps: "9975",
    balancerPoolFactories: {
        weightedPool2Tokens: "0xA5bf2ddF098bb0Ef6d120C98217dD6B141c74EE0",
        stablePool: "0xc66Ba2B6595D3613CCab350C886aCE23866EDe24",
        investmentPool: "0x48767F9F868a4A7b86A90736632F6E44C2df7fa9",
    },
    weth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    wethWhale: "0xC564EE9f21Ed8A2d8E7e76c085740d5e4c5FaFbE",
};

task("deploy:mainnet:crv").setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers } = hre;
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();
    const balHelper = new AssetHelpers(curveSystem.weth);
    console.log(deployerAddress);

    const distroList = getMockDistro();
    const multisigs = await getMockMultisigs(deployer, deployer, deployer);
    const naming = {
        cvxName: "Convex Finance",
        cvxSymbol: "CVX",
        vlCvxName: "Vote Locked Convex",
        vlCvxSymbol: "vlCVX",
        cvxCrvName: "Convex CRV",
        cvxCrvSymbol: "cvxCRV",
        tokenFactoryNamePostfix: " Convex Deposit",
    };

    // ~~~ SET UP BALANCES ~~~

    // crvBPT for initialLock && cvxCrv/crvBPT pair
    const tokenWhaleSigner = await impersonateAccount(curveSystem.tokenWhale);
    const crv = MockERC20__factory.connect(curveSystem.token, tokenWhaleSigner.signer);
    let tx = await crv.transfer(deployerAddress, simpleToExactAmount(1000));
    await waitForTx(tx, true);

    // weth for LBP creation
    const wethWhaleSigner = await impersonateAccount(curveSystem.wethWhale);
    const weth = await MockERC20__factory.connect(curveSystem.weth, wethWhaleSigner.signer);
    tx = await weth.transfer(deployerAddress, simpleToExactAmount(50));
    await waitForTx(tx, true);

    // ~~~~~~~~~~~~~~~~~~
    // ~~~ DEPLOYMENT ~~~
    // ~~~~~~~~~~~~~~~~~~

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 1 ~~~
    // ~~~~~~~~~~~~~~~
    const phase1 = await deployPhase1(deployer, curveSystem, false, true);

    // POST-PHASE-1
    // Whitelist the VoterProxy in the Curve system
    const ve = ICurveVoteEscrow__factory.connect(curveSystem.votingEscrow, deployer);
    const walletChecker = IWalletChecker__factory.connect(await ve.smart_wallet_checker(), deployer);
    const owner = await walletChecker.dao();
    const ownerSigner = await impersonateAccount(owner);
    tx = await walletChecker.connect(ownerSigner.signer).approveWallet(phase1.voterProxy.address);
    await waitForTx(tx, true);

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 2 ~~~
    // ~~~~~~~~~~~~~~~

    const phase2 = await deployPhase2(hre, deployer, phase1, distroList, multisigs, naming, curveSystem, true);
    // POST-PHASE-2
    const treasurySigner = await impersonateAccount(multisigs.treasuryMultisig);
    const lbp = IInvestmentPool__factory.connect(phase2.lbp, treasurySigner.signer);
    const currentTime = BN.from((await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp);
    const [, weights] = balHelper.sortTokens(
        [phase2.cvx.address, curveSystem.weth],
        [simpleToExactAmount(10, 16), simpleToExactAmount(90, 16)],
    );
    tx = await lbp.updateWeightsGradually(currentTime.add(3600), currentTime.add(ONE_DAY.mul(4)), weights as BN[]);
    await waitForTx(tx, true);
    tx = await lbp.setSwapEnabled(true);
    await waitForTx(tx, true);

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 3 ~~~
    // ~~~~~~~~~~~~~~~

    // PRE-PHASE-3
    tx = await weth.transfer(phase2.balLiquidityProvider.address, simpleToExactAmount(500));
    await waitForTx(tx, true);

    const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, curveSystem, true);

    // POST-PHASE-3

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 4 ~~~
    // ~~~~~~~~~~~~~~~

    // PRE-PHASE-4
    const multisigSigner = await impersonateAccount(multisigs.daoMultisig);
    tx = await phase3.poolManager.connect(multisigSigner.signer).setProtectPool(false);
    await waitForTx(tx, true);

    const phase4 = await deployPhase4(deployer, phase3, curveSystem, true);
    return phase4;
});

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

    const phase1 = await deployPhase1(deployer, kovanBalancerConfig, false, true);
    console.log(phase1.voterProxy.address);
});

task("deploy:kovan").setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers } = hre;
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();
    const balHelper = new AssetHelpers(kovanBalancerConfig.weth);
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
    const phase1 = await deployPhase1(deployer, kovanBalancerConfig, false, true);

    // POST-PHASE-1
    // Whitelist the VoterProxy in the Curve system
    const walletChecker = await deployContract<MockWalletChecker>(
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

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 2 ~~~
    // ~~~~~~~~~~~~~~~

    const phase2 = await deployPhase2(hre, deployer, phase1, distroList, multisigs, naming, kovanBalancerConfig, true);
    // POST-PHASE-2
    const lbp = IInvestmentPool__factory.connect(phase2.lbp, deployer);
    const currentTime = BN.from((await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp);
    const [, weights] = balHelper.sortTokens(
        [phase2.cvx.address, kovanBalancerConfig.weth],
        [simpleToExactAmount(10, 16), simpleToExactAmount(90, 16)],
    );
    tx = await lbp.updateWeightsGradually(currentTime.add(3600), currentTime.add(ONE_DAY.mul(4)), weights as BN[]);
    await waitForTx(tx, true);
    tx = await lbp.setSwapEnabled(true);
    await waitForTx(tx, true);

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 3 ~~~
    // ~~~~~~~~~~~~~~~

    // PRE-PHASE-3
    const weth = await MockERC20__factory.connect(kovanBalancerConfig.weth, deployer);
    tx = await weth.transfer(phase2.balLiquidityProvider.address, simpleToExactAmount(400));
    await waitForTx(tx, true);

    const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, kovanBalancerConfig, true);

    // POST-PHASE-3

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 4 ~~~
    // ~~~~~~~~~~~~~~~

    // PRE-PHASE-4
    tx = await phase3.poolManager.connect(deployer).setProtectPool(false);
    await waitForTx(tx, true);

    const phase4 = await deployPhase4(deployer, phase3, kovanBalancerConfig, true);
    return phase4;
});

task("deploy:testnet").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    console.log(await deployer.getAddress());

    const mocks = await deployMocks(deployer, true);
    const multisigs = await getMockMultisigs(deployer, deployer, deployer);
    const distro = getMockDistro();

    const phase1 = await deployPhase1(deployer, mocks.addresses, true, true);
    const phase2 = await deployPhase2(
        hre,
        deployer,
        phase1,
        distro,
        multisigs,
        mocks.namingConfig,
        mocks.addresses,
        true,
    );
    const tx = await mocks.weth.transfer(phase2.balLiquidityProvider.address, simpleToExactAmount(500));
    await tx.wait();

    const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses, true);
    const contracts = await deployPhase4(deployer, phase3, mocks.addresses, true);

    logExtSystem(mocks.addresses);
    logContracts(contracts as unknown as { [key: string]: { address: string } });
});

task("postDeploy:rinkeby").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    console.log(await deployer.getAddress());

    // const sys: ExtSystemConfig = {
    //     token: "0x65c29b54d701DeF26000aA85193915B0c5dB9822",
    //     tokenWhale: "0xbE126Fd179822c5Cb72b0e6E584a6F7afeb9eaBE",
    //     minter: "0x44d7eb6e0fF0863f16AbC3a9fDa8D49Dab879e40",
    //     votingEscrow: "0x0e0837C8DA3C1931831Cc9aC2c19265AAa16cF97",
    //     gaugeController: "0xbce229725bc29e88f351e20176f7ad003CB7bbf7",
    //     feeDistribution: "",
    //     nativeTokenDistribution: "",
    //     voteOwnership: "0xbce229725bc29e88f351e20176f7ad003CB7bbf7",
    //     voteParameter: "0xbce229725bc29e88f351e20176f7ad003CB7bbf7",
    //     gauges: [
    //         "0x877B96Bf9ee1a365872A269482BF213910994Ac6",
    //         "0x156c44B88FBA5B65083758e7D1634c9fD27F0a31",
    //         "0x65964D0d66B9b5dbd0d548a5064a1d4601A0a168",
    //     ],
    //     balancerVault: "0x0000000000000000000000000000000000000000",
    //     balancerWeightedPoolFactory: "0x0000000000000000000000000000000000000000",
    //     weth: "0x0000000000000000000000000000000000000000",
    // };
    // const cvxSys: SystemDeployed = {
    //     voterProxy: CurveVoterProxy__factory.connect("0xF5940797f21BdEDDD2E2A884DcD7c688c1bAd13a", deployer),
    //     cvx: AuraToken__factory.connect("0xE6Adf2BFE209586c2b623e564194B73B14Bf2866", deployer),
    //     minter: AuraMinter__factory.connect("0xBeb1Dc260DA7C79264359d43A88901B080F9A30b", deployer),
    //     booster: Booster__factory.connect("0xF3BA38823F5bf8C315c747861539eE27081357Cb", deployer),
    //     boosterOwner: BoosterOwner__factory.connect("0xEC1a6e61f7c4864Cf8bfcf5BcEEFeE6259D6A2B6", deployer),
    //     cvxCrv: CvxCrvToken__factory.connect("0x0422a859FeCF2576e2201209AE02eFff916AfCF4", deployer),
    //     cvxCrvRewards: BaseRewardPool__factory.connect("0x2c9e3F6953B7e7675Eb448ED85666Ece4A109389", deployer),
    //     crvDepositor: CrvDepositor__factory.connect("0x9044439962dedD4dF5e032ADD45e16Eb609f72B7", deployer),
    //     poolManager: PoolManagerV3__factory.connect("0xF5713ba15e6B2397D86C519BF5DA83F8955f4640", deployer),
    //     cvxLocker: AuraLocker__factory.connect("0x2E05Cef94C259b6092E14f631Eb20094f7DDDC63", deployer),
    //     cvxStakingProxy: AuraStakingProxy__factory.connect("0x1DAB1cC828cfb71C379D6EE18468b02DEAe9Aa5E", deployer),
    //     vestedEscrows: [VestedEscrow__factory.connect("0x34f23e3577b85102dc01e3b5af1fd92d4970019e", deployer)],
    //     dropFactory: MerkleAirdropFactory__factory.connect("0x2d53Feee8A4a94b2FA4C72551db96BEadC3f383C", deployer),
    //     claimZap: ClaimZap__factory.connect("0x779688dC607607bF84FCb4B09C4474E2F2A23696", deployer),
    // };

    // const poolInfo = await cvxSys.booster.poolInfo(0);
    // const lp = await ERC20__factory.connect(poolInfo.lptoken, deployer);

    // let tx = await lp.approve(cvxSys.booster.address, simpleToExactAmount(100));
    // await tx.wait();

    // tx = await cvxSys.booster.deposit(0, simpleToExactAmount(100), true);
    // await tx.wait();

    // tx = await cvxSys.cvx.approve(cvxSys.cvxLocker.address, simpleToExactAmount(100));
    // await tx.wait();

    // tx = await cvxSys.cvxLocker.lock(await deployer.getAddress(), simpleToExactAmount(100));
    // await tx.wait();

    // tx = await cvxSys.booster.earmarkRewards(0);
    // await tx.wait();

    // tx = await cvxSys.cvxStakingProxy.distribute();
    // await tx.wait();

    // tx = await ERC20__factory.connect(sys.token, deployer).approve(
    //     cvxSys.crvDepositor.address,
    //     simpleToExactAmount(100),
    // );
    // await tx.wait();

    // tx = await cvxSys.crvDepositor["deposit(uint256,bool,address)"](
    //     simpleToExactAmount(100),
    //     true,
    //     cvxSys.cvxCrvRewards.address,
    // );
    // await tx.wait();

    // tx = await lp.approve(cvxSys.booster.address, simpleToExactAmount(100));
    // await tx.wait();

    // tx = await cvxSys.booster.deposit(0, simpleToExactAmount(100), true);
    // await tx.wait();
});
