import { Signer } from "ethers";

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
} from "../types/generated";
import { deployContract } from "../tasks/utils";

export interface DeployMocksResult {
    lptoken: MockERC20;
    crv: MockERC20;
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
        0,
    ]);

    const lptoken = await deployContract<MockERC20>(new MockERC20__factory(deployer), "MockCRV", [
        "mockLPToken",
        "mockLPToken",
        18,
        deployerAddress,
        0,
    ]);

    const feeDistro = await deployContract<MockFeeDistro>(new MockFeeDistro__factory(deployer), "MockFeeDistro", [
        crv.address,
    ]);

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

    const tx = await registry.setAddress("0", feeDistro.address);
    await tx.wait();

    const gauge = await deployContract<MockCurveGauge>(new MockCurveGauge__factory(deployer), "MockCurveGauge", [
        "TestGauge",
        "TestGauge",
        lptoken.address,
        [],
    ]);

    return { lptoken, crv, voting, votingEscrow, registry, smartWalletChecker, feeDistro, gauge };
}
