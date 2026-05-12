import { BigNumber, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { deployContract, verifyEtherscan } from "../tasks/utils";
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
import { ONE_YEAR, ZERO_ADDRESS } from "../test-utils/constants";
interface WinddownPhase1Deployed {
    auraRedemption: AuraRedemption;
    rAuraRedemption: RAuraRedemption;
    auraBalRedemption: AuraBalRedemption;
}
interface WinddownPhase2Deployed {
    coordinator: WindDownCoordinator;
}

export async function deployWinddownPhase1(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    multisigs: MultisigConfig,
    deployment: { cvx: AuraToken; cvxCrv: CvxCrvToken },
    config: {
        redeemableAuraSupply: BigNumber;
    },
    debug = false,
    waitForBlocks = 0,
): Promise<WinddownPhase1Deployed> {
    const { cvx, cvxCrv } = deployment;
    const latest = await hre.ethers.provider.getBlock("latest");
    const now = BigNumber.from(latest.timestamp);
    const auraExpiry = now.add(ONE_YEAR);
    const SWEEP_DELAY = ONE_YEAR;

    const auraRedemptionArgs = [
        "Redeemed AURA",
        "rAURA",
        cvx.address,
        config.redeemableAuraSupply,
        auraExpiry,
        multisigs.daoMultisig,
    ];
    const auraRedemption = await deployContract<AuraRedemption>(
        hre,
        new AuraRedemption__factory(signer),
        "AuraRedemption",
        auraRedemptionArgs,
        {},
        debug,
        waitForBlocks,
    );
    await verifyEtherscan(hre, { address: auraRedemption.address, constructorArguments: auraRedemptionArgs });

    const rAuraRedemptionArgs = [auraRedemption.address, SWEEP_DELAY, multisigs.daoMultisig];
    const rAuraRedemption = await deployContract<RAuraRedemption>(
        hre,
        new RAuraRedemption__factory(signer),
        "RAuraRedemption",
        rAuraRedemptionArgs,
        {},
        debug,
        waitForBlocks,
    );
    await verifyEtherscan(hre, { address: rAuraRedemption.address, constructorArguments: rAuraRedemptionArgs });

    const auraBalRedemptionArgs = [cvxCrv.address, SWEEP_DELAY, multisigs.daoMultisig];
    const auraBalRedemption = await deployContract<AuraBalRedemption>(
        hre,
        new AuraBalRedemption__factory(signer),
        "AuraBalRedemption",
        auraBalRedemptionArgs,
        {},
        debug,
        waitForBlocks,
    );
    await verifyEtherscan(hre, { address: auraBalRedemption.address, constructorArguments: auraBalRedemptionArgs });

    return { auraRedemption, rAuraRedemption, auraBalRedemption };
}
export async function deployWinddownPhase2(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    extSystem: ExtSystemConfig,
    multisigs: MultisigConfig,
    deployment: WinddownPhase1Deployed & { voterProxy: VoterProxy },
    debug = false,
    waitForBlocks = 0,
): Promise<WinddownPhase2Deployed> {
    const AURABAL_BPS = 9000; // 90% of BPT goes to auraBAL holders, 10% to rAURA.
    const { voterProxy, auraRedemption, rAuraRedemption, auraBalRedemption } = deployment;
    const coordinatorArgs = [
        voterProxy.address,
        extSystem.votingEscrow,
        extSystem.tokenBpt,
        auraRedemption.address,
        rAuraRedemption.address,
        auraBalRedemption.address,
        AURABAL_BPS,
        multisigs.daoMultisig,
    ];
    const coordinator = await deployContract<WindDownCoordinator>(
        hre,
        new WindDownCoordinator__factory(signer),
        "WindDownCoordinator",
        coordinatorArgs,
        {},
        debug,
        waitForBlocks,
    );
    await verifyEtherscan(hre, { address: coordinator.address, constructorArguments: coordinatorArgs });
    return { coordinator };
}

export async function getWinddownPhase1(signer: Signer): Promise<WinddownPhase1Deployed> {
    return {
        auraRedemption: AuraRedemption__factory.connect(ZERO_ADDRESS, signer),
        rAuraRedemption: RAuraRedemption__factory.connect(ZERO_ADDRESS, signer),
        auraBalRedemption: AuraBalRedemption__factory.connect(ZERO_ADDRESS, signer),
    };
}
