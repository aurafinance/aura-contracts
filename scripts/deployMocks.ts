import { simpleToExactAmount } from "./../test-utils/math";
import { ethers, Signer } from "ethers";

import {
    MockERC20__factory,
    MockERC20,
    MockCurveVoteEscrow,
    MockCurveVoteEscrow__factory,
    MockVoting,
    MockVoting__factory,
    MockRegistry,
    MockRegistry__factory,
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

export interface DeployMocksResult {
    lptoken: MockERC20;
    crv: MockERC20;
    crvMinter: MockCurveMinter;
    voting: MockVoting;
    votingEscrow: MockCurveVoteEscrow;
    registry: MockRegistry;
    smartWalletChecker: MockWalletChecker;
    feeDistro: MockFeeDistro;
    gauge: MockCurveGauge;
}

export default async function deployMocks(signer: Signer): Promise<DeployMocksResult> {
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    // -----------------------------
    // 1. Deployments
    // -----------------------------

    const crv = await deployContract<MockERC20>(new MockERC20__factory(deployer), "MockCRV", [
        "mockCrv",
        "mockCrv",
        18,
        deployerAddress,
        10000000,
    ]);

    const crvMinter = await deployContract<MockCurveMinter>(new MockCurveMinter__factory(deployer), "MockCurveMinter", [
        crv.address,
        simpleToExactAmount(1, 18),
    ]);

    let tx = await crv.transfer(crvMinter.address, simpleToExactAmount(1, 22));
    await tx.wait();

    const lptoken = await deployContract<MockERC20>(new MockERC20__factory(deployer), "MockLPToken", [
        "mockLPToken",
        "mockLPToken",
        18,
        deployerAddress,
        10000000,
    ]);

    const feeToken = await deployContract<MockERC20>(new MockERC20__factory(deployer), "FeeToken", [
        "Fee Token",
        "feeToken",
        18,
        deployerAddress,
        10000000,
    ]);

    const feeDistro = await deployContract<MockFeeDistro>(new MockFeeDistro__factory(deployer), "MockFeeDistro", [
        feeToken.address,
        simpleToExactAmount(1),
    ]);

    tx = await feeToken.transfer(feeDistro.address, simpleToExactAmount(1, 22));
    await tx.wait();

    const smartWalletChecker = await deployContract<MockWalletChecker>(
        new MockWalletChecker__factory(deployer),
        "mockWalletChecker",
        [],
    );

    const votingEscrow = await deployContract<MockCurveVoteEscrow>(
        new MockCurveVoteEscrow__factory(deployer),
        "MockCurveVoteEscrow",
        [smartWalletChecker.address, crv.address],
    );

    const voting = await deployContract<MockVoting>(new MockVoting__factory(deployer), "MockVoting", []);

    const registry = await deployContract<MockRegistry>(new MockRegistry__factory(deployer), "MockRegistry", []);

    tx = await registry.setAddress("0", feeDistro.address);
    await tx.wait();

    const gauge = await deployContract<MockCurveGauge>(new MockCurveGauge__factory(deployer), "MockCurveGauge", [
        "TestGauge",
        "tstGauge",
        lptoken.address,
        [],
    ]);

    return { lptoken, crv, crvMinter, voting, votingEscrow, registry, smartWalletChecker, feeDistro, gauge };
}
