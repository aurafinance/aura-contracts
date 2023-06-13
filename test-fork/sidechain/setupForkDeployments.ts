import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
    SidechainPhase1Deployed,
    SidechainPhase2Deployed,
} from "../../scripts/deploySidechain";
import { impersonateAccount } from "../../test-utils";
import { AuraBalVaultDeployed, config } from "../../tasks/deploy/mainnet-config";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { Account, LZEndpointMock, LZEndpointMock__factory, SidechainConfig } from "../../types";
import { deploySimpleBridgeDelegates, SimplyBridgeDelegateDeployed } from "../../scripts/deployBridgeDelegates";

export interface TestSuiteDeployment {
    dao: Account;
    phase2: Phase2Deployed;
    phase6: Phase6Deployed;
    l1LzEndpoint: LZEndpointMock;
    l2LzEndpoint: LZEndpointMock;
    canonical: CanonicalPhase1Deployed & CanonicalPhase2Deployed;
    sidechain: SidechainPhase1Deployed & SidechainPhase2Deployed;
    vaultDeployment: AuraBalVaultDeployed;
    bridgeDelegateDeployment: SimplyBridgeDelegateDeployed;
    sidechainConfig: SidechainConfig;
}

export const setupForkDeployment = async (
    hre: HardhatRuntimeEnvironment,
    canonicalConfig: typeof config,
    sidechainConfig: SidechainConfig,
    deployer: Account,
    L2_CHAIN_ID: number,
): Promise<TestSuiteDeployment> => {
    const dao = await impersonateAccount(canonicalConfig.multisigs.daoMultisig);

    const phase2 = await canonicalConfig.getPhase2(deployer.signer);
    const phase6 = await canonicalConfig.getPhase6(deployer.signer);
    const vaultDeployment = await canonicalConfig.getAuraBalVault(deployer.signer);

    const l1LzEndpoint = LZEndpointMock__factory.connect(canonicalConfig.addresses.lzEndpoint, deployer.signer);
    const l2LzEndpoint = LZEndpointMock__factory.connect(sidechainConfig.extConfig.lzEndpoint, deployer.signer);

    const canonical = canonicalConfig.getSidechain(deployer.signer);
    const sidechain = sidechainConfig.getSidechain(deployer.signer);

    const bridgeDelegateDeployment = await deploySimpleBridgeDelegates(
        hre,
        canonicalConfig.addresses,
        canonical,
        L2_CHAIN_ID,
        deployer.signer,
    );

    return {
        dao,
        phase2,
        phase6,
        vaultDeployment,
        l1LzEndpoint,
        l2LzEndpoint,
        canonical,
        sidechain,
        bridgeDelegateDeployment,
        sidechainConfig,
    };
};
