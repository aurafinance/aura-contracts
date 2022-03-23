import { ZERO_ADDRESS, ZERO_KEY } from "./../test-utils/constants";
import { simpleToExactAmount } from "./../test-utils/math";
import { Signer } from "ethers";
import {
    MockERC20__factory,
    MockERC20,
    MockCurveVoteEscrow,
    MockCurveVoteEscrow__factory,
    MockVoting,
    MockVoting__factory,
    MockWalletChecker,
    MockWalletChecker__factory,
    MockFeeDistro,
    MockFeeDistro__factory,
    MockCurveGauge,
    MockCurveGauge__factory,
    MockCurveMinter__factory,
    MockCurveMinter,
} from "../types/generated";
import { deployContract } from "../tasks/utils";
import { MultisigConfig, DistroList, ExtSystemConfig, NamingConfig } from "./deploySystem";

interface DeployMocksResult {
    lptoken: MockERC20;
    crv: MockERC20;
    crvMinter: MockCurveMinter;
    voting: MockVoting;
    votingEscrow: MockCurveVoteEscrow;
    feeDistribution: MockFeeDistro;
    nativeTokenDistribution: MockFeeDistro;
    smartWalletChecker: MockWalletChecker;
    gauges: MockCurveGauge[];
    addresses: ExtSystemConfig;
    namingConfig: NamingConfig;
}

/** @dev Recreates the Convex distribution list */
function getMockDistro(): DistroList {
    return {
        miningRewards: simpleToExactAmount(50, 24),
        lpIncentives: simpleToExactAmount(25, 24),
        airdrops: [{ merkleRoot: ZERO_KEY, amount: simpleToExactAmount(2, 24) }],
        vesting: [
            { address: "0x1e1300EEAf333c572E4FC0133614291fa9d0df8B", amount: simpleToExactAmount(10, 24) },
            { address: "0x0cebb78bf382d3b9e5ae2b73930dc41a9a7a5e06", amount: simpleToExactAmount(3.286, 24) },
        ],
        treasury: { address: "0x1389388d01708118b497f59521f6943Be2541bb7", amount: simpleToExactAmount(9.7, 24) },
        partnerTreasury: { address: ZERO_ADDRESS, amount: simpleToExactAmount(0) },
        lpSeed: simpleToExactAmount(0.014, 24),
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
    };
}

async function deployMocks(signer: Signer, debug = false): Promise<DeployMocksResult> {
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    // -----------------------------
    // 1. Deployments
    // -----------------------------

    const crv = await deployContract<MockERC20>(
        new MockERC20__factory(deployer),
        "MockCRV",
        ["mockCrv", "mockCrv", 18, deployerAddress, 10000000],
        {},
        debug,
    );

    const crvMinter = await deployContract<MockCurveMinter>(
        new MockCurveMinter__factory(deployer),
        "MockCurveMinter",
        [crv.address, simpleToExactAmount(1, 18)],
        {},
        debug,
    );

    let tx = await crv.transfer(crvMinter.address, simpleToExactAmount(1, 22));
    await tx.wait();

    const lptoken = await deployContract<MockERC20>(
        new MockERC20__factory(deployer),
        "MockLPToken",
        ["mockLPToken", "mockLPToken", 18, deployerAddress, 10000000],
        {},
        debug,
    );

    const feeToken = await deployContract<MockERC20>(
        new MockERC20__factory(deployer),
        "FeeToken",
        ["Fee Token", "feeToken", 18, deployerAddress, 10000000],
        {},
        debug,
    );

    const feeDistro = await deployContract<MockFeeDistro>(
        new MockFeeDistro__factory(deployer),
        "MockFeeDistro",
        [feeToken.address, simpleToExactAmount(1)],
        {},
        debug,
    );

    tx = await feeToken.transfer(feeDistro.address, simpleToExactAmount(1, 22));
    await tx.wait();

    const nativeFeeDistro = await deployContract<MockFeeDistro>(
        new MockFeeDistro__factory(deployer),
        "MockFeeDistro",
        [crv.address, simpleToExactAmount(1)],
        {},
        debug,
    );

    tx = await crv.transfer(nativeFeeDistro.address, simpleToExactAmount(1, 22));
    await tx.wait();

    const smartWalletChecker = await deployContract<MockWalletChecker>(
        new MockWalletChecker__factory(deployer),
        "mockWalletChecker",
        [],
        {},
        debug,
    );

    const votingEscrow = await deployContract<MockCurveVoteEscrow>(
        new MockCurveVoteEscrow__factory(deployer),
        "MockCurveVoteEscrow",
        [smartWalletChecker.address, crv.address],
        {},
        debug,
    );

    const voting = await deployContract<MockVoting>(new MockVoting__factory(deployer), "MockVoting", [], {}, false);

    const gauges = [];

    for (let i = 0; i < 3; i++) {
        const gauge = await deployContract<MockCurveGauge>(
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

    return {
        lptoken,
        crv,
        crvMinter,
        voting,
        votingEscrow,
        smartWalletChecker,
        feeDistribution: feeDistro,
        nativeTokenDistribution: nativeFeeDistro,
        gauges,
        addresses: {
            token: crv.address,
            tokenWhale: deployerAddress,
            minter: crvMinter.address,
            votingEscrow: votingEscrow.address,
            feeDistribution: feeDistro.address,
            nativeTokenDistribution: nativeFeeDistro.address,
            gaugeController: voting.address,
            voteOwnership: voting.address,
            voteParameter: voting.address,
            gauges: gauges.map(g => g.address),
            // TODO - update these addresses with mocks
            balancerVault: ZERO_ADDRESS,
            balancerWeightedPoolFactory: ZERO_ADDRESS,
            weth: ZERO_ADDRESS,
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
