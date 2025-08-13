import { ethers, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types/runtime";

import {
    deploySimpleBridgeReceiver,
    deploySimpleBridgeSender,
    SimplyBridgeDelegateDeployed,
} from "../../scripts/deployBridgeDelegates";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
    CanonicalPhase3Deployed,
    CanonicalPhase4Deployed,
    deployCanonicalAuraDistributor,
    deployCanonicalPhase1,
    deployCanonicalPhase2,
    deployCanonicalPhase3,
    deployCanonicalPhase4,
    deploySidechainPhase1,
    deploySidechainPhase2,
    deploySidechainPhase3,
    deploySidechainPhase4,
    setTrustedRemoteCanonicalPhase1,
    setTrustedRemoteCanonicalPhase2,
    setTrustedRemoteCanonicalPhase3,
    SidechainPhase1Deployed,
    SidechainPhase2Deployed,
    SidechainPhase3Deployed,
    SidechainPhase4Deployed,
} from "../../scripts/deploySidechain";
import {
    DeployL2MocksResult,
    deploySidechainMocks,
    getMockMultisigs as getL2MockMultisigs,
} from "../../scripts/deploySidechainMocks";
import {
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    deployPhase6,
    deployPhase8,
    ExtSystemConfig,
    MultisigConfig,
    Phase2Deployed,
    Phase6Deployed,
    Phase8Deployed,
} from "../../scripts/deploySystem";
import { deployVault, VaultDeployment } from "../../scripts/deployVault";
import { simpleToExactAmount, ZERO_ADDRESS } from "../../test-utils";
import { impersonateAccount } from "../../test-utils/fork";
import {
    Account,
    AuraDistributor,
    Create2Factory__factory,
    IGaugeController__factory,
    LZEndpointMock__factory,
    SidechainConfig,
    SidechainMultisigConfig,
    SidechainPhaseDeployed,
} from "../../types";

export type SidechainDeployed = SidechainPhase1Deployed &
    SidechainPhase2Deployed &
    SidechainPhase3Deployed &
    SidechainPhase4Deployed;

export type CanonicalPhaseDeployed = CanonicalPhase1Deployed &
    CanonicalPhase2Deployed &
    CanonicalPhase3Deployed &
    CanonicalPhase4Deployed & { auraDistributor: AuraDistributor };
export interface L1TestSetup {
    mocks: DeployMocksResult;
    multisigs: MultisigConfig;
    phase2: Phase2Deployed;
    phase6: Phase6Deployed;
    phase8: Phase8Deployed;
    canonical: CanonicalPhaseDeployed;
    vaultDeployment: VaultDeployment;
}
export interface L2TestSetup {
    mocks: DeployL2MocksResult;
    multisigs: SidechainMultisigConfig;
    sidechain: SidechainPhaseDeployed;
}
export interface SideChainTestSetup {
    deployer: Account;
    l1: L1TestSetup;
    l2: L2TestSetup;
    bridgeDelegates: SimplyBridgeDelegateDeployed;
}

