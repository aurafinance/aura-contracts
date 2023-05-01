import { expect } from "chai";
import { BigNumber, Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { CanonicalPhaseDeployed } from "scripts/deploySidechain";
import {
    DEAD_ADDRESS,
    impersonateAccount,
    increaseTime,
    ONE_WEEK,
    simpleToExactAmount,
    ZERO,
    ZERO_ADDRESS,
} from "../../test-utils";
import shouldBehaveLikeERC20, { IERC20BehaviourContext } from "../../test/shared/ERC20.behaviour";
import { Account } from "../../types";
import { AuraOFT, ERC20, ProxyOFT } from "../../types/generated";
import { ERRORS, OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import { SideChainTestSetup, sidechainTestSetup } from "./sidechainTestSetup";
const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;

async function bridgeTokenFromL1ToL2(
    sender: Account,
    token: ERC20,
    proxyOFT: ProxyOFT,
    dstChainId: number,
    amount: BigNumber,
) {
    const from = sender.address;
    const to = sender.address;
    await token.connect(sender.signer).approve(proxyOFT.address, amount);
    await proxyOFT.connect(sender.signer).sendFrom(from, dstChainId, to, amount, ZERO_ADDRESS, ZERO_ADDRESS, [], {
        value: NATIVE_FEE,
    });
}
describe("AuraOFT", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;
    let cvx: ERC20;

    // Testing contract
    let auraOFT: AuraOFT;
    let testSetup: SideChainTestSetup;
    let canonical: CanonicalPhaseDeployed;

    const SET_CONFIG_SELECTOR = "setConfig(uint16,bytes4,(bytes,address))";
    /* -- Declare shared functions -- */
    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID);
        auraOFT = testSetup.l2.sidechain.auraOFT;
        canonical = testSetup.l1.canonical;
        cvx = testSetup.l1.phase2.cvx;
        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);
        // Send some balances in order to test
        // dirty trick to get some cvx balance.
        const cvxDepositorAccount = await impersonateAccount(testSetup.l1.phase2.vestedEscrows[0].address);
        const cvxConnected = testSetup.l1.phase2.cvx.connect(cvxDepositorAccount.signer);
        const cvxBalance = await cvxConnected.balanceOf(cvxDepositorAccount.address);
        await cvxConnected.transfer(deployer.address, cvxBalance);
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
                    ctx.ownable = auraOFT;
                    return ctx as OwnableBehaviourContext;
                };
            });
            shouldBehaveLikeOwnable(() => ctx as OwnableBehaviourContext);
        });
        describe("should behave like ERC20 ", async () => {
            const ctx: Partial<IERC20BehaviourContext> = {};
            const initialSupply = simpleToExactAmount(2);

            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.token = auraOFT;
                    ctx.initialHolder = deployer;
                    ctx.recipient = alice;
                    ctx.anotherAccount = dao;

                    // Initial supply of auraOFT by locking aura on L1 and bridge it to L2
                    await bridgeTokenFromL1ToL2(
                        deployer,
                        testSetup.l1.phase2.cvx,
                        canonical.auraProxyOFT,
                        L2_CHAIN_ID,
                        initialSupply,
                    );
                };
                await ctx.fixture();
            });
            shouldBehaveLikeERC20(() => ctx as IERC20BehaviourContext, "ERC20", initialSupply);
        });
    });
    describe("constructor", async () => {
        before(async () => {
            await setup();
        });
        it("should properly store valid arguments", async () => {
            expect(await auraOFT.canonicalChainId(), "canonicalChainId").to.eq(L1_CHAIN_ID);
            // oFTCore
            expect(await auraOFT.NO_EXTRA_GAS(), "NO_EXTRA_GAS").to.eq(0);
            expect(await auraOFT.PT_SEND(), "PT_SEND").to.eq(0);
            expect(await auraOFT.useCustomAdapterParams(), "useCustomAdapterParams").to.eq(false);
            // nonblockingLzApp
            // expect(await auraOFT.failedMessages(), "failedMessages").to.eq("TODO");
            // lzApp
            expect(await auraOFT.DEFAULT_PAYLOAD_SIZE_LIMIT(), "DEFAULT_PAYLOAD_SIZE_LIMIT").to.eq(10000);
            expect(await auraOFT.lzEndpoint(), "lzEndpoint").to.eq(testSetup.l2.mocks.addresses.lzEndpoint);
            // expect(await auraOFT.minDstGasLookup(), "minDstGasLookup").to.eq("TODO");
            expect(await auraOFT.precrime(), "precrime").to.eq(ZERO_ADDRESS);
        });
        it("should be initialized", async () => {
            expect(await auraOFT.totalSupply(), "totalSupply").to.eq(0);
            expect(await auraOFT.circulatingSupply(), "circulatingSupply").to.eq(0);
            expect(await auraOFT.token(), "token").to.eq(auraOFT.address);
            expect(await auraOFT.symbol(), "symbol").to.eq(testSetup.l2.mocks.namingConfig.auraOftSymbol);
            expect(await auraOFT.owner(), "owner").to.eq(dao.address);
            expect(await auraOFT.name(), "name").to.eq(testSetup.l2.mocks.namingConfig.auraOftName);
            expect(await auraOFT.decimals(), "decimals").to.eq(18);
            expect(await auraOFT.trustedRemoteLookup(await auraOFT.canonicalChainId()), "trustedRemoteLookup").to.not.be
                .empty;
            expect(
                await auraOFT.payloadSizeLimitLookup(await auraOFT.canonicalChainId()),
                "payloadSizeLimitLookup",
            ).to.eq(0);
        });
    });
    describe("setConfig", async () => {
        // CrossChainConfig
        it("sets configuration by selector", async () => {
            const lockSelector = auraOFT.interface.getSighash("lock");
            const lockConfig = {
                adapterParams: ethers.utils.solidityPack(["uint16", "uint256"], [1, 1000_000]),
                zroPaymentAddress: DEAD_ADDRESS,
            };

            //   When  config is set.
            await auraOFT.connect(dao.signer)[SET_CONFIG_SELECTOR](L1_CHAIN_ID, lockSelector, lockConfig);
            // No events
            const newConfig = await auraOFT.configs(L1_CHAIN_ID, lockSelector);
            expect(newConfig.adapterParams, "adapterParams").to.be.eq(lockConfig.adapterParams);
            expect(newConfig.zroPaymentAddress, "zroPaymentAddress").to.be.eq(lockConfig.zroPaymentAddress);
        });
        it("fails if caller is not the owner", async () => {
            await expect(
                auraOFT[SET_CONFIG_SELECTOR](L1_CHAIN_ID, "0xdd467064", {
                    adapterParams: "0x",
                    zroPaymentAddress: DEAD_ADDRESS,
                }),
                "fails due to ",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
    });
    describe("lock", async () => {
        const amount = simpleToExactAmount(1);
        it("bridge tokens from L1 to L2", async () => {
            const auraBalanceBefore = await cvx.balanceOf(deployer.address);
            const auraOFTBalanceBefore = await auraOFT.balanceOf(deployer.address);
            await bridgeTokenFromL1ToL2(deployer, testSetup.l1.phase2.cvx, canonical.auraProxyOFT, L2_CHAIN_ID, amount);
            const auraBalanceAfter = await cvx.balanceOf(deployer.address);
            const auraOFTBalanceAfter = await auraOFT.balanceOf(deployer.address);

            expect(auraBalanceAfter, "balance aura").to.be.eq(auraBalanceBefore.sub(amount));
            expect(auraOFTBalanceAfter, "balance auraOFT").to.be.eq(auraOFTBalanceBefore.add(amount));
        });

        it("should lock from L2 to L1 staking it on cvxLocker", async () => {
            // AuraOFT.lock => AuraProxyOFT.lzReceive => AuraLocker.lock
            const stakedBefore = await testSetup.l1.phase2.cvxLocker.totalSupply();

            const auraOFTBalance = await auraOFT.balanceOf(deployer.address);
            expect(auraOFTBalance, "bridge amount").to.be.eq(amount);
            // Lock
            const tx = await auraOFT.connect(deployer.signer).lock(auraOFTBalance, { value: NATIVE_FEE });
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(auraOFT, "Transfer").withArgs(deployer.address, ZERO_ADDRESS, amount);
            await expect(tx)
                .to.emit(testSetup.l1.phase2.cvx, "Transfer")
                .withArgs(canonical.auraProxyOFT.address, testSetup.l1.phase2.cvxLocker.address, amount);
            await expect(tx)
                .to.emit(testSetup.l1.phase2.cvxLocker, "Staked")
                .withArgs(deployer.address, amount, amount);

            await increaseTime(ONE_WEEK);
            const stakedAfter = await testSetup.l1.phase2.cvxLocker.totalSupply();
            expect(stakedAfter, "staked").to.be.eq(stakedBefore.add(amount));
        });
        it("fails if sender has no balance", async () => {
            await expect(auraOFT.lock(1), "no balance").to.be.revertedWith("ERC20: burn amount exceeds balance");
        });
        it("fails if no fee is sent", async () => {
            await bridgeTokenFromL1ToL2(deployer, testSetup.l1.phase2.cvx, canonical.auraProxyOFT, L2_CHAIN_ID, amount);
            await expect(auraOFT.lock(amount), "native fee").to.be.revertedWith(
                "LayerZeroMock: not enough native for fees",
            );
        });
        it("fails if amount is zero", async () => {
            await expect(auraOFT.lock(ZERO, { value: NATIVE_FEE }), "zero amount").to.be.revertedWith("!amount");
        });
    });
});
