import { BigNumberish, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deployContract } from "../tasks/utils";
import { simpleToExactAmount } from "../test-utils";
import {
    RAura,
    RAura__factory,
    SiphonDepositor,
    SiphonDepositor__factory,
    SiphonGauge,
    SiphonGauge__factory,
    SiphonToken,
    SiphonToken__factory,
} from "../types";

export interface CrossChainDeploymentConfig {
    siphondepositor: { pid: BigNumberish };
    rAura: { symbol: string };
    booster: string;
    cvxLocker: string;
    crvToken: string;
    cvx: string;
    lzEndpoint: string;
    dstChainId: BigNumberish;
    penalty: BigNumberish;
}

export interface CrossChainL1Deployment {
    siphonToken: SiphonToken;
    siphonGauge: SiphonGauge;
    rAura: RAura;
    siphonDepositor: SiphonDepositor;
}

/**
 * Deploy the layer 1 part of the Cross Chain deployment
 *
 * - SiphonToken: dummy lpToken used to siphon AURA rewards
 * - SiphonGauge: dummy gauge used to siphon AURA rewards
 * - rAURA: the wrapped AURA token bridge to L2 and given our as a reward
 * - siphonDepositor: The contract in charge or coordinating everything
 */
export async function deployCrossChainL1(
    config: CrossChainDeploymentConfig,
    signer: Signer,
    hre: HardhatRuntimeEnvironment,
    debug: boolean = true,
    waitForBlocks: number,
): Promise<CrossChainL1Deployment> {
    const signerAddress = await signer.getAddress();

    // deploy siphon token (lp token)
    const siphonToken = await deployContract<SiphonToken>(
        hre,
        new SiphonToken__factory(signer),
        "SiphonLpToken",
        [signerAddress, simpleToExactAmount(1)],
        {},
        debug,
        waitForBlocks,
    );

    // deploy siphon gauge (gauge)
    const siphonGauge = await deployContract<SiphonGauge>(
        hre,
        new SiphonGauge__factory(signer),
        "SiphonGauge",
        [siphonToken.address],
        {},
        debug,
        waitForBlocks,
    );

    // deploy rAURA
    const rAura = await deployContract<RAura>(
        hre,
        new RAura__factory(signer),
        "rAura",
        [config.rAura.symbol, config.rAura.symbol],
        {},
        debug,
        waitForBlocks,
    );

    // deploy siphon depositor
    const siphonDepositor = await deployContract<SiphonDepositor>(
        hre,
        new SiphonDepositor__factory(signer),
        "SiphonDepositor",
        [
            siphonToken.address,
            config.siphondepositor.pid,
            config.booster,
            config.cvxLocker,
            config.crvToken,
            config.cvx,
            rAura.address,
            config.lzEndpoint,
            config.dstChainId,
            config.penalty,
        ],
        {},
        debug,
        waitForBlocks,
    );

    // send siphon token to depositor
    await siphonToken.transfer(siphonDepositor.address, simpleToExactAmount(1));
    // transfer ownership of rAURA to siphon depositor
    await rAura.transferOwnership(siphonDepositor.address);

    return {
        siphonToken,
        siphonGauge,
        rAura,
        siphonDepositor,
    };
}

export async function deployCrossChainL2() {
    // deploy rAURA
    // deploy siphon receiver
    // transfer ownership of rAURA to siphon receiver
    /* ---------------------------------------------------
       Deploy Aura System
    --------------------------------------------------- */
    // deploy voter proxy
    // deploy booster
    // setup booster/vp
    // set booster on siphon receiver
    // deploy factories
    // set factories on the Booster
}

export async function setUpCrossChainL2() {
    // set siphon receiver on L1 siphon depositor
}
