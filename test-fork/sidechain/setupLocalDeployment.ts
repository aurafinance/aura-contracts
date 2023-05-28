import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
    deployCanonicalPhase1,
    deployCanonicalPhase2,
    deploySidechainPhase1,
    deploySidechainPhase2,
    setTrustedRemoteCanonicalPhase1,
    setTrustedRemoteCanonicalPhase2,
    SidechainPhase1Deployed,
    SidechainPhase2Deployed,
} from "../../scripts/deploySidechain";
import { impersonateAccount } from "../../test-utils";
import { sidechainNaming } from "../../tasks/deploy/sidechain-naming";
import { AuraBalVaultDeployed } from "../../tasks/deploy/mainnet-config";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import {
    Account,
    Create2Factory__factory,
    LZEndpointMock,
    LZEndpointMock__factory,
    SidechainConfig,
} from "../../types";
import { deploySimpleBridgeDelegates, SimplyBridgeDelegateDeployed } from "../../scripts/deployBridgeDelegates";

interface TestSuiteDeployment {
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

export const setupLocalDeployment = async (
    hre: HardhatRuntimeEnvironment,
    config: any,
    deployer: Account,
    L1_CHAIN_ID: number,
    L2_CHAIN_ID: number,
): Promise<TestSuiteDeployment> => {
    const dao = await impersonateAccount(config.multisigs.daoMultisig);

    const phase2 = await config.getPhase2(deployer.signer);
    const phase6 = await config.getPhase6(deployer.signer);
    const vaultDeployment = await config.getAuraBalVault(deployer.signer);

    // deploy layerzero mocks
    const l1LzEndpoint = await new LZEndpointMock__factory(deployer.signer).deploy(L1_CHAIN_ID);
    const l2LzEndpoint = await new LZEndpointMock__factory(deployer.signer).deploy(L2_CHAIN_ID);

    // deploy Create2Factory
    const create2Factory = await new Create2Factory__factory(deployer.signer).deploy();
    await create2Factory.updateDeployer(deployer.address, true);

    // setup sidechain config
    const sidechainConfig = {
        chainId: 123,
        multisigs: { daoMultisig: dao.address, pauseGuardian: dao.address },
        naming: { ...sidechainNaming },
        extConfig: {
            canonicalChainId: L1_CHAIN_ID,
            lzEndpoint: l2LzEndpoint.address,
            create2Factory: create2Factory.address,
            token: config.addresses.token,
            minter: config.addresses.minter,
            gauges: config.addresses.gauges,
        },
        bridging: {
            l1Receiver: "0x0000000000000000000000000000000000000000",
            l2Sender: "0x0000000000000000000000000000000000000000",
            nativeBridge: "0x0000000000000000000000000000000000000000",
        },
        whales: config.whales,
    };

    // deploy canonicalPhase
    const l1Addresses = { ...config.addresses, lzEndpoint: l1LzEndpoint.address };
    const canonicalPhase1 = await deployCanonicalPhase1(
        hre,
        deployer.signer,
        config.multisigs,
        l1Addresses,
        phase2,
        phase6,
    );
    const canonicalPhase2 = await deployCanonicalPhase2(
        hre,
        deployer.signer,
        config.multisigs,
        l1Addresses,
        phase2,
        vaultDeployment,
        canonicalPhase1,
    );

    // deploy sidechain
    const sidechainPhase1 = await deploySidechainPhase1(
        hre,
        deployer.signer,
        sidechainConfig.naming,
        sidechainConfig.multisigs,
        sidechainConfig.extConfig,
        canonicalPhase1,
        L1_CHAIN_ID,
    );
    const sidechainPhase2 = await deploySidechainPhase2(
        hre,
        deployer.signer,
        sidechainConfig.naming,
        sidechainConfig.multisigs,
        sidechainConfig.extConfig,
        canonicalPhase2,
        sidechainPhase1,
        L1_CHAIN_ID,
    );
    const sidechain = { ...sidechainPhase1, ...sidechainPhase2 };
    const canonical = { ...canonicalPhase1, ...canonicalPhase2 };

    await setTrustedRemoteCanonicalPhase1(canonical, sidechain, L2_CHAIN_ID, config.multisigs);
    await setTrustedRemoteCanonicalPhase2(canonical, sidechain, L2_CHAIN_ID, config.multisigs);

    // Connect contracts to its owner signer.
    canonical.l1Coordinator = canonical.l1Coordinator.connect(dao.signer);
    canonical.auraProxyOFT = canonical.auraProxyOFT.connect(dao.signer);
    canonical.auraBalProxyOFT = canonical.auraBalProxyOFT.connect(dao.signer);

    await l1LzEndpoint.setDestLzEndpoint(sidechain.l2Coordinator.address, l2LzEndpoint.address);
    await l1LzEndpoint.setDestLzEndpoint(sidechain.auraOFT.address, l2LzEndpoint.address);

    await l2LzEndpoint.setDestLzEndpoint(canonical.l1Coordinator.address, l1LzEndpoint.address);
    await l2LzEndpoint.setDestLzEndpoint(canonical.auraProxyOFT.address, l1LzEndpoint.address);

    const bridgeDelegateDeployment = await deploySimpleBridgeDelegates(
        hre,
        l1Addresses,
        canonical,
        L2_CHAIN_ID,
        deployer.signer,
    );

    return {
        dao,
        phase2,
        phase6,
        l1LzEndpoint,
        l2LzEndpoint,
        canonical,
        sidechain,
        vaultDeployment,
        bridgeDelegateDeployment,
        sidechainConfig,
    };
};
