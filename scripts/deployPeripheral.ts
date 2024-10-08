import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { config } from "../tasks/deploy/mainnet-config";
import { deployContract, deployContractWithCreate2 } from "../tasks/utils";
import {
    AuraBalStaker,
    AuraBalStaker__factory,
    AuraBalVault,
    CvxCrvToken,
    WardenQuestScheduler,
    WardenQuestScheduler__factory,
    FeeScheduler,
    FeeScheduler__factory,
    KeeperMulticall3,
    KeeperMulticall3__factory,
    PayableMulticall,
    PayableMulticall__factory,
    VeBalGrant,
    VeBalGrant__factory,
    BoosterHelper,
    BoosterHelper__factory,
    Booster,
    BoosterLite,
    ExtSidechainConfig,
    Create2Factory__factory,
} from "../types";
import { ExtSystemConfig } from "./deploySystem";
const SALT = "berlin";

export async function deployAuraBalStaker(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    vault: AuraBalVault,
    auraBal: CvxCrvToken,
    debug = false,
    waitForBlocks = 0,
) {
    return deployContract<AuraBalStaker>(
        hre,
        new AuraBalStaker__factory(signer),
        "AuraBalStaker",
        [vault.address, auraBal.address],
        {},
        debug,
        waitForBlocks,
    );
}

export async function deployFeeScheduler(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
) {
    const results = await config.getAuraBalVault(signer);

    const feeScheduler = await deployContract<FeeScheduler>(
        hre,
        new FeeScheduler__factory(signer),
        "FeeScheduler",
        [config.multisigs.daoMultisig, results.strategy.address, config.addresses.token],
        {},
        debug,
        waitForBlocks,
    );

    return { feeScheduler };
}

export async function deployVeBalGrant(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    extSystem: ExtSystemConfig,
    project: string,
    balancer: string,
    debug = false,
    waitForBlocks = 0,
) {
    const veBalGrant = await deployContract<VeBalGrant>(
        hre,
        new VeBalGrant__factory(signer),
        "VeBalGrant",
        [
            extSystem.weth,
            extSystem.token,
            extSystem.tokenBpt,
            extSystem.votingEscrow,
            extSystem.gaugeController,
            project,
            balancer,
            extSystem.balancerVault,
            extSystem.balancerPoolId,
        ],
        {},
        debug,
        waitForBlocks,
    );

    return {
        veBalGrant,
    };
}
export async function deployWardenQuestScheduler(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
) {
    const phase2 = await config.getPhase2(signer);
    const phase6 = await config.getPhase6(signer);
    const wardenQuestScheduler = await deployContract<WardenQuestScheduler>(
        hre,
        new WardenQuestScheduler__factory(signer),
        "WardenQuestScheduler",
        [phase6.booster.address, phase2.cvx.address, config.addresses.darkQuestBoard, await signer.getAddress()],
        {},
        debug,
        waitForBlocks,
    );
    return { wardenQuestScheduler };
}
export async function deployKeeperMulticall3(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    owner: string,
    debug = false,
    waitForBlocks = 0,
) {
    console.log("deployKeeperMulticall3");
    const keeperMulticall3 = await deployContract<KeeperMulticall3>(
        hre,
        new KeeperMulticall3__factory(signer),
        "KeeperMulticall3",
        [owner],
        {},
        debug,
        waitForBlocks,
    );
    return { keeperMulticall3 };
}
export async function deployPayableMulticall(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    extConfig: ExtSidechainConfig,
    salt: string = SALT,
    debug = false,
    waitForBlocks = 0,
) {
    const create2Options = { amount: 0, salt, callbacks: [] };
    const deployOptions = {
        overrides: {},
        create2Options,
        debug,
        waitForBlocks,
    };
    const create2Factory = Create2Factory__factory.connect(extConfig.create2Factory, signer);
    const payableMulticall = await deployContractWithCreate2<PayableMulticall, PayableMulticall__factory>(
        hre,
        create2Factory,
        new PayableMulticall__factory(signer),
        "PayableMulticall",
        [],
        deployOptions,
    );

    return { payableMulticall };
}
export async function deployBoosterHelper(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    extConfig: ExtSidechainConfig,
    deployment: { booster: Booster | BoosterLite },
    salt: string = SALT,
    debug = true,
    waitForBlocks = 0,
) {
    const { token, create2Factory } = extConfig;
    const { booster } = deployment;
    const create2Options = { amount: 0, salt, callbacks: [] };
    const deployOptions = {
        overrides: {},
        create2Options,
        debug,
        waitForBlocks,
    };
    const create2FactoryInts = Create2Factory__factory.connect(create2Factory, signer);

    const boosterHelper = await deployContractWithCreate2<BoosterHelper, BoosterHelper__factory>(
        hre,
        create2FactoryInts,
        new BoosterHelper__factory(signer),
        "BoosterHelper",
        [booster.address, token],
        deployOptions,
    );

    return { boosterHelper };
}
