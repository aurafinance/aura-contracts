import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers, network } from "hardhat";

import { SimplyBridgeDelegateDeployed } from "../../scripts/deployBridgeDelegates";
import {
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
    SidechainPhase1Deployed,
    SidechainPhase2Deployed,
    deploySidechainClaimZap,
} from "../../scripts/deploySidechain";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { config as goerliConfig } from "../../tasks/deploy/goerli-config";
import { config as goerliSidechainConfig } from "../../tasks/deploy/goerliSidechain-config";
import { config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import { lzChainIds } from "../../tasks/deploy/sidechain-constants";
import {
    impersonate,
    impersonateAccount,
    ONE_DAY,
    simpleToExactAmount,
    ZERO_ADDRESS,
    ONE_WEEK,
} from "../../test-utils";
import {
    Account,
    AuraOFT,
    BaseRewardPool4626__factory,
    ERC20,
    ERC20__factory,
    L2Coordinator,
    LZEndpointMock,
    MockERC20__factory,
    SidechainConfig,
    SidechainClaimZap,
} from "../../types";
import { ClaimRewardsAmountsStruct, OptionsStruct } from "../../types/generated/SidechainClaimZap";
import { increaseTime } from "./../../test-utils/time";
import { TestSuiteDeployment } from "./setupForkDeployments";
import { setupLocalDeployment } from "./setupLocalDeployment";

const FORKING = process.env.FORKING;

const [_canonicalConfig, _sidechainConfig, BLOCK_NUMBER] = FORKING
    ? [goerliConfig, goerliSidechainConfig, 8971461]
    : [mainnetConfig, mainnetConfig, 17096880];

const canonicalConfig = _canonicalConfig as typeof mainnetConfig;
const sidechainConfigGlobal = _sidechainConfig as SidechainConfig;

const canonicalLzChainId = lzChainIds[canonicalConfig.chainId];
const sidechainLzChainId = lzChainIds[sidechainConfigGlobal.chainId];

describe("Sidechain", () => {
    let alice: Signer;
    let aliceAddress: string;
    let dave: Signer;
    let daveAddress: string;
    let deployer: Account;
    let dao: Account;
    // phases
    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    // LayerZero endpoints
    let l2LzEndpoint: LZEndpointMock;
    let crv: ERC20;
    let sidechain: SidechainPhase1Deployed & SidechainPhase2Deployed;
    let sidechainConfig: SidechainConfig;
    let l2Coordinator: L2Coordinator;
    let auraOFT: AuraOFT;
    let canonical: CanonicalPhase1Deployed & CanonicalPhase2Deployed;
    let bridgeDelegateDeployment: SimplyBridgeDelegateDeployed;
    let sidechainClaimZap: SidechainClaimZap;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    const getBpt = async (token: string, recipient: string, amount = simpleToExactAmount(250)) => {
        const whale = sidechainConfig.whales[token];
        if (!whale) throw new Error("No BPT whale found");
        const tokenWhaleSigner = await impersonateAccount(whale);
        const tokenContract = MockERC20__factory.connect(token, tokenWhaleSigner.signer);
        await tokenContract.transfer(recipient, amount);
    };

    const getAura = async (recipient: string, amount = simpleToExactAmount(250)) => {
        const whale = mainnetConfig.addresses.balancerVault;
        if (!whale) throw new Error("No BPT whale found");
        const tokenWhaleSigner = await impersonateAccount(whale);
        const tokenContract = phase2.cvx.connect(tokenWhaleSigner.signer).transfer(recipient, amount);
    };

    const getBal = async (recipient: string, amount = simpleToExactAmount(250)) => {
        const whale = "0x740a4AEEfb44484853AA96aB12545FC0290805F3";
        if (!whale) throw new Error("No BPT whale found");
        const tokenWhaleSigner = await impersonateAccount(whale);
        const tokenContract = crv.connect(tokenWhaleSigner.signer).transfer(recipient, amount);
    };

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
        dave = accounts[6];
        daveAddress = await dave.getAddress();
        deployer = await impersonateAccount(sidechainConfigGlobal.multisigs.daoMultisig, true);

        const result: TestSuiteDeployment = await setupLocalDeployment(
            hre,
            canonicalConfig,
            deployer,
            canonicalLzChainId,
            sidechainLzChainId,
        );

        phase2 = result.phase2;
        phase6 = result.phase6;
        l2LzEndpoint = result.l2LzEndpoint;
        canonical = result.canonical;
        sidechain = result.sidechain;
        bridgeDelegateDeployment = result.bridgeDelegateDeployment;
        dao = await impersonateAccount(sidechainConfigGlobal.multisigs.daoMultisig);
        l2Coordinator = sidechain.l2Coordinator;
        auraOFT = sidechain.auraOFT;
        sidechainConfig = result.sidechainConfig;
        crv = ERC20__factory.connect(sidechainConfig.extConfig.token, alice);

        const zapdeployment = await deploySidechainClaimZap(
            result.sidechainConfig.extConfig,
            result.sidechain,
            hre,
            deployer.signer,
        );
        sidechainClaimZap = zapdeployment.sidechainClaimZap;
    });

    /* ---------------------------------------------------------------------
     * Protocol setup Before Testing
     * --------------------------------------------------------------------- */

    describe("Protocol setup Before Testing", () => {
        it("Set Up Protocol", async () => {
            // As this test suite is running the bridge from L1 -> L1 forked on
            // mainnet. We can just add the first 10 active existing Aura pools
            let i = 0;
            const boosterPoolLen = await phase6.booster.poolLength();
            const targetLen = boosterPoolLen.lt(10) ? boosterPoolLen.toNumber() : 10;
            while ((await sidechain.booster.poolLength()).lt(targetLen)) {
                const poolInfo = await phase6.booster.poolInfo(i);
                if (!poolInfo.shutdown) {
                    await sidechain.poolManager.connect(dao.signer)["addPool(address)"](poolInfo.gauge);
                }
                i++;
            }
            expect(await sidechain.booster.poolLength()).eq(targetLen);

            await sidechain.poolManager.connect(dao.signer).setProtectPool(false);
            expect(await sidechain.poolManager.protectAddPool()).eq(false);

            const gauge = sidechainConfig.extConfig.gauges[0];
            await sidechain.poolManager["addPool(address)"](gauge);

            let owner = await impersonateAccount(await sidechain.l2Coordinator.owner());
            await sidechain.l2Coordinator
                .connect(owner.signer)
                .setBridgeDelegate(bridgeDelegateDeployment.bridgeDelegateSender.address);

            owner = await impersonateAccount(await bridgeDelegateDeployment.bridgeDelegateSender.owner());

            await bridgeDelegateDeployment.bridgeDelegateSender
                .connect(owner.signer)
                .setL2Coordinator(sidechain.l2Coordinator.address);

            expect(await sidechain.l2Coordinator.bridgeDelegate()).to.eq(
                bridgeDelegateDeployment.bridgeDelegateSender.address,
            );
            expect(await bridgeDelegateDeployment.bridgeDelegateSender.l2Coordinator()).to.eq(
                sidechain.l2Coordinator.address,
            );

            await sidechain.l2Coordinator
                .connect(owner.signer)
                .setTrustedRemote(
                    canonicalLzChainId,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [canonical.l1Coordinator.address, sidechain.l2Coordinator.address],
                    ),
                );

            await sidechain.auraOFT
                .connect(owner.signer)
                .setTrustedRemote(
                    canonicalLzChainId,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [canonical.auraProxyOFT.address, sidechain.auraOFT.address],
                    ),
                );

            await sidechain.auraBalOFT
                .connect(owner.signer)
                .setTrustedRemote(
                    canonicalLzChainId,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [canonical.auraBalProxyOFT.address, sidechain.auraBalOFT.address],
                    ),
                );

            const endpoint = await impersonateAccount(await sidechain.l2Coordinator.lzEndpoint());
            const accAuraRewardsBefore = await sidechain.l2Coordinator.accAuraRewards();

            const amount = simpleToExactAmount("10000");

            let payload = ethers.utils.defaultAbiCoder.encode(
                ["bytes4", "uint8", "uint256"],
                ["0x7a7f9946", "2", amount],
            );
            await sidechain.l2Coordinator
                .connect(endpoint.signer)
                .lzReceive(
                    canonicalLzChainId,
                    await sidechain.l2Coordinator.trustedRemoteLookup(canonicalLzChainId),
                    0,
                    payload,
                );

            const accAuraRewardsAfter = await sidechain.l2Coordinator.accAuraRewards();
            expect(accAuraRewardsAfter.sub(accAuraRewardsBefore)).eq(amount);

            // Transfer some AURA to L2
            const bridgeAmount = ethers.utils.parseEther("10000");

            // bytes memory lzPayload = abi.encode(PT_SEND, _toAddress, amount);
            let PT_SEND = await sidechain.auraOFT.PT_SEND();
            let toAddress = ethers.utils.solidityPack(["address"], [l2Coordinator.address]);
            payload = ethers.utils.defaultAbiCoder.encode(
                ["uint16", "bytes", "uint256"],
                [PT_SEND, toAddress, bridgeAmount],
            );

            let signer = await impersonate(sidechain.auraOFT.address, true);
            await sidechain.auraOFT
                .connect(signer)
                .nonblockingLzReceive(canonicalLzChainId, l2LzEndpoint.address, 0, payload);

            PT_SEND = await sidechain.auraBalOFT.PT_SEND();
            toAddress = ethers.utils.solidityPack(["address"], [aliceAddress]);
            payload = ethers.utils.defaultAbiCoder.encode(
                ["uint16", "bytes", "uint256"],
                [PT_SEND, toAddress, bridgeAmount],
            );

            signer = await impersonate(sidechain.auraBalOFT.address, true);
            await sidechain.auraBalOFT
                .connect(signer)
                .nonblockingLzReceive(canonicalLzChainId, l2LzEndpoint.address, 0, payload);

            await getAura(canonical.auraProxyOFT.address, simpleToExactAmount("1000000"));

            const poolInfo = await sidechain.booster.poolInfo(0);

            signer = await impersonate(sidechain.booster.address, true);
            await getBal(poolInfo.crvRewards, simpleToExactAmount("1000"));
            await getBal(l2Coordinator.address, simpleToExactAmount("3333"));
            await sidechain.l2Coordinator
                .connect(signer)
                .queueNewRewards(deployer.address, simpleToExactAmount("3333"), simpleToExactAmount("1000"), {
                    gasLimit: 4000000,
                    value: simpleToExactAmount("0.2"),
                });
        });
    });

    /* ---------------------------------------------------------------------
     * Zap Testing
     * --------------------------------------------------------------------- */

    describe("Check config", () => {
        it("Zap has correct config", async () => {
            expect(await sidechainClaimZap.getName()).to.be.eq("Sidechain ClaimZap V1.0");
            expect(await sidechainClaimZap.cvx()).eq(sidechain.auraOFT.address);
            expect(await sidechainClaimZap.cvxCrv()).eq(sidechain.auraBalOFT.address);
            expect(await sidechainClaimZap.compounder()).eq(sidechain.auraBalVault.address);
        });

        it("set approval for deposits", async () => {
            await sidechainClaimZap.setApprovals();
            expect(await sidechain.auraBalOFT.allowance(sidechainClaimZap.address, sidechain.auraBalVault.address)).gte(
                ethers.constants.MaxUint256,
            );
        });

        it("cannot reinit", async () => {
            await expect(
                sidechainClaimZap
                    .connect(alice)
                    .init(sidechain.auraOFT.address, sidechain.auraBalOFT.address, sidechain.auraBalVault.address),
            ).to.be.revertedWith("INIT");
        });

        it("verifies only owner can set approvals", async () => {
            expect(await sidechainClaimZap.owner()).not.eq(aliceAddress);
            await expect(sidechainClaimZap.connect(alice).setApprovals()).to.be.revertedWith("!auth");
        });
    });

    describe("Zap Testing", () => {
        it("Deposit to Pool", async () => {
            const poolInfo = await sidechain.booster.poolInfo(0);
            await getBpt(poolInfo.lptoken, aliceAddress, simpleToExactAmount("200"));

            const lpToken = ERC20__factory.connect(poolInfo.lptoken, alice);
            const baseRewardPool = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, alice);

            const lpTokenBalance = await lpToken.balanceOf(aliceAddress);

            const rewardBalanceBefore = await baseRewardPool.balanceOf(aliceAddress);

            await lpToken.approve(baseRewardPool.address, lpTokenBalance);
            await baseRewardPool.deposit(lpTokenBalance, aliceAddress);
            const rewardBalanceAfter = await baseRewardPool.balanceOf(aliceAddress);

            expect(rewardBalanceAfter.sub(rewardBalanceBefore)).eq(simpleToExactAmount("200"));
        });

        it("User can claim rewards from pool on l2", async () => {
            const poolId = 0;
            const poolInfo = await sidechain.booster.poolInfo(poolId);

            for (let i = 0; i < 4; i++) {
                await sidechain.booster.earmarkRewards(poolId, { value: simpleToExactAmount("0.2") });
                await increaseTime(ONE_WEEK.mul("1"));
            }

            const crvBalanceBefore = await crv.balanceOf(aliceAddress);
            const cvxBalanceBefore = await auraOFT.balanceOf(aliceAddress);

            const options: OptionsStruct = {
                useAllWalletFunds: false,
                sendCvxToL1: false,
                lockCvxL1: false,
                useCompounder: false,
                refundEth: false,
                overrideL1Receiver: false,
                l1Receiever: ZERO_ADDRESS,
            };

            const amounts: ClaimRewardsAmountsStruct = {
                lockCvxMaxAmount: ethers.constants.MaxUint256,
                depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
                bridgeCvxMaxAmount: ethers.constants.MaxUint256,
            };

            await sidechainClaimZap.connect(alice).claimRewards([poolInfo.crvRewards], [], [], [], amounts, options);

            const crvBalanceAfter = await crv.balanceOf(aliceAddress);
            const cvxBalanceAfter = await auraOFT.balanceOf(aliceAddress);
            expect(crvBalanceAfter).to.be.gt(crvBalanceBefore);

            expect(cvxBalanceAfter).to.be.gt(cvxBalanceBefore);
        });

        it("User can claim rewards from pool and then lock on l1", async () => {
            await auraOFT.connect(alice).approve(sidechainClaimZap.address, ethers.constants.MaxUint256);

            const poolId = 0;
            const poolInfo = await sidechain.booster.poolInfo(poolId);

            for (let i = 0; i < 4; i++) {
                await sidechain.booster.earmarkRewards(poolId, { value: simpleToExactAmount("0.2") });
                await increaseTime(ONE_WEEK.mul("1"));
            }

            const options: OptionsStruct = {
                useAllWalletFunds: false,
                sendCvxToL1: false,
                lockCvxL1: true,
                useCompounder: false,
                refundEth: false,
                overrideL1Receiver: false,
                l1Receiever: ZERO_ADDRESS,
            };

            const amounts: ClaimRewardsAmountsStruct = {
                lockCvxMaxAmount: ethers.constants.MaxUint256,
                depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
                bridgeCvxMaxAmount: ethers.constants.MaxUint256,
            };

            const balancesBefore = await phase2.cvxLocker.balances(aliceAddress);
            const tx = await sidechainClaimZap
                .connect(alice)
                .claimRewards([poolInfo.crvRewards], [], [], [], amounts, options, {
                    value: simpleToExactAmount("0.2"),
                });
            const balancesAfter = await phase2.cvxLocker.balances(aliceAddress);

            await expect(tx).to.emit(auraOFT, "Locked");
            await increaseTime(ONE_WEEK);
            expect(balancesAfter.locked).to.be.gt(balancesBefore.locked);
        });

        it("User can claim rewards from pool and then send to l1", async () => {
            await auraOFT.connect(alice).approve(sidechainClaimZap.address, ethers.constants.MaxUint256);

            const poolId = 0;
            const poolInfo = await sidechain.booster.poolInfo(poolId);

            for (let i = 0; i < 4; i++) {
                await sidechain.booster.earmarkRewards(poolId, { value: simpleToExactAmount("0.2") });
                await increaseTime(ONE_WEEK.mul("1"));
            }

            const options: OptionsStruct = {
                useAllWalletFunds: false,
                sendCvxToL1: true,
                lockCvxL1: false,
                useCompounder: false,
                refundEth: false,
                overrideL1Receiver: false,
                l1Receiever: ZERO_ADDRESS,
            };

            const amounts: ClaimRewardsAmountsStruct = {
                lockCvxMaxAmount: ethers.constants.MaxUint256,
                depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
                bridgeCvxMaxAmount: ethers.constants.MaxUint256,
            };

            const balancesBefore = await phase2.cvx.balanceOf(aliceAddress);
            const tx = await sidechainClaimZap
                .connect(alice)
                .claimRewards([poolInfo.crvRewards], [], [], [], amounts, options, {
                    value: simpleToExactAmount("0.2"),
                });
            const balancesAfter = await phase2.cvx.balanceOf(aliceAddress);

            await expect(tx).to.emit(auraOFT, "SendToChain");
            await increaseTime(ONE_WEEK);
            expect(balancesAfter).to.be.gt(balancesBefore);
        });

        it("Use all balance override does what is expected", async () => {
            await auraOFT.connect(alice).approve(sidechainClaimZap.address, ethers.constants.MaxUint256);

            const poolId = 0;
            const poolInfo = await sidechain.booster.poolInfo(poolId);

            for (let i = 0; i < 4; i++) {
                await sidechain.booster.earmarkRewards(poolId, { value: simpleToExactAmount("0.2") });
                await increaseTime(ONE_WEEK.mul("1"));
            }

            const options: OptionsStruct = {
                useAllWalletFunds: true,
                sendCvxToL1: false,
                lockCvxL1: true,
                useCompounder: false,
                refundEth: false,
                overrideL1Receiver: false,
                l1Receiever: ZERO_ADDRESS,
            };

            const amounts: ClaimRewardsAmountsStruct = {
                lockCvxMaxAmount: ethers.constants.MaxUint256,
                depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
                bridgeCvxMaxAmount: ethers.constants.MaxUint256,
            };

            const balancesBefore = await sidechain.auraOFT.balanceOf(aliceAddress);
            const tx = await sidechainClaimZap
                .connect(alice)
                .claimRewards([poolInfo.crvRewards], [], [], [], amounts, options, {
                    value: simpleToExactAmount("0.2"),
                });
            const balancesAfter = await sidechain.auraOFT.balanceOf(aliceAddress);

            await expect(tx).to.emit(auraOFT, "Locked");
            await increaseTime(ONE_WEEK);

            expect(balancesAfter).eq(0);
            expect(balancesBefore).to.be.gt(0);
        });

        it("Can deposit cvxcrv in vault for user", async () => {
            await sidechain.auraBalOFT.connect(alice).approve(sidechainClaimZap.address, ethers.constants.MaxUint256);
            const balancesBefore = await sidechain.auraBalOFT.balanceOf(aliceAddress);
            expect(balancesBefore).to.be.gt(0);

            const options: OptionsStruct = {
                useAllWalletFunds: true,
                sendCvxToL1: false,
                lockCvxL1: false,
                useCompounder: true,
                refundEth: false,
                overrideL1Receiver: false,
                l1Receiever: ZERO_ADDRESS,
            };

            const amounts: ClaimRewardsAmountsStruct = {
                lockCvxMaxAmount: ethers.constants.MaxUint256,
                depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
                bridgeCvxMaxAmount: ethers.constants.MaxUint256,
            };

            const vaultBefore = await sidechain.auraBalVault.balanceOf(aliceAddress);
            const tx = await sidechainClaimZap
                .connect(alice)
                .claimRewards([], [], [], [], amounts, options, { value: simpleToExactAmount("0.2") });
            const balancesAfter = await sidechain.auraBalOFT.balanceOf(aliceAddress);
            const vaultAfter = await sidechain.auraBalVault.balanceOf(aliceAddress);

            await expect(tx).to.emit(sidechain.auraBalVault, "Deposit");

            expect(balancesAfter).eq(0);
            expect(vaultAfter).eq(balancesBefore);
            expect(vaultBefore).eq(0);
            expect(vaultAfter).to.be.gt(vaultBefore);
        });

        it("User can override xchain receiver address", async () => {
            await auraOFT.connect(alice).approve(sidechainClaimZap.address, ethers.constants.MaxUint256);

            const poolId = 0;
            const poolInfo = await sidechain.booster.poolInfo(poolId);

            for (let i = 0; i < 4; i++) {
                await sidechain.booster.earmarkRewards(poolId, { value: simpleToExactAmount("0.2") });
                await increaseTime(ONE_WEEK.mul("1"));
            }

            const options: OptionsStruct = {
                useAllWalletFunds: true,
                sendCvxToL1: true,
                lockCvxL1: false,
                useCompounder: false,
                refundEth: false,
                overrideL1Receiver: true,
                l1Receiever: daveAddress,
            };

            const amounts: ClaimRewardsAmountsStruct = {
                lockCvxMaxAmount: ethers.constants.MaxUint256,
                depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
                bridgeCvxMaxAmount: ethers.constants.MaxUint256,
            };

            const balancesBefore = await phase2.cvx.balanceOf(daveAddress);
            const tx = await sidechainClaimZap
                .connect(alice)
                .claimRewards([poolInfo.crvRewards], [], [], [], amounts, options, {
                    value: simpleToExactAmount("0.2"),
                });
            const balancesAfter = await phase2.cvx.balanceOf(daveAddress);

            await expect(tx).to.emit(auraOFT, "SendToChain");
            await increaseTime(ONE_WEEK);
            expect(balancesAfter).to.be.gt(balancesBefore);
        });

        it("fails if claim rewards are incorrect", async () => {
            const options: OptionsStruct = {
                useAllWalletFunds: false,
                sendCvxToL1: false,
                lockCvxL1: false,
                useCompounder: false,
                refundEth: false,
                overrideL1Receiver: false,
                l1Receiever: daveAddress,
            };

            const amounts: ClaimRewardsAmountsStruct = {
                lockCvxMaxAmount: ethers.constants.MaxUint256,
                depositCvxCrvMaxAmount: ethers.constants.MaxUint256,
                bridgeCvxMaxAmount: ethers.constants.MaxUint256,
            };
            await expect(
                sidechainClaimZap.connect(alice).claimRewards([], [], [], [ZERO_ADDRESS], amounts, options),
            ).to.be.revertedWith("!parity");
        });

        it("owner can set zro", async () => {
            await sidechainClaimZap.setZro(daveAddress);
            expect(await sidechainClaimZap.zro()).eq(daveAddress);
        });

        it("verifies only owner can set zro", async () => {
            expect(await sidechainClaimZap.owner()).not.eq(aliceAddress);
            await expect(sidechainClaimZap.connect(alice).setZro(aliceAddress)).to.be.revertedWith("!auth");
        });
    });
});
