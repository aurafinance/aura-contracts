import { expect } from "chai";
import { BigNumber, BigNumberish } from "ethers";
import hre, { ethers } from "hardhat";
import { deployContract, deployContractWithCreate2 } from "../../tasks/utils";
import { deploySidechainSystem, SidechainDeployed } from "../../scripts/deploySidechain";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import { config as sidechainConfig } from "../../tasks/deploy/sidechain-config";
import { impersonate, impersonateAccount, simpleToExactAmount, ZERO_ADDRESS } from "../../test-utils";
import {
    Account,
    AuraOFT,
    AuraOFT__factory,
    Coordinator,
    Create2Factory,
    Create2Factory__factory,
    ERC20,
    ExtraRewardStashV3__factory,
    LZEndpointMock,
    LZEndpointMock__factory,
    MockCurveMinter,
    MockCurveMinter__factory,
    MockERC20__factory,
} from "../../types";

const NATIVE_FEE = simpleToExactAmount("0.1");

describe("Sidechain", () => {
    const L1_CHAIN_ID = 111;
    const L2_CHAIN_ID = 222;
    const mintrMintAmount = simpleToExactAmount(10);

    let deployer: Account;
    let dao: Account;
    let auraWhale: Account;

    // phases
    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    let mockMintr: MockCurveMinter;

    // LayerZero endpoints
    let l1LzEndpoint: LZEndpointMock;
    let l2LzEndpoint: LZEndpointMock;

    // Canonical chain Contracts
    let create2Factory: Create2Factory;
    let auraOFT: AuraOFT;
    let crv: ERC20;

    // Sidechain Contracts
    let sidechain: SidechainDeployed;
    let coordinator: Coordinator;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    async function getEth(recipient: string) {
        const ethWhale = await impersonate(mainnetConfig.addresses.weth);
        await ethWhale.sendTransaction({
            to: recipient,
            value: simpleToExactAmount(1),
        });
    }

    async function getBal(to: string, amount: BigNumberish) {
        await getEth(mainnetConfig.addresses.balancerVault);
        const tokenWhaleSigner = await impersonateAccount(mainnetConfig.addresses.balancerVault);
        await crv.connect(tokenWhaleSigner.signer).transfer(to, amount);
    }

    async function withMockMinter(fn: () => Promise<void>) {
        // Update the mintr slot of voter proxy to be our mock mintr
        const original = await hre.network.provider.send("eth_getStorageAt", [sidechain.voterProxy.address, "0x0"]);
        const newSlot = "0x" + mockMintr.address.slice(2).padStart(64, "0");
        await getBal(mockMintr.address, mintrMintAmount);
        expect(await crv.balanceOf(mockMintr.address)).eq(mintrMintAmount);

        await hre.network.provider.send("hardhat_setStorageAt", [sidechain.voterProxy.address, "0x0", newSlot]);
        await fn();
        await hre.network.provider.send("hardhat_setStorageAt", [sidechain.voterProxy.address, "0x0", original]);
    }

    async function toFeeAmount(n: BigNumber) {
        const lockIncentive = await sidechain.booster.lockIncentive();
        const stakerIncentive = await sidechain.booster.stakerIncentive();
        const platformFee = await sidechain.booster.platformFee();
        const feeDenom = await sidechain.booster.FEE_DENOMINATOR();

        const totalIncentive = lockIncentive.add(stakerIncentive).add(platformFee);
        return n.mul(totalIncentive).div(feeDenom);
    }

    before(async () => {
        const accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        dao = await impersonateAccount(mainnetConfig.multisigs.daoMultisig);
        auraWhale = await impersonateAccount(mainnetConfig.addresses.balancerVault, true);

        phase2 = await mainnetConfig.getPhase2(deployer.signer);
        phase6 = await mainnetConfig.getPhase6(deployer.signer);

        // deploy layerzero mocks
        l1LzEndpoint = await new LZEndpointMock__factory(deployer.signer).deploy(L1_CHAIN_ID);
        l2LzEndpoint = await new LZEndpointMock__factory(deployer.signer).deploy(L2_CHAIN_ID);

        // deploy Create2Factory
        create2Factory = await new Create2Factory__factory(deployer.signer).deploy();

        auraOFT = await deployContractWithCreate2<AuraOFT, AuraOFT__factory>(
            create2Factory,
            new AuraOFT__factory(deployer.signer),
            "AuraOFT",
            [l1LzEndpoint.address, phase2.cvx.address, phase2.cvxLocker.address, deployer.address],
            {},
            {},
            false,
        );

        // deploy sidechain
        sidechain = await deploySidechainSystem(
            hre,
            sidechainConfig.naming,
            {
                ...sidechainConfig.addresses,
                lzEndpoint: l2LzEndpoint.address,
                daoMultisig: dao.address,
                create2Factory: create2Factory.address,
            },
            { ...sidechainConfig.extConfig, canonicalChainId: L1_CHAIN_ID },
            deployer.signer,
        );

        coordinator = sidechain.coordinator;

        crv = MockERC20__factory.connect(mainnetConfig.addresses.token, deployer.signer);

        mockMintr = await deployContract<MockCurveMinter>(
            hre,
            new MockCurveMinter__factory(deployer.signer),
            "MockCurveMinter",
            [mainnetConfig.addresses.token, mintrMintAmount],
            {},
            false,
        );
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
            expect(await sidechain.booster.feeManager()).eq(dao.address);
            expect(await sidechain.booster.poolManager()).eq(sidechain.poolManager.address);
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

    describe("Setup: Protocol DAO transactions", () => {
        it("set auraOFT as booster bridge delegate", async () => {
            expect(await phase6.booster.bridgeDelegate()).not.eq(auraOFT.address);
            await phase6.booster.connect(dao.signer).setBridgeDelegate(auraOFT.address);
            expect(await phase6.booster.bridgeDelegate()).eq(auraOFT.address);
        });
        it("add trusted remotes to layerzero endpoints", async () => {
            await auraOFT.setTrustedRemote(
                L2_CHAIN_ID,
                hre.ethers.utils.solidityPack(["address", "address"], [coordinator.address, auraOFT.address]),
            );
            await coordinator.setTrustedRemote(
                L1_CHAIN_ID,
                hre.ethers.utils.solidityPack(["address", "address"], [auraOFT.address, coordinator.address]),
            );

            await l2LzEndpoint.setDestLzEndpoint(auraOFT.address, l1LzEndpoint.address);
            await l1LzEndpoint.setDestLzEndpoint(coordinator.address, l2LzEndpoint.address);
        });
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
    });

    describe("Bridge AURA normally", () => {
        const bridgeAmount = simpleToExactAmount(101);
        it("bridge AURA from L1 -> L2", async () => {
            const balBefore = await phase2.cvx.balanceOf(auraWhale.address);
            const l2BalBefore = await coordinator.balanceOf(deployer.address);
            expect(balBefore).gt(bridgeAmount);

            await phase2.cvx.connect(auraWhale.signer).approve(auraOFT.address, bridgeAmount);
            expect(await phase2.cvx.allowance(auraWhale.address, auraOFT.address)).gte(bridgeAmount);

            await auraOFT
                .connect(auraWhale.signer)
                .sendFrom(
                    auraWhale.address,
                    L2_CHAIN_ID,
                    deployer.address,
                    bridgeAmount,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    [],
                    {
                        value: NATIVE_FEE,
                    },
                );

            const balAfter = await phase2.cvx.balanceOf(auraWhale.address);
            const l2BalAfter = await coordinator.balanceOf(deployer.address);
            expect(balBefore.sub(balAfter)).eq(bridgeAmount);
            expect(l2BalAfter.sub(l2BalBefore)).eq(bridgeAmount);
        });
        it("bridge AURA from L2 -> L1", async () => {
            const balBefore = await coordinator.balanceOf(deployer.address);
            const l2BalBefore = await phase2.cvx.balanceOf(auraWhale.address);
            expect(balBefore).gte(bridgeAmount);

            await coordinator.approve(coordinator.address, bridgeAmount);
            expect(await coordinator.allowance(deployer.address, coordinator.address)).gte(bridgeAmount);

            await coordinator.sendFrom(
                deployer.address,
                L1_CHAIN_ID,
                auraWhale.address,
                bridgeAmount,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                [],
                {
                    value: NATIVE_FEE,
                },
            );

            const balAfter = await coordinator.balanceOf(deployer.address);
            const l2BalAfter = await phase2.cvx.balanceOf(auraWhale.address);
            expect(balBefore.sub(balAfter)).eq(bridgeAmount);
            expect(l2BalAfter.sub(l2BalBefore)).eq(bridgeAmount);
        });
    });

    describe("Lock AURA", () => {
        const lockAmount = simpleToExactAmount(10);
        before(async () => {
            // Transfer some AURA to L2
            await phase2.cvx.connect(auraWhale.signer).approve(auraOFT.address, lockAmount);
            await auraOFT
                .connect(auraWhale.signer)
                .sendFrom(
                    auraWhale.address,
                    L2_CHAIN_ID,
                    deployer.address,
                    lockAmount,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    [],
                    {
                        value: NATIVE_FEE,
                    },
                );
        });
        it("lock AURA from L2 -> L1", async () => {
            const balancesBefore = await phase2.cvxLocker.balances(deployer.address);
            await coordinator.lock(lockAmount, [], { value: NATIVE_FEE });
            const balancesAfter = await phase2.cvxLocker.balances(deployer.address);
            expect(balancesAfter.locked.sub(balancesBefore.locked)).eq(lockAmount);
        });
    });

    describe('Earmark rewards on L2 "mints" (transfers) AURA', () => {
        it("earmark rewards sends fees to coordinator", async () => {
            const coordinatorBalBefore = await crv.balanceOf(coordinator.address);
            const feeDebtBefore = await auraOFT.feeDebt(L2_CHAIN_ID);
            await withMockMinter(async () => {
                await sidechain.booster.earmarkRewards(0, [], {
                    value: NATIVE_FEE,
                });
            });
            const coordinatorBalAfter = await crv.balanceOf(coordinator.address);
            const feeDebtAfter = await auraOFT.feeDebt(L2_CHAIN_ID);
            const amountOfFees = await toFeeAmount(mintrMintAmount);

            expect(coordinatorBalAfter.sub(coordinatorBalBefore)).eq(amountOfFees);
            expect(feeDebtAfter.sub(feeDebtBefore)).eq(amountOfFees);
            // TODO: check new AURA (OFT) balance of coordinator on L2
        });
    });

    describe("Settle fee debt from L2 -> L1", () => {
        it("settle fees updated feeDebt on L1");
    });
});
