import { expect } from "chai";
import hre, { ethers, network } from "hardhat";
import { formatEther } from "ethers/lib/utils";
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
import { AuraBalVaultDeployed } from "tasks/deploy/goerli-config";
import { SidechainConfig } from "../../types/sidechain-types";
import { ExtSystemConfig, Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import {
    getAuraBal,
    getAura,
    impersonateAccount,
    simpleToExactAmount,
    ZERO_ADDRESS,
    increaseTime,
    ONE_WEEK,
    getTimestamp,
    increaseTimeTo,
    assertBNClose,
} from "../../test-utils";
import { Account, Create2Factory, Create2Factory__factory, LZEndpointMock, LZEndpointMock__factory } from "../../types";
import { BigNumber } from "ethers";

const NATIVE_FEE = simpleToExactAmount("0.2");

describe("AuraBalOFT", () => {
    const L1_CHAIN_ID = 111;
    const L2_CHAIN_ID = 222;

    let dao: Account;
    let deployer: Account;

    // phases
    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    let vaultDeployment: AuraBalVaultDeployed;

    // LayerZero endpoints
    let l1LzEndpoint: LZEndpointMock;
    let l2LzEndpoint: LZEndpointMock;

    // Canonical chain Contracts
    let canonical: CanonicalPhase1Deployed & CanonicalPhase2Deployed;
    let create2Factory: Create2Factory;

    // Sidechain Contracts
    let sidechain: SidechainPhase1Deployed & SidechainPhase2Deployed;
    let sidechainConfig: SidechainConfig;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

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

        phase2 = await mainnetConfig.getPhase2(deployer.signer);
        phase6 = await mainnetConfig.getPhase6(deployer.signer);
        vaultDeployment = await mainnetConfig.getAuraBalVault(deployer.signer);

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
            extConfig: {
                canonicalChainId: L1_CHAIN_ID,
                lzEndpoint: l2LzEndpoint.address,
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
        };

        // deploy canonicalPhase
        const extSystemConfig: ExtSystemConfig = { ...mainnetConfig.addresses, lzEndpoint: l1LzEndpoint.address };
        const canonicalPhase1 = await deployCanonicalPhase1(
            hre,
            deployer.signer,
            mainnetConfig.multisigs,
            extSystemConfig,
            phase2,
            phase6,
        );
        const canonicalPhase2 = await deployCanonicalPhase2(
            hre,
            deployer.signer,
            mainnetConfig.multisigs,
            extSystemConfig,
            phase2,
            vaultDeployment,
            canonicalPhase1,
        );
        canonical = { ...canonicalPhase1, ...canonicalPhase2 };

        // deploy sidechain
        const sidechainPhase1 = await deploySidechainPhase1(
            hre,
            deployer.signer,
            sidechainConfig.naming,
            sidechainConfig.multisigs,
            sidechainConfig.extConfig,
            canonical,
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
        sidechain = { ...sidechainPhase1, ...sidechainPhase2 };

        await getAuraBal(phase2, mainnetConfig.addresses, deployer.address, simpleToExactAmount(10_000));
        // Connect contracts to its owner signer.
        canonical.l1Coordinator = canonical.l1Coordinator.connect(dao.signer);
        canonical.auraProxyOFT = canonical.auraProxyOFT.connect(dao.signer);
        canonical.auraBalProxyOFT = canonical.auraBalProxyOFT.connect(dao.signer);

        sidechain.l2Coordinator = sidechain.l2Coordinator.connect(dao.signer);
        sidechain.auraOFT = sidechain.auraOFT.connect(dao.signer);
        sidechain.auraBalOFT = sidechain.auraBalOFT.connect(dao.signer);
    });

    afterEach(async () => {
        const totalSupply = await canonical.auraBalProxyOFT.internalTotalSupply();
        const underlying = await vaultDeployment.vault.balanceOfUnderlying(canonical.auraBalProxyOFT.address);
        // sub 1 to account for the 1 wei rounding issue
        expect(underlying).gte(totalSupply.sub(simpleToExactAmount(1)));
    });

    describe("Protocol DAO setup", () => {
        it("set as vault owner", async () => {
            await vaultDeployment.vault.connect(dao.signer).setHarvestPermissions(false);
            await vaultDeployment.vault.connect(dao.signer).transferOwnership(canonical.auraBalProxyOFT.address);
        });
    });

    describe("Set trusted remotes", () => {
        it("set LZ destinations", async () => {
            await l2LzEndpoint.setDestLzEndpoint(canonical.auraBalProxyOFT.address, l1LzEndpoint.address);
            await l2LzEndpoint.setDestLzEndpoint(canonical.auraProxyOFT.address, l1LzEndpoint.address);
            await l1LzEndpoint.setDestLzEndpoint(sidechain.auraBalOFT.address, l2LzEndpoint.address);
            await l1LzEndpoint.setDestLzEndpoint(sidechain.auraOFT.address, l2LzEndpoint.address);
        });
        it("set canonical trusted remotes", async () => {
            await setTrustedRemoteCanonicalPhase1(canonical, sidechain, L2_CHAIN_ID);
            await setTrustedRemoteCanonicalPhase2(canonical, sidechain, L2_CHAIN_ID);
        });
    });

    describe("Check configs", () => {
        it("auraBalProxyOFT has correct config", async () => {
            expect(await sidechain.auraBalOFT.lzEndpoint()).eq(l2LzEndpoint.address);
            expect(await sidechain.auraBalOFT.name()).eq(sidechainConfig.naming.auraBalOftName);
            expect(await sidechain.auraBalOFT.symbol()).eq(sidechainConfig.naming.auraBalOftSymbol);
        });
        it("auraBalOFT has correct config", async () => {
            expect(await canonical.auraBalProxyOFT.lzEndpoint()).eq(l1LzEndpoint.address);
            expect(await canonical.auraBalProxyOFT.vault()).eq(vaultDeployment.vault.address);
            expect(await canonical.auraBalProxyOFT.internalTotalSupply()).eq(0);
            expect(await canonical.auraBalProxyOFT.ofts(phase2.cvxCrv.address)).eq(canonical.auraBalProxyOFT.address);
            expect(await canonical.auraBalProxyOFT.ofts(phase2.cvx.address)).eq(canonical.auraProxyOFT.address);
        });
        it("auraBal vault has correct config", async () => {
            expect(await sidechain.auraBalVault.underlying()).eq(sidechain.auraBalOFT.address);
            expect(await sidechain.auraBalVault.virtualRewardFactory()).eq(sidechain.virtualRewardFactory.address);
            expect(await sidechain.auraBalVault.strategy()).eq(sidechain.auraBalStrategy.address);
        });
        it("auraBal strategy has correct config", async () => {
            expect(await sidechain.auraBalStrategy.auraBalToken()).eq(sidechain.auraBalOFT.address);
            expect(await sidechain.auraBalStrategy.vault()).eq(sidechain.auraBalVault.address);
        });
    });

    describe("Setup OFT", () => {
        it("set reward receiver", async () => {
            expect(await canonical.auraBalProxyOFT.rewardReceiver(L2_CHAIN_ID)).not.eq(
                sidechain.auraBalStrategy.address,
            );
            await canonical.auraBalProxyOFT
                .connect(dao.signer)
                .setRewardReceiver(L2_CHAIN_ID, sidechain.auraBalStrategy.address);
            expect(await canonical.auraBalProxyOFT.rewardReceiver(L2_CHAIN_ID)).eq(sidechain.auraBalStrategy.address);
        });
    });

    describe("Transfer to sidechain", () => {
        it("transfer and burn", async () => {
            // Because of the way the rounding works in the auraBAL vault deposits/withdrawals can be off
            // by 1 wei in some cases. In order to ensure that auraBAL on the sidechains is indeed fully backed
            // we just send 1 auraBAL to the L2 and burn it. This gives us 1e18 wei of cover which is plenty
            const amount = simpleToExactAmount(1);
            await phase2.cvxCrv.approve(canonical.auraBalProxyOFT.address, amount);
            await canonical.auraBalProxyOFT
                .connect(deployer.signer)
                .sendFrom(deployer.address, L2_CHAIN_ID, deployer.address, amount, ZERO_ADDRESS, ZERO_ADDRESS, [], {
                    value: NATIVE_FEE,
                });
            await sidechain.auraBalOFT
                .connect(deployer.signer)
                .transfer("0x000000000000000000000000000000000000dead", amount);
        });
        it("can transfer auraBAL to sidechain", async () => {
            const innerSupplyBefore = await canonical.auraBalProxyOFT.internalTotalSupply();
            const l1BalanceBefore = await phase2.cvxCrv.balanceOf(deployer.address);
            const l2BalanceBefore = await sidechain.auraBalOFT.balanceOf(deployer.address);
            const vaultBalanceBefore = await vaultDeployment.vault.balanceOfUnderlying(
                canonical.auraBalProxyOFT.address,
            );

            const bridgeAmount = simpleToExactAmount(1000);
            await phase2.cvxCrv.connect(deployer.signer).approve(canonical.auraBalProxyOFT.address, bridgeAmount);
            await canonical.auraBalProxyOFT
                .connect(deployer.signer)
                .sendFrom(
                    deployer.address,
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

            const innerSupplyAfter = await canonical.auraBalProxyOFT.internalTotalSupply();
            const l1BalanceAfter = await phase2.cvxCrv.balanceOf(deployer.address);
            const l2BalanceAfter = await sidechain.auraBalOFT.balanceOf(deployer.address);
            const vaultBalanceAfter = await vaultDeployment.vault.balanceOfUnderlying(
                canonical.auraBalProxyOFT.address,
            );

            expect(innerSupplyAfter.sub(innerSupplyBefore)).eq(bridgeAmount);
            expect(l1BalanceBefore.sub(l1BalanceAfter)).eq(bridgeAmount);
            expect(l2BalanceAfter.sub(l2BalanceBefore)).eq(bridgeAmount);

            // Account for the off by 1 wei issue
            expect(vaultBalanceAfter.sub(vaultBalanceBefore)).gte(bridgeAmount.sub(1));
            expect(vaultBalanceAfter.sub(vaultBalanceBefore)).lte(bridgeAmount);
        });
        it("cannot call harvest when not authorized", async () => {
            expect(await canonical.auraBalProxyOFT.authorizedHarvesters(deployer.address)).eq(false);
            await expect(canonical.auraBalProxyOFT.harvest([L2_CHAIN_ID], [100], 100)).to.be.revertedWith("!harvester");
        });
        it("set authorized harvester", async () => {
            expect(await canonical.auraBalProxyOFT.authorizedHarvesters(deployer.address)).eq(false);
            await canonical.auraBalProxyOFT.updateAuthorizedHarvesters(deployer.address, true);
            expect(await canonical.auraBalProxyOFT.authorizedHarvesters(deployer.address)).eq(true);
        });
        it("can harvest auraBAL from vault", async () => {
            const harvestAmount = simpleToExactAmount(100);
            await getAuraBal(phase2, mainnetConfig.addresses, vaultDeployment.strategy.address, harvestAmount);
            await getAura(phase2, mainnetConfig.addresses, vaultDeployment.strategy.address, harvestAmount);

            // Harvest from auraBAL vault
            const underlyingBalanceBefore = await vaultDeployment.vault.balanceOfUnderlying(
                canonical.auraBalProxyOFT.address,
            );
            await vaultDeployment.vault["harvest()"]();
            await increaseTime(ONE_WEEK.mul(2));

            const underlyingBalanceAfter = await vaultDeployment.vault.balanceOfUnderlying(
                canonical.auraBalProxyOFT.address,
            );
            const auraBalClaimed = underlyingBalanceAfter.sub(underlyingBalanceBefore);
            expect(underlyingBalanceAfter).gt(underlyingBalanceBefore);
            expect(auraBalClaimed).gt(0);

            // Harvest from auraBAL proxy OFT
            const auraBalanceBefore = await phase2.cvx.balanceOf(canonical.auraBalProxyOFT.address);
            const claimableAuraBalBefore = await canonical.auraBalProxyOFT.totalClaimable(phase2.cvxCrv.address);
            const claimableAuraBefore = await canonical.auraBalProxyOFT.totalClaimable(phase2.cvx.address);
            const srcChainAuraBalClaimableBefore = await canonical.auraBalProxyOFT.claimable(
                phase2.cvxCrv.address,
                L2_CHAIN_ID,
            );
            const srcChainAuraClaimableBefore = await canonical.auraBalProxyOFT.claimable(
                phase2.cvx.address,
                L2_CHAIN_ID,
            );

            // call harvest
            await canonical.auraBalProxyOFT.connect(deployer.signer).harvest([L2_CHAIN_ID], [100], 100);

            const auraBalanceAfter = await phase2.cvx.balanceOf(canonical.auraBalProxyOFT.address);
            const claimableAuraBalAfter = await canonical.auraBalProxyOFT.totalClaimable(phase2.cvxCrv.address);
            const claimableAuraAfter = await canonical.auraBalProxyOFT.totalClaimable(phase2.cvx.address);
            const srcChainAuraBalClaimableAfter = await canonical.auraBalProxyOFT.claimable(
                phase2.cvxCrv.address,
                L2_CHAIN_ID,
            );
            const srcChainAuraClaimableAfter = await canonical.auraBalProxyOFT.claimable(
                phase2.cvx.address,
                L2_CHAIN_ID,
            );
            const auraClaimed = auraBalanceAfter.sub(auraBalanceBefore);
            expect(auraClaimed).gt(0);

            expect(auraBalanceAfter).gt(auraBalanceBefore);
            assertBNClose(claimableAuraBalAfter.sub(claimableAuraBalBefore), auraBalClaimed, 1);
            expect(claimableAuraAfter.sub(claimableAuraBefore)).eq(auraClaimed);
            expect(srcChainAuraClaimableAfter).gt(srcChainAuraClaimableBefore);
            expect(srcChainAuraBalClaimableAfter).gt(srcChainAuraBalClaimableBefore);
        });
        it("can claim tokens to sidechain", async () => {
            const claimableAuraBal = await canonical.auraBalProxyOFT.totalClaimable(phase2.cvxCrv.address);
            const claimableAura = await canonical.auraBalProxyOFT.totalClaimable(phase2.cvx.address);

            console.log("Claimable auraBAL:", formatEther(claimableAuraBal));
            console.log("Claimable AURA:", formatEther(claimableAura));

            const internalTotalSupplyBefore = await canonical.auraBalProxyOFT.internalTotalSupply();
            const auraBalBalanceBefore = await sidechain.auraBalOFT.balanceOf(sidechain.auraBalStrategy.address);

            await canonical.auraBalProxyOFT.processClaimable(phase2.cvxCrv.address, L2_CHAIN_ID, { value: NATIVE_FEE });

            const internalTotalSupplyAfter = await canonical.auraBalProxyOFT.internalTotalSupply();
            const claimableAuraBalAfter = await canonical.auraBalProxyOFT.totalClaimable(phase2.cvxCrv.address);
            const auraBalBalanceAfter = await sidechain.auraBalOFT.balanceOf(sidechain.auraBalStrategy.address);
            expect(internalTotalSupplyAfter.sub(internalTotalSupplyBefore)).eq(claimableAuraBal);
            expect(claimableAuraBalAfter).eq(0);
            expect(auraBalBalanceAfter.sub(auraBalBalanceBefore)).eq(claimableAuraBal);

            const auraRewardBefore = await sidechain.auraOFT.balanceOf(sidechain.auraBalStrategy.address);
            await canonical.auraBalProxyOFT.processClaimable(phase2.cvx.address, L2_CHAIN_ID, { value: NATIVE_FEE });

            const auraRewardAfter = await sidechain.auraOFT.balanceOf(sidechain.auraBalStrategy.address);
            const claimableAuraAfter = await canonical.auraBalProxyOFT.totalClaimable(phase2.cvx.address);
            expect(claimableAuraAfter).eq(0);
            expect(auraRewardAfter.sub(auraRewardBefore)).eq(claimableAura);
        });
        it("can withdraw auraBAL from sidechain", async () => {
            const bridgeAmount = simpleToExactAmount(1000);
            const innerSupplyBefore = await canonical.auraBalProxyOFT.internalTotalSupply();
            const l1BalanceBefore = await phase2.cvxCrv.balanceOf(deployer.address);
            const l2BalanceBefore = await sidechain.auraBalOFT.balanceOf(deployer.address);
            const vaultBalanceBefore = await vaultDeployment.vault.balanceOfUnderlying(
                canonical.auraBalProxyOFT.address,
            );

            await sidechain.auraBalOFT
                .connect(deployer.signer)
                .sendFrom(
                    deployer.address,
                    L1_CHAIN_ID,
                    deployer.address,
                    bridgeAmount,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    ethers.utils.solidityPack(["uint16", "uint256"], [1, 600_000]),
                    {
                        value: NATIVE_FEE,
                    },
                );

            const innerSupplyAfter = await canonical.auraBalProxyOFT.internalTotalSupply();
            const l1BalanceAfter = await phase2.cvxCrv.balanceOf(deployer.address);
            const l2BalanceAfter = await sidechain.auraBalOFT.balanceOf(deployer.address);
            const vaultBalanceAfter = await vaultDeployment.vault.balanceOfUnderlying(
                canonical.auraBalProxyOFT.address,
            );

            expect(innerSupplyBefore.sub(innerSupplyAfter)).eq(bridgeAmount);
            expect(l1BalanceAfter.sub(l1BalanceBefore)).eq(bridgeAmount);
            expect(l2BalanceBefore.sub(l2BalanceAfter)).eq(bridgeAmount);

            // Account for the off by 1 wei issue
            expect(vaultBalanceBefore.sub(vaultBalanceAfter)).gte(bridgeAmount);
            expect(vaultBalanceBefore.sub(vaultBalanceAfter)).lte(bridgeAmount.add(1));
        });
    });

    describe("Pausing and queue", () => {
        let queued: [BigNumber, BigNumber, string, BigNumber, BigNumber];

        it("Transfer L1 -> L2 updates outflow", async () => {
            const epoch = await canonical.auraBalProxyOFT.getCurrentEpoch();
            const outflowBefore = await canonical.auraBalProxyOFT.outflow(epoch);
            const inflowBefore = await canonical.auraBalProxyOFT.inflow(epoch);

            const amount = simpleToExactAmount(1);
            await phase2.cvxCrv.connect(deployer.signer).approve(canonical.auraBalProxyOFT.address, amount);
            await canonical.auraBalProxyOFT
                .connect(deployer.signer)
                .sendFrom(deployer.address, L2_CHAIN_ID, deployer.address, amount, ZERO_ADDRESS, ZERO_ADDRESS, [], {
                    value: NATIVE_FEE,
                });

            const outflowAfter = await canonical.auraBalProxyOFT.outflow(epoch);
            const inflowAfter = await canonical.auraBalProxyOFT.inflow(epoch);
            expect(outflowAfter.sub(outflowBefore)).eq(amount);
            expect(inflowBefore).eq(inflowAfter);
        });
        it("Transfer L2 -> L1 updates inflow", async () => {
            const epoch = await canonical.auraBalProxyOFT.getCurrentEpoch();
            const outflowBefore = await canonical.auraBalProxyOFT.outflow(epoch);
            const inflowBefore = await canonical.auraBalProxyOFT.inflow(epoch);

            const amount = simpleToExactAmount(1);
            await sidechain.auraBalOFT
                .connect(deployer.signer)
                .sendFrom(
                    deployer.address,
                    L1_CHAIN_ID,
                    deployer.address,
                    amount,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    ethers.utils.solidityPack(["uint16", "uint256"], [1, 600_000]),
                    {
                        value: NATIVE_FEE,
                    },
                );

            const outflowAfter = await canonical.auraBalProxyOFT.outflow(epoch);
            const inflowAfter = await canonical.auraBalProxyOFT.inflow(epoch);
            expect(inflowAfter.sub(inflowBefore)).eq(amount);
            expect(outflowBefore).eq(outflowAfter);
        });
        it("Can pause auraBalProxyOFT transfers", async () => {
            expect(await canonical.auraBalProxyOFT.paused()).eq(false);
            await canonical.auraBalProxyOFT.connect(dao.signer).pause();
            expect(await canonical.auraBalProxyOFT.paused()).eq(true);

            const amount = simpleToExactAmount(1);
            await phase2.cvxCrv.connect(deployer.signer).approve(canonical.auraBalProxyOFT.address, amount);
            await expect(
                canonical.auraBalProxyOFT
                    .connect(deployer.signer)
                    .sendFrom(deployer.address, L2_CHAIN_ID, deployer.address, amount, ZERO_ADDRESS, ZERO_ADDRESS, [], {
                        value: NATIVE_FEE,
                    }),
            ).to.be.revertedWith("Pausable: paused");
        });
        it("Can pause auraProxyOFT transfers", async () => {
            expect(await canonical.auraProxyOFT.paused()).eq(false);
            await canonical.auraProxyOFT.connect(dao.signer).pause();
            expect(await canonical.auraProxyOFT.paused()).eq(true);

            const amount = simpleToExactAmount(1);
            await phase2.cvxCrv.connect(deployer.signer).approve(canonical.auraProxyOFT.address, amount);
            await expect(
                canonical.auraProxyOFT
                    .connect(deployer.signer)
                    .sendFrom(deployer.address, L2_CHAIN_ID, deployer.address, amount, ZERO_ADDRESS, ZERO_ADDRESS, [], {
                        value: NATIVE_FEE,
                    }),
            ).to.be.revertedWith("Pausable: paused");
        });
        it("Can pause auraOFT transfers", async () => {
            expect(await sidechain.auraOFT.paused()).eq(false);
            await sidechain.auraOFT.connect(dao.signer).pause();
            expect(await sidechain.auraOFT.paused()).eq(true);

            const amount = simpleToExactAmount(1);
            await phase2.cvxCrv.connect(deployer.signer).approve(sidechain.auraOFT.address, amount);
            await expect(
                sidechain.auraOFT
                    .connect(deployer.signer)
                    .sendFrom(deployer.address, L1_CHAIN_ID, deployer.address, amount, ZERO_ADDRESS, ZERO_ADDRESS, [], {
                        value: NATIVE_FEE,
                    }),
            ).to.be.revertedWith("Pausable: paused");
        });
        it("Can pause auraBalOFT transfers", async () => {
            expect(await sidechain.auraBalOFT.paused()).eq(false);
            await sidechain.auraBalOFT.connect(dao.signer).pause();
            expect(await sidechain.auraBalOFT.paused()).eq(true);

            const amount = simpleToExactAmount(1);
            await phase2.cvxCrv.connect(deployer.signer).approve(sidechain.auraBalOFT.address, amount);
            await expect(
                sidechain.auraBalOFT
                    .connect(deployer.signer)
                    .sendFrom(deployer.address, L1_CHAIN_ID, deployer.address, amount, ZERO_ADDRESS, ZERO_ADDRESS, [], {
                        value: NATIVE_FEE,
                    }),
            ).to.be.revertedWith("Pausable: paused");
        });
        it("Can unpause transfers", async () => {
            await canonical.auraProxyOFT.connect(dao.signer).unpause();
            expect(await canonical.auraProxyOFT.paused()).eq(false);

            await canonical.auraBalProxyOFT.connect(dao.signer).unpause();
            expect(await canonical.auraBalProxyOFT.paused()).eq(false);

            await sidechain.auraOFT.connect(dao.signer).unpause();
            expect(await sidechain.auraOFT.paused()).eq(false);

            await sidechain.auraBalOFT.connect(dao.signer).unpause();
            expect(await sidechain.auraBalOFT.paused()).eq(false);
        });
        it("Can set inflow limit", async () => {
            const limit = simpleToExactAmount(1000);

            await canonical.auraProxyOFT.connect(dao.signer).setInflowLimit(limit);
            expect(await canonical.auraProxyOFT.inflowLimit()).eq(limit);

            await canonical.auraBalProxyOFT.connect(dao.signer).setInflowLimit(limit);
            expect(await canonical.auraBalProxyOFT.inflowLimit()).eq(limit);
        });
        it("Can set queue delay", async () => {
            const delay = ONE_WEEK.mul(4);

            await canonical.auraProxyOFT.connect(dao.signer).setQueueDelay(delay);
            expect(await canonical.auraProxyOFT.queueDelay()).eq(delay);

            await canonical.auraBalProxyOFT.connect(dao.signer).setQueueDelay(delay);
            expect(await canonical.auraBalProxyOFT.queueDelay()).eq(delay);
        });
        it("Sending more than inflow limit gets queued", async () => {
            const overLimitAmount = (await canonical.auraBalProxyOFT.inflowLimit()).add(1);
            await getAuraBal(phase2, mainnetConfig.addresses, deployer.address, overLimitAmount);

            const amount = overLimitAmount;

            // Send auraBAL to the L2
            await phase2.cvxCrv.connect(deployer.signer).approve(canonical.auraBalProxyOFT.address, amount);
            await canonical.auraBalProxyOFT
                .connect(deployer.signer)
                .sendFrom(deployer.address, L2_CHAIN_ID, deployer.address, amount, ZERO_ADDRESS, ZERO_ADDRESS, [], {
                    value: NATIVE_FEE,
                });

            // Increase time to zero out this epochs outflow
            await increaseTime((await canonical.auraBalProxyOFT.epochDuration()).add(1));
            const epoch = await canonical.auraBalProxyOFT.getCurrentEpoch();
            expect(await canonical.auraBalProxyOFT.outflow(epoch)).eq(0);

            // Send auraBAL to the L1
            const l1BalanceBefore = await phase2.cvxCrv.balanceOf(deployer.address);
            const ts = (await getTimestamp()).add(1_000);
            await ethers.provider.send("evm_setNextBlockTimestamp", [ts.toNumber()]);

            await sidechain.auraBalOFT
                .connect(deployer.signer)
                .sendFrom(
                    deployer.address,
                    L1_CHAIN_ID,
                    deployer.address,
                    amount,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    ethers.utils.solidityPack(["uint16", "uint256"], [1, 600_000]),
                    {
                        value: NATIVE_FEE,
                    },
                );

            queued = [epoch, BigNumber.from(L2_CHAIN_ID), deployer.address, amount, ts];
            const root = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(["uint256", "uint16", "address", "uint256", "uint256"], queued),
            );

            // Check that the root is now valid
            expect(await canonical.auraBalProxyOFT.queue(root)).eq(true);

            // Check that no auraBAL has been transfered and the transfer has been queued
            const l1BalanceAfter = await phase2.cvxCrv.balanceOf(deployer.address);
            expect(l1BalanceBefore).eq(l1BalanceAfter);
        });
        it("Queued transfer can NOT be processed when paused", async () => {
            await canonical.auraBalProxyOFT.connect(dao.signer).pause();
            expect(await canonical.auraBalProxyOFT.paused()).eq(true);

            await expect(canonical.auraBalProxyOFT.processQueued(...queued)).to.be.revertedWith("Pausable: paused");

            await canonical.auraBalProxyOFT.connect(dao.signer).unpause();
            expect(await canonical.auraBalProxyOFT.paused()).eq(false);
        });
        it("Queued transfer can NOT be processed with bad root", async () => {
            const queuedCopy: [BigNumber, BigNumber, string, BigNumber, BigNumber] = [...queued];
            queuedCopy[0] = (queuedCopy[0] as BigNumber).add(1);
            await expect(canonical.auraBalProxyOFT.processQueued(...queuedCopy)).to.be.revertedWith("!root");
        });
        it("Queued transfer can NOT be processed before delay expires", async () => {
            await expect(canonical.auraBalProxyOFT.processQueued(...queued)).to.be.revertedWith("!timestamp");
        });
        it("Queued transfer can be processed", async () => {
            const ts = queued[4];
            const amount = queued[3];
            const delay = ts.add(await canonical.auraBalProxyOFT.queueDelay()).add(1);
            await increaseTimeTo(delay);

            const balanceBefore = await phase2.cvxCrv.balanceOf(deployer.address);
            await canonical.auraBalProxyOFT.processQueued(...queued);
            const balanceAfter = await phase2.cvxCrv.balanceOf(deployer.address);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);

            const root = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(["uint256", "uint16", "address", "uint256", "uint256"], queued),
            );
            expect(await canonical.auraBalProxyOFT.queue(root)).eq(false);
        });
    });

    describe("Rescue", () => {
        it("Rescue is only callable by sudo", async () => {
            await expect(
                canonical.auraBalProxyOFT.connect(deployer.signer).rescue(phase2.cvxCrv.address, deployer.address, 100),
            ).to.be.revertedWith("!sudo");
        });
        it("Can rescue tokens", async () => {
            const to = deployer.address;
            const underlying = await vaultDeployment.vault.balanceOfUnderlying(canonical.auraBalProxyOFT.address);
            const amount = simpleToExactAmount(1);
            expect(amount).lte(underlying);

            const balBefore = await phase2.cvxCrv.balanceOf(to);
            await canonical.auraBalProxyOFT.connect(dao.signer).rescue(phase2.cvxCrv.address, to, amount);
            const balAfter = await phase2.cvxCrv.balanceOf(to);

            expect(balAfter.sub(balBefore)).eq(amount);
        });
        it("Can rescue entire balance", async () => {
            const to = deployer.address;

            // Harvest some rewards so internalTotalSupply is not latest
            const underlyingBefore = await vaultDeployment.vault.balanceOfUnderlying(canonical.auraBalProxyOFT.address);
            await getAuraBal(phase2, mainnetConfig.addresses, vaultDeployment.strategy.address, simpleToExactAmount(1));
            await vaultDeployment.vault["harvest()"]();
            const underlying = await vaultDeployment.vault.balanceOfUnderlying(canonical.auraBalProxyOFT.address);
            expect(underlying).gt(underlyingBefore);

            const amount = underlying;

            await expect(canonical.auraBalProxyOFT.connect(dao.signer).rescue(phase2.cvxCrv.address, to, amount)).to.be
                .reverted;

            await canonical.auraBalProxyOFT.connect(deployer.signer).harvest([L2_CHAIN_ID], [100], 100);
            await canonical.auraBalProxyOFT.processClaimable(phase2.cvxCrv.address, L2_CHAIN_ID, { value: NATIVE_FEE });

            const balBefore = await phase2.cvxCrv.balanceOf(to);
            await canonical.auraBalProxyOFT.connect(dao.signer).rescue(phase2.cvxCrv.address, to, amount);
            const balAfter = await phase2.cvxCrv.balanceOf(to);

            expect(balAfter.sub(balBefore)).eq(amount);
        });
    });
});
