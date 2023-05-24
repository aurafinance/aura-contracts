import { expect } from "chai";
import { Signer } from "ethers";
import { toUtf8Bytes } from "ethers/lib/utils";
import hre, { ethers } from "hardhat";
import { DeployL2MocksResult } from "scripts/deploySidechainMocks";

import {
    anyValue,
    DEAD_ADDRESS,
    impersonate,
    impersonateAccount,
    increaseTime,
    simpleToExactAmount,
    ZERO,
    ZERO_ADDRESS,
} from "../../test-utils";
import { Account, PoolInfo } from "../../types";
import { BaseRewardPool__factory, L2Coordinator } from "../../types/generated";
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

describe("L2Coordinator", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;
    let l2mocks: DeployL2MocksResult;
    let pool: PoolInfo;

    // Testing contract
    let l2Coordinator: L2Coordinator;
    let testSetup: SideChainTestSetup;
    let sidechain: SidechainDeployed;
    let canonical: CanonicalPhaseDeployed;
    const pid = 0;
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
        canonical = testSetup.l1.canonical;
        sidechain = testSetup.l2.sidechain;
        l2Coordinator = testSetup.l2.sidechain.l2Coordinator;
        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);
        l2mocks = testSetup.l2.mocks;
        pool = await sidechain.booster.poolInfo(pid);

        // transfer LP tokens to accounts
        const balance = await l2mocks.bpt.balanceOf(deployer.address);
        await l2mocks.bpt.transfer(alice.address, balance.div(4));
    };
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
                    ctx.ownable = l2Coordinator;
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
            expect(await l2Coordinator.canonicalChainId()).eq(L1_CHAIN_ID);
            expect(await l2Coordinator.auraOFT()).eq(sidechain.auraOFT.address);
            expect(await l2Coordinator.booster()).eq(sidechain.booster.address);
            expect(await l2Coordinator.balToken(), "balToken").to.eq(testSetup.l2.mocks.token.address);
            expect(await l2Coordinator.mintRate()).eq(0);
            expect(await l2Coordinator.bridgeDelegate(), "bridgeDelegate").to.eq(
                testSetup.bridgeDelegates.bridgeDelegateSender.address,
            );
            expect(await l2Coordinator.lzEndpoint()).eq(testSetup.l2.mocks.addresses.lzEndpoint);
        });
        it("initialize fails if initialize is called more than once", async () => {
            expect(await l2Coordinator.booster()).to.not.be.eq(ZERO_ADDRESS);
            await expect(
                l2Coordinator.connect(dao.signer).initialize(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS),
                "init call twice",
            ).to.be.revertedWith("already initialized");
        });
        it("initialize fails if initialize is caller is not the owner", async () => {
            await expect(
                l2Coordinator.connect(deployer.signer).initialize(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS),
                "onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
    });
    describe("setConfig", async () => {
        // CrossChainConfig
        it("sets configuration by selector", async () => {
            const selector = ethers.utils.keccak256(toUtf8Bytes("queueNewRewards(address,uint256)"));

            const config = {
                adapterParams: ethers.utils.solidityPack(["uint16", "uint256"], [1, 1000_000]),
                zroPaymentAddress: DEAD_ADDRESS,
            };

            //   When  config is set.
            await l2Coordinator.connect(dao.signer)[SET_CONFIG_SELECTOR](L1_CHAIN_ID, selector, config);
            // No events
            const newConfig = await l2Coordinator.configs(L1_CHAIN_ID, selector);
            expect(newConfig.adapterParams, "adapterParams").to.be.eq(config.adapterParams);
            expect(newConfig.zroPaymentAddress, "zroPaymentAddress").to.be.eq(config.zroPaymentAddress);
        });
    });
    describe("normal flow", async () => {
        it("user stakes into reward pool", async () => {
            const stake = true;
            const amount = ethers.utils.parseEther("10");
            let tx = await l2mocks.bpt.connect(alice.signer).approve(sidechain.booster.address, amount);

            tx = await sidechain.booster.connect(alice.signer).deposit(pid, amount, stake);
            await expect(tx).to.emit(sidechain.booster, "Deposited").withArgs(alice.address, pid, amount);
        });
        it("earmarkRewards sends fees to L2 Coordinator via queueNewRewards", async () => {
            await increaseTime(60 * 60 * 24);
            const feeDebtBefore = await canonical.l1Coordinator.feeDebtOf(L2_CHAIN_ID);
            const bridgeDelegate = await sidechain.l2Coordinator.bridgeDelegate();
            expect(bridgeDelegate, "L2 bridgeDelegate").to.not.be.eq(ZERO_ADDRESS);
            const bridgeDelegateBalanceBefore = await l2mocks.token.balanceOf(bridgeDelegate);
            // const amountOfFees = await toFeeAmount(mintrMintAmount);
            // When earmarkRewards
            const tx = await sidechain.booster.earmarkRewards(pid, { value: NATIVE_FEE });
            // It calls L2Coordinator.queueNewRewards()
            // No events
            // Then sends fees to L2 and increase l1 fee debt
            const feeDebtAfter = await canonical.l1Coordinator.feeDebtOf(L2_CHAIN_ID);
            const bridgeDelegateBalanceAfter = await l2mocks.token.balanceOf(bridgeDelegate);
            const bridgeDelegateBalanceDelta = bridgeDelegateBalanceAfter.sub(bridgeDelegateBalanceBefore);

            await expect(tx)
                .to.emit(l2mocks.token, "Transfer")
                .withArgs(l2Coordinator.address, bridgeDelegate, bridgeDelegateBalanceDelta);

            expect(feeDebtAfter.sub(feeDebtBefore), "fees sent to coordinator").gt(ZERO);
            expect(bridgeDelegateBalanceDelta, "crv on L2 coordinator").to.gt(ZERO);
        });
        it("updates accumulated aura", async () => {
            const lzEndpoint = await impersonateAccount(await l2Coordinator.lzEndpoint(), true);

            // Send some AURA OFT
            const PT_SEND = await sidechain.auraOFT.PT_SEND();
            const toAddress = ethers.utils.solidityPack(["address"], [l2Coordinator.address]);
            const auraOftPayload = ethers.utils.defaultAbiCoder.encode(
                ["uint16", "bytes", "uint256"],
                [PT_SEND, toAddress, simpleToExactAmount(100)],
            );

            const signer = await impersonate(sidechain.auraOFT.address, true);
            await sidechain.auraOFT
                .connect(signer)
                .nonblockingLzReceive(L1_CHAIN_ID, lzEndpoint.address, 0, auraOftPayload);

            // Update mintRate
            const payload = ethers.utils.defaultAbiCoder.encode(
                ["bytes4", "uint8", "uint256"],
                ["0x7a7f9946", "2", simpleToExactAmount(1)],
            );
            const accAuraBefore = await l2Coordinator.accAuraRewards();

            await l2Coordinator
                .connect(dao.signer)
                .setTrustedRemoteAddress(L1_CHAIN_ID, canonical.l1Coordinator.address);
            await l2Coordinator
                .connect(lzEndpoint.signer)
                .lzReceive(L1_CHAIN_ID, await l2Coordinator.trustedRemoteLookup(L1_CHAIN_ID), 0, payload);
            const accAuraAfter = await l2Coordinator.accAuraRewards();
            expect(accAuraAfter.sub(accAuraBefore)).eq(simpleToExactAmount(1));
        });
        it("user get reward from BaseRewardPool and mints aura via L2Coordinator", async () => {
            const claimExtras = false;

            await increaseTime(60 * 60 * 24);

            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, alice.signer);
            const rewardsEarned = await crvRewards.earned(alice.address);
            const mintRateBefore = await l2Coordinator.mintRate();
            const auraOFTAliceBalanceBefore = await sidechain.auraOFT.balanceOf(alice.address);

            const expectedAuraMinted = rewardsEarned.mul(mintRateBefore).div(simpleToExactAmount(1));

            // When
            const tx = await crvRewards["getReward(address,bool)"](alice.address, claimExtras);

            // Calls L2Coordinator.mint(to,amount)
            await expect(tx)
                .to.emit(sidechain.auraOFT, "Transfer")
                .withArgs(l2Coordinator.address, alice.address, anyValue);

            const auraOFTAliceBalanceAfter = await sidechain.auraOFT.balanceOf(alice.address);
            const auraOFTRewards = auraOFTAliceBalanceAfter.sub(auraOFTAliceBalanceBefore);
            expect(auraOFTRewards, "rate should not change").to.gte(expectedAuraMinted);

            expect(auraOFTAliceBalanceAfter, "auraOFT alice balance").to.equal(
                auraOFTAliceBalanceBefore.add(auraOFTRewards),
            );
        });
    });

    describe("edge cases", () => {
        it("setBridgeDelegate fails if caller is not the owner", async () => {
            await expect(l2Coordinator.setBridgeDelegate(ZERO_ADDRESS), "onlyOwner").to.be.revertedWith(
                ERRORS.ONLY_OWNER,
            );
        });
        it("setConfig fails if caller is not the owner", async () => {
            const selector = ethers.utils.keccak256(toUtf8Bytes("queueNewRewards(address,uint256)"));
            await expect(
                l2Coordinator[SET_CONFIG_SELECTOR](L1_CHAIN_ID, selector, {
                    adapterParams: "0x",
                    zroPaymentAddress: DEAD_ADDRESS,
                }),
                "onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("mint fails if caller is not booster", async () => {
            await expect(l2Coordinator.mint(ZERO_ADDRESS, ZERO), "!booster").to.be.revertedWith("!booster");
        });

        it("queueNewRewards fails if caller is not booster", async () => {
            await expect(l2Coordinator.queueNewRewards(ZERO_ADDRESS, ZERO, ZERO), "!booster").to.be.revertedWith(
                "!booster",
            );
        });
        it("queueNewRewards fails bridge delegate is not set", async () => {
            const boosterAccount = await impersonateAccount(sidechain.booster.address);
            await l2Coordinator.connect(dao.signer).setBridgeDelegate(ZERO_ADDRESS);
            await expect(
                l2Coordinator.connect(boosterAccount.signer).queueNewRewards(ZERO_ADDRESS, ZERO, ZERO),
                "!bridgeDelegate",
            ).to.be.revertedWith("!bridgeDelegate");
        });
    });
});
