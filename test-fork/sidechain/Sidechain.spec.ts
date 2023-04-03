import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { deploySidechainSystem, SidechainDeployed } from "../../scripts/deploySidechain";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import { config as sidechainConfig } from "../../tasks/deploy/sidechain-config";
import { impersonateAccount, ZERO_ADDRESS } from "../../test-utils";
import {
    Account,
    AuraOFT,
    AuraOFT__factory,
    Coordinator,
    ExtraRewardStashV3__factory,
    LZEndpointMock,
    LZEndpointMock__factory,
} from "../../types";

describe("Sidechain", () => {
    const L1_CHAIN_ID = 111;
    const L2_CHAIN_ID = 222;

    let deployer: Account;
    let dao: Account;

    // phases
    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;

    // LayerZero endpoints
    let l1LzEndpoint: LZEndpointMock;
    let l2LzEndpoint: LZEndpointMock;

    // Canonical chain Contracts
    let auraOFT: AuraOFT;

    // Sidechain Contracts
    let sidechain: SidechainDeployed;
    let coordinator: Coordinator;

    before(async () => {
        const accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        dao = await impersonateAccount(mainnetConfig.multisigs.daoMultisig);

        phase2 = await mainnetConfig.getPhase2(deployer.signer);
        phase6 = await mainnetConfig.getPhase6(deployer.signer);

        // deploy layerzero mocks
        l1LzEndpoint = await new LZEndpointMock__factory(deployer.signer).deploy(L1_CHAIN_ID);
        l2LzEndpoint = await new LZEndpointMock__factory(deployer.signer).deploy(L2_CHAIN_ID);

        // deploy canonical chain
        auraOFT = await new AuraOFT__factory(deployer.signer).deploy(l1LzEndpoint.address, phase2.cvx.address);

        // // deploy sidechain
        sidechain = await deploySidechainSystem(
            hre,
            sidechainConfig.naming,
            { ...sidechainConfig.addresses, lzEndpoint: l2LzEndpoint.address },
            { ...sidechainConfig.extConfig, canonicalChainId: L1_CHAIN_ID },
            deployer.signer,
        );

        coordinator = sidechain.coordinator;
    });

    describe("Check configs", () => {
        it("VotingProxy has correct config", async () => {
            const { addresses } = sidechainConfig;

            expect(await sidechain.voterProxy.mintr()).eq(addresses.minter);
            expect(await sidechain.voterProxy.crv()).eq(addresses.token);
            expect(await sidechain.voterProxy.rewardDeposit()).eq(ZERO_ADDRESS);
            expect(await sidechain.voterProxy.withdrawer()).eq(ZERO_ADDRESS);
            expect(await sidechain.voterProxy.owner()).eq(sidechainConfig.addresses.daoMultisig);
            expect(await sidechain.voterProxy.operator()).eq(sidechain.booster.address);
        });
        it("Coordinator has correct config", async () => {
            expect(await coordinator.canonicalChainId()).eq(L1_CHAIN_ID);
            expect(await coordinator.booster()).eq(sidechain.booster.address);
            expect(await coordinator.mintRate()).eq(0);
            expect(await coordinator.name()).eq(sidechainConfig.naming.coordinatorName);
            expect(await coordinator.symbol()).eq(sidechainConfig.naming.coordinatorSymbol);
            expect(await coordinator.lzEndpoint()).eq(l2LzEndpoint.address);
        });
        it("AuraOFT has correct config", async () => {
            expect(await auraOFT.lzEndpoint()).eq(l1LzEndpoint.address);
            expect(await auraOFT.token()).eq(phase2.cvx.address);
        });
        it("Booster has correct config", async () => {
            expect(await sidechain.booster.crv()).eq(sidechainConfig.addresses.token);

            expect(await sidechain.booster.lockIncentive()).eq(550);
            expect(await sidechain.booster.stakerIncentive()).eq(1100);
            expect(await sidechain.booster.earmarkIncentive()).eq(50);
            expect(await sidechain.booster.platformFee()).eq(0);
            expect(await sidechain.booster.MaxFees()).eq(4000);
            expect(await sidechain.booster.FEE_DENOMINATOR()).eq(10000);

            expect(await sidechain.booster.owner()).eq(sidechain.boosterOwner.address);
            expect(await sidechain.booster.feeManager()).eq(sidechainConfig.addresses.daoMultisig);
            expect(await sidechain.booster.poolManager()).eq(sidechain.poolManagerProxy.address);
            expect(await sidechain.booster.staker()).eq(sidechain.voterProxy.address);
            expect(await sidechain.booster.minter()).eq(coordinator.address);
            expect(await sidechain.booster.rewardFactory()).eq(sidechain.factories.rewardFactory.address);
            expect(await sidechain.booster.stashFactory()).eq(sidechain.factories.stashFactory.address);
            expect(await sidechain.booster.tokenFactory()).eq(sidechain.factories.tokenFactory.address);
            expect(await sidechain.booster.treasury()).eq(ZERO_ADDRESS);

            expect(await sidechain.booster.isShutdown()).eq(false);
            expect(await sidechain.booster.poolLength()).eq(0);
        });
        it("Booster Owner has correct config", async () => {
            expect(await sidechain.boosterOwner.poolManager()).eq(sidechain.poolManagerSecondaryProxy.address);
            expect(await sidechain.boosterOwner.booster()).eq(sidechain.booster.address);
            expect(await sidechain.boosterOwner.stashFactory()).eq(sidechain.factories.stashFactory.address);
            expect(await sidechain.boosterOwner.rescueStash()).eq(ZERO_ADDRESS);
            expect(await sidechain.boosterOwner.owner()).eq(sidechainConfig.addresses.daoMultisig);
            expect(await sidechain.boosterOwner.pendingowner()).eq(ZERO_ADDRESS);
            expect(await sidechain.boosterOwner.isSealed()).eq(true);
            expect(await sidechain.boosterOwner.isForceTimerStarted()).eq(false);
            expect(await sidechain.boosterOwner.forceTimestamp()).eq(0);
        });
        it("factories have correct config", async () => {
            const {
                booster,
                factories: { rewardFactory, stashFactory, tokenFactory, proxyFactory },
            } = sidechain;

            const { addresses } = sidechainConfig;

            expect(await rewardFactory.operator()).eq(booster.address);
            expect(await rewardFactory.crv()).eq(addresses.token);

            expect(await stashFactory.operator()).eq(booster.address);
            expect(await stashFactory.rewardFactory()).eq(rewardFactory.address);
            expect(await stashFactory.proxyFactory()).eq(proxyFactory.address);
            expect(await stashFactory.v1Implementation()).eq(ZERO_ADDRESS);
            expect(await stashFactory.v2Implementation()).eq(ZERO_ADDRESS);

            const rewardsStashV3 = ExtraRewardStashV3__factory.connect(
                await stashFactory.v3Implementation(),
                deployer.signer,
            );
            expect(await rewardsStashV3.crv()).eq(addresses.token);

            expect(await tokenFactory.operator()).eq(booster.address);
            expect(await tokenFactory.namePostfix()).eq(sidechainConfig.naming.tokenFactoryNamePostfix);
            expect(await tokenFactory.symbolPrefix()).eq("aura");
        });
        it("poolManagerProxy has correct config", async () => {
            const { booster, poolManagerProxy, poolManagerSecondaryProxy } = sidechain;
            expect(await poolManagerProxy.pools()).eq(booster.address);
            expect(await poolManagerProxy.owner()).eq(ZERO_ADDRESS);
            expect(await poolManagerProxy.operator()).eq(poolManagerSecondaryProxy.address);
        });
        it("poolManagerSecondaryProxy has correct config", async () => {
            const { booster, poolManagerProxy, poolManagerSecondaryProxy, poolManager } = sidechain;
            const { addresses } = sidechainConfig;
            // TODO: gaugeController
            expect(await poolManagerSecondaryProxy.gaugeController()).eq("0x0000000000000000000000000000000000000000");
            expect(await poolManagerSecondaryProxy.pools()).eq(poolManagerProxy.address);
            expect(await poolManagerSecondaryProxy.booster()).eq(booster.address);
            expect(await poolManagerSecondaryProxy.owner()).eq(addresses.daoMultisig);
            expect(await poolManagerSecondaryProxy.operator()).eq(poolManager.address);
            expect(await poolManagerSecondaryProxy.isShutdown()).eq(false);
        });
        it("poolManager has correct config", async () => {
            const { poolManagerSecondaryProxy, poolManager } = sidechain;
            const { addresses } = sidechainConfig;
            expect(await poolManager.pools()).eq(poolManagerSecondaryProxy.address);
            // TODO: gaugeController
            expect(await poolManager.gaugeController()).eq("0x0000000000000000000000000000000000000000");
            expect(await poolManager.operator()).eq(addresses.daoMultisig);
            expect(await poolManager.protectAddPool()).eq(true);
        });
    });

    describe("Setup: Protocol DAO transactions", () => {
        it("set auraOFT as booster bridge delegate", async () => {
            expect(await phase6.booster.bridgeDelegate()).not.eq(auraOFT.address);
            await phase6.booster.connect(dao.signer).setBridgeDelegate(auraOFT.address);
            expect(await phase6.booster.bridgeDelegate()).eq(auraOFT.address);
        });
        it("add pools to the booster");
    });

    describe("Bridge AURA normally", () => {
        it("bridge AURA from L1 -> L2");
        it("bridge AURA from L2 -> L1");
    });

    describe("Lock AURA", () => {
        it("lock AURA from L2 -> L1");
    });

    describe('Earmark rewards on L2 "mints" (transfers) AURA', () => {
        it("earmark rewards sends fees to coordinator");
    });

    describe("Settle fee debt from L2 -> L1", () => {
        it("settle fees updated feeDebt on L1");
    });
});
