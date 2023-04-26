import { expect } from "chai";
import hre, { ethers } from "hardhat";
import {
    CanonicalPhaseDeployed,
    deployCanonicalPhase,
    deploySidechainSystem,
    SidechainDeployed,
} from "../../scripts/deploySidechain";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import { impersonateAccount } from "../../test-utils";
import { SidechainConfig } from "../../tasks/deploy/sidechain-types";
import { AuraBalVaultDeployed } from "tasks/deploy/goerli-config";
import { Account, Create2Factory, Create2Factory__factory, LZEndpointMock, LZEndpointMock__factory } from "../../types";

describe("AuraBalOFT", () => {
    const L1_CHAIN_ID = 111;
    const L2_CHAIN_ID = 222;

    let deployer: Account;
    let dao: Account;

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
            addresses: {
                lzEndpoint: l2LzEndpoint.address,
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
            extConfig: { canonicalChainId: L1_CHAIN_ID },
        };

        // deploy canonicalPhase
        canonical = await deployCanonicalPhase(
            hre,
            { ...mainnetConfig.addresses, lzEndpoint: l1LzEndpoint.address },
            phase2,
            phase6,
            vaultDeployment,
            deployer.signer,
        );

        // deploy sidechain
        sidechain = await deploySidechainSystem(
            hre,
            sidechainConfig.naming,
            sidechainConfig.addresses,
            sidechainConfig.extConfig,
            deployer.signer,
        );
    });

    afterEach(async () => {
        // TODO: check that totalSupply or auraBAL OFT is the same or less than total underlying
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
        it("auraBal vault has correct config");
        it("auraBal strategy has correct config");
    });

    describe("Transfer to sidechain", () => {
        it("can transfer auraBAL to sidechain", async () => {
            // TODO: check balances
            // TODO: check vault balance
        });
        it("can harvest auraBAL from vault", async () => {
            // TODO: call harvest
            // TODO: check claimable balances
            // TODO: check balances match claimable
            //
        });
        it("can claim tokens to sidechain", async () => {
            // TODO: claim auraBAL to sidechain
            // TODO: check totals have updates
            // TODO: check sidechain strategy has balance
        });
        it("can withdraw auraBAL from sidechain", async () => {
            // TODO: check balances
            // TODO: check vault balance
        });
    });
});
