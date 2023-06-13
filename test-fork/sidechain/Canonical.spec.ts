import { expect } from "chai";
import hre, { ethers, network } from "hardhat";
import { Signer } from "ethers";
import {
    deployCanonicalPhase1,
    deployCanonicalPhase2,
    deploySidechainPhase1,
    deploySidechainPhase2,
    SidechainPhase1Deployed,
    SidechainPhase2Deployed,
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
} from "../../scripts/deploySidechain";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { AuraBalVaultDeployed, config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import {
    impersonateAccount,
    ZERO_ADDRESS,
    ONE_WEEK,
    simpleToExactAmount,
    getBal,
    getTimestamp,
} from "../../test-utils";
import {
    Account,
    AuraOFT,
    L2Coordinator,
    Create2Factory,
    Create2Factory__factory,
    LZEndpointMock,
    LZEndpointMock__factory,
    MockERC20__factory,
} from "../../types";
import { sidechainNaming } from "../../tasks/deploy/sidechain-constants";
import { SidechainConfig } from "../../types/sidechain-types";
import { deploySimpleBridgeDelegates, SimplyBridgeDelegateDeployed } from "../../scripts/deployBridgeDelegates";
import { BigNumber } from "ethers";

describe("Canonical", () => {
    const L1_CHAIN_ID = 111;
    const L2_CHAIN_ID = 222;
    let alice: Signer;
    let aliceAddress: string;
    let deployer: Account;
    let dao: Account;
    // phases
    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    let vaultDeployment: AuraBalVaultDeployed;
    // LayerZero endpoints
    let l1LzEndpoint: LZEndpointMock;
    let l2LzEndpoint: LZEndpointMock;
    let create2Factory: Create2Factory;
    let sidechain: SidechainPhase1Deployed & SidechainPhase2Deployed;
    let l2Coordinator: L2Coordinator;
    let auraOFT: AuraOFT;
    let sidechainConfig: SidechainConfig;

    const ethBlockNumber: number = 17096880;
    let canonical: CanonicalPhase1Deployed & CanonicalPhase2Deployed;
    let bridgeDelegate: SimplyBridgeDelegateDeployed;

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
                        blockNumber: ethBlockNumber,
                    },
                },
            ],
        });

        const accounts = await ethers.getSigners();
        alice = accounts[1];
        aliceAddress = await alice.getAddress();
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
        const l1Addresses = { ...mainnetConfig.addresses, lzEndpoint: l1LzEndpoint.address };
        const canonicalPhase1 = await deployCanonicalPhase1(
            hre,
            deployer.signer,
            mainnetConfig.multisigs,
            l1Addresses,
            phase2,
            phase6,
        );
        const canonicalPhase2 = await deployCanonicalPhase2(
            hre,
            deployer.signer,
            mainnetConfig.multisigs,
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
        sidechain = { ...sidechainPhase1, ...sidechainPhase2 };
        canonical = { ...canonicalPhase1, ...canonicalPhase2 };

        l2Coordinator = sidechain.l2Coordinator;
        auraOFT = sidechain.auraOFT;

        phase6 = await mainnetConfig.getPhase6(deployer.signer);

        // Connect contracts to its owner signer.
        canonical.l1Coordinator = canonical.l1Coordinator.connect(dao.signer);
        canonical.auraProxyOFT = canonical.auraProxyOFT.connect(dao.signer);
        canonical.auraBalProxyOFT = canonical.auraBalProxyOFT.connect(dao.signer);

        bridgeDelegate = await deploySimpleBridgeDelegates(
            hre,
            mainnetConfig.addresses,
            canonical,
            L2_CHAIN_ID,
            deployer.signer,
        );
    });

    describe("setup", () => {
        it("add trusted remotes to layerzero endpoints", async () => {
            const owner = await impersonateAccount(await sidechain.l2Coordinator.owner());
            // L1 Stuff
            await canonical.l1Coordinator
                .connect(owner.signer)
                .setTrustedRemote(
                    L2_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [sidechain.l2Coordinator.address, canonical.l1Coordinator.address],
                    ),
                );

            await canonical.auraProxyOFT
                .connect(owner.signer)
                .setTrustedRemote(
                    L2_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [sidechain.auraOFT.address, canonical.auraProxyOFT.address],
                    ),
                );

            await canonical.auraProxyOFT
                .connect(owner.signer)
                .setTrustedRemote(
                    L2_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [sidechain.auraOFT.address, canonical.auraProxyOFT.address],
                    ),
                );

            await l1LzEndpoint.connect(owner.signer).setDestLzEndpoint(l2Coordinator.address, l2LzEndpoint.address);
            await l1LzEndpoint.connect(owner.signer).setDestLzEndpoint(auraOFT.address, l2LzEndpoint.address);

            // L2 Stuff
            await sidechain.l2Coordinator
                .connect(owner.signer)
                .setTrustedRemote(
                    L1_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [canonical.l1Coordinator.address, sidechain.l2Coordinator.address],
                    ),
                );

            await sidechain.auraOFT
                .connect(owner.signer)
                .setTrustedRemote(
                    L1_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [canonical.auraProxyOFT.address, sidechain.auraOFT.address],
                    ),
                );

            await sidechain.auraBalOFT
                .connect(owner.signer)
                .setTrustedRemote(
                    L1_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [canonical.auraBalProxyOFT.address, sidechain.auraBalOFT.address],
                    ),
                );

            await l2LzEndpoint
                .connect(owner.signer)
                .setDestLzEndpoint(canonical.l1Coordinator.address, l1LzEndpoint.address);
            await l2LzEndpoint
                .connect(owner.signer)
                .setDestLzEndpoint(canonical.auraProxyOFT.address, l1LzEndpoint.address);
        });
        it("set bridge delegates", async () => {
            await canonical.l1Coordinator
                .connect(dao.signer)
                .setBridgeDelegate(L2_CHAIN_ID, bridgeDelegate.bridgeDelegateReceiver.address);
            expect(await canonical.l1Coordinator.bridgeDelegates(L2_CHAIN_ID)).to.eq(
                bridgeDelegate.bridgeDelegateReceiver.address,
            );
        });
    });
    describe("Check configs", () => {
        it("auraBalProxyOFT has correct config", async () => {
            expect(await canonical.auraBalProxyOFT.lzEndpoint()).eq(l1LzEndpoint.address);
            expect(await canonical.auraBalProxyOFT.vault()).eq(vaultDeployment.vault.address);
            expect(await canonical.auraBalProxyOFT.internalTotalSupply()).eq(0);
        });
        it("AuraProxyOFT has correct config", async () => {
            expect(await canonical.auraProxyOFT.lzEndpoint()).eq(l1LzEndpoint.address);
            expect(await canonical.auraProxyOFT.token()).eq(phase2.cvx.address);
            expect(await canonical.auraProxyOFT.locker()).eq(phase2.cvxLocker.address);
            expect(Number(await canonical.auraProxyOFT.epochDuration())).eq(Number(60 * 60 * 24 * 7));
            // Allowances
            expect(await phase2.cvx.allowance(canonical.auraProxyOFT.address, phase2.cvxLocker.address)).eq(
                ethers.constants.MaxUint256,
            );
        });
        it("L1Coordinator has correct config", async () => {
            expect(await canonical.l1Coordinator.booster()).eq(phase6.booster.address);
            expect(await canonical.l1Coordinator.balToken()).eq(mainnetConfig.addresses.token);
            expect(await canonical.l1Coordinator.auraToken()).eq(phase2.cvx.address);
            expect(await canonical.l1Coordinator.auraOFT()).eq(canonical.auraProxyOFT.address);
            expect(await canonical.l1Coordinator.lzEndpoint()).eq(l1LzEndpoint.address);
            // Allowances
            expect(await phase2.cvx.allowance(canonical.l1Coordinator.address, canonical.auraProxyOFT.address)).eq(
                ethers.constants.MaxUint256,
            );
            const crv = MockERC20__factory.connect(mainnetConfig.addresses.token, deployer.signer);
            expect(await crv.allowance(canonical.l1Coordinator.address, phase6.booster.address)).eq(
                ethers.constants.MaxUint256,
            );
        });
    });
    describe("Setup: Protocol DAO transactions", () => {
        it("set auraOFT as booster bridge delegate", async () => {
            expect(await phase6.booster.bridgeDelegate()).not.eq(canonical.l1Coordinator.address);
            await phase6.booster.connect(dao.signer).setBridgeDelegate(canonical.l1Coordinator.address);
            expect(await phase6.booster.bridgeDelegate()).eq(canonical.l1Coordinator.address);
        });
    });
    describe("L1Coordinator tests", () => {
        it("set l2coordinator", async () => {
            expect(await canonical.l1Coordinator.l2Coordinators(L2_CHAIN_ID)).not.eq(sidechain.l2Coordinator.address);
            await canonical.l1Coordinator.setL2Coordinator(L2_CHAIN_ID, sidechain.l2Coordinator.address);
            expect(await canonical.l1Coordinator.l2Coordinators(L2_CHAIN_ID)).eq(sidechain.l2Coordinator.address);
        });
        it("set distributors", async () => {
            expect(await canonical.l1Coordinator.distributors(dao.address)).eq(false);
            await canonical.l1Coordinator.setDistributor(dao.address, true);
            expect(await canonical.l1Coordinator.distributors(dao.address)).eq(true);
        });
        it("Can Notify Fees", async () => {
            const endpoint = await impersonateAccount(await canonical.l1Coordinator.lzEndpoint());
            const amount = simpleToExactAmount("100");
            const payload = ethers.utils.defaultAbiCoder.encode(
                ["bytes4", "uint8", "uint256"],
                ["0x7a7f9946", "1", amount],
            );
            await canonical.l1Coordinator
                .connect(endpoint.signer)
                .lzReceive(L2_CHAIN_ID, await canonical.l1Coordinator.trustedRemoteLookup(L2_CHAIN_ID), 0, payload);
            expect(await canonical.l1Coordinator.feeDebtOf(L2_CHAIN_ID)).to.eq(amount);
        });
        it("Can Settle Fee Debt", async () => {
            const amount = simpleToExactAmount("100");
            await getBal(mainnetConfig.addresses, bridgeDelegate.bridgeDelegateReceiver.address, amount);
            await bridgeDelegate.bridgeDelegateReceiver.settleFeeDebt(amount);

            const crv = MockERC20__factory.connect(mainnetConfig.addresses.token, dao.signer);

            expect(await canonical.l1Coordinator.feeDebtOf(L2_CHAIN_ID)).to.eq(amount);
            expect(await canonical.l1Coordinator.settledFeeDebtOf(L2_CHAIN_ID)).to.eq(amount);
            expect(await crv.balanceOf(bridgeDelegate.bridgeDelegateReceiver.address)).to.eq(0);
            expect(await crv.balanceOf(canonical.l1Coordinator.address)).to.eq(amount);
        });
        it("coordinator recieve l2 fees and distribute aura to l1coordinator", async () => {
            const crv = MockERC20__factory.connect(mainnetConfig.addresses.token, dao.signer);
            const cvx = MockERC20__factory.connect(phase2.cvx.address, dao.signer);

            const totalSupplyStart = await cvx.totalSupply();
            const startOFTBalance = await cvx.balanceOf(canonical.auraProxyOFT.address);

            await canonical.l1Coordinator.distributeAura(L2_CHAIN_ID, "0x", { value: simpleToExactAmount("0.5") });

            const endAura = await cvx.balanceOf(canonical.l1Coordinator.address);
            const endBal = await crv.balanceOf(canonical.l1Coordinator.address);
            const endTotalSupply = await cvx.totalSupply();
            const endOFTBalance = await cvx.balanceOf(canonical.auraProxyOFT.address);

            expect(endTotalSupply).to.be.gt(totalSupplyStart);
            expect(endAura).eq(0);
            expect(endBal).eq(0);
            expect(endOFTBalance).to.be.gt(startOFTBalance);
        });
        it("dissable distributor", async () => {
            expect(await canonical.l1Coordinator.distributors(dao.address)).eq(true);
            await canonical.l1Coordinator.setDistributor(dao.address, false);
            expect(await canonical.l1Coordinator.distributors(dao.address)).eq(false);
        });
    });
    describe("AuraProxyOFT", () => {
        it("Can Pause OFT", async () => {
            expect(await canonical.auraProxyOFT.paused()).eq(false);
            await canonical.auraProxyOFT.pause();
            expect(await canonical.auraProxyOFT.paused()).eq(true);
        });
        it("Can unpause OFT", async () => {
            expect(await canonical.auraProxyOFT.paused()).eq(true);
            await canonical.auraProxyOFT.unpause();
            expect(await canonical.auraProxyOFT.paused()).eq(false);
        });
        it("Can set precrime", async () => {
            expect(await canonical.auraProxyOFT.precrime()).eq(ZERO_ADDRESS);
            await canonical.auraProxyOFT.setPrecrime(deployer.address);
            expect(await canonical.auraProxyOFT.precrime()).eq(deployer.address);
            await canonical.auraProxyOFT.setPrecrime(ZERO_ADDRESS);
        });
        it("Can lock for a user via lock message", async () => {
            const amount = simpleToExactAmount("100");
            const endpoint = await impersonateAccount(await canonical.auraProxyOFT.lzEndpoint());
            const balancesBefore = await phase2.cvxLocker.balances(aliceAddress);

            const payload = ethers.utils.defaultAbiCoder.encode(
                ["bytes4", "uint8", "address", "uint256"],
                ["0x7a7f9946", "0", aliceAddress, amount],
            );
            await canonical.auraProxyOFT
                .connect(endpoint.signer)
                .lzReceive(L2_CHAIN_ID, await canonical.auraProxyOFT.trustedRemoteLookup(L2_CHAIN_ID), 0, payload);

            const balancesAfter = await phase2.cvxLocker.balances(aliceAddress);
            expect(balancesAfter.locked.sub(balancesBefore.locked)).to.eq(amount);
        });
        it("Can set inflow limit", async () => {
            const limit = simpleToExactAmount(1000);

            await canonical.auraProxyOFT.setInflowLimit(limit);
            expect(await canonical.auraProxyOFT.inflowLimit()).eq(limit);
        });
        it("Can set queue delay", async () => {
            const delay = ONE_WEEK.mul(4);

            await canonical.auraProxyOFT.connect(dao.signer).setQueueDelay(delay);
            expect(await canonical.auraProxyOFT.queueDelay()).eq(delay);
        });
        it("Queued transfer can NOT be processed when paused", async () => {
            await canonical.auraProxyOFT.pause();
            expect(await canonical.auraProxyOFT.paused()).eq(true);

            const epoch = await canonical.auraBalProxyOFT.getCurrentEpoch();
            const amount = await canonical.auraProxyOFT.inflowLimit();
            const ts = (await getTimestamp()).add(1_000);
            const queued: [BigNumber, BigNumber, string, BigNumber, BigNumber] = [
                epoch,
                BigNumber.from(L2_CHAIN_ID),
                deployer.address,
                amount,
                ts,
            ];

            await expect(canonical.auraProxyOFT.processQueued(...queued)).to.be.revertedWith("Pausable: paused");

            await canonical.auraProxyOFT.unpause();
            expect(await canonical.auraBalProxyOFT.paused()).eq(false);
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
                        value: simpleToExactAmount("0.2"),
                    }),
            ).to.be.revertedWith("Pausable: paused");
        });
    });
});
