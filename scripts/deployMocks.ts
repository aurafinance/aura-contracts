import { Signer } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deployContract } from "../tasks/utils";
import {
    LZEndpointMock,
    LZEndpointMock__factory,
    MockBalancerPoolToken,
    MockBalancerPoolToken__factory,
    MockBalancerVault,
    MockBalancerVault__factory,
    MockCurveGauge,
    MockCurveGauge__factory,
    MockCurveMinter,
    MockCurveMinter__factory,
    MockCurveVoteEscrow,
    MockCurveVoteEscrow__factory,
    MockERC20,
    MockERC20__factory,
    MockFeeDistributor,
    MockFeeDistributor__factory,
    MockVoting,
    MockVoting__factory,
    MockWalletChecker,
    MockWalletChecker__factory,
} from "../types/generated";
import { ONE_WEEK, ZERO_ADDRESS, ZERO_KEY } from "./../test-utils/constants";
import { simpleToExactAmount } from "./../test-utils/math";
import { DistroList, ExtSystemConfig, MultisigConfig, NamingConfig } from "./deploySystem";

interface DeployMocksResult {
    lptoken: MockERC20;
    crv: MockERC20;
    crvMinter: MockCurveMinter;
    voting: MockVoting;
    votingEscrow: MockCurveVoteEscrow;
    feeDistribution: MockFeeDistributor;
    smartWalletChecker: MockWalletChecker;
    gauges: MockCurveGauge[];
    crvBpt: MockBalancerPoolToken;
    balancerVault: MockBalancerVault;
    bal: MockERC20;
    weth: MockERC20;
    lzEndpoint: LZEndpointMock;
    addresses: ExtSystemConfig;
    namingConfig: NamingConfig;
}
/** @dev Recreates the Convex distribution list */
function getMockDistro(): DistroList {
    return {
        miningRewards: simpleToExactAmount(50, 24),
        lpIncentives: simpleToExactAmount(10, 24),
        cvxCrvBootstrap: simpleToExactAmount(2, 24),
        lbp: {
            tknAmount: simpleToExactAmount(2.2, 24),
            wethAmount: simpleToExactAmount(50),
            matching: simpleToExactAmount(2.8, 24),
        },
        airdrops: [
            {
                merkleRoot: ZERO_KEY,
                startDelay: ONE_WEEK,
                length: ONE_WEEK.mul(3),
                amount: simpleToExactAmount(2.5, 24),
            },
            {
                merkleRoot: ZERO_KEY,
                startDelay: ONE_WEEK.mul(26),
                length: ONE_WEEK.mul(8),
                amount: simpleToExactAmount(1, 24),
            },
        ],
        immutableVesting: [
            {
                period: ONE_WEEK.mul(16),
                recipients: [
                    { address: "0x1e1300EEAf333c572E4FC0133614291fa9d0df8B", amount: simpleToExactAmount(0.5, 24) },
                ],
            },
        ],
        vesting: [
            {
                period: ONE_WEEK.mul(16),
                recipients: [
                    { address: "0x1e1300EEAf333c572E4FC0133614291fa9d0df8B", amount: simpleToExactAmount(0.5, 24) }, // Team vesting
                ],
            },
            {
                period: ONE_WEEK.mul(104),
                recipients: [
                    { address: "0x0cebb78bf382d3b9e5ae2b73930dc41a9a7a5e06", amount: simpleToExactAmount(9, 24) }, // Team vesting
                    { address: "0x0cebb78bf382d3b9e5ae2b73930dc41a9a7a5e06", amount: simpleToExactAmount(2, 24) }, // Partner Treasury
                ],
            },
            {
                period: ONE_WEEK.mul(208),
                recipients: [
                    { address: "0x0cebb78bf382d3b9e5ae2b73930dc41a9a7a5e06", amount: simpleToExactAmount(17.5, 24) }, // Treasury
                ],
            },
        ],
    };
}

/** @dev Simply fetches the addresses of the given signers to act as respective multisigs */
async function getMockMultisigs(
    vestingSigner: Signer,
    treasurySigner: Signer,
    daoSigner: Signer,
): Promise<MultisigConfig> {
    return {
        vestingMultisig: await vestingSigner.getAddress(),
        treasuryMultisig: await treasurySigner.getAddress(),
        daoMultisig: await daoSigner.getAddress(),
        sudoMultisig: await daoSigner.getAddress(),
        pauseGaurdian: await daoSigner.getAddress(),
    };
}

