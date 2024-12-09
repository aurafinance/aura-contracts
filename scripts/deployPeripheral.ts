import { Contract, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { config } from "../tasks/deploy/mainnet-config";
import { deployContract, deployContractWithCreate2, waitForTx } from "../tasks/utils";
import { simpleToExactAmount } from "../test-utils/math";
import {
    AuraBalStaker,
    AuraBalStaker__factory,
    AuraBalVault,
    AuraToken,
    Booster,
    BoosterHelper,
    BoosterHelper__factory,
    BoosterLite,
    BoosterOwnerLite,
    BoosterOwnerSecondary,
    ChefForwarder,
    Create2Factory__factory,
    CvxCrvToken,
    ExtraRewardStashLiteModule__factory,
    ExtraRewardStashModule,
    ExtraRewardStashModule__factory,
    ExtSidechainConfig,
    FeeScheduler,
    FeeScheduler__factory,
    GaugeVoteRewards,
    GaugeVoterModule,
    GaugeVoterModule__factory,
    HHChefClaimBriberModule,
    HHChefClaimBriberModule__factory,
    HHRewardsClaimForwarderModule,
    HHRewardsClaimForwarderModule__factory,
    KeeperMulticall3,
    KeeperMulticall3__factory,
    PayableMulticall,
    PayableMulticall__factory,
    StashRewardDistro,
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

export async function deployHHRewardsClaimForwarderModule(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    multisigs: MultisigConfig,
    deployment: {
        cvx: AuraToken;
        stashRewardDistro: StashRewardDistro;
    },
    debug = false,
    waitForBlocks = 0,
): Promise<{ hhRewardsClaimForwarderModule: HHRewardsClaimForwarderModule }> {
    const { cvx, stashRewardDistro } = deployment;
    const hiddenHandsRewardDistributorAddress = "0xa9b08B4CeEC1EF29EdEC7F9C94583270337D6416";

    const hhRewardsClaimForwarderModule = await deployContract<HHRewardsClaimForwarderModule>(
        hre,
        new HHRewardsClaimForwarderModule__factory(signer),
        "HHRewardsClaimForwarderModule",
        [
            await signer.getAddress(),
            multisigs.incentivesMultisig,
            cvx.address,
            stashRewardDistro.address,
            hiddenHandsRewardDistributorAddress,
        ],
        {},
        debug,
        waitForBlocks,
    );

    let tx = await hhRewardsClaimForwarderModule.updateAuthorizedKeepers(multisigs.defender.keeperMulticall3, true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await hhRewardsClaimForwarderModule.transferOwnership(multisigs.incentivesMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    return { hhRewardsClaimForwarderModule };
}

export async function deployHHChefClaimBriberModule(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    multisigs: MultisigConfig,
    deployment: {
        cvx: AuraToken;
        chefForwarder: ChefForwarder;
    },
    debug = false,
    waitForBlocks = 0,
): Promise<{ hhChefClaimBriberModule: HHChefClaimBriberModule }> {
    const { cvx, chefForwarder } = deployment;
    const hiddenHandsBribeVaultAddress = "0xE00fe722e5bE7ad45b1A16066E431E47Df476CeC";
    // Proposals
    // See https://api.hiddenhand.finance/proposal/aura or https://api.hiddenhand.finance/proposal/balancer depending on the market
    const auraEthVeBALId = "0xb355f196c7ab330d85a3a392623204f81c8f2d668baaeda4e78f87c9f50bef04";
    const auraBalVeBALId = "0xa2b574c32fbe12ce1e12ebb850253595ef7087671c213241076b924614822a20";
    const ARBAuraBalwstEthId = "0xffb8d412a5a5581f13e52cab6dee6cd2b5ce26a932d1f8f843e02f2223b5a8f4";

    // Markets
    const vlAuraIncentiveAddress = "0xcbf242f20d183b4116c22dd5e441b9ae15b0d35a";
    const veBalIncentiveAddress = "0x45Bc37b18E73A42A4a826357a8348cDC042cCBBc";

    const rewardPerEpoch = simpleToExactAmount(62016); // Based on AIP-63 , update every 6 months

    const hhChefClaimBriberModule = await deployContract<HHChefClaimBriberModule>(
        hre,
        new HHChefClaimBriberModule__factory(signer),
        "HHChefClaimBriberModule",
        [
            await signer.getAddress(),
            multisigs.incentivesMultisig,
            cvx.address,
            chefForwarder.address,
            hiddenHandsBribeVaultAddress,
        ],
        {},
        debug,
        waitForBlocks,
    );

    let tx = await hhChefClaimBriberModule.updateAuthorizedKeepers(multisigs.defender.keeperMulticall3, true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await hhChefClaimBriberModule.updateAuthorizedProposals(auraEthVeBALId, true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await hhChefClaimBriberModule.updateAuthorizedProposals(auraBalVeBALId, true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await hhChefClaimBriberModule.updateAuthorizedProposals(ARBAuraBalwstEthId, true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await hhChefClaimBriberModule.updateAuthorizedMarkets(vlAuraIncentiveAddress, true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await hhChefClaimBriberModule.updateAuthorizedMarkets(veBalIncentiveAddress, true);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await hhChefClaimBriberModule.setRewardPerEpoch(rewardPerEpoch);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await hhChefClaimBriberModule.transferOwnership(multisigs.incentivesMultisig);
    await waitForTx(tx, debug, waitForBlocks);

    return { hhChefClaimBriberModule };
}
