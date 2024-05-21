import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";

import { DEAD_ADDRESS, impersonateAccount, simpleToExactAmount, ZERO_ADDRESS } from "../../test-utils";
import { Account } from "../../types";
import {
    L1PoolManagerProxy,
    L2PoolManagerProxy,
    MockCurveGauge__factory,
    MockERC20__factory,
    MockStakelessGauge__factory,
} from "../../types/generated";
import { OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import {
    CanonicalPhaseDeployed,
    SidechainDeployed,
    SideChainTestSetup,
    sidechainTestSetup,
} from "./sidechainTestSetup";

const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;

describe("L1PoolManagerProxy", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;

    // Testing contract
    let l1PoolManagerProxy: L1PoolManagerProxy;
    let l2PoolManagerProxy: L2PoolManagerProxy;
    let testSetup: SideChainTestSetup;
    let sidechain: SidechainDeployed;
    let canonical: CanonicalPhaseDeployed;
    let idSnapShot: number;

    /* -- Declare shared functions -- */
    const setup = async () => {
        hre.tracer.enabled = false;
        if (idSnapShot) {
            await hre.ethers.provider.send("evm_revert", [idSnapShot]);
            idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
            return;
        }
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID);
        sidechain = testSetup.l2.sidechain;
        canonical = testSetup.l1.canonical;
        l1PoolManagerProxy = canonical.l1PoolManagerProxy;
        l2PoolManagerProxy = sidechain.l2PoolManagerProxy;
        dao = await impersonateAccount(testSetup.l1.multisigs.daoMultisig);

        idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
    };

    const deploySidechainGauge = async (name: string, weight = 0) => {
        const lptoken = await new MockERC20__factory(deployer.signer).deploy(
            `lp-${name}`,
            `lp-${name}`,
            18,
            deployer.address,
            10000000,
        );
        const sidechainGauge = await new MockCurveGauge__factory(deployer.signer).deploy(
            `l2-${name}`,
            `l2-${name}`,
            lptoken.address,
            [],
        );
        const rootGauge = await new MockStakelessGauge__factory(deployer.signer).deploy(sidechainGauge.address);
        await testSetup.l1.mocks.voting.vote_for_gauge_weights(rootGauge.address, weight);
        console.log(
            "rootGauge",
            rootGauge.address,
            "sidechainGauge",
            sidechainGauge.address,
            "lptoken",
            lptoken.address,
        );
        return { rootGauge, sidechainGauge, lptoken };
    };
    before("init contract", async () => {
        await setup();
    });
    after(async () => {
        await hre.ethers.provider.send("evm_revert", [idSnapShot]);
    });
    describe("behaviors", async () => {
        describe("should behave like Ownable ", async () => {
            const ctx: Partial<OwnableBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.owner = dao;
                    ctx.anotherAccount = alice;
                    ctx.ownable = l1PoolManagerProxy;
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
            expect(await l1PoolManagerProxy.lzChainId(), "lzChainId").to.eq(L1_CHAIN_ID);
            expect(await l1PoolManagerProxy.protectAddPool(), "protectAddPool").to.eq(true);
            expect(await l1PoolManagerProxy.owner(), "owner").to.eq(dao.address);
        });
    });
    describe("configuration ", async () => {
        it("DAO - sets setTrustedRemoteAddress on l1PoolManagerProxy", async () => {
            const expectedTrustedRemote = (
                l2PoolManagerProxy.address + l1PoolManagerProxy.address.slice(2)
            ).toLowerCase();
            //   When  config is set.
            await l1PoolManagerProxy
                .connect(dao.signer)
                .setTrustedRemoteAddress(L2_CHAIN_ID, l2PoolManagerProxy.address);
            // No events
            const trustedRemote = await l1PoolManagerProxy.trustedRemoteLookup(L2_CHAIN_ID);
            expect(trustedRemote, "trustedRemote").to.be.eq(expectedTrustedRemote);
        });
        it("DAO - sets setTrustedRemoteAddress on l2PoolManagerProxy", async () => {
            const expectedTrustedRemote = (
                l1PoolManagerProxy.address + l2PoolManagerProxy.address.slice(2)
            ).toLowerCase();
            //   When  config is set.
            await l2PoolManagerProxy
                .connect(dao.signer)
                .setTrustedRemoteAddress(L1_CHAIN_ID, l1PoolManagerProxy.address);
            // No events
            const trustedRemote = await l2PoolManagerProxy.trustedRemoteLookup(L1_CHAIN_ID);
            expect(trustedRemote, "trustedRemote").to.be.eq(expectedTrustedRemote);
        });
        it("DAO - updates sidechain poolManager ", async () => {
            expect(await sidechain.poolManager.operator(), "operator DAO").to.be.eq(dao.address);

            await sidechain.poolManager.connect(dao.signer).setOperator(l2PoolManagerProxy.address);

            expect(await sidechain.poolManager.operator(), "operator l2PoolManagerProxy").to.be.eq(
                l2PoolManagerProxy.address,
            );
        });
    });

    describe("addPool", async () => {
        it("from mainnet to sidechain add pool", async () => {
            // const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 1000_000]);
            const adapterParams = "0x";
            const { rootGauge, sidechainGauge } = await deploySidechainGauge("mock", 1);
            // hre.tracer.enabled = true;
            const tx = await l1PoolManagerProxy
                .connect(dao.signer)
                .addPool(rootGauge.address, L2_CHAIN_ID, ZERO_ADDRESS, adapterParams, { value: NATIVE_FEE });
            await expect(tx)
                .to.emit(l1PoolManagerProxy, "AddSidechainPool")
                .withArgs(L2_CHAIN_ID, rootGauge.address, sidechainGauge.address);
            await expect(tx).to.emit(l1PoolManagerProxy, "PoolAdded");
        });
    });
    // describe("edge cases", () => {
    //     describe("add pool", async () => {
    //         it("fails when protected pool is true, caller is not owner", async () => {
    //             await expect(
    //                 l1PoolManagerProxy.addPool(999, ZERO_ADDRESS, ZERO_ADDRESS, [], { value: NATIVE_FEE.mul(2) }),
    //                 "wrong chain",
    //             ).to.be.revertedWith("SafeMath: division by zero");
    //         });
    //         it("fails when dstChainId has no trusted remote is set", async () => {
    //             await expect(
    //                 l1PoolManagerProxy.addPool(L2_CHAIN_ID, ZERO_ADDRESS, ZERO_ADDRESS, []),
    //                 "!feeAmount",
    //             ).to.be.revertedWith("!feeAmount");
    //         });
    //         it("fails when dstChainId is wrong", async () => {
    //             await expect(
    //                 l1PoolManagerProxy.addPool(L2_CHAIN_ID, ZERO_ADDRESS, ZERO_ADDRESS, []),
    //                 "!feeAmount",
    //             ).to.be.revertedWith("!feeAmount");
    //         });
    //         it("fails when root gauge is wrong", async () => {
    //             await expect(
    //                 l1PoolManagerProxy
    //                     .connect(alice.signer)
    //                     .addPool(999, ZERO_ADDRESS, ZERO_ADDRESS, [], { value: NATIVE_FEE.mul(2) }),
    //                 "onlyDistributor",
    //             ).to.be.revertedWith("!distributor");
    //         });
    //         it("fails if pool is already added", async () => {
    //             await expect(
    //                 l1PoolManagerProxy.connect(alice.signer).addPool(DEAD_ADDRESS, true),
    //                 "onlyOwner",
    //             ).to.be.revertedWith(ERRORS.ONLY_OWNER);
    //         });
    //         it("fails if pool has no weights", async () => {
    //             await sidechain.booster.connect(alice.signer).earmarkRewards(0, ZERO_ADDRESS, { value: 0 });
    //             await sidechain.l2Coordinator.connect(alice.signer).notifyFees(ZERO_ADDRESS, { value: NATIVE_FEE });
    //             const feeDebtOf = await l1PoolManagerProxy.feeDebtOf(L2_CHAIN_ID);
    //             expect(feeDebtOf).to.be.gt(ZERO);
    //             // Make sure the L2 coordinator is not set.
    //             await l1PoolManagerProxy.connect(dao.signer).setL2Coordinator(L2_CHAIN_ID, ZERO_ADDRESS);
    //             await expect(
    //                 l1PoolManagerProxy.addPool(L2_CHAIN_ID, ZERO_ADDRESS, ZERO_ADDRESS, [], {
    //                     value: NATIVE_FEE.mul(2),
    //                 }),
    //                 "wrong chain",
    //             ).to.be.revertedWith("to can not be zero");
    //         });
    //     });
    // });
});
