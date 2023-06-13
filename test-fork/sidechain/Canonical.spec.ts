import { expect } from "chai";
import hre, { ethers, network } from "hardhat";
import { Signer, BigNumber } from "ethers";
import {
    SidechainPhase1Deployed,
    SidechainPhase2Deployed,
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
} from "../../scripts/deploySidechain";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { AuraBalVaultDeployed } from "../../tasks/deploy/mainnet-config";
import {
    impersonateAccount,
    ZERO_ADDRESS,
    ONE_WEEK,
    simpleToExactAmount,
    getBal,
    getTimestamp,
} from "../../test-utils";
import { Account, LZEndpointMock, MockERC20__factory, SidechainConfig } from "../../types";
import { SimplyBridgeDelegateDeployed } from "../../scripts/deployBridgeDelegates";
import { setupLocalDeployment } from "./setupLocalDeployment";
import { setupForkDeployment, TestSuiteDeployment } from "./setupForkDeployments";

import { config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import { config as goerliConfig } from "../../tasks/deploy/goerli-config";
import { config as goerliSidechainConfig } from "../../tasks/deploy/goerliSidechain-config";
import { lzChainIds } from "../../tasks/deploy/sidechain-constants";

const FORKING = process.env.FORKING;

const [_canonicalConfig, _sidechainConfig, BLOCK_NUMBER] = FORKING
    ? [goerliConfig, goerliSidechainConfig, 8971316]
    : [mainnetConfig, mainnetConfig, 17096880];

const canonicalConfig = _canonicalConfig as typeof mainnetConfig;
const sidechainConfig = _sidechainConfig as SidechainConfig;

const canonicalLzChainId = lzChainIds[canonicalConfig.chainId];
const sidechainLzChainId = lzChainIds[sidechainConfig.chainId];

describe("Canonical", () => {
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
    let sidechain: SidechainPhase1Deployed & SidechainPhase2Deployed;

    let canonical: CanonicalPhase1Deployed & CanonicalPhase2Deployed;
    let bridgeDelegateDeployment: SimplyBridgeDelegateDeployed;

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
                        blockNumber: BLOCK_NUMBER,
                    },
                },
            ],
        });

        const accounts = await ethers.getSigners();
        alice = accounts[1];
        aliceAddress = await alice.getAddress();
        deployer = await impersonateAccount(canonicalConfig.multisigs.daoMultisig, true);

        let result: TestSuiteDeployment;
        if (FORKING) {
            result = await setupForkDeployment(hre, canonicalConfig, sidechainConfig, deployer, sidechainLzChainId);
        } else {
            result = await setupLocalDeployment(hre, canonicalConfig, deployer, canonicalLzChainId, sidechainLzChainId);
        }

        phase2 = result.phase2;
        phase6 = result.phase6;
        l1LzEndpoint = result.l1LzEndpoint;
        canonical = result.canonical;
        sidechain = result.sidechain;
        vaultDeployment = result.vaultDeployment;
        bridgeDelegateDeployment = result.bridgeDelegateDeployment;
        dao = result.dao;
    });

    describe("setup", () => {
        it("add trusted remotes to layerzero endpoints", async () => {
            // L1 Stuff
            await canonical.l1Coordinator
                .connect(dao.signer)
                .setTrustedRemote(
                    sidechainLzChainId,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [sidechain.l2Coordinator.address, canonical.l1Coordinator.address],
                    ),
                );

            await canonical.auraProxyOFT
                .connect(dao.signer)
                .setTrustedRemote(
                    sidechainLzChainId,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [sidechain.auraOFT.address, canonical.auraProxyOFT.address],
                    ),
                );

            await canonical.auraProxyOFT
                .connect(dao.signer)
                .setTrustedRemote(
                    sidechainLzChainId,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [sidechain.auraOFT.address, canonical.auraProxyOFT.address],
                    ),
                );
        });
        it("set bridge delegates", async () => {
            await canonical.l1Coordinator
                .connect(dao.signer)
                .setBridgeDelegate(sidechainLzChainId, bridgeDelegateDeployment.bridgeDelegateReceiver.address);
            expect(await canonical.l1Coordinator.bridgeDelegates(sidechainLzChainId)).to.eq(
                bridgeDelegateDeployment.bridgeDelegateReceiver.address,
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
            expect(await canonical.l1Coordinator.balToken()).eq(canonicalConfig.addresses.token);
            expect(await canonical.l1Coordinator.auraToken()).eq(phase2.cvx.address);
            expect(await canonical.l1Coordinator.auraOFT()).eq(canonical.auraProxyOFT.address);
            expect(await canonical.l1Coordinator.lzEndpoint()).eq(l1LzEndpoint.address);
            // Allowances
            expect(await phase2.cvx.allowance(canonical.l1Coordinator.address, canonical.auraProxyOFT.address)).eq(
                ethers.constants.MaxUint256,
            );
            const crv = MockERC20__factory.connect(canonicalConfig.addresses.token, deployer.signer);
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
            expect(await canonical.l1Coordinator.l2Coordinators(sidechainLzChainId)).not.eq(
                sidechain.l2Coordinator.address,
            );
            await canonical.l1Coordinator.setL2Coordinator(sidechainLzChainId, sidechain.l2Coordinator.address);
            expect(await canonical.l1Coordinator.l2Coordinators(sidechainLzChainId)).eq(
                sidechain.l2Coordinator.address,
            );
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
                .lzReceive(
                    sidechainLzChainId,
                    await canonical.l1Coordinator.trustedRemoteLookup(sidechainLzChainId),
                    0,
                    payload,
                );
            expect(await canonical.l1Coordinator.feeDebtOf(sidechainLzChainId)).to.eq(amount);
        });
        it("Can Settle Fee Debt", async () => {
            const amount = simpleToExactAmount("100");
            await getBal(canonicalConfig.addresses, bridgeDelegateDeployment.bridgeDelegateReceiver.address, amount);
            await bridgeDelegateDeployment.bridgeDelegateReceiver.settleFeeDebt(amount);

            const crv = MockERC20__factory.connect(canonicalConfig.addresses.token, dao.signer);

            expect(await canonical.l1Coordinator.feeDebtOf(sidechainLzChainId)).to.eq(amount);
            expect(await canonical.l1Coordinator.settledFeeDebtOf(sidechainLzChainId)).to.eq(amount);
            expect(await crv.balanceOf(bridgeDelegateDeployment.bridgeDelegateReceiver.address)).to.eq(0);
            expect(await crv.balanceOf(canonical.l1Coordinator.address)).to.eq(amount);
        });
        it("coordinator recieve l2 fees and distribute aura to l1coordinator", async () => {
            const crv = MockERC20__factory.connect(canonicalConfig.addresses.token, dao.signer);
            const cvx = MockERC20__factory.connect(phase2.cvx.address, dao.signer);

            const totalSupplyStart = await cvx.totalSupply();
            const startOFTBalance = await cvx.balanceOf(canonical.auraProxyOFT.address);

            await canonical.l1Coordinator.distributeAura(sidechainLzChainId, "0x", {
                value: simpleToExactAmount("0.5"),
            });

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
                .lzReceive(
                    sidechainLzChainId,
                    await canonical.auraProxyOFT.trustedRemoteLookup(sidechainLzChainId),
                    0,
                    payload,
                );

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
                BigNumber.from(sidechainLzChainId),
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
                    .sendFrom(
                        deployer.address,
                        sidechainLzChainId,
                        deployer.address,
                        amount,
                        ZERO_ADDRESS,
                        ZERO_ADDRESS,
                        [],
                        {
                            value: simpleToExactAmount("0.2"),
                        },
                    ),
            ).to.be.revertedWith("Pausable: paused");
        });
    });
});
