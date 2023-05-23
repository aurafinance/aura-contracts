import { expect } from "chai";
import { BigNumber, Signer } from "ethers";
import { toUtf8Bytes } from "ethers/lib/utils";
import hre, { ethers } from "hardhat";

import {
    anyValue,
    BN,
    DEAD_ADDRESS,
    impersonateAccount,
    simpleToExactAmount,
    ZERO,
    ZERO_ADDRESS,
} from "../../test-utils";
import { Account } from "../../types";
import { BaseRewardPool, BaseRewardPool__factory, ERC20, L1Coordinator } from "../../types/generated";
import { ERRORS, OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import {
    CanonicalPhaseDeployed,
    SidechainDeployed,
    SideChainTestSetup,
    sidechainTestSetup,
} from "./sidechainTestSetup";

const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;
const SET_CONFIG_SELECTOR = "setConfig(uint16,bytes32,(bytes,address))";
describe("L1Coordinator", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;
    let crv: ERC20;
    let cvx: ERC20;

    // Testing contract
    let l1Coordinator: L1Coordinator;
    let testSetup: SideChainTestSetup;
    let sidechain: SidechainDeployed;
    let canonical: CanonicalPhaseDeployed;
    let idSnapShot: number;

    /* -- Declare shared functions -- */
    const setup = async () => {
        if (idSnapShot) {
            await hre.ethers.provider.send("evm_revert", [idSnapShot]);
            return;
        }
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID);
        sidechain = testSetup.l2.sidechain;
        canonical = testSetup.l1.canonical;
        l1Coordinator = canonical.l1Coordinator;
        cvx = testSetup.l1.phase2.cvx;
        crv = testSetup.l1.mocks.crv;
        dao = await impersonateAccount(testSetup.l1.multisigs.daoMultisig);

        // dirty trick to update Voter Proxy Operator to phase6.booster, as we need to mint new aura.
        const newSlot = "0x" + testSetup.l1.phase6.booster.address.slice(2).padStart(64, "0");
        await hre.network.provider.send("hardhat_setStorageAt", [
            testSetup.l1.phase2.voterProxy.address,
            "0x5",
            newSlot,
        ]);

        await l1Coordinator.connect(dao.signer).setDistributor(deployer.address, true);
        // update Aura operator
        await testSetup.l1.phase2.cvx.updateOperator();
        await crv.transfer(l1Coordinator.address, simpleToExactAmount(10));

        // dirty trick to get some cvx balance.
        const cvxDepositorAccount = await impersonateAccount(testSetup.l1.phase2.vestedEscrows[0].address);
        const cvxConnected = cvx.connect(cvxDepositorAccount.signer);
        const cvxBalance = await cvxConnected.balanceOf(cvxDepositorAccount.address);
        await cvxConnected.transfer(deployer.address, cvxBalance);
    };
    async function toFeeAmount(n: BigNumber) {
        const lockIncentive = await sidechain.booster.lockIncentive();
        const stakerIncentive = await sidechain.booster.stakerIncentive();
        const platformFee = await sidechain.booster.platformFee();
        const feeDenom = await sidechain.booster.FEE_DENOMINATOR();

        const totalIncentive = lockIncentive.add(stakerIncentive).add(platformFee);
        return n.mul(totalIncentive).div(feeDenom);
    }
    before("init contract", async () => {
        await setup();
    });

    describe("behaviors", async () => {
        describe("should behave like Ownable ", async () => {
            const ctx: Partial<OwnableBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.owner = dao;
                    ctx.anotherAccount = alice;
                    ctx.ownable = l1Coordinator;
                    return ctx as OwnableBehaviourContext;
                };
            });
            shouldBehaveLikeOwnable(() => ctx as OwnableBehaviourContext);
        });
    });
    describe("constructor", async () => {
        before("init contract", async () => {
            await setup();
        });

        it("should properly store valid arguments", async () => {
            expect(await l1Coordinator.booster(), "booster").to.eq(testSetup.l1.phase6.booster.address);
            expect(await l1Coordinator.balToken(), "balToken").to.eq(crv.address);
            expect(await l1Coordinator.auraToken(), "auraToken").to.eq(cvx.address);
            expect(await l1Coordinator.auraOFT(), "auraOFT").to.eq(canonical.auraProxyOFT.address);
            expect(await l1Coordinator.feeDebtOf(L2_CHAIN_ID), "feeDebt").to.eq(ZERO);
            expect(await l1Coordinator.bridgeDelegates(L2_CHAIN_ID), "bridgeDelegates").to.eq(
                testSetup.bridgeDelegates.bridgeDelegateReceiver.address,
            );
            expect(await l1Coordinator.l2Coordinators(L2_CHAIN_ID), "l2Coordinators").to.eq(
                sidechain.l2Coordinator.address,
            );
        });
        it("check initial state of new chains", async () => {
            const SUPER_L2_CHAIN_ID = 999;
            expect(await l1Coordinator.feeDebtOf(SUPER_L2_CHAIN_ID), "feeDebt").to.eq(ZERO);
            expect(await l1Coordinator.bridgeDelegates(SUPER_L2_CHAIN_ID), "bridgeDelegates").to.eq(ZERO_ADDRESS);
            expect(await l1Coordinator.l2Coordinators(SUPER_L2_CHAIN_ID), "l2Coordinators").to.eq(ZERO_ADDRESS);
        });
        it("should set initial allowances", async () => {
            expect(
                await crv.allowance(l1Coordinator.address, testSetup.l1.phase6.booster.address),
                "crv allowance",
            ).to.be.eq(ethers.constants.MaxUint256);
            expect(
                await cvx.allowance(l1Coordinator.address, canonical.auraProxyOFT.address),
                "auraOFT allowance",
            ).to.be.eq(ethers.constants.MaxUint256);
        });
    });
    describe("setConfig", async () => {
        // CrossChainConfig
        it("sets configuration by selector", async () => {
            const selector = ethers.utils.keccak256(toUtf8Bytes("distributeAura(uint16,address,bytes)"));
            const config = {
                adapterParams: ethers.utils.solidityPack(["uint16", "uint256"], [1, 1000_000]),
                zroPaymentAddress: DEAD_ADDRESS,
            };

            //   When  config is set.
            await l1Coordinator.connect(dao.signer)[SET_CONFIG_SELECTOR](L2_CHAIN_ID, selector, config);
            // No events
            const newConfig = await l1Coordinator.configs(L2_CHAIN_ID, selector);
            expect(newConfig.adapterParams, "adapterParams").to.be.eq(config.adapterParams);
            expect(newConfig.zroPaymentAddress, "zroPaymentAddress").to.be.eq(config.zroPaymentAddress);
        });
        it("fails if caller is not the owner", async () => {
            const selector = ethers.utils.keccak256(toUtf8Bytes("distributeAura(uint16,address,bytes)"));
            await expect(
                l1Coordinator[SET_CONFIG_SELECTOR](L2_CHAIN_ID, selector, {
                    adapterParams: "0x",
                    zroPaymentAddress: DEAD_ADDRESS,
                }),
                "fails due to ",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
    });
    describe("setBridgeDelegate", async () => {
        it("updates the bridgeDelegate", async () => {
            const bridgeDelegateBefore = await l1Coordinator.bridgeDelegates(L2_CHAIN_ID);
            expect(bridgeDelegateBefore, "bridgeDelegateBefore").to.not.be.eq(DEAD_ADDRESS);

            await l1Coordinator.connect(dao.signer).setBridgeDelegate(L2_CHAIN_ID, DEAD_ADDRESS);
            // No events
            expect(await l1Coordinator.bridgeDelegates(L2_CHAIN_ID), "bridgeDelegateBefore after").to.be.eq(
                DEAD_ADDRESS,
            );
        });
        it("fails if owner is not the caller", async () => {
            await expect(l1Coordinator.setBridgeDelegate(L2_CHAIN_ID, ZERO_ADDRESS), "onlyOwner").to.be.revertedWith(
                ERRORS.ONLY_OWNER,
            );
        });
    });
    describe("setL2Coordinator", async () => {
        it("updates the l2Coordinator", async () => {
            const l2CoordinatorBefore = await l1Coordinator.l2Coordinators(L2_CHAIN_ID);
            expect(l2CoordinatorBefore, "l2CoordinatorBefore").to.not.be.eq(DEAD_ADDRESS);

            await l1Coordinator.connect(dao.signer).setL2Coordinator(L2_CHAIN_ID, DEAD_ADDRESS);
            // No events
            expect(await l1Coordinator.l2Coordinators(L2_CHAIN_ID), "l2CoordinatorBefore after").to.be.eq(DEAD_ADDRESS);
        });
        it("fails if owner is not the caller", async () => {
            await expect(l1Coordinator.setL2Coordinator(L2_CHAIN_ID, ZERO_ADDRESS), "onlyOwner").to.be.revertedWith(
                ERRORS.ONLY_OWNER,
            );
        });
    });
    describe('Earmark rewards on L2 "mints" (transfers) AURA', () => {
        const mintrMintAmount = simpleToExactAmount(1); // Rate of the MockCurveMinter.
        let feeDebt: BN;
        let crvRewards: BaseRewardPool;
        before("init contract", async () => {
            await setup();
            // const pool = await testSetup.l1.phase6.booster.poolInfo(0);
            const lockRewards = await testSetup.l1.phase6.booster.lockRewards();
            crvRewards = BaseRewardPool__factory.connect(lockRewards, deployer.signer);
        });
        it("L2 earmark rewards sends fees to L1 coordinator", async () => {
            // L2 BoosterLite.earmarkRewards =>  VoterProxyLite.claimCrv() => L2Coordinator.queueNewRewards()
            // L2 LZEndpointMock.send() =>  L1 ZEndpointMock.receivePayload()
            // L1 L1Coordinator.lzReceive() => L1Coordinator._notifyFees() => feeDebt[_srcChainId] += _amount
            const amountOfFees = await toFeeAmount(mintrMintAmount);
            const feeDebtBefore = await l1Coordinator.feeDebtOf(L2_CHAIN_ID);
            const coordinatorBalBefore = await testSetup.l2.mocks.token.balanceOf(
                testSetup.bridgeDelegates.bridgeDelegateSender.address,
            );
            await sidechain.booster.connect(alice.signer).earmarkRewards(0, { value: NATIVE_FEE });
            const feeDebtAfter = await l1Coordinator.feeDebtOf(L2_CHAIN_ID);
            feeDebt = feeDebtAfter.sub(feeDebtBefore);
            const coordinatorBalAfter = await testSetup.l2.mocks.token.balanceOf(
                testSetup.bridgeDelegates.bridgeDelegateSender.address,
            );
            expect(feeDebt, "feeDebt").to.be.eq(amountOfFees);
            expect(coordinatorBalAfter.sub(coordinatorBalBefore), "bridgeDelegateSender balance").to.be.eq(
                amountOfFees,
            );
        });
        it("distribute aura to L2", async () => {
            // L1 L1Coordinator.distributeAura() => Booster.distributeL2Fees() => BaseRewardPool.queueNewRewards() => AuraToken.mint()
            // L1 |a|- LZEndpointMock.send() => LZEndpointMock.receivePayload =>  L2Coordinator.lzReceive => update mintRate !!
            // L1 |b|- AuraProxyOFT.sendFrom () => AuraToken.transferFrom()

            // Given that is some feeDebt for a given L2 CHAIN
            expect(feeDebt, "feeDebt").to.be.gt(ZERO);

            const coordinatorAuraBalBefore = await sidechain.auraOFT.balanceOf(sidechain.l2Coordinator.address);
            expect(await sidechain.l2Coordinator.mintRate()).eq(0);
            // When distribute Aura
            await canonical.auraProxyOFT.connect(dao.signer).setUseCustomAdapterParams(false);
            const tx = await l1Coordinator.distributeAura(L2_CHAIN_ID, ZERO_ADDRESS, [], { value: NATIVE_FEE.mul(2) });

            // Verify that calling it twice it does not distribute twice
            await expect(
                l1Coordinator.distributeAura(L2_CHAIN_ID, ZERO_ADDRESS, [], { value: NATIVE_FEE.mul(2) }),
            ).to.be.revertedWith("SafeMath: division by zero");

            // Expect aura to be received on L2 Coordinator
            const coordinatorAuraBalAfter = await sidechain.auraOFT.balanceOf(sidechain.l2Coordinator.address);
            const coordinatorAuraDelta = coordinatorAuraBalAfter.sub(coordinatorAuraBalBefore);

            // L1
            //send lockers' share of crv to reward contract
            await expect(tx)
                .to.emit(testSetup.l1.mocks.crv, "Transfer")
                .withArgs(l1Coordinator.address, testSetup.l1.phase2.cvxStakingProxy.address, anyValue);
            //send stakers's share of crv to reward contract
            await expect(tx)
                .to.emit(testSetup.l1.mocks.crv, "Transfer")
                .withArgs(l1Coordinator.address, crvRewards.address, anyValue);
            await expect(tx).to.emit(crvRewards, "RewardAdded");
            // Mint CVX to bridge delegate

            // L2
            await expect(tx)
                .to.emit(sidechain.auraOFT, "Transfer")
                .withArgs(ZERO_ADDRESS, sidechain.l2Coordinator.address, coordinatorAuraDelta);
            await expect(tx)
                .to.emit(sidechain.auraOFT, "ReceiveFromChain")
                .withArgs(L1_CHAIN_ID, sidechain.l2Coordinator.address, coordinatorAuraDelta);

            expect(await sidechain.l2Coordinator.mintRate()).not.eq(0);
            expect(coordinatorAuraBalAfter, "coordinator aura balance").to.be.gt(coordinatorAuraBalBefore);
        });
        it("settleFeeDebt should reduce the sidechain fee debt", async () => {
            // Given that some bridge has sent crv to the bridgeDelegateReceiver
            await crv.transfer(testSetup.bridgeDelegates.bridgeDelegateReceiver.address, feeDebt);

            const bridgeDelegate = await l1Coordinator.bridgeDelegates(L2_CHAIN_ID);
            const feeDebtBefore = await l1Coordinator.feeDebtOf(L2_CHAIN_ID);
            const bridgeDelegateBalance = await crv.balanceOf(bridgeDelegate);
            const l1CoordinatorBalance = await crv.balanceOf(l1Coordinator.address);

            expect(feeDebtBefore, "feeDebtBefore").to.be.eq(feeDebt);
            expect(bridgeDelegate, "correct bridgeDelegate").to.be.eq(
                testSetup.bridgeDelegates.bridgeDelegateReceiver.address,
            );

            // When the fee debt is settled
            const tx = await testSetup.bridgeDelegates.bridgeDelegateReceiver
                .connect(deployer.signer)
                .settleFeeDebt(feeDebt);

            // Verify that calling it twice it does not distribute twice
            await expect(
                testSetup.bridgeDelegates.bridgeDelegateReceiver.connect(deployer.signer).settleFeeDebt(feeDebt),
            ).to.be.revertedWith("!amount");

            // No Events on l1Coordinator
            await expect(tx)
                .to.emit(testSetup.bridgeDelegates.bridgeDelegateReceiver, "SettleFeeDebt")
                .withArgs(feeDebt);

            const feeDebtAfter = await l1Coordinator.feeDebtOf(L2_CHAIN_ID);
            const settledFeeDebtOf = await l1Coordinator.settledFeeDebtOf(L2_CHAIN_ID);

            const bridgeDelegateAfter = await crv.balanceOf(bridgeDelegate);
            const l1CoordinatorAfter = await crv.balanceOf(l1Coordinator.address);

            expect(feeDebtAfter, "settleFeeDebt").to.be.eq(settledFeeDebtOf);
            expect(bridgeDelegateAfter, "bridgeDelegate balance").to.be.eq(bridgeDelegateBalance.sub(feeDebt));
            expect(l1CoordinatorAfter, "l1Coordinator balance").to.be.eq(l1CoordinatorBalance.add(feeDebt));
        });
    });
    describe("edge cases", () => {
        describe("distributeAura", async () => {
            it("fails if the chain does not exist", async () => {
                await expect(
                    l1Coordinator.distributeAura(999, ZERO_ADDRESS, [], { value: NATIVE_FEE.mul(2) }),
                    "wrong chain",
                ).to.be.revertedWith("SafeMath: division by zero");
            });
            xit("fails if no native fees are provided", async () => {
                await expect(
                    l1Coordinator.distributeAura(L2_CHAIN_ID, ZERO_ADDRESS, []),
                    "!feeAmount",
                ).to.be.revertedWith("!feeAmount");
            });
            it("fails if caller is not distributor", async () => {
                await expect(
                    l1Coordinator
                        .connect(alice.signer)
                        .distributeAura(999, ZERO_ADDRESS, [], { value: NATIVE_FEE.mul(2) }),
                    "onlyDistributor",
                ).to.be.revertedWith("!distributor");
            });
            it("fails if caller is not distributor", async () => {
                await expect(
                    l1Coordinator.connect(alice.signer).setDistributor(DEAD_ADDRESS, true),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("fails if the chain does not have an L2 coordinator", async () => {
                await sidechain.booster.connect(alice.signer).earmarkRewards(0, { value: NATIVE_FEE });
                const feeDebtOf = await l1Coordinator.feeDebtOf(L2_CHAIN_ID);
                expect(feeDebtOf).to.be.gt(ZERO);
                // Make sure the L2 coordinator is not set.
                await l1Coordinator.connect(dao.signer).setL2Coordinator(L2_CHAIN_ID, ZERO_ADDRESS);
                await expect(
                    l1Coordinator.distributeAura(L2_CHAIN_ID, ZERO_ADDRESS, [], { value: NATIVE_FEE.mul(2) }),
                    "wrong chain",
                ).to.be.revertedWith("to can not be zero");
            });
        });

        describe("settleFeeDebt", async () => {
            it("fails if settle more than the actual debt", async () => {
                const amount = 1;
                const srcChainId = await testSetup.bridgeDelegates.bridgeDelegateReceiver.srcChainId();
                const feeDebtBefore = await l1Coordinator.feeDebtOf(srcChainId);
                await expect(
                    testSetup.bridgeDelegates.bridgeDelegateReceiver
                        .connect(dao.signer)
                        .settleFeeDebt(feeDebtBefore.add(amount)),
                    "Arithmetic operation underflowed",
                ).to.be.reverted;
            });
            it("fails if the chain does not have a bridge delegate", async () => {
                await expect(
                    l1Coordinator.connect(alice.signer).settleFeeDebt(9999, ZERO),
                    "!bridgeDelegate",
                ).to.be.revertedWith("!bridgeDelegate");
            });
            it("fails if caller is not bridgeDelegate", async () => {
                await expect(
                    l1Coordinator.connect(alice.signer).settleFeeDebt(L2_CHAIN_ID, ZERO),
                    "!bridgeDelegate",
                ).to.be.revertedWith("!bridgeDelegate");
            });
        });
        xit("DAO goes rogue breaks distributeAura", async () => {
            const selector = ethers.utils.keccak256(toUtf8Bytes("distributeAura(uint16,address,bytes)"));
            const config = {
                adapterParams: ethers.utils.solidityPack(["uint16", "uint256"], [1, 10]),
                zroPaymentAddress: DEAD_ADDRESS,
            };
            //   When  config is set.
            await crv.transfer(l1Coordinator.address, simpleToExactAmount(10));
            await canonical.auraProxyOFT.connect(dao.signer).setUseCustomAdapterParams(false);
            await l1Coordinator.connect(dao.signer)[SET_CONFIG_SELECTOR](L2_CHAIN_ID, selector, config);
            await sidechain.booster.connect(alice.signer).earmarkRewards(0, { value: NATIVE_FEE });
            await l1Coordinator.distributeAura(L2_CHAIN_ID, ZERO_ADDRESS, [], { value: NATIVE_FEE.mul(2) });
        });
    });
});
