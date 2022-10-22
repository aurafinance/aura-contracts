import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

import { deployContract, getSigner } from "tasks/utils";
import { config as mainnetConfig } from "./mainnet-config";
import { config as crossChainConfig } from "./cross-chain-config";
import { deployCrossChainL1, deployCrossChainL2 } from "scripts/deployCrossChain";
import { MockCurveMinter, MockCurveMinter__factory, MockERC20, MockERC20__factory } from "types";
import { simpleToExactAmount } from "test-utils";

const DEBUG = true;

const WAIT_FOR_BLOCKS = 4;

task("deploy:crosschain:goerli").setAction(async function (_: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const deployer = await getSigner(hre);

    const chainId = 5; // Ethereum Goerli

    const network = await hre.ethers.provider.getNetwork();
    const actualChainId = network.chainId;

    if (actualChainId !== chainId) {
        throw new Error(`Wrong chain, expected: ${chainId}`);
    }

    const contracts = await mainnetConfig.getPhase4(deployer);

    // We are making the assumption that after we run this task to deploy the
    // L1 cross chain contracts we will add the siphonGauge as the next pool
    // to the booster. Therefore the PID of the siphonGauge will be pools.length
    const pid = await contracts.booster.poolLength();

    const config = crossChainConfig[chainId];

    await deployCrossChainL1(
        {
            l2Coordinators: config.l2Coordinators,
            siphonDepositor: { pid },
            booster: contracts.booster.address,
            cvxLocker: contracts.cvxLocker.address,
            token: mainnetConfig.addresses.token,
            cvx: contracts.cvx.address,
            lzEndpoint: config.lzEndpoint,
        },
        deployer,
        hre,
        DEBUG,
        WAIT_FOR_BLOCKS,
    );
});

task("deploy:crosschain:arbitrum-goerli").setAction(async function (_: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();

    const chainId = 421613; // Ethereum Goerli

    const network = await hre.ethers.provider.getNetwork();
    const actualChainId = network.chainId;

    if (actualChainId !== chainId) {
        throw new Error(`Wrong chain, expected: ${chainId}`);
    }

    /* ---------------------------------------------------------------
     * Deploy Mocks
    --------------------------------------------------------------- */

    // - Mock minter (BAL minter)
    const mockMinter = await deployContract<MockCurveMinter>(
        hre,
        new MockCurveMinter__factory(deployer),
        "MockCurveMinter",
        [],
        {},
        DEBUG,
        WAIT_FOR_BLOCKS,
    );

    // - Mock token (BAL) (sending BAL to mock minter)
    const mockToken = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockToken",
        ["MockBAL", "MockBAL", 18, mockMinter.address, simpleToExactAmount(1000000)],
        {},
        DEBUG,
        WAIT_FOR_BLOCKS,
    );

    // - Mock tokenBpt (BAL BPT)
    const mockTokenBpt = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockToken",
        ["MockBAL-8020-bpt", "MockBAL-8020-bpt", 18, deployerAddress, simpleToExactAmount(1000000)],
        {},
        DEBUG,
        WAIT_FOR_BLOCKS,
    );

    /* ---------------------------------------------------------------
     * Deploy L2 system 
    --------------------------------------------------------------- */

    const config = crossChainConfig[chainId];

    await deployCrossChainL2(
        {
            canonicalChainId: config.canonicalChainId,
            lzEndpoint: config.lzEndpoint,
            minter: mockMinter.address,
            token: mockToken.address,
            tokenBpt: mockTokenBpt.address,
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
});
