import { BigNumber, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { deployContract } from "../tasks/utils";
import {
    AuraBalRedemption,
    AuraBalRedemption__factory,
    AuraRedemption,
    AuraRedemption__factory,
    AuraToken,
    CvxCrvToken,
    RAuraRedemption,
    RAuraRedemption__factory,
    VoterProxy,
    WindDownCoordinator,
    WindDownCoordinator__factory,
} from "../types";
import { ExtSystemConfig, MultisigConfig } from "./deploySystem";
import { getTimestamp } from "../test-utils/time";
import { ONE_DAY, ONE_YEAR, ZERO_ADDRESS } from "../test-utils/constants";
interface WindownPhase1Deployed {
    auraRedemption: AuraRedemption;
    rAuraRedemption: RAuraRedemption;
    auraBalRedemption: AuraBalRedemption;
}
interface WindownPhase2Deployed {
    coordinator: WindDownCoordinator;
}

export async function deployWindowPhase1(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    multisigs: MultisigConfig,
    deployment: { cvx: AuraToken; cvxCrv: CvxCrvToken },
    config: {
        redeemableAuraSupply: BigNumber;
    },
    debug = false,
    waitForBlocks = 0,
): Promise<WindownPhase1Deployed> {
    const { cvx, cvxCrv } = deployment;
    const now = await getTimestamp();
    const auraExpiry = now.add(ONE_DAY.mul(100));
    const SWEEP_DELAY = ONE_YEAR;

    const auraRedemption = await deployContract<AuraRedemption>(
        hre,
        new AuraRedemption__factory(signer),
        "AuraRedemption",
        ["Redeemed AURA", "rAURA", cvx.address, config.redeemableAuraSupply, auraExpiry, multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );
    const rAuraRedemption = await deployContract<RAuraRedemption>(
        hre,
        new RAuraRedemption__factory(signer),
        "RAuraRedemption",
        [auraRedemption.address, SWEEP_DELAY, multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );
    const auraBalRedemption = await deployContract<AuraBalRedemption>(
        hre,
        new AuraBalRedemption__factory(signer),
        "AuraBalRedemption",
        [cvxCrv.address, SWEEP_DELAY, multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );
    return { auraRedemption, rAuraRedemption, auraBalRedemption };
}
export async function deployWindowPhase2(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    extSystem: ExtSystemConfig,
    multisigs: MultisigConfig,
    deployment: WindownPhase1Deployed & { voterProxy: VoterProxy },
    debug = false,
    waitForBlocks = 0,
): Promise<WindownPhase2Deployed> {
    const AURABAL_BPS = 9000; // 90% of BPT goes to auraBAL holders, 10% to rAURA.
    const { voterProxy, auraRedemption, rAuraRedemption, auraBalRedemption } = deployment;
    const coordinator = await deployContract<WindDownCoordinator>(
        hre,
        new WindDownCoordinator__factory(signer),
        "WindDownCoordinator",
        [
            voterProxy.address,
            extSystem.votingEscrow,
            extSystem.tokenBpt,
            auraRedemption.address,
            rAuraRedemption.address,
            auraBalRedemption.address,
            AURABAL_BPS,
            multisigs.daoMultisig,
        ],
        {},
        debug,
        waitForBlocks,
    );
    return { coordinator };
}

export async function getWindownPhase1(signer: Signer): Promise<WindownPhase1Deployed> {
    return {
        auraRedemption: AuraRedemption__factory.connect(ZERO_ADDRESS, signer),
        rAuraRedemption: RAuraRedemption__factory.connect(ZERO_ADDRESS, signer),
        auraBalRedemption: AuraBalRedemption__factory.connect(ZERO_ADDRESS, signer),
    };
}
