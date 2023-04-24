import { simpleToExactAmount } from "../test-utils/math";
import { Signer } from "ethers";
import {
    MockERC20__factory,
    MockERC20,
    MockCurveGauge,
    MockCurveMinter__factory,
    MockCurveMinter,
    MockBalancerPoolToken,
    LZEndpointMock__factory,
    Create2Factory__factory,
    Create2Factory,
    MockBalancerPoolToken__factory,
    MockCurveGauge__factory,
    LZEndpointMock,
    MockVoting,
    MockVoting__factory,
} from "../types/generated";
import { deployContract } from "../tasks/utils";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ExtSidechainConfig, SidechainNaming, SidechainMultisigConfig } from "types/sidechain-types";

interface DeployL2MocksResult {
    crv: MockERC20;
    crvMinter: MockCurveMinter;
    voting: MockVoting;
    gauges: MockCurveGauge[];
    crvBpt: MockBalancerPoolToken;
    lptoken: MockERC20;
    create2Factory: Create2Factory;
    l2LzEndpoint: LZEndpointMock;
    addresses: ExtSidechainConfig;
    namingConfig: SidechainNaming;
}
/** @dev Simply fetches the addresses of the given signers to act as respective multisigs */
async function getMockMultisigs(daoSigner: Signer): Promise<SidechainMultisigConfig> {
    return {
        daoMultisig: await daoSigner.getAddress(),
    };
}

async function deploySidechainMocks(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
): Promise<DeployL2MocksResult> {
    const L1_CHAIN_ID = 111;
    const L2_CHAIN_ID = 222;
    const deployer = signer;
    const deployerAddress = await deployer.getAddress();

    const create2Factory = await new Create2Factory__factory(deployer).deploy();
    let tx = await create2Factory.updateDeployer(deployerAddress, true);
    await tx.wait();

    const crv = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "l2MockCRV",
        ["l2mockCrv", "l2mockCrv", 18, deployerAddress, 10000000],
        {},
        debug,
        waitForBlocks,
    );
    const crvMinter = await deployContract<MockCurveMinter>(
        hre,
        new MockCurveMinter__factory(deployer),
        "l2MockCurveMinter",
        [crv.address, simpleToExactAmount(1, 18)],
        {},
        debug,
        waitForBlocks,
    );
    const amount = await crv.balanceOf(deployerAddress);
    tx = await crv.transfer(crvMinter.address, amount);
    await tx.wait();
    const lptoken = await deployContract<MockERC20>(
        hre,
        new MockERC20__factory(deployer),
        "MockLPToken",
        ["mockLPToken", "mockLPToken", 18, deployerAddress, 10000000],
        {},
        debug,
    );

    const crvBpt = await deployContract<MockBalancerPoolToken>(
        hre,
        new MockBalancerPoolToken__factory(deployer),
        "MockBalancerPoolToken",
        [18, deployerAddress, 1000],
        {},
        debug,
        waitForBlocks,
    );
    const voting = await deployContract<MockVoting>(
        hre,
        new MockVoting__factory(deployer),
        "MockVoting",
        [],
        {},
        debug,
        waitForBlocks,
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
    // tx = await crvBpt.setPrice(parseEther("2.40"));
    // await tx.wait();

    const l2LzEndpoint = await deployContract<LZEndpointMock>(
        hre,
        new LZEndpointMock__factory(deployer),
        "l2LzEndpoint",
        [L2_CHAIN_ID],
        {},
        debug,
    );

    return {
        crv,
        crvMinter,
        voting,
        gauges,
        crvBpt,
        lptoken,
        create2Factory,
        l2LzEndpoint,
        addresses: {
            canonicalChainId: L1_CHAIN_ID,
            remoteLzChainId: L2_CHAIN_ID,
            create2Factory: create2Factory.address,
            token: crv.address,
            tokenBpt: crvBpt.address,
            minter: crvMinter.address,
            gauges: gauges.map(g => g.address),
            gaugeController: voting.address,
            l2LzEndpoint: l2LzEndpoint.address,
        },
        namingConfig: {
            coordinatorName: "Aura",
            coordinatorSymbol: "AURA",
            tokenFactoryNamePostfix: " Aura Deposit",
        },
    };
}

export { getMockMultisigs, deploySidechainMocks, DeployL2MocksResult };
