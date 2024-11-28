import { Contract, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { config } from "../tasks/deploy/mainnet-config";
import { deployContract, deployContractWithCreate2, waitForTx } from "../tasks/utils";
import {
    AuraBalStaker,
    AuraBalStaker__factory,
    AuraBalVault,
    Booster,
    BoosterHelper,
    BoosterHelper__factory,
    BoosterLite,
    BoosterOwnerLite,
    BoosterOwnerSecondary,
    Create2Factory__factory,
    CvxCrvToken,
    ExtraRewardStashLiteModule,
    ExtraRewardStashLiteModule__factory,
    ExtraRewardStashModule,
    ExtraRewardStashModule__factory,
    ExtSidechainConfig,
    FeeScheduler,
    FeeScheduler__factory,
    GaugeVoteRewards,
    GaugeVoterModule,
    GaugeVoterModule__factory,
    KeeperMulticall3,
    KeeperMulticall3__factory,
    PayableMulticall,
    PayableMulticall__factory,
    SidechainMultisigConfig,
    VeBalGrant,
    VeBalGrant__factory,
    WardenQuestScheduler,
    WardenQuestScheduler__factory,
} from "../types";
import { ExtSystemConfig, MultisigConfig } from "./deploySystem";
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
export async function deployGaugeVoterModule(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    multisigs: MultisigConfig,
    deployment: { gaugeVoter: GaugeVoteRewards },
    debug = false,
    waitForBlocks = 0,
) {
    const gaugeVoterModule = await deployContract<GaugeVoterModule>(
        hre,
        new GaugeVoterModule__factory(signer),
        "GaugeVoterModule",
        [await signer.getAddress(), multisigs.daoMultisig, deployment.gaugeVoter.address],
        {},
        debug,
        waitForBlocks,
    );

    let tx = await gaugeVoterModule.updateAuthorizedKeepers(multisigs.defender.keeperMulticall3, true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await gaugeVoterModule.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    return { gaugeVoterModule };
}
async function deployExtraRewardStashModuleT<C extends Contract>(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    multisigs: MultisigConfig,
    contracts: {
        boosterOwner: BoosterOwnerLite | BoosterOwnerSecondary;
        extraRewardStashModuleFactory: ExtraRewardStashModule__factory | ExtraRewardStashLiteModule__factory;
    },
    authorizedTokens: string[],
    name: string,
    debug = false,
    waitForBlocks = 0,
): Promise<C> {
    const { boosterOwner, extraRewardStashModuleFactory } = contracts;
    const boosterAddress = await boosterOwner.booster();
    const extraRewardStashModule = await deployContract<C>(
        hre,
        extraRewardStashModuleFactory,
        name,
        [await signer.getAddress(), multisigs.daoMultisig, boosterOwner.address, boosterAddress],
        {},
        debug,
        waitForBlocks,
    );

    let tx = await extraRewardStashModule.updateAuthorizedKeepers(multisigs.defender.keeperMulticall3, true);
    await waitForTx(tx, debug, waitForBlocks);

    for (let i = 0; i < authorizedTokens.length; i++) {
        tx = await extraRewardStashModule.updateAuthorizedTokens(authorizedTokens[i], true);
        await waitForTx(tx, debug, waitForBlocks);
    }

    tx = await extraRewardStashModule.transferOwnership(multisigs.daoMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    return extraRewardStashModule;
}
export async function deployExtraRewardStashModule(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    multisigs: MultisigConfig,
    deployment: { boosterOwnerSecondary: BoosterOwnerSecondary },
    authorizedTokens: string[],
    debug = false,
    waitForBlocks = 0,
): Promise<{ extraRewardStashModule: ExtraRewardStashModule }> {
    const { boosterOwnerSecondary } = deployment;
    const contracts = {
        boosterOwner: boosterOwnerSecondary,
        extraRewardStashModuleFactory: new ExtraRewardStashModule__factory(signer),
    };
    const extraRewardStashModule = await deployExtraRewardStashModuleT<ExtraRewardStashModule>(
        hre,
        signer,
        multisigs,
        contracts,
        authorizedTokens,
        "ExtraRewardStashModule",
        debug,
        waitForBlocks,
    );

    return { extraRewardStashModule };
}

export async function deployExtraRewardStashLiteModule(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    sideMultisigs: SidechainMultisigConfig,
    deployment: { boosterOwnerLite: BoosterOwnerLite; keeperMulticall3: KeeperMulticall3 },
    authorizedTokens: string[],
    debug = false,
    waitForBlocks = 0,
): Promise<{ extraRewardStashModule: ExtraRewardStashLiteModule }> {
    const { boosterOwnerLite, keeperMulticall3 } = deployment;

    const contracts = {
        boosterOwner: boosterOwnerLite,
        extraRewardStashModuleFactory: new ExtraRewardStashLiteModule__factory(signer),
    };
    const multisigs = {
        daoMultisig: sideMultisigs.daoMultisig,
        defender: {
            keeperMulticall3: keeperMulticall3.address,
        },
    };
    const extraRewardStashModule = await deployExtraRewardStashModuleT<ExtraRewardStashLiteModule>(
        hre,
        signer,
        multisigs as MultisigConfig,
        contracts,
        authorizedTokens,
        "ExtraRewardStashLiteModule",
        debug,
        waitForBlocks,
    );

    return { extraRewardStashModule };
}
