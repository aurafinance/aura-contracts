import { expect } from "chai";
import { BigNumber } from "ethers";
import hre, { ethers, network } from "hardhat";
import { deployContract } from "../../tasks/utils";
import {
    CanonicalPhaseDeployed,
    deployCanonicalPhase,
    deploySidechainSystem,
    setTrustedRemoteCanonical,
    SidechainDeployed,
} from "../../scripts/deploySidechain";
import { ExtSystemConfig, Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import {
    fullScale,
    getBal,
    impersonateAccount,
    increaseTime,
    ONE_WEEK,
    simpleToExactAmount,
    ZERO_ADDRESS,
} from "../../test-utils";
import {
    Account,
    AuraOFT,
    AuraProxyOFT,
    L2Coordinator,
    L1Coordinator,
    Create2Factory,
    Create2Factory__factory,
    ERC20,
    ExtraRewardStashV3__factory,
    LZEndpointMock,
    LZEndpointMock__factory,
    MockCurveMinter,
    MockCurveMinter__factory,
    MockERC20__factory,
    SimpleBridgeDelegateSender,
    BridgeDelegateReceiver,
    BaseRewardPool4626__factory,
} from "../../types";
import { SidechainConfig } from "../../types/sidechain-types";
import { deploySimpleBridgeDelegates } from "../../scripts/deployBridgeDelegates";
import { sidechainNaming } from "../../tasks/deploy/sidechain-constants";
import { AuraBalVaultDeployed } from "../../tasks/deploy/goerli-config";
import { compareAddresses } from "../../tasks/snapshot/utils";

const NATIVE_FEE = simpleToExactAmount("0.2");

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
    let vaultDeployment: AuraBalVaultDeployed;
    let mockMintr: MockCurveMinter;

    // LayerZero endpoints
    let l1LzEndpoint: LZEndpointMock;
    let l2LzEndpoint: LZEndpointMock;

    // Canonical chain Contracts
    let canonical: CanonicalPhaseDeployed;
    let create2Factory: Create2Factory;
    let l1Coordinator: L1Coordinator;
    let auraProxyOFT: AuraProxyOFT;
    let crv: ERC20;
    let bridgeDelegateReceiver: BridgeDelegateReceiver;

    // Sidechain Contracts
    let sidechain: SidechainDeployed;
    let l2Coordinator: L2Coordinator;
    let auraOFT: AuraOFT;
    let sidechainConfig: SidechainConfig;
    let bridgeDelegateSender: SimpleBridgeDelegateSender;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    async function withMockMinter(fn: () => Promise<void>) {
        // Update the mintr slot of voter proxy to be our mock mintr
        const original = await hre.network.provider.send("eth_getStorageAt", [sidechain.voterProxy.address, "0x0"]);
        const newSlot = "0x" + mockMintr.address.slice(2).padStart(64, "0");
        await getBal(mainnetConfig.addresses, mockMintr.address, mintrMintAmount);
        expect(await crv.balanceOf(mockMintr.address)).eq(mintrMintAmount);

        await hre.network.provider.send("hardhat_setStorageAt", [sidechain.voterProxy.address, "0x0", newSlot]);
        await fn();
        await hre.network.provider.send("hardhat_setStorageAt", [sidechain.voterProxy.address, "0x0", original]);
    }

    async function toFeeAmount(n: BigNumber) {
        const lockIncentive = await phase6.booster.lockIncentive();
        const stakerIncentive = await phase6.booster.stakerIncentive();
        const platformFee = await phase6.booster.platformFee();
        const feeDenom = await phase6.booster.FEE_DENOMINATOR();

        const totalIncentive = lockIncentive.add(stakerIncentive).add(platformFee);
        return n.mul(totalIncentive).div(feeDenom);
    }

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 17140000,
                    },
                },
            ],
        });

        const accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        dao = await impersonateAccount(mainnetConfig.multisigs.daoMultisig);
        auraWhale = await impersonateAccount(mainnetConfig.addresses.balancerVault, true);

        phase2 = await mainnetConfig.getPhase2(deployer.signer);
        phase6 = await mainnetConfig.getPhase6(deployer.signer);
        vaultDeployment = await mainnetConfig.getAuraBalVault(deployer.signer);

        // Deploy mocks
        crv = MockERC20__factory.connect(mainnetConfig.addresses.token, deployer.signer);
        mockMintr = await deployContract<MockCurveMinter>(
            hre,
            new MockCurveMinter__factory(deployer.signer),
            "MockCurveMinter",
            [mainnetConfig.addresses.token, mintrMintAmount],
            {},
            false,
        );

        // deploy layerzero mocks
        l1LzEndpoint = await new LZEndpointMock__factory(deployer.signer).deploy(L1_CHAIN_ID);
        l2LzEndpoint = await new LZEndpointMock__factory(deployer.signer).deploy(L2_CHAIN_ID);

        // deploy Create2Factory
        create2Factory = await new Create2Factory__factory(deployer.signer).deploy();
        await create2Factory.updateDeployer(deployer.address, true);

        // setup sidechain config
        sidechainConfig = {
            chainId: 123,
            multisigs: { daoMultisig: dao.address, pauseGaurdian: dao.address },
            naming: { ...sidechainNaming },
            extConfig: {
                canonicalChainId: L1_CHAIN_ID,
                lzEndpoint: l2LzEndpoint.address,
                create2Factory: create2Factory.address,
                token: mainnetConfig.addresses.token,
                minter: mainnetConfig.addresses.minter,
            },
            bridging: {
                l1Receiver: "0x0000000000000000000000000000000000000000",
                l2Sender: "0x0000000000000000000000000000000000000000",
                nativeBridge: "0x0000000000000000000000000000000000000000",
            },
        };

        // deploy canonicalPhase
        const extSystemConfig: ExtSystemConfig = { ...mainnetConfig.addresses, lzEndpoint: l1LzEndpoint.address };
        canonical = await deployCanonicalPhase(
            hre,
            deployer.signer,
            mainnetConfig.multisigs,
            extSystemConfig,
            phase2,
            phase6,
            vaultDeployment,
        );

        l1Coordinator = canonical.l1Coordinator;
        auraProxyOFT = canonical.auraProxyOFT;

        // deploy sidechain
        sidechain = await deploySidechainSystem(
            hre,
            deployer.signer,
            sidechainConfig.naming,
            sidechainConfig.multisigs,
            sidechainConfig.extConfig,
            canonical,
            L1_CHAIN_ID,
        );

        l2Coordinator = sidechain.l2Coordinator;
        auraOFT = sidechain.auraOFT;
        // Connect contracts to its owner signer.
        canonical.l1Coordinator = canonical.l1Coordinator.connect(dao.signer);
        canonical.auraProxyOFT = canonical.auraProxyOFT.connect(dao.signer);
        canonical.auraBalProxyOFT = canonical.auraBalProxyOFT.connect(dao.signer);

        sidechain.l2Coordinator = sidechain.l2Coordinator.connect(dao.signer);
        sidechain.auraOFT = sidechain.auraOFT.connect(dao.signer);
        sidechain.auraBalOFT = sidechain.auraBalOFT.connect(dao.signer);
    });

    describe("Check configs", () => {
        it("VotingProxy has correct config", async () => {
            const { extConfig } = sidechainConfig;

            expect(await sidechain.voterProxy.mintr()).eq(extConfig.minter);
            expect(await sidechain.voterProxy.crv()).eq(extConfig.token);
            expect(await sidechain.voterProxy.rewardDeposit()).eq(ZERO_ADDRESS);
            expect(await sidechain.voterProxy.withdrawer()).eq(ZERO_ADDRESS);
            expect(await sidechain.voterProxy.owner()).eq(dao.address);
            expect(await sidechain.voterProxy.operator()).eq(sidechain.booster.address);
        });
        it("AuraOFT has correct config", async () => {
            expect(await auraOFT.name()).eq(sidechainConfig.naming.auraOftName);
            expect(await auraOFT.symbol()).eq(sidechainConfig.naming.auraOftSymbol);
            expect(await auraOFT.lzEndpoint()).eq(l2LzEndpoint.address);
            expect(await auraOFT.canonicalChainId()).eq(L1_CHAIN_ID);

            expect(
                await auraOFT.isTrustedRemote(
                    L1_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [canonical.auraProxyOFT.address, auraOFT.address],
                    ),
                ),
            ).eq(true);

            const lockSelector = ethers.utils.id("lock(uint256)").substring(0, 10);
            const config = await auraOFT.configs(L1_CHAIN_ID, lockSelector);
            const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 600_000]);
            expect(config.adapterParams).eq(adapterParams);
            expect(config.zroPaymentAddress).eq(ZERO_ADDRESS);
        });
        it("L2Coordinator has correct config", async () => {
            expect(await l2Coordinator.canonicalChainId()).eq(L1_CHAIN_ID);
            expect(await l2Coordinator.booster()).eq(sidechain.booster.address);
            expect(await l2Coordinator.auraOFT()).eq(auraOFT.address);
            expect(await l2Coordinator.mintRate()).eq(0);
            expect(await l2Coordinator.lzEndpoint()).eq(l2LzEndpoint.address);

            expect(
                await l2Coordinator.isTrustedRemote(
                    L1_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [canonical.l1Coordinator.address, l2Coordinator.address],
                    ),
                ),
            ).eq(true);
        });
        it("L1Coordinator has correct config", async () => {
            expect(await l1Coordinator.booster()).eq(phase6.booster.address);
            expect(await l1Coordinator.balToken()).eq(mainnetConfig.addresses.token);
            expect(await l1Coordinator.auraToken()).eq(phase2.cvx.address);
            expect(await l1Coordinator.auraOFT()).eq(auraProxyOFT.address);
            expect(await l1Coordinator.lzEndpoint()).eq(l1LzEndpoint.address);
            // Allowances
            expect(await phase2.cvx.allowance(l1Coordinator.address, auraProxyOFT.address)).eq(
                ethers.constants.MaxUint256,
            );
            expect(await crv.allowance(l1Coordinator.address, phase6.booster.address)).eq(ethers.constants.MaxUint256);
        });
        it("AuraProxyOFT has correct config", async () => {
            expect(await auraProxyOFT.lzEndpoint()).eq(l1LzEndpoint.address);
            expect(await auraProxyOFT.token()).eq(phase2.cvx.address);
            expect(await auraProxyOFT.locker()).eq(phase2.cvxLocker.address);
            // Allowances
            expect(await phase2.cvx.allowance(auraProxyOFT.address, phase2.cvxLocker.address)).eq(
                ethers.constants.MaxUint256,
            );
        });
        it("BoosterLite has correct config", async () => {
            expect(await sidechain.booster.crv()).eq(sidechainConfig.extConfig.token);

            expect(await sidechain.booster.lockIncentive()).eq(1850);
            expect(await sidechain.booster.stakerIncentive()).eq(400);
            expect(await sidechain.booster.earmarkIncentive()).eq(50);
            expect(await sidechain.booster.platformFee()).eq(200);
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
        it("factories have correct config", async () => {
            const {
                booster,
                factories: { rewardFactory, stashFactory, tokenFactory, proxyFactory },
            } = sidechain;

            const { extConfig } = sidechainConfig;

            expect(await rewardFactory.operator()).eq(booster.address);
            expect(await rewardFactory.crv()).eq(extConfig.token);

            expect(await stashFactory.operator()).eq(booster.address);
            expect(await stashFactory.rewardFactory()).eq(rewardFactory.address);
            expect(await stashFactory.proxyFactory()).eq(proxyFactory.address);
            expect(await stashFactory.v1Implementation()).eq(ZERO_ADDRESS);
            expect(await stashFactory.v2Implementation()).eq(ZERO_ADDRESS);

            const rewardsStashV3 = ExtraRewardStashV3__factory.connect(
                await stashFactory.v3Implementation(),
                deployer.signer,
            );
            expect(await rewardsStashV3.crv()).eq(extConfig.token);

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
        it("auraBalOFT has correct config", async () => {
            expect(await sidechain.auraBalOFT.lzEndpoint()).eq(l2LzEndpoint.address);
            expect(await sidechain.auraBalOFT.name()).eq(sidechainConfig.naming.auraBalOftName);
            expect(await sidechain.auraBalOFT.symbol()).eq(sidechainConfig.naming.auraBalOftSymbol);

            expect(
                await sidechain.auraBalOFT.isTrustedRemote(
                    L1_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [canonical.auraBalProxyOFT.address, sidechain.auraBalOFT.address],
                    ),
                ),
            ).eq(true);
        });
        it("auraBalProxyOFT has correct config", async () => {
            expect(await canonical.auraBalProxyOFT.lzEndpoint()).eq(l1LzEndpoint.address);
            expect(await canonical.auraBalProxyOFT.vault()).eq(vaultDeployment.vault.address);
            expect(await canonical.auraBalProxyOFT.internalTotalSupply()).eq(0);
        });
    });

    describe("Setup: Protocol DAO transactions", () => {
        it("set auraOFT as booster bridge delegate", async () => {
            expect(await phase6.booster.bridgeDelegate()).not.eq(l1Coordinator.address);
            await phase6.booster.connect(dao.signer).setBridgeDelegate(l1Coordinator.address);
            expect(await phase6.booster.bridgeDelegate()).eq(l1Coordinator.address);
        });
        it("add trusted remotes to layerzero endpoints", async () => {
            // L1 Stuff
            await setTrustedRemoteCanonical(canonical, sidechain, L2_CHAIN_ID);

            expect(
                await canonical.auraBalProxyOFT.isTrustedRemote(
                    L2_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [sidechain.auraBalOFT.address, canonical.auraBalProxyOFT.address],
                    ),
                ),
            ).eq(true);

            expect(
                await canonical.auraProxyOFT.isTrustedRemote(
                    L2_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [sidechain.auraOFT.address, canonical.auraProxyOFT.address],
                    ),
                ),
            ).eq(true);

            expect(
                await canonical.l1Coordinator.isTrustedRemote(
                    L2_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [sidechain.l2Coordinator.address, canonical.l1Coordinator.address],
                    ),
                ),
            ).eq(true);

            await l1LzEndpoint.setDestLzEndpoint(l2Coordinator.address, l2LzEndpoint.address);
            await l1LzEndpoint.setDestLzEndpoint(auraOFT.address, l2LzEndpoint.address);

            // L2 Stuff
            await l2LzEndpoint.setDestLzEndpoint(l1Coordinator.address, l1LzEndpoint.address);
            await l2LzEndpoint.setDestLzEndpoint(auraProxyOFT.address, l1LzEndpoint.address);
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
        it("fund the L1Coordinator with a BAL float", async () => {
            const floatAmount = simpleToExactAmount(10_000);
            await getBal(mainnetConfig.addresses, l1Coordinator.address, floatAmount);
            expect(await crv.balanceOf(l1Coordinator.address)).gte(floatAmount);
        });
        it("Set l2Coordinator on l1Coordinator", async () => {
            expect(await l1Coordinator.l2Coordinators(L2_CHAIN_ID)).not.to.eq(l2Coordinator.address);
            await l1Coordinator.connect(dao.signer).setL2Coordinator(L2_CHAIN_ID, l2Coordinator.address);
            expect(await l1Coordinator.l2Coordinators(L2_CHAIN_ID)).to.eq(l2Coordinator.address);
        });
    });

    describe("Deploy and setup simple bridge delegate", () => {
        it("Deploy simple bridge delegate", async () => {
            const result = await deploySimpleBridgeDelegates(
                hre,
                mainnetConfig.addresses,
                canonical,
                L2_CHAIN_ID,
                deployer.signer,
            );
            bridgeDelegateSender = result.bridgeDelegateSender as SimpleBridgeDelegateSender;
            bridgeDelegateReceiver = result.bridgeDelegateReceiver;
        });
        it("Bridge delegate sender has correct config", async () => {
            expect(await bridgeDelegateSender.token()).eq(sidechainConfig.extConfig.token);
        });
        it("Bridge delegate receiver has correct config", async () => {
            expect(await bridgeDelegateReceiver.l1Coordinator()).eq(l1Coordinator.address);
            expect(await bridgeDelegateReceiver.srcChainId()).eq(L2_CHAIN_ID);
        });
        it("Set bridge delegate sender on L2", async () => {
            expect(await l2Coordinator.bridgeDelegate()).not.eq(bridgeDelegateSender.address);
            await l2Coordinator.connect(dao.signer).setBridgeDelegate(bridgeDelegateSender.address);
            expect(await l2Coordinator.bridgeDelegate()).eq(bridgeDelegateSender.address);
        });
    });

    describe("Bridge AURA normally", () => {
        const bridgeAmount = simpleToExactAmount(101);
        it("bridge AURA from L1 -> L2", async () => {
            const balBefore = await phase2.cvx.balanceOf(auraWhale.address);
            const l2BalBefore = await auraOFT.balanceOf(deployer.address);
            expect(balBefore).gt(bridgeAmount);

            await phase2.cvx.connect(auraWhale.signer).approve(auraProxyOFT.address, bridgeAmount);
            expect(await phase2.cvx.allowance(auraWhale.address, auraProxyOFT.address)).gte(bridgeAmount);

            await auraProxyOFT
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
            const l2BalAfter = await auraOFT.balanceOf(deployer.address);
            expect(balBefore.sub(balAfter)).eq(bridgeAmount);
            expect(l2BalAfter.sub(l2BalBefore)).eq(bridgeAmount);
        });
        it("bridge AURA from L2 -> L1", async () => {
            const balBefore = await auraOFT.balanceOf(deployer.address);
            const l2BalBefore = await phase2.cvx.balanceOf(auraWhale.address);
            expect(balBefore).gte(bridgeAmount);

            await auraOFT
                .connect(deployer.signer)
                .sendFrom(
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

            const balAfter = await auraOFT.balanceOf(deployer.address);
            const l2BalAfter = await phase2.cvx.balanceOf(auraWhale.address);
            expect(balBefore.sub(balAfter)).eq(bridgeAmount);
            expect(l2BalAfter.sub(l2BalBefore)).eq(bridgeAmount);
        });
    });

    describe("Lock AURA", () => {
        const lockAmount = simpleToExactAmount(5);
        before(async () => {
            // Transfer some AURA to L2
            const bridgeAmount = lockAmount.mul(2);
            await phase2.cvx.connect(auraWhale.signer).approve(auraProxyOFT.address, bridgeAmount);
            await auraProxyOFT
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
        });
        it("lock AURA from L2 -> L1", async () => {
            const balancesBefore = await phase2.cvxLocker.balances(deployer.address);
            await auraOFT.connect(deployer.signer).lock(lockAmount, { value: NATIVE_FEE });
            const balancesAfter = await phase2.cvxLocker.balances(deployer.address);
            await increaseTime(ONE_WEEK);
            expect(balancesAfter.locked.sub(balancesBefore.locked)).eq(lockAmount);
        });
        it("locking from L2 -> l1 when shutdown", async () => {
            await phase2.cvxLocker.connect(dao.signer).shutdown();
            const balancesBefore = await phase2.cvxLocker.balances(deployer.address);
            const balanceBefore = await phase2.cvx.balanceOf(deployer.address);
            await auraOFT.lock(lockAmount, { value: NATIVE_FEE });
            const balancesAfter = await phase2.cvxLocker.balances(deployer.address);
            const balanceAfter = await phase2.cvx.balanceOf(deployer.address);
            expect(balancesAfter.locked).eq(balancesBefore.locked);
            expect(balanceAfter.sub(balanceBefore)).eq(lockAmount);
        });
    });

    describe('Earmark rewards on L2 "mints" (transfers) AURA', () => {
        it("Can not distribute AURA as no distributor", async () => {
            expect(await l1Coordinator.distributors(deployer.address)).eq(false);
            await expect(l1Coordinator.distributeAura(L2_CHAIN_ID, { value: NATIVE_FEE })).to.be.revertedWith(
                "!distributor",
            );
        });
        it("Can set deployer as distributor", async () => {
            await expect(l1Coordinator.setDistributor(deployer.address, true)).to.be.revertedWith(
                "Ownable: caller is not the owner",
            );

            expect(await l1Coordinator.distributors(deployer.address)).eq(false);
            await l1Coordinator.connect(dao.signer).setDistributor(deployer.address, true);
            expect(await l1Coordinator.distributors(deployer.address)).eq(true);
        });
        it("earmark rewards sends fees to coordinator", async () => {
            const coordinatorBalBefore = await crv.balanceOf(bridgeDelegateSender.address);
            const feeDebtBefore = await l1Coordinator.feeDebtOf(L2_CHAIN_ID);

            const poolInfo = await sidechain.booster.poolInfo(0);
            const crvRewards = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, deployer.signer);
            const balanceOfRewardContractBefore = await crv.balanceOf(crvRewards.address);
            await withMockMinter(async () => {
                await sidechain.booster.earmarkRewards(0, {
                    value: NATIVE_FEE,
                });
            });
            const balanceOfRewardContractAfter = await crv.balanceOf(crvRewards.address);
            const coordinatorBalAfter = await crv.balanceOf(bridgeDelegateSender.address);
            const feeDebtAfter = await l1Coordinator.feeDebtOf(L2_CHAIN_ID);
            const amountOfFees = await toFeeAmount(mintrMintAmount);

            // Verify the minter mint amount is correct and the correct amount of
            // fee debt has been registered
            expect(coordinatorBalAfter.sub(coordinatorBalBefore)).eq(amountOfFees);
            expect(feeDebtAfter.sub(feeDebtBefore)).eq(amountOfFees);

            // Distribute AURA and check feeDebt mappings are updated correctly
            const coordinatorAuraBalBefore = await auraOFT.balanceOf(l2Coordinator.address);
            expect(await l2Coordinator.mintRate()).eq(0);
            const distributedFeeDebtBefore = await l1Coordinator.distributedFeeDebtOf(L2_CHAIN_ID);

            const auraBalanceBefore = await sidechain.auraOFT.balanceOf(l2Coordinator.address);
            const crvBalanceBefore = await crv.balanceOf(l1Coordinator.address);
            const tx = await l1Coordinator.distributeAura(L2_CHAIN_ID, { value: NATIVE_FEE.mul(2) });
            const reciept = await tx.wait();
            const crvBalanceAfter = await crv.balanceOf(l1Coordinator.address);
            const auraBalanceAfter = await sidechain.auraOFT.balanceOf(l2Coordinator.address);
            expect(crvBalanceBefore.sub(crvBalanceAfter)).eq(amountOfFees);

            // Verify that the minted amount is the amount of AURA sent to OFT
            const mintEvent = reciept.events.find(
                x =>
                    compareAddresses(x.address, phase2.cvx.address) &&
                    x.topics[1] === "0x0000000000000000000000000000000000000000000000000000000000000000",
            );
            const mintAmount = BigNumber.from(mintEvent.data);
            expect(auraBalanceAfter.sub(auraBalanceBefore)).eq(mintAmount);

            const distributedFeeDebtAfter = await l1Coordinator.distributedFeeDebtOf(L2_CHAIN_ID);
            const coordinatorAuraBalAfter = await auraOFT.balanceOf(l2Coordinator.address);

            const expectedRate = mintAmount.mul(fullScale).div(mintrMintAmount);

            const mintRate = await l2Coordinator.mintRate();
            expect(mintRate).eq(expectedRate);
            expect(coordinatorAuraBalAfter).gt(coordinatorAuraBalBefore);
            expect(distributedFeeDebtAfter.sub(distributedFeeDebtBefore)).eq(feeDebtAfter);

            // Amount of BAL in the reward contract
            const rewards = balanceOfRewardContractAfter.sub(balanceOfRewardContractBefore);
            expect(rewards.mul(mintRate).div(fullScale)).lte(mintAmount);
        });
    });

    describe("Settle fee debt from L2 -> L1", () => {
        before(async () => {
            // Fund bridge delegate receiver
            await getBal(mainnetConfig.addresses, bridgeDelegateReceiver.address, simpleToExactAmount(10_000));
        });
        it("set bridge delegate for L2", async () => {
            expect(await l1Coordinator.bridgeDelegates(L2_CHAIN_ID)).eq(ZERO_ADDRESS);
            await l1Coordinator.connect(dao.signer).setBridgeDelegate(L2_CHAIN_ID, bridgeDelegateReceiver.address);
            expect(await l1Coordinator.bridgeDelegates(L2_CHAIN_ID)).eq(bridgeDelegateReceiver.address);
        });
        it("settle fees updated feeDebt on L1", async () => {
            // TODO: check bridgeDelegate balances
            const oldDebt = await l1Coordinator.feeDebtOf(L2_CHAIN_ID);
            expect(oldDebt).gt(0);

            const oldSettledDebt = await l1Coordinator.settledFeeDebtOf(L2_CHAIN_ID);

            await bridgeDelegateReceiver.settleFeeDebt(oldDebt);

            const newDebt = await l1Coordinator.feeDebtOf(L2_CHAIN_ID);
            const newSettledDebt = await l1Coordinator.settledFeeDebtOf(L2_CHAIN_ID);
            expect(newDebt).eq(oldDebt);
            expect(newSettledDebt.sub(oldSettledDebt)).eq(oldDebt);
        });
    });
});
