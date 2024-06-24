import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";

import { impersonateAccount, simpleToExactAmount, ZERO_ADDRESS } from "../../test-utils";
import { Account } from "../../types";
import {
    L1PoolManagerProxy,
    L2PoolManagerProxy,
    MockCurveGauge__factory,
    MockERC20__factory,
    MockGaugeCheckpointer,
    MockGaugeCheckpointer__factory,
    MockStakelessGauge,
    MockStakelessGauge__factory,
} from "../../types/generated";
import { ERRORS, OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import {
    CanonicalPhaseDeployed,
    SidechainDeployed,
    SideChainTestSetup,
    sidechainTestSetup,
} from "./sidechainTestSetup";

describe("L1PoolManagerProxy", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;
    let keeper: Account;

    let gaugeCheckPointer: MockGaugeCheckpointer;
    // Testing contract
    let l1PoolManagerProxy: L1PoolManagerProxy;
    let l2PoolManagerProxy: L2PoolManagerProxy;
    let testSetup: SideChainTestSetup;
    let sidechain: SidechainDeployed;
    let canonical: CanonicalPhaseDeployed;
    let rootGauge0: MockStakelessGauge;

    let idSnapShot: number;

    const NATIVE_FEE = simpleToExactAmount("3");
    const L1_CHAIN_ID = 111;
    const L2_CHAIN_ID = 222;
    const L2_BALANCER_GAUGE_TYPE = "Sidechain";
    const minDstGas = 5_500_000;
    const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, minDstGas]);

    /* -- Declare shared functions -- */
    const setup = async () => {
        if (idSnapShot) {
            await hre.ethers.provider.send("evm_revert", [idSnapShot]);
            idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
            return;
        }
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());
        keeper = await impersonateAccount(await accounts[7].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID);
        sidechain = testSetup.l2.sidechain;
        canonical = testSetup.l1.canonical;
        l1PoolManagerProxy = canonical.l1PoolManagerProxy;
        l2PoolManagerProxy = sidechain.l2PoolManagerProxy;

        dao = await impersonateAccount(testSetup.l1.multisigs.daoMultisig);
        gaugeCheckPointer = MockGaugeCheckpointer__factory.connect(
            testSetup.l1.mocks.addresses.gaugeCheckpointer,
            deployer.signer,
        );

        ({ rootGauge: rootGauge0 } = await deploySidechainGauge("mock", 1));

        idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
    };

    const deploySidechainGauge = async (name: string, weight = 0) => {
        const lptoken = await new MockERC20__factory(deployer.signer).deploy(
            `mk-lp-${name}`,
            `mk`,
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
        await gaugeCheckPointer.addGauges(L2_BALANCER_GAUGE_TYPE, [rootGauge.address]);

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
        it("DAO - sets keeper on l1PoolManagerProxy", async () => {
            //   When  config is set.
            await l1PoolManagerProxy.connect(dao.signer).updateAuthorizedKeepers(keeper.address, true);
            // No events
            const authorizedKeepers = await l1PoolManagerProxy.authorizedKeepers(keeper.address);
            expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
        });
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
        it("DAO - sets setGaugeTypes on l1PoolManagerProxy", async () => {
            //   When  config is set.
            await l1PoolManagerProxy.connect(dao.signer).setGaugeType(L2_CHAIN_ID, L2_BALANCER_GAUGE_TYPE);
            // No events
            const gaugeType = await l1PoolManagerProxy.gaugeTypes(L2_CHAIN_ID);
            expect(gaugeType, "gaugeType").to.be.eq(L2_BALANCER_GAUGE_TYPE);
        });
        it("DAO - sets minDestination gas on l1PoolManagerProxy", async () => {
            //   When  config is set.
            await l1PoolManagerProxy.connect(dao.signer).setMinDstGas(L2_CHAIN_ID, 0, minDstGas);
            // No events
            const minDstGasLookup = await l1PoolManagerProxy.minDstGasLookup(L2_CHAIN_ID, 0);
            expect(minDstGasLookup, "minDstGas").to.be.eq(minDstGas);
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
        it("DAO - setProtectPool on l1PoolManagerProxy", async () => {
            const expectedprotectAddPool = true;
            //   When  config is set.
            await l1PoolManagerProxy.connect(dao.signer).setProtectPool(expectedprotectAddPool);

            const protectAddPool = await l1PoolManagerProxy.protectAddPool();
            expect(protectAddPool, "protectAddPool").to.be.eq(expectedprotectAddPool);
        });
    });

    describe("addPool", async () => {
        it("from mainnet to sidechain add pool", async () => {
            const { rootGauge, sidechainGauge } = await deploySidechainGauge("mock", 1);

            // Removes protection so anyone can add pools
            await l1PoolManagerProxy.connect(dao.signer).setProtectPool(false);
            const tx = await l1PoolManagerProxy
                .connect(deployer.signer)
                .addPools([rootGauge.address], L2_CHAIN_ID, ZERO_ADDRESS, adapterParams, {
                    value: NATIVE_FEE,
                    gasLimit: minDstGas,
                });
            await expect(tx)
                .to.emit(l1PoolManagerProxy, "AddSidechainPool")
                .withArgs(L2_CHAIN_ID, rootGauge.address, sidechainGauge.address);
            await expect(tx).to.emit(sidechain.booster, "PoolAdded");
        });
    });
    describe("edge cases", () => {
        describe("configurations", async () => {
            it("fails to protected pool, caller is not owner", async () => {
                await expect(
                    l1PoolManagerProxy.connect(deployer.signer).setProtectPool(false),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("fails setGaugeType, caller is not owner", async () => {
                await expect(
                    l1PoolManagerProxy.connect(deployer.signer).setGaugeType(L2_CHAIN_ID, L2_BALANCER_GAUGE_TYPE),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
        });
        describe("add pool", async () => {
            it("fails when protected pool is true, caller is not keeper", async () => {
                await l1PoolManagerProxy.connect(dao.signer).setProtectPool(true);
                await expect(
                    l1PoolManagerProxy
                        .connect(alice.signer)
                        .addPool(rootGauge0.address, L2_CHAIN_ID, ZERO_ADDRESS, adapterParams, {
                            value: NATIVE_FEE,
                            gasLimit: minDstGas,
                        }),
                    "!keeper",
                ).to.be.revertedWith("!keeper");
                await l1PoolManagerProxy.connect(dao.signer).setProtectPool(false);
            });
            it("fails if adapter params is not set", async () => {
                await expect(
                    l1PoolManagerProxy
                        .connect(keeper.signer)
                        .addPool(rootGauge0.address, L2_CHAIN_ID, ZERO_ADDRESS, "0x"),
                    "!adapterParams",
                ).to.be.revertedWith("LzApp: invalid adapterParams");
            });
            it("fails when dstChainId is same as lzChainId", async () => {
                await l1PoolManagerProxy.connect(dao.signer).setMinDstGas(L1_CHAIN_ID, 0, minDstGas);
                await expect(
                    l1PoolManagerProxy.addPools([ZERO_ADDRESS], L1_CHAIN_ID, ZERO_ADDRESS, adapterParams, {
                        value: NATIVE_FEE,
                        gasLimit: minDstGas,
                    }),
                    "!dstChainId",
                ).to.be.revertedWith("!dstChainId");
            });
            it("fails when dstChainId is not configured", async () => {
                await l1PoolManagerProxy.connect(dao.signer).setMinDstGas(333, 0, minDstGas);
                await expect(
                    l1PoolManagerProxy.addPool(ZERO_ADDRESS, 333, ZERO_ADDRESS, adapterParams, {
                        value: NATIVE_FEE,
                        gasLimit: minDstGas,
                    }),
                    "!gaugeType",
                ).to.be.revertedWith("!gaugeType");
            });
            it("fails when dstChainId and root gauge are not configured on balancer", async () => {
                await expect(
                    l1PoolManagerProxy.addPool(ZERO_ADDRESS, L2_CHAIN_ID, ZERO_ADDRESS, adapterParams),
                    "!checkpointer",
                ).to.be.revertedWith("!checkpointer");
            });
            it("fails when root gauge does not have weight", async () => {
                const { rootGauge } = await deploySidechainGauge("mock", 0);

                await expect(
                    l1PoolManagerProxy.addPool(rootGauge.address, L2_CHAIN_ID, ZERO_ADDRESS, adapterParams, {
                        value: NATIVE_FEE,
                        gasLimit: minDstGas,
                    }),
                    "must have weight",
                ).to.be.revertedWith("must have weight");
            });
            it("fails if pool is already added", async () => {
                const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 20_000_000]);
                const { rootGauge, sidechainGauge } = await deploySidechainGauge("mock02", 2);

                let tx = await l1PoolManagerProxy
                    .connect(dao.signer)
                    .addPool(rootGauge.address, L2_CHAIN_ID, ZERO_ADDRESS, adapterParams, {
                        value: NATIVE_FEE,
                        gasLimit: minDstGas,
                    });

                await expect(tx).to.emit(sidechain.booster, "PoolAdded");

                tx = await l1PoolManagerProxy
                    .connect(dao.signer)
                    .addPool(rootGauge.address, L2_CHAIN_ID, ZERO_ADDRESS, adapterParams, {
                        value: NATIVE_FEE,
                        gasLimit: minDstGas,
                    });
                await expect(tx)
                    .to.emit(l1PoolManagerProxy, "AddSidechainPool")
                    .withArgs(L2_CHAIN_ID, rootGauge.address, sidechainGauge.address);
                await expect(tx).to.emit(sidechain.l2PoolManagerProxy, "MessageFailed");
                await expect(tx).to.not.emit(sidechain.booster, "PoolAdded");
            });
        });
    });
});
