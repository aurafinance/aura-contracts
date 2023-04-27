import { expect } from "chai";
import hre, { ethers } from "hardhat";
import {
    CanonicalPhaseDeployed,
    deployCanonicalPhase,
    deploySidechainSystem,
    setTrustedRemoteCanonical,
    setTrustedRemoteSidechain,
    SidechainDeployed,
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
} from "../../test-utils";
import { Account, Create2Factory, Create2Factory__factory, LZEndpointMock, LZEndpointMock__factory } from "../../types";
import { formatEther } from "ethers/lib/utils";

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
    let canonical: CanonicalPhaseDeployed;
    let create2Factory: Create2Factory;

    // Sidechain Contracts
    let sidechain: SidechainDeployed;
    let sidechainConfig: SidechainConfig;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    before(async () => {
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
            multisigs: { daoMultisig: dao.address },
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
        canonical = await deployCanonicalPhase(
            hre,
            deployer.signer,
            mainnetConfig.multisigs,
            extSystemConfig,
            phase2,
            phase6,
            vaultDeployment,
        );

        // deploy sidechain
        sidechain = await deploySidechainSystem(
            hre,
            deployer.signer,
            sidechainConfig.naming,
            sidechainConfig.multisigs,
            sidechainConfig.extConfig,
        );

        await getAuraBal(phase2, mainnetConfig.addresses, deployer.address, simpleToExactAmount(10_000));
    });

    afterEach(async () => {
        const totalSupply = await canonical.auraBalProxyOFT.internalTotalSupply();
        const underlying = await vaultDeployment.vault.balanceOfUnderlying(canonical.auraBalProxyOFT.address);
        // sub 1 to account for the 1 wei rounding issue
        expect(underlying).gte(totalSupply.sub(1));
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
        it("set sidechain trusted remotes", async () => {
            await setTrustedRemoteSidechain(canonical, sidechain, L1_CHAIN_ID);
        });
        it("set canonical trusted remotes", async () => {
            await setTrustedRemoteCanonical(canonical, sidechain, L2_CHAIN_ID);
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
            await canonical.auraBalProxyOFT.setRewardReceiver(L2_CHAIN_ID, sidechain.auraBalStrategy.address);
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
            await canonical.auraBalProxyOFT.sendFrom(
                deployer.address,
                L2_CHAIN_ID,
                deployer.address,
                amount,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                [],
                {
                    value: NATIVE_FEE,
                },
            );
            await sidechain.auraBalOFT.transfer("0x000000000000000000000000000000000000dead", amount);
        });
        it("can transfer auraBAL to sidechain", async () => {
            const innerSupplyBefore = await canonical.auraBalProxyOFT.internalTotalSupply();
            const l1BalanceBefore = await phase2.cvxCrv.balanceOf(deployer.address);
            const l2BalanceBefore = await sidechain.auraBalOFT.balanceOf(deployer.address);
            const vaultBalanceBefore = await vaultDeployment.vault.balanceOfUnderlying(
                canonical.auraBalProxyOFT.address,
            );

            const bridgeAmount = simpleToExactAmount(1000);
            await phase2.cvxCrv.approve(canonical.auraBalProxyOFT.address, bridgeAmount);
            await canonical.auraBalProxyOFT.sendFrom(
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
            expect(underlyingBalanceAfter).gt(underlyingBalanceBefore);

            // Harvest from auraBAL proxy OFT
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
            await canonical.auraBalProxyOFT.harvest([L2_CHAIN_ID], [100], 100);

            const claimableAuraBalAfter = await canonical.auraBalProxyOFT.totalClaimable(phase2.cvxCrv.address);
            const claimableAuraAfter = await canonical.auraBalProxyOFT.totalClaimable(phase2.cvx.address);
            expect(claimableAuraBalAfter).gt(claimableAuraBalBefore);
            expect(claimableAuraAfter).gt(claimableAuraBefore);

            const srcChainAuraBalClaimableAfter = await canonical.auraBalProxyOFT.claimable(
                phase2.cvxCrv.address,
                L2_CHAIN_ID,
            );
            const srcChainAuraClaimableAfter = await canonical.auraBalProxyOFT.claimable(
                phase2.cvx.address,
                L2_CHAIN_ID,
            );
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

            await canonical.auraBalProxyOFT.processClaimable(
                phase2.cvxCrv.address,
                canonical.auraBalProxyOFT.address,
                L2_CHAIN_ID,
                { value: NATIVE_FEE },
            );

            const internalTotalSupplyAfter = await canonical.auraBalProxyOFT.internalTotalSupply();
            const claimableAuraBalAfter = await canonical.auraBalProxyOFT.totalClaimable(phase2.cvxCrv.address);
            const auraBalBalanceAfter = await sidechain.auraBalOFT.balanceOf(sidechain.auraBalStrategy.address);
            expect(internalTotalSupplyAfter.sub(internalTotalSupplyBefore)).eq(claimableAuraBal);
            expect(claimableAuraBalAfter).eq(0);
            expect(auraBalBalanceAfter.sub(auraBalBalanceBefore)).eq(claimableAuraBal);

            const auraRewardBefore = await sidechain.auraOFT.balanceOf(sidechain.auraBalStrategy.address);
            await canonical.auraBalProxyOFT.processClaimable(
                phase2.cvx.address,
                canonical.auraProxyOFT.address,
                L2_CHAIN_ID,
                { value: NATIVE_FEE },
            );

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

            await sidechain.auraBalOFT.setUseCustomAdapterParams(true);
            await sidechain.auraBalOFT.setMinDstGas(L1_CHAIN_ID, await sidechain.auraBalOFT.PT_SEND(), 600_000);
            await sidechain.auraBalOFT.sendFrom(
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
});