async function deployMocks(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    chainId = 111,
): Promise<DeployMocksResult> {
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    // -----------------------------
    // 1. Deployments
    // -----------------------------

    const crv = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockCRV",
        ["mockCrv", "mockCrv", 18, deployerAddress, 10000000],
        {},
        debug,
    );

    const crvBpt = await deployContract<MockBalancerPoolToken>(
        hre,
        new MockBalancerPoolToken__factory(deployer),
        "MockBalancerPoolToken",
        [18, deployerAddress, 100],
        {},
        debug,
    );

    const crvMinter = await deployContract<MockCurveMinter>(
        hre,
        new MockCurveMinter__factory(deployer),
        "MockCurveMinter",
        [crv.address, simpleToExactAmount(1, 18)],
        {},
        debug,
    );

    let tx = await crv.transfer(crvMinter.address, simpleToExactAmount(1, 22));
    await tx.wait();

    const lptoken = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockLPToken",
        ["mockLPToken", "mockLPToken", 18, deployerAddress, 10000000],
        {},
        debug,
    );

    const feeDistro = await deployContract<MockFeeDistributor>(
        hre,
        new MockFeeDistributor__factory(deployer),
        "MockFeeDistributor",
        [
            [lptoken.address, crv.address],
            [simpleToExactAmount(1), simpleToExactAmount(1)],
        ],
        {},
        debug,
    );

    tx = await lptoken.transfer(feeDistro.address, simpleToExactAmount(1, 22));
    await tx.wait();

    tx = await crv.transfer(feeDistro.address, simpleToExactAmount(1, 22));
    await tx.wait();

    const smartWalletChecker = await deployContract<MockWalletChecker>(
        hre,
        new MockWalletChecker__factory(deployer),
        "mockWalletChecker",
        [],
        {},
        debug,
    );

    const votingEscrow = await deployContract<MockCurveVoteEscrow>(
        hre,
        new MockCurveVoteEscrow__factory(deployer),
        "MockCurveVoteEscrow",
        [smartWalletChecker.address, crvBpt.address],
        {},
        debug,
    );

    const voting = await deployContract<MockVoting>(
        hre,
        new MockVoting__factory(deployer),
        "MockVoting",
        [],
        {},
        false,
    );

    const gauges: MockCurveGauge[] = [];

    for (let i = 0; i < 3; i++) {
        const gauge = await deployContract<MockCurveGauge>(
            hre,
            new MockCurveGauge__factory(deployer),
            "MockCurveGauge",
            [`TestGauge_${i + 1}`, `tstGauge_${i + 1}`, lptoken.address, []],
            {},
            debug,
        );

        const tx = await voting.vote_for_gauge_weights(gauge.address, 1);
        await tx.wait();
        gauges.push(gauge);
    }

    tx = await crvBpt.setPrice(parseEther("2.40"));
    await tx.wait();

    const balancerVault = await deployContract<MockBalancerVault>(
        hre,
        new MockBalancerVault__factory(deployer),
        "MockBalancerVault",
        [crvBpt.address],
        {},
        debug,
    );

    const bal = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockBAL",
        ["mockBAL", "mockBAL", 18, deployerAddress, 10000000],
        {},
        debug,
    );

    const weth = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockWETH",
        ["mockWETH", "mockWETH", 18, deployerAddress, 10000000],
        {},
        debug,
    );
    const feeToken = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockFeeToken",
        ["mockFeeToken", "mockFeeToken", 18, deployerAddress, 10000000],
        {},
        debug,
    );

    // -----------------------------
    // 2 Sidechain
    // -----------------------------
    const lzEndpoint = await deployContract<LZEndpointMock>(
        hre,
        new LZEndpointMock__factory(deployer),
        "lzEndpoint",
        [chainId],
        {},
        debug,
    );
    return {
        lptoken,
        crv,
        crvMinter,
        voting,
        votingEscrow,
        smartWalletChecker,
        feeDistribution: feeDistro,
        gauges,
        crvBpt,
        balancerVault,
        bal,
        weth,
        lzEndpoint,
        addresses: {
            token: crv.address,
            tokenBpt: crvBpt.address,
            tokenWhale: deployerAddress,
            minter: crvMinter.address,
            votingEscrow: votingEscrow.address,
            feeDistribution: feeDistro.address,
            gaugeController: voting.address,
            voteOwnership: voting.address,
            voteParameter: voting.address,
            gauges: gauges.map(g => g.address),
            balancerGaugeFactory: ZERO_ADDRESS,
            balancerVault: balancerVault.address,
            balancerPoolOwner: "0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B",
            balancerPoolFactories: {
                weightedPool: ZERO_ADDRESS,
                weightedPool2Tokens: ZERO_ADDRESS,
                stablePool: ZERO_ADDRESS,
                bootstrappingPool: ZERO_ADDRESS,
            },
            balancerPoolId: ZERO_KEY,
            balancerMinOutBps: "9975",
            weth: weth.address,
            wethWhale: deployerAddress,
            uniswapRouter: ZERO_ADDRESS,
            sushiswapRouter: ZERO_ADDRESS,
            auraBalGauge: gauges[0].address,
            feeToken: feeToken.address,
            feeTokenHandlerPath: {
                poolIds: [ZERO_KEY],
                assetsIn: [feeToken.address],
            },
            lzEndpoint: lzEndpoint.address,
            sidechain: {
                auraBalInflowLimit: parseEther("1000000"),
                auraInflowLimit: parseEther("1000000"),
            },
        },
        namingConfig: {
            cvxName: "Convex Finance",
            cvxSymbol: "CVX",
            vlCvxName: "Vote Locked CVX",
            vlCvxSymbol: "vlCVX",
            cvxCrvName: "Convex CRV",
            cvxCrvSymbol: "cvxCRV",
            tokenFactoryNamePostfix: " Convex Deposit",
        },
    };
}

export { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs };
