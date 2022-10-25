import { task } from "hardhat/config";
import { ContractTransaction } from "ethers";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

import {
    MockCurveGauge,
    MockCurveGauge__factory,
    MockCurveMinter,
    MockCurveMinter__factory,
    MockERC20,
    MockERC20__factory,
} from "../../types";
import { deployContract, getSigner, waitForTx } from "../utils";
import { config as goerliConfig } from "./goerli-config";
import { config as crossChainConfig } from "./cross-chain-config";
import { deployCrossChainL1, deployCrossChainL2 } from "../../scripts/deployCrossChain";
import { simpleToExactAmount } from "../../test-utils/math";

const DEBUG = true;

const WAIT_FOR_BLOCKS = 4;

task("deploy:crosschain:goerli").setAction(async function (_: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const deployer = await getSigner(hre);

    const chainId = 5; // Ethereum Goerli

    const network = await hre.ethers.provider.getNetwork();
    const actualChainId = network.chainId;

    if (actualChainId !== chainId) {
        throw new Error(`Wrong chain, expected: ${chainId} got: ${actualChainId}`);
    }

    const contracts = await goerliConfig.getPhase4(deployer);

    /*------------------------------------------------------------------------
     * Deployment
     *----------------------------------------------------------------------*/

    // We are making the assumption that nobody is going to frontrun this deployment
    // and get in between this poolLength call and the call to add the pool
    // Therefore the PID of the siphonGauge will be pools.length
    const pid = await contracts.booster.poolLength();

    const config = crossChainConfig[chainId];

    const deployment = await deployCrossChainL1(
        {
            l2Coordinators: config.l2Coordinators,
            siphonDepositor: { pid },
            booster: contracts.booster.address,
            cvxLocker: contracts.cvxLocker.address,
            token: goerliConfig.addresses.token,
            cvx: contracts.cvx.address,
            lzEndpoint: config.lzEndpoint,
        },
        deployer,
        hre,
        DEBUG,
        WAIT_FOR_BLOCKS,
    );

    /*------------------------------------------------------------------------
     * Setup
     *----------------------------------------------------------------------*/

    let tx: ContractTransaction;

    // Set up trusted remote on the siphon depositor
    for (const l2Coordinator of config.l2Coordinators) {
        const path = hre.ethers.utils.solidityPack(
            ["address", "address"],
            [l2Coordinator.address, deployment.siphonDepositor.address],
        );
        tx = await deployment.siphonDepositor.setTrustedRemote(l2Coordinator.chainId, path);
        await waitForTx(tx);
    }

    // Add pool to Booster
    tx = await contracts.poolManager.forceAddPool(deployment.siphonToken.address, deployment.siphonGauge.address, 3);
    await waitForTx(tx);

    // Deposit LP tokens into pool from depositor
    tx = await deployment.siphonDepositor.setApprovals();
    await waitForTx(tx);
    tx = await deployment.siphonDepositor.deposit();
    await waitForTx(tx);

    // Fund siphonDepositor manually with BAL
});

task("deploy:crosschain:arbitrum-goerli").setAction(async function (_: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();

    const chainId = 421613; // Ethereum Goerli

    const network = await hre.ethers.provider.getNetwork();
    const actualChainId = network.chainId;

    if (actualChainId !== chainId) {
        throw new Error(`Wrong chain, expected: ${chainId} got: ${actualChainId}`);
    }

    let tx: ContractTransaction;

    /*------------------------------------------------------------------------
     * Deploy Mocks
     *----------------------------------------------------------------------*/

    const mintAmount = simpleToExactAmount(1000000);

    // Mock token (BAL) (sending BAL to mock minter)
    const mockToken = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockToken",
        ["MockBAL", "MockBAL", 18, deployerAddress, mintAmount],
        {},
        DEBUG,
        WAIT_FOR_BLOCKS,
    );

    // Mock minter (BAL minter)
    const mockMinter = await deployContract<MockCurveMinter>(
        hre,
        new MockCurveMinter__factory(deployer),
        "MockCurveMinter",
        [mockToken.address, simpleToExactAmount(1)],
        {},
        DEBUG,
        WAIT_FOR_BLOCKS,
    );

    // Send mockToken to mockMinter
    tx = await mockToken.transfer(mockMinter.address, mintAmount);
    await waitForTx(tx);

    // Mock tokenBpt (Balancer Pool Token)
    const mockTokenBpt = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockToken",
        ["MockBAL-8020-bpt", "MockBAL-8020-bpt", 18, deployerAddress, simpleToExactAmount(1000000)],
        {},
        DEBUG,
        WAIT_FOR_BLOCKS,
    );

    // Mock Gauge
    const mockGauge = await deployContract<MockCurveGauge>(
        hre,
        new MockCurveGauge__factory(deployer),
        "MockCurveGauge",
        ["MockCurveGauge", "MCG", mockTokenBpt.address, []],
        {},
        DEBUG,
        WAIT_FOR_BLOCKS,
    );

    /*------------------------------------------------------------------------
     * Deploy L2 system
     *----------------------------------------------------------------------*/

    const config = crossChainConfig[chainId];

    const deployment = await deployCrossChainL2(
        {
            canonicalChainId: config.canonicalChainId,
            lzEndpoint: config.lzEndpoint,
            minter: mockMinter.address,
            token: mockToken.address,
            naming: {
                tokenFactoryNamePostfix: config.naming.tokenFactoryNamePostfix,
                cvxSymbol: config.naming.cvxSymbol,
                cvxName: config.naming.cvxName,
            },
        },
        deployer,
        hre,
        DEBUG,
        WAIT_FOR_BLOCKS,
    );

    /*------------------------------------------------------------------------
     * Setup
     *----------------------------------------------------------------------*/

    tx = await deployment.poolManager["addPool(address)"](mockGauge.address);
    await waitForTx(tx);

    // Manually need to set trusted remote
});

task("crosschain:trusted-remotes")
    .addPositionalParam("remote")
    .addPositionalParam("local")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const path = hre.ethers.utils.solidityPack(["address", "address"], [taskArgs.remote, taskArgs.local]);
        console.log("Path:", path);
    });