export const deployL1 = async (
    hre: HardhatRuntimeEnvironment,
    accounts: Signer[],
    canonicalChainId = 111,
    debug = false,
    waitForBlocks = 0,
): Promise<L1TestSetup> => {
    const deployer = await impersonateAccount(await accounts[0].getAddress());
    const l1Mocks = await deployMocks(hre, deployer.signer);
    const l1Multisigs = await getMockMultisigs(accounts[1], accounts[2], accounts[3]);
    const dao = await impersonateAccount(l1Multisigs.daoMultisig);
    const distro = getMockDistro();
    const phase1 = await deployPhase1(hre, deployer.signer, l1Mocks.addresses, true, debug, waitForBlocks);
    const phase2 = await deployPhase2(
        hre,
        deployer.signer,
        phase1,
        distro,
        l1Multisigs,
        l1Mocks.namingConfig,
        l1Mocks.addresses,
        debug,
        waitForBlocks,
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
        debug,
        waitForBlocks,
    );
    const phase8 = await deployPhase8(hre, deployer.signer, phase6, l1Multisigs, debug, waitForBlocks);

    const vaultDeployment = await deployVault(
        {
            addresses: l1Mocks.addresses,
            multisigs: l1Multisigs,
            getPhase2: async (__: Signer) => phase2,
            getPhase6: async (__: Signer) => phase6,
        },
        hre,
        deployer.signer,
        debug,
        waitForBlocks,
    );

    // The great migration phase6 configuration
    await shutdownSystem(dao, phase2, phase6);
    await reAddPools(dao, deployer, l1Mocks, phase6);

    // deploy canonicalPhase
    const canonicalPhase1 = await deployCanonicalPhase1(
        hre,
        deployer.signer,
        l1Multisigs,
        l1Mocks.addresses,
        phase2,
        phase6,
    );
    const canonicalPhase2 = await deployCanonicalPhase2(
        hre,
        deployer.signer,
        {
            ...l1Multisigs,
            defender: {
                l1CoordinatorDistributor: "0x0000000000000000000000000000000000000000",
                auraBalProxyOFTHarvestor: "0x0000000000000000000000000000000000000000",
            },
        },
        l1Mocks.addresses,
        phase2,
        vaultDeployment,
        canonicalPhase1,
        debug,
        waitForBlocks,
    );

    const canonicalPhase3 = await deployCanonicalPhase3(
        hre,
        deployer.signer,
        l1Multisigs,
        l1Mocks.addresses,
        phase2,
        phase6,
        canonicalPhase1,
        canonicalChainId,
        debug,
        waitForBlocks,
    );
    const canonicalPhase4 = await deployCanonicalPhase4(
        hre,
        deployer.signer,
        l1Multisigs,
        l1Mocks.addresses,
        canonicalChainId,
        "salt",
        debug,
        waitForBlocks,
    );
    const canonicalPhase5 = await deployCanonicalAuraDistributor(
        hre,
        deployer.signer,
        l1Mocks.addresses,
        l1Multisigs,
        canonicalPhase1,
        debug,
        waitForBlocks,
    );

    // Simulate current state of deployment
    await canonicalPhase4.l1PoolManagerProxy.transferOwnership(l1Multisigs.daoMultisig);
    await phase6.boosterOwner.connect(dao.signer).transferOwnership(phase8.boosterOwnerSecondary.address);
    await phase8.boosterOwnerSecondary.connect(dao.signer).acceptOwnershipBoosterOwner();
    await phase8.boosterOwnerSecondary.connect(dao.signer).setVoteDelegate(canonicalPhase3.gaugeVoteRewards.address);
    await phase6.poolManagerSecondaryProxy.connect(dao.signer).setOperator(phase8.poolManagerV4.address);
    await phase6.poolManagerSecondaryProxy.connect(dao.signer).setOwner(phase8.poolManagerV4.address);

    const canonical = {
        ...canonicalPhase1,
        ...canonicalPhase2,
        ...canonicalPhase3,
        ...canonicalPhase4,
        ...canonicalPhase5,
    };

    return { mocks: l1Mocks, multisigs: l1Multisigs, phase2, phase6, phase8, vaultDeployment, canonical };
};
export const deployL2 = async (
    hre: HardhatRuntimeEnvironment,
    accounts: Signer[],
    l1: L1TestSetup,
    canonicalChainId = 111,
    sidechainLzChainId = 222,
    debug = false,
    waitForBlocks = 0,
): Promise<{ l2: L2TestSetup; bridgeDelegates: SimplyBridgeDelegateDeployed }> => {
    const deployer = await impersonateAccount(await accounts[0].getAddress());
    const l2mocks = await deploySidechainMocks(hre, deployer.signer, canonicalChainId, debug, waitForBlocks);
    const l2Multisigs = await getL2MockMultisigs(accounts[3]);
    const l1Multisigs = await getMockMultisigs(accounts[1], accounts[2], accounts[3]);
    const dao = await impersonateAccount(l2Multisigs.daoMultisig);

    // deploy sidechain
    const create2Factory = await new Create2Factory__factory(deployer.signer).deploy();
    await create2Factory.updateDeployer(deployer.address, true);

    const l2LzEndpoint = await new LZEndpointMock__factory(deployer.signer).deploy(sidechainLzChainId);
    l2mocks.addresses.lzEndpoint = l2LzEndpoint.address;

    const bridging = { l2Sender: ZERO_ADDRESS, l1Receiver: ZERO_ADDRESS, nativeBridge: ZERO_ADDRESS };
    const extSidechainConfig = { ...l2mocks.addresses, create2Factory: create2Factory.address };
    const sidechainPhase1 = await deploySidechainPhase1(
        hre,
        deployer.signer,
        l2mocks.namingConfig,
        l2Multisigs,
        extSidechainConfig,
        bridging,
        l1.canonical,
        canonicalChainId,
    );
    const sidechainPhase2 = await deploySidechainPhase2(
        hre,
        deployer.signer,
        l2mocks.namingConfig,
        l2Multisigs,
        extSidechainConfig,
        l1.canonical,
        sidechainPhase1,
        canonicalChainId,
    );
    const sidechainPhase3 = await deploySidechainPhase3(
        hre,
        deployer.signer,
        extSidechainConfig,
        l2Multisigs,
        sidechainPhase1,
    );
    const sidechainPhase4 = await deploySidechainPhase4(
        hre,
        deployer.signer,
        l1.canonical,
        canonicalChainId,
        extSidechainConfig,
        l2Multisigs,
        sidechainPhase1,
    );
    const sidechain = { ...sidechainPhase1, ...sidechainPhase2, ...sidechainPhase3, ...sidechainPhase4 };

    // Mock L1 Endpoints  configuration
    await l1.mocks.lzEndpoint.setDestLzEndpoint(sidechain.l2Coordinator.address, l2LzEndpoint.address);
    await l1.mocks.lzEndpoint.setDestLzEndpoint(sidechain.auraOFT.address, l2LzEndpoint.address);
    await l1.mocks.lzEndpoint.setDestLzEndpoint(sidechain.auraBalOFT.address, l2LzEndpoint.address);
    await l1.mocks.lzEndpoint.setDestLzEndpoint(sidechain.childGaugeVoteRewards.address, l2LzEndpoint.address);
    await l1.mocks.lzEndpoint.setDestLzEndpoint(sidechain.l2PoolManagerProxy.address, l2LzEndpoint.address);

    // Mock L12Endpoints  configuration
    await l2LzEndpoint.setDestLzEndpoint(l1.canonical.l1Coordinator.address, l1.mocks.lzEndpoint.address);
    await l2LzEndpoint.setDestLzEndpoint(l1.canonical.auraProxyOFT.address, l1.mocks.lzEndpoint.address);
    await l2LzEndpoint.setDestLzEndpoint(l1.canonical.auraBalProxyOFT.address, l1.mocks.lzEndpoint.address);
    await l2LzEndpoint.setDestLzEndpoint(l1.canonical.gaugeVoteRewards.address, l1.mocks.lzEndpoint.address);
    await l2LzEndpoint.setDestLzEndpoint(l1.canonical.l1PoolManagerProxy.address, l1.mocks.lzEndpoint.address);

    // Add Mock Gauge
    await sidechain.poolManager.connect(dao.signer)["addPool(address)"](l2mocks.gauge.address);

    const l1CoordinatorOwner = await l1.canonical.l1Coordinator.owner();
    // It means at least 1 side chain already was deployed and the coordinator owner is DAO.
    if (l1CoordinatorOwner.toLocaleLowerCase() === dao.address.toLocaleLowerCase()) {
        l1.canonical.l1Coordinator = l1.canonical.l1Coordinator.connect(dao.signer);
        l1.canonical.auraProxyOFT = l1.canonical.auraProxyOFT.connect(dao.signer);
        l1.canonical.gaugeVoteRewards = l1.canonical.gaugeVoteRewards.connect(dao.signer);
    }

    const sidechainMultisigs = {
        ...l1Multisigs,
        daoMultisig: dao.address,
        defender: {
            l1CoordinatorDistributor: "0x0000000000000000000000000000000000000000",
            auraBalProxyOFTHarvestor: "0x0000000000000000000000000000000000000000",
        },
    };
    await setTrustedRemoteCanonicalPhase1(l1.canonical, sidechain, sidechainLzChainId, sidechainMultisigs, bridging);
    await setTrustedRemoteCanonicalPhase2(l1.canonical, sidechain, sidechainLzChainId, sidechainMultisigs);
    await setTrustedRemoteCanonicalPhase3(l1.canonical, sidechain, sidechainLzChainId, sidechainMultisigs);

    // Emulate DAO Settings - L1 Stuff
    await l1.phase6.booster.connect(dao.signer).setBridgeDelegate(l1.canonical.l1Coordinator.address);
    l1.canonical.l1Coordinator = l1.canonical.l1Coordinator.connect(dao.signer);
    l1.canonical.auraProxyOFT = l1.canonical.auraProxyOFT.connect(dao.signer);
    l1.canonical.auraBalProxyOFT = l1.canonical.auraBalProxyOFT.connect(dao.signer);
    await l1.canonical.auraBalProxyOFT.setRewardReceiver(sidechainLzChainId, sidechain.auraBalStrategy.address);

    // Emulate DAO Settings - L2 Stuff
    sidechain.l2Coordinator = sidechain.l2Coordinator.connect(dao.signer);
    sidechain.auraOFT = sidechain.auraOFT.connect(dao.signer);
    sidechain.auraBalOFT = sidechain.auraBalOFT.connect(dao.signer);
    await sidechain.childGaugeVoteRewards
        .connect(dao.signer)
        .setTrustedRemote(
            canonicalChainId,
            ethers.utils.solidityPack(
                ["address", "address"],
                [l1.canonical.gaugeVoteRewards.address, sidechain.childGaugeVoteRewards.address],
            ),
        );

    // Emulate DAO Settings - L1 Stuff
    const { bridgeDelegateSender } = await deploySimpleBridgeSender(
        hre,
        { extConfig: l1.mocks.addresses } as unknown as SidechainConfig,
        deployer.signer,
    );
    const { bridgeDelegateReceiver } = await deploySimpleBridgeReceiver(
        hre,
        { create2Factory: create2Factory.address } as unknown as ExtSystemConfig,
        l1.canonical,
        sidechainLzChainId,
        deployer.signer,
        "test",
    );
    const sbd = { bridgeDelegateSender, bridgeDelegateReceiver };

    await l1.canonical.l1Coordinator
        .connect(dao.signer)
        .setBridgeDelegate(sidechainLzChainId, sbd.bridgeDelegateReceiver.address);
    await l1.canonical.l1Coordinator
        .connect(dao.signer)
        .setL2Coordinator(sidechainLzChainId, sidechain.l2Coordinator.address);

    await sidechain.l2Coordinator.connect(dao.signer).setBridgeDelegate(sbd.bridgeDelegateSender.address);

    // Revert connected contracts with deployer signer
    l1.canonical.l1Coordinator = l1.canonical.l1Coordinator.connect(deployer.signer);
    sidechain.l2Coordinator = sidechain.l2Coordinator.connect(deployer.signer);
    sidechain.auraOFT = sidechain.auraOFT.connect(deployer.signer);
    sidechain.auraBalOFT = sidechain.auraBalOFT.connect(deployer.signer);
    return {
        l2: { mocks: l2mocks, multisigs: l2Multisigs, sidechain },
        bridgeDelegates: { ...sbd },
    };
};
/**
 * Full deployment of the system in order to test sidechain stuff.
 * - L1: phase 1 to 6, canonical phase, mocks, multisigs
 * - L2: phase 1 to 2, mocks, multisigs
 *
 * - Configures layer zero to enable communication between L1 <=> L2
 *
 * @param {HardhatRuntimeEnvironment} hre - The Hardhat runtime environment
 * @param {Signer[]} accounts - Array of accounts to use.
 * @param {number} canonicalChainId - The ID of the canonical chain, or L1
 * @param {number} sidechainLzChainId - The ID of the canonical chain, or L2
 * @returns {SideChainTestSetup}
 */
