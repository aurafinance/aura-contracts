import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { BigNumber as BN } from "ethers";
import { waitForTx } from "../utils/deploy-utils";
import { getSigner } from "../utils";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4, ExtSystemConfig } from "../../scripts/deploySystem";
import { getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import { simpleToExactAmount } from "../../test-utils/math";
import { impersonateAccount } from "../../test-utils/fork";
import { AssetHelpers } from "@balancer-labs/balancer-js";
import {
    IWalletChecker__factory,
    ICurveVoteEscrow__factory,
    MockERC20__factory,
    IInvestmentPool__factory,
} from "../../types/generated";
import { ONE_DAY, ZERO_ADDRESS } from "../../test-utils/constants";

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

const naming = {
    cvxName: "Convex Finance",
    cvxSymbol: "CVX",
    vlCvxName: "Vote Locked Convex",
    vlCvxSymbol: "vlCVX",
    cvxCrvName: "Convex CRV",
    cvxCrvSymbol: "cvxCRV",
    tokenFactoryNamePostfix: " Convex Deposit",
};

task("deploy:mainnet:crv").setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers } = hre;
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();
    const balHelper = new AssetHelpers(curveSystem.weth);
    console.log(deployerAddress);

    const distroList = getMockDistro();
    const multisigs = await getMockMultisigs(deployer, deployer, deployer);

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
    const lbp = IInvestmentPool__factory.connect(phase2.lbpBpt.address, treasurySigner.signer);
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
