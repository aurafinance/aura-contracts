import { expect } from "chai";
import hre, { ethers } from "hardhat";

import {
    Account,
    AuraOFT,
    L2Coordinator,
    Create2Factory,
    Create2Factory__factory,
    ExtraRewardStashV3__factory,
} from "../../types";
import { impersonateAccount, ZERO_ADDRESS } from "../../test-utils";
import { SidechainConfig } from "../../tasks/deploy/sidechain-types";
import { config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import { deploySidechainSystem, SidechainDeployed } from "../../scripts/deploySidechain";
import { Phase6Deployed } from "scripts/deploySystem";

describe("Sidechain", () => {
    const L1_CHAIN_ID = 111;

    let deployer: Account;
    let dao: Account;

    let create2Factory: Create2Factory;
    let sidechain: SidechainDeployed;
    let l2Coordinator: L2Coordinator;
    let auraOFT: AuraOFT;
    let sidechainConfig: SidechainConfig;
    let phase6: Phase6Deployed;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    before(async () => {
        const accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        dao = await impersonateAccount(mainnetConfig.multisigs.daoMultisig);

        // deploy Create2Factory
        create2Factory = await new Create2Factory__factory(deployer.signer).deploy();
        await create2Factory.updateDeployer(deployer.address, true);

        // setup sidechain config
        sidechainConfig = {
            chainId: 123,
            addresses: {
                lzEndpoint: ZERO_ADDRESS,
                daoMultisig: dao.address,
                create2Factory: create2Factory.address,
                token: mainnetConfig.addresses.token,
                minter: mainnetConfig.addresses.minter,
            },
            naming: {
                auraOftName: "Aura",
                auraOftSymbol: "AURA",
                tokenFactoryNamePostfix: " Aura Deposit",
                auraBalOftName: "Aura BAL",
                auraBalOftSymbol: "auraBAL",
            },
            bridging: {
                l1Receiver: "0x0000000000000000000000000000000000000000",
                l2Sender: "0x0000000000000000000000000000000000000000",
                nativeBridge: "0x0000000000000000000000000000000000000000",
            },
            extConfig: { canonicalChainId: L1_CHAIN_ID },
        };

        // deploy sidechain
        sidechain = await deploySidechainSystem(
            hre,
            sidechainConfig.naming,
            sidechainConfig.addresses,
            sidechainConfig.extConfig,
            deployer.signer,
        );

        l2Coordinator = sidechain.l2Coordinator;
        auraOFT = sidechain.auraOFT;

        phase6 = await mainnetConfig.getPhase6(deployer.signer);
    });

    describe("Check configs", () => {
        it("VotingProxy has correct config", async () => {
            const { addresses } = sidechainConfig;

            expect(await sidechain.voterProxy.mintr()).eq(addresses.minter);
            expect(await sidechain.voterProxy.crv()).eq(addresses.token);
            expect(await sidechain.voterProxy.rewardDeposit()).eq(ZERO_ADDRESS);
            expect(await sidechain.voterProxy.withdrawer()).eq(ZERO_ADDRESS);
            expect(await sidechain.voterProxy.owner()).eq(dao.address);
            expect(await sidechain.voterProxy.operator()).eq(sidechain.booster.address);
        });
        it("AuraOFT has correct config", async () => {
            expect(await auraOFT.name()).eq(sidechainConfig.naming.auraOftName);
            expect(await auraOFT.symbol()).eq(sidechainConfig.naming.auraOftSymbol);
            expect(await auraOFT.lzEndpoint()).eq(ZERO_ADDRESS);
            expect(await auraOFT.canonicalChainId()).eq(L1_CHAIN_ID);
        });
        it("L2Coordinator has correct config", async () => {
            expect(await l2Coordinator.canonicalChainId()).eq(L1_CHAIN_ID);
            expect(await l2Coordinator.booster()).eq(sidechain.booster.address);
            expect(await l2Coordinator.auraOFT()).eq(auraOFT.address);
            expect(await l2Coordinator.mintRate()).eq(0);
            expect(await l2Coordinator.lzEndpoint()).eq(ZERO_ADDRESS);
        });
        it("BoosterLite has correct config", async () => {
            expect(await sidechain.booster.crv()).eq(sidechainConfig.addresses.token);

            expect(await sidechain.booster.lockIncentive()).eq(550);
            expect(await sidechain.booster.stakerIncentive()).eq(1100);
            expect(await sidechain.booster.earmarkIncentive()).eq(50);
            expect(await sidechain.booster.platformFee()).eq(0);
            expect(await sidechain.booster.MaxFees()).eq(4000);
            expect(await sidechain.booster.FEE_DENOMINATOR()).eq(10000);

            expect(await sidechain.booster.owner()).eq(sidechain.boosterOwner.address);
            expect(await sidechain.booster.feeManager()).eq(dao.address);
            expect(await sidechain.booster.poolManager()).eq(sidechain.poolManager.address);
            expect(await sidechain.booster.staker()).eq(sidechain.voterProxy.address);
            expect(await sidechain.booster.minter()).eq(l2Coordinator.address);
            expect(await sidechain.booster.rewardFactory()).eq(sidechain.factories.rewardFactory.address);
            expect(await sidechain.booster.stashFactory()).eq(sidechain.factories.stashFactory.address);
            expect(await sidechain.booster.tokenFactory()).eq(sidechain.factories.tokenFactory.address);
            expect(await sidechain.booster.treasury()).eq(ZERO_ADDRESS);

            expect(await sidechain.booster.isShutdown()).eq(false);
            expect(await sidechain.booster.poolLength()).eq(0);
        });
        it("Booster Owner has correct config", async () => {
            expect(await sidechain.boosterOwner.poolManager()).eq(sidechain.poolManager.address);
            expect(await sidechain.boosterOwner.booster()).eq(sidechain.booster.address);
            expect(await sidechain.boosterOwner.stashFactory()).eq(sidechain.factories.stashFactory.address);
            expect(await sidechain.boosterOwner.rescueStash()).eq(ZERO_ADDRESS);
            expect(await sidechain.boosterOwner.owner()).eq(dao.address);
            expect(await sidechain.boosterOwner.pendingowner()).eq(ZERO_ADDRESS);
            expect(await sidechain.boosterOwner.isSealed()).eq(true);
            expect(await sidechain.boosterOwner.isForceTimerStarted()).eq(false);
            expect(await sidechain.boosterOwner.forceTimestamp()).eq(0);
        });
        it("BoosterOwnerSecondary has correct config");
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
        it("poolManager has correct config", async () => {
            const { booster, poolManager } = sidechain;
            expect(await poolManager.booster()).eq(booster.address);
            expect(await poolManager.operator()).eq(dao.address);
            expect(await poolManager.protectAddPool()).eq(true);
        });
    });

    /* ---------------------------------------------------------------------
     * Protected functions
     * --------------------------------------------------------------------- */

    describe("Protected functions", () => {
        it("BoosterOwnerSecondary protected functions");
        it("PoolManager protected functions");
    });

    /* ---------------------------------------------------------------------
     * General Functional tests
     * --------------------------------------------------------------------- */

    describe("Booster setup", () => {
        it("can unprotected poolManager add pool");
        it("add pools to the booster", async () => {
            // As this test suite is running the bridge from L1 -> L1 forked on
            // mainnet. We can just add the first 10 active existing Aura pools
            let i = 0;
            while ((await sidechain.booster.poolLength()).lt(10)) {
                const poolInfo = await phase6.booster.poolInfo(i);
                if (!poolInfo.shutdown) {
                    await sidechain.poolManager.connect(dao.signer)["addPool(address)"](poolInfo.gauge);
                }
                i++;
            }
            expect(await sidechain.booster.poolLength()).eq(10);
        });
        it("Pool stash has the correct config");
        it("Pool rewards contract has the correct config");
    });

    describe("Deposit and withdraw BPT", () => {
        it("allow deposit into pool via Booster");
        it("allows auraBPT deposits directly into the reward pool");
        it("allows BPT deposits directly into the reward pool");
        it("allows withdrawals directly from the pool 4626");
        it("allows withdrawals directly from the pool normal");
        it("allows earmarking of rewards");
        it("pays out a premium to the caller");
        it("allows users to earn $BAl and $AURA");
        it("allows extra rewards to be added to pool");
    });

    describe("Booster admin", () => {
        it("does not allow a duplicate pool to be added");
        it("allows a pool to be shut down");
        it("does not allow the system to be shut down");
        it("does not allow boosterOwner to revert control");
        it("allows boosterOwner owner to be changed");
        it("allows boosterOwner to call all fns on booster");
    });

    describe("Shutdown", () => {
        it("allows system to be shutdown");
    });
});