export const sidechainTestSetup = async (
    hre: HardhatRuntimeEnvironment,
    accounts: Signer[],
    canonicalChainId: number = 111,
    sidechainLzChainId: number = 222,
    debug = false,
    waitForBlocks = 0,
): Promise<SideChainTestSetup> => {
    const deployer = await impersonateAccount(await accounts[0].getAddress());
    const l1Deployed = await deployL1(hre, accounts, canonicalChainId, debug, waitForBlocks);
    // configuration of l1 after full deployment
    await l1Deployed.vaultDeployment.vault.setHarvestPermissions(false);
    await l1Deployed.vaultDeployment.vault.transferOwnership(l1Deployed.canonical.auraBalProxyOFT.address);

    const l2Deployed = await deployL2(
        hre,
        accounts,
        l1Deployed,
        canonicalChainId,
        sidechainLzChainId,
        debug,
        waitForBlocks,
    );

    return {
        deployer,
        l1: { ...l1Deployed },
        l2: { ...l2Deployed.l2 },
        bridgeDelegates: { ...l2Deployed.bridgeDelegates },
    };
};

const shutdownSystem = async (dao: Account, phase2: Phase2Deployed, phase6: Phase6Deployed) => {
    // shutdown pools
    const poolLength = await phase2.booster.poolLength();
    await Promise.all(
        Array(poolLength.toNumber())
            .fill(null)
            .map(async (_, i) => {
                const poolInfo = await phase2.booster.poolInfo(i);
                if (!poolInfo.shutdown) {
                    await phase2.poolManager.connect(dao.signer).shutdownPool(i);
                    return { ...poolInfo, shutdown: true, pid: i };
                }
                return { ...poolInfo, pid: i };
            }),
    );
    // shutdown system
    await phase2.poolManagerSecondaryProxy.connect(dao.signer).shutdownSystem();
    await phase2.boosterOwner.connect(dao.signer).shutdownSystem();
    // update voterproxy operator
    await phase2.voterProxy.connect(dao.signer).setOperator(phase6.booster.address);
    // update Aura operator
    await phase2.cvx.connect(dao.signer).updateOperator();
};

const reAddPools = async (dao: Account, deployer: Account, l1Mocks: DeployMocksResult, phase6: Phase6Deployed) => {
    await phase6.poolManager.connect(dao.signer).setProtectPool(false);
    const { gauges } = l1Mocks.addresses;
    const gaugeLength = gauges.length;
    const gaugeController = IGaugeController__factory.connect(l1Mocks.addresses.gaugeController, deployer.signer);
    for (let i = 0; i < gaugeLength; i++) {
        if (gaugeLength > 10) {
            const weight = await gaugeController.get_gauge_weight(gauges[i]);
            if (weight.lt(simpleToExactAmount(15000))) continue;
        }
        await phase6.poolManager["addPool(address)"](gauges[i]);
    }
};
