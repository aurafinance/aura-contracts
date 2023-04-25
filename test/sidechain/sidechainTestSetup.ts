import {
    MultisigConfig,
    Phase2Deployed,
    Phase6Deployed,
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    deployPhase6,
} from "../../scripts/deploySystem";
import { DeployMocksResult, deployMocks, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import { impersonateAccount } from "../../test-utils/fork";
import {
    deployCanonicalPhase,
    deploySidechainSystem,
    deploySidechainPhase2,
    setTrustedRemoteCanonical,
    CanonicalPhaseDeployed,
    SidechainDeployed,
} from "../../scripts/deploySidechain";
import { Account, SidechainMultisigConfig } from "types";
import {
    DeployL2MocksResult,
    deploySidechainMocks,
    getMockMultisigs as getL2MockMultisigs,
} from "../../scripts/deploySidechainMocks";
import { deploySimpleBridgeDelegates, SimplyBridgeDelegateDeployed } from "../../scripts/deployBridgeDelegates";
import { HardhatRuntimeEnvironment } from "hardhat/types/runtime";
import { Signer } from "ethers";

export interface L1TestSetup {
    mocks: DeployMocksResult;
    multisigs: MultisigConfig;
    phase2: Phase2Deployed;
    phase6: Phase6Deployed;
    canonical: CanonicalPhaseDeployed;
}
export interface L2TestSetup {
    mocks: DeployL2MocksResult;
    multisigs: SidechainMultisigConfig;
    sidechain: SidechainDeployed;
}
export interface SideChainTestSetup {
    deployer: Account;
    l1: L1TestSetup;
    l2: L2TestSetup;
    bridgeDelegates: SimplyBridgeDelegateDeployed;
}

/**
 * Full deployment of the system in order to test sidechain stuff.
 * - L1: phase 1 to 6, canonical phase, mocks, multisigs
 * - L2: phase 1 to 2, mocks, multisigs
 *
 * - Configures layer zero to enable communication between L1 <=> L2
 *
 * @param {HardhatRuntimeEnvironment} hre - The Hardhat runtime environment
 * @param {Signer[]} accounts - Array of accounts to use.
 * @returns {SideChainTestSetup}
 */

export const sidechainTestSetup = async (
    hre: HardhatRuntimeEnvironment,
    accounts: Signer[],
): Promise<SideChainTestSetup> => {
    const deployer = await impersonateAccount(await accounts[0].getAddress());
    const l1Mocks = await deployMocks(hre, deployer.signer);
    const l2mocks = await deploySidechainMocks(hre, deployer.signer);
    const l1Multisigs = await getMockMultisigs(accounts[1], accounts[2], accounts[3]);
    const l2Multisigs = await getL2MockMultisigs(accounts[3]);
    const dao = await impersonateAccount(l2Multisigs.daoMultisig);

    const distro = getMockDistro();
    const phase1 = await deployPhase1(hre, deployer.signer, l1Mocks.addresses);
    const phase2 = await deployPhase2(
        hre,
        deployer.signer,
        phase1,
        distro,
        l1Multisigs,
        l1Mocks.namingConfig,
        l1Mocks.addresses,
    );
    const phase3 = await deployPhase3(hre, deployer.signer, phase2, l1Multisigs, l1Mocks.addresses);
    await phase3.poolManager.connect(dao.signer).setProtectPool(false);
    await deployPhase4(hre, deployer.signer, phase3, l1Mocks.addresses);
    const phase6 = await deployPhase6(
        hre,
        deployer.signer,
        phase2,
        l1Multisigs,
        l1Mocks.namingConfig,
        l1Mocks.addresses,
    );

    // deploy canonicalPhase
    const canonical = await deployCanonicalPhase(hre, deployer.signer, l1Mocks.addresses, phase2, phase6);
    // deploy sidechain

    const sidechain = await deploySidechainSystem(
        hre,
        deployer.signer,
        l2mocks.namingConfig,
        l2Multisigs,
        l2mocks.addresses,
        { addresses: l1Mocks.addresses, canonical },
    );

    await sidechain.poolManager.connect(dao.signer).setProtectPool(false);
    // Mock L1 Endpoints  configuration
    await l1Mocks.l1LzEndpoint.setDestLzEndpoint(sidechain.l2Coordinator.address, l2mocks.l2LzEndpoint.address);
    await l1Mocks.l1LzEndpoint.setDestLzEndpoint(sidechain.auraOFT.address, l2mocks.l2LzEndpoint.address);

    // Mock L12Endpoints  configuration
    await l2mocks.l2LzEndpoint.setDestLzEndpoint(canonical.l1Coordinator.address, l1Mocks.l1LzEndpoint.address);
    await l2mocks.l2LzEndpoint.setDestLzEndpoint(canonical.auraProxyOFT.address, l1Mocks.l1LzEndpoint.address);

    await deploySidechainPhase2(hre, deployer.signer, sidechain, l2mocks.addresses);

    // Emulate DAO Settings - L1 Stuff
    await phase6.booster.connect(dao.signer).setBridgeDelegate(canonical.l1Coordinator.address);
    await setTrustedRemoteCanonical(canonical, sidechain, l2mocks.addresses.remoteLzChainId);

    // Emulate DAO Settings - L2 Stuff
    const sbd = await deploySimpleBridgeDelegates(
        hre,
        l1Mocks.addresses,
        canonical,
        l2mocks.addresses.remoteLzChainId,
        deployer.signer,
    );
    await sidechain.l2Coordinator.connect(dao.signer).setBridgeDelegate(sbd.bridgeDelegateSender.address);

    return {
        deployer,
        l1: { mocks: l1Mocks, multisigs: l1Multisigs, phase2, phase6, canonical },
        l2: { mocks: l2mocks, multisigs: l2Multisigs, sidechain },
        bridgeDelegates: { ...sbd },
    };
};
