import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ExtSidechainConfig, SidechainMultisigConfig, SidechainNaming } from "types/sidechain-types";
import { sidechainNaming } from "../tasks/deploy/sidechain-constants";
import { deployContract } from "../tasks/utils";
import { ZERO_ADDRESS } from "../test-utils";
import { simpleToExactAmount } from "../test-utils/math";
import {
    MockBalancerPoolToken,
    MockBalancerPoolToken__factory,
    MockCurveGauge,
    MockCurveGauge__factory,
    MockCurveMinter,
    MockCurveMinter__factory,
    MockERC20,
    MockERC20__factory,
} from "../types/generated";

interface DeployL2MocksResult {
    token: MockERC20;
    minter: MockCurveMinter;
    gauge: MockCurveGauge;
    bpt: MockBalancerPoolToken;
    addresses: ExtSidechainConfig;
    namingConfig: SidechainNaming;
}
/** @dev Simply fetches the addresses of the given signers to act as respective multisigs */
async function getMockMultisigs(daoSigner: Signer): Promise<SidechainMultisigConfig> {
    return {
        daoMultisig: await daoSigner.getAddress(),
        pauseGaurdian: await daoSigner.getAddress(),
    };
}

async function deploySidechainMocks(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    canonicalChainId = 111, // L1_CHAIN_ID
    debug = false,
    waitForBlocks = 0,
): Promise<DeployL2MocksResult> {
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    const token = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockERC20",
        ["mockToken", "mockToken", 18, deployerAddress, 10000000],
        {},
        debug,
        waitForBlocks,
    );
    const minter = await deployContract<MockCurveMinter>(
        hre,
        new MockCurveMinter__factory(deployer),
        "MockCurveMinter",
        [token.address, simpleToExactAmount(1, 18)],
        {},
        debug,
        waitForBlocks,
    );
    const amount = await token.balanceOf(deployerAddress);
    const tx = await token.transfer(minter.address, amount);
    await tx.wait();

    const bpt = await deployContract<MockBalancerPoolToken>(
        hre,
        new MockBalancerPoolToken__factory(deployer),
        "MockBalancerPoolToken",
        [18, deployerAddress, 1000],
        {},
        debug,
        waitForBlocks,
    );

    const gauge = await deployContract<MockCurveGauge>(
        hre,
        new MockCurveGauge__factory(deployer),
        "MockCurveGauge",
        ["MockGauge", "MOCK", bpt.address, []],
        {},
        debug,
    );
    return {
        token,
        bpt,
        minter,
        gauge,
        addresses: {
            canonicalChainId,
            create2Factory: ZERO_ADDRESS,
            token: token.address,
            minter: minter.address,
            gauge: gauge.address,
            lzEndpoint: ZERO_ADDRESS,
        },
        namingConfig: { ...sidechainNaming },
    };
}

export { getMockMultisigs, deploySidechainMocks, DeployL2MocksResult };
