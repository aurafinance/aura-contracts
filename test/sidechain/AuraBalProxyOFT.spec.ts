import { expect } from "chai";
import { BigNumber, ContractTransaction, Signer } from "ethers";
import { toUtf8Bytes } from "ethers/lib/utils";
import hre, { ethers } from "hardhat";

import { DEAD_ADDRESS, impersonateAccount, simpleToExactAmount, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { Account } from "../../types";
import {
    AuraBalOFT,
    AuraBalProxyOFT,
    AuraBalProxyOFT__factory,
    AuraBalVault__factory,
    ERC20,
    OFT,
    PausableProxyOFT,
    ProxyOFT,
} from "../../types/generated";
import { OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import {
    ERRORS,
    PausableProxyOFTBehaviourContext,
    shouldBehaveLikePausableProxyOFT,
} from "../shared/PausableProxyOFT.behaviour";
import {
    L1TestSetup,
    L2TestSetup,
    SidechainDeployed,
    SideChainTestSetup,
    sidechainTestSetup,
} from "./sidechainTestSetup";

const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;

const NATIVE_FEE = simpleToExactAmount("0.2");
async function bridgeTokenFromL1ToL2(
    sender: Account,
    token: ERC20,
    proxyOFT: ProxyOFT,
    dstChainId: number,
    amount: BigNumber,
): Promise<ContractTransaction> {
    const from = sender.address;
    const to = sender.address;
    await token.connect(sender.signer).approve(proxyOFT.address, amount);
    const tx = await proxyOFT
        .connect(sender.signer)
        .sendFrom(from, dstChainId, to, amount, ZERO_ADDRESS, ZERO_ADDRESS, [], {
            value: NATIVE_FEE,
        });
    return tx;
}
describe("AuraBalProxyOFT", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;
    let guardian: Account;
    let cvxCrv: ERC20;

    // Testing contract
    let auraBalOFT: AuraBalOFT;
    let auraBalProxyOFT: AuraBalProxyOFT;
    let testSetup: SideChainTestSetup;
    let l1: L1TestSetup;
    let l2: L2TestSetup;
    let sidechain: SidechainDeployed;
    let idSnapShot: number;

    /* -- Declare shared functions -- */
    const setup = async () => {
        if (idSnapShot) {
            await hre.ethers.provider.send("evm_revert", [idSnapShot]);
            return;
        }
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[6].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID);
        ({ l1, l2 } = testSetup);
        auraBalProxyOFT = l1.canonical.auraBalProxyOFT;
        cvxCrv = l1.phase2.cvxCrv;
        ({ sidechain } = l2);
        auraBalOFT = sidechain.auraBalOFT;

        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);
        guardian = await impersonateAccount(testSetup.l2.multisigs.pauseGuardian);
        // Send some balances in order to test
        // dirty trick to get some crvCvx balance.
        const cvxCrvDepositorAccount = await impersonateAccount(testSetup.l1.phase2.crvDepositor.address);
        const cvxCrvConnected = testSetup.l1.phase2.cvxCrv.connect(cvxCrvDepositorAccount.signer);
        await cvxCrvConnected.mint(deployer.address, simpleToExactAmount(100));
        await cvxCrvConnected.mint(alice.address, simpleToExactAmount(100));

        await testSetup.l1.phase2.cvxCrv
            .connect(alice.signer)
            .approve(auraBalProxyOFT.address, ethers.constants.MaxUint256);
    };
    before(async () => {
        await setup();
    });
    describe("behaviors", async () => {
        describe("should behave like Ownable", async () => {
            const ctx: Partial<OwnableBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.owner = dao;
                    ctx.anotherAccount = alice;
                    ctx.ownable = auraBalProxyOFT;
                    return ctx as OwnableBehaviourContext;
                };
            });
            shouldBehaveLikeOwnable(() => ctx as OwnableBehaviourContext);
        });
        describe("should behave like PausableProxyOFT", async () => {
            const ctx: Partial<PausableProxyOFTBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.pausableProxyOFT = auraBalProxyOFT as unknown as PausableProxyOFT;
                    ctx.oft = auraBalOFT as unknown as OFT;
                    ctx.owner = dao;
                    ctx.guardian = guardian;
                    ctx.sudo = dao;
                    ctx.anotherAccount = alice;
                    ctx.inflowLimit = l1.mocks.addresses.sidechain.auraInflowLimit;
                    ctx.canonicalChainId = L1_CHAIN_ID;
                    ctx.sideChainId = L2_CHAIN_ID;

                    return ctx as PausableProxyOFTBehaviourContext;
                };
            });
            shouldBehaveLikePausableProxyOFT(() => ctx as PausableProxyOFTBehaviourContext);
        });
    });
    describe("constructor", async () => {
        before(async () => {
            await setup();
        });
        it("should properly store valid arguments", async () => {
            expect(await auraBalProxyOFT.vault(), "vault").to.eq(l1.vaultDeployment.vault.address);
            expect(await auraBalProxyOFT.internalTotalSupply(), "internalTotalSupply").to.eq(ZERO);
            expect(await auraBalProxyOFT.totalClaimable(l1.phase2.cvx.address), "totalClaimable cvx").to.eq(ZERO);
            expect(await auraBalProxyOFT.totalClaimable(l1.phase2.cvxCrv.address), "totalClaimable cvxCrv").to.eq(ZERO);
            expect(await auraBalProxyOFT.totalClaimable(l1.mocks.crv.address), "totalClaimable crv").to.eq(ZERO);
            expect(await auraBalProxyOFT.claimable(l1.phase2.cvx.address, L2_CHAIN_ID), "claimable cvx").to.eq(ZERO);
            expect(await auraBalProxyOFT.claimable(l1.phase2.cvxCrv.address, L2_CHAIN_ID), "claimable cvxCrv").to.eq(
                ZERO,
            );

            expect(await auraBalProxyOFT.rewardReceiver(L2_CHAIN_ID), "rewardReceiver").to.eq(
                l2.sidechain.auraBalStrategy.address,
            );
            expect(await auraBalProxyOFT.authorizedHarvesters(deployer.address), "authorizedHarvesters").to.eq(false);
            expect(await auraBalProxyOFT.ofts(l1.phase2.cvx.address), "oft cvx").to.eq(
                l1.canonical.auraProxyOFT.address,
            );
            expect(await auraBalProxyOFT.ofts(l1.phase2.cvxCrv.address), "oft cvxCrv").to.eq(
                l1.canonical.auraBalProxyOFT.address,
            );
        });
        it("fails if called with wrong arguments", async () => {
            await expect(
                new AuraBalProxyOFT__factory(deployer.signer).deploy(
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    ZERO,
                ),
                ERRORS.GUARDIAN_ZERO_ADDRESS,
            ).to.be.revertedWith(ERRORS.ENDPOINT_ZERO_ADDRESS);
        });
    });
    describe("normal flow", () => {
        it("sets configuration by selector cvxCrv", async () => {
            const processClaimableCvxCrv = auraBalProxyOFT.interface.encodeFunctionData("processClaimable", [
                cvxCrv.address,
                L1_CHAIN_ID,
                ZERO_ADDRESS,
            ]);
            const selector = ethers.utils.keccak256(toUtf8Bytes(processClaimableCvxCrv));
            const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 1000_000]);

            //   When  config is set.
            await auraBalProxyOFT.connect(dao.signer).setAdapterParams(L2_CHAIN_ID, selector, adapterParams);
            // No events
            const newAdapterParams = await auraBalProxyOFT.getAdapterParams(L2_CHAIN_ID, selector);
            expect(newAdapterParams, "adapterParams").to.be.eq(adapterParams);
        });
        it("sets configuration by selector cvx", async () => {
            const processClaimableCvxCrv = auraBalProxyOFT.interface.encodeFunctionData("processClaimable", [
                l1.phase2.cvx.address,
                L1_CHAIN_ID,
                ZERO_ADDRESS,
            ]);
            const selector = ethers.utils.keccak256(toUtf8Bytes(processClaimableCvxCrv));
            const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 1000_000]);

            //   When  config is set.
            await auraBalProxyOFT.connect(dao.signer).setAdapterParams(L2_CHAIN_ID, selector, adapterParams);
            // No events
            const newAdapterParams = await auraBalProxyOFT.getAdapterParams(L2_CHAIN_ID, selector);
            expect(newAdapterParams, "adapterParams").to.be.eq(adapterParams);
        });
        it("sets reward receiver by srcChainId", async () => {
            const rewardReceiverBefore = await auraBalProxyOFT.rewardReceiver(L2_CHAIN_ID);
            expect(rewardReceiverBefore, "rewardReceiver").to.not.be.eq(DEAD_ADDRESS);

            //   When  config is set.
            await auraBalProxyOFT.setRewardReceiver(L2_CHAIN_ID, DEAD_ADDRESS);
            // No events
            expect(await auraBalProxyOFT.rewardReceiver(L2_CHAIN_ID), "rewardReceiver").to.be.eq(DEAD_ADDRESS);
        });
        it("sets authorized Harvesters", async () => {
            const authorizedHarvestersBefore = await auraBalProxyOFT.authorizedHarvesters(deployer.address);
            expect(authorizedHarvestersBefore, "authorizedHarvesters").to.be.eq(false);

            //   When  config is set.
            await auraBalProxyOFT.updateAuthorizedHarvesters(deployer.address, true);
            // No events
            expect(await auraBalProxyOFT.authorizedHarvesters(deployer.address), "authorizedHarvesters").to.be.eq(true);
        });
        it("sets OFT / token configuration", async () => {
            const oftBefore = await auraBalProxyOFT.ofts(l1.mocks.crv.address);
            expect(oftBefore, "oft").to.not.be.eq(DEAD_ADDRESS);

            //   When  config is set.
            await auraBalProxyOFT.setOFT(l1.mocks.crv.address, DEAD_ADDRESS);
            // No events
            expect(await auraBalProxyOFT.ofts(l1.mocks.crv.address), "ofts").to.be.eq(DEAD_ADDRESS);
        });
        it("sets harvest SrcChainIds", async () => {
            //   When  config is set.
            await auraBalProxyOFT.setHarvestSrcChainIds([L1_CHAIN_ID, L2_CHAIN_ID]);
            // No events
            expect(await auraBalProxyOFT.harvestSrcChainIds(0), "harvestSrcChainIds").to.be.eq(L1_CHAIN_ID);
            expect(await auraBalProxyOFT.harvestSrcChainIds(1), "harvestSrcChainIds").to.be.eq(L2_CHAIN_ID);
        });
        it("rescue cvxCrv token", async () => {
            const amount = simpleToExactAmount(10);
            await bridgeTokenFromL1ToL2(
                deployer,
                cvxCrv,
                l1.canonical.auraBalProxyOFT as unknown as ProxyOFT,
                L2_CHAIN_ID,
                amount.mul(2),
            );

            const internalTotalSupplyBefore = await auraBalProxyOFT.internalTotalSupply();
            await cvxCrv.transfer(auraBalProxyOFT.address, amount);
            const balanceOfAuraBalProxyOFTBefore = await cvxCrv.balanceOf(auraBalProxyOFT.address);
            const balanceOfDeployerBefore = await cvxCrv.balanceOf(deployer.address);

            // When rescue
            await auraBalProxyOFT.connect(dao.signer).rescue(cvxCrv.address, deployer.address, amount);

            // Tokens are transferred out of the bridge
            expect(await cvxCrv.balanceOf(auraBalProxyOFT.address), "balance").to.be.eq(balanceOfAuraBalProxyOFTBefore);
            expect(await cvxCrv.balanceOf(deployer.address), "rescue amount").to.be.eq(
                balanceOfDeployerBefore.add(amount),
            );
            expect(await auraBalProxyOFT.internalTotalSupply(), "internalTotalSupply").to.be.eq(
                internalTotalSupplyBefore.sub(amount),
            );
        });
    });
    describe("edge cases", () => {
        it("setConfig fails if caller is not the owner", async () => {
            const selector = ethers.utils.keccak256(toUtf8Bytes("processClaimable(address,uint16)"));
            await expect(
                auraBalProxyOFT.connect(alice.signer).setAdapterParams(L2_CHAIN_ID, selector, "0x"),
                "onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("setOFT fails if caller is not the owner", async () => {
            await expect(
                auraBalProxyOFT.connect(alice.signer).setOFT(l1.mocks.crv.address, DEAD_ADDRESS),
                "onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("setRewardReceiver fails if caller is not the owner", async () => {
            await expect(
                auraBalProxyOFT.connect(alice.signer).setRewardReceiver(L2_CHAIN_ID, ZERO_ADDRESS),
                "onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("setHarvestSrcChainIds fails if caller is not the owner", async () => {
            await expect(
                auraBalProxyOFT.connect(alice.signer).setHarvestSrcChainIds([L2_CHAIN_ID]),
                "onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("updateAuthorizedHarvesters fails if caller is not the owner", async () => {
            await expect(
                auraBalProxyOFT.connect(alice.signer).updateAuthorizedHarvesters(ZERO_ADDRESS, true),
                "onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("processClaimable fails if oft is not set", async () => {
            // Make sure all configurations are set on L2 to enable harvest
            await auraBalProxyOFT.setHarvestSrcChainIds([L2_CHAIN_ID]);
            await auraBalProxyOFT.setRewardReceiver(L2_CHAIN_ID, sidechain.auraBalStrategy.address);
            await auraBalProxyOFT.connect(dao.signer).updateAuthorizedHarvesters(deployer.address, true);

            // Bridge auraBal to L2, deposit into the l2 vault.
            const bridgeAmount = simpleToExactAmount(10);
            await bridgeTokenFromL1ToL2(
                deployer,
                cvxCrv,
                l1.canonical.auraBalProxyOFT as unknown as ProxyOFT,
                L2_CHAIN_ID,
                bridgeAmount,
            );
            await sidechain.auraBalOFT.approve(sidechain.auraBalVault.address, ethers.constants.MaxUint256);
            await sidechain.auraBalVault.deposit(bridgeAmount.div(4), deployer.address);

            // Harvest and the process all claimable.
            const totalUnderlyings = [await sidechain.auraBalVault.totalUnderlying()];
            const totalUnderlyingSum = await sidechain.auraBalVault.totalUnderlying();
            await auraBalProxyOFT.connect(deployer.signer).harvest(totalUnderlyings, totalUnderlyingSum);

            // Make sure the oft is not set
            await auraBalProxyOFT.connect(dao.signer).setOFT(cvxCrv.address, ZERO_ADDRESS),
                await expect(
                    auraBalProxyOFT.processClaimable(cvxCrv.address, L2_CHAIN_ID, ZERO_ADDRESS, {
                        value: NATIVE_FEE,
                    }),
                    "oft != address(0)",
                ).to.be.revertedWith("!oft");

            // Sets the wrong OFT for cvxCrv
            await auraBalProxyOFT.connect(dao.signer).setOFT(cvxCrv.address, DEAD_ADDRESS),
                await expect(
                    auraBalProxyOFT.processClaimable(cvxCrv.address, L2_CHAIN_ID, ZERO_ADDRESS, {
                        value: NATIVE_FEE,
                    }),
                    "oft != address(0)",
                ).to.be.revertedWith("!oft");
        });
        it("processClaimable fails if reward receiver is not set", async () => {
            const SUPER_CHAIN_ID = 999;
            expect(await auraBalProxyOFT.rewardReceiver(SUPER_CHAIN_ID), "reward receiver").to.be.eq(ZERO_ADDRESS);
            await expect(
                auraBalProxyOFT.processClaimable(ZERO_ADDRESS, SUPER_CHAIN_ID, ZERO_ADDRESS),
                "receiver != address(0)",
            ).to.be.revertedWith("0");
        });
        it("processClaimable fails if there are no rewards", async () => {
            const SUPER_CHAIN_ID = 999;
            await auraBalProxyOFT.setRewardReceiver(SUPER_CHAIN_ID, DEAD_ADDRESS);
            await expect(
                auraBalProxyOFT.processClaimable(ZERO_ADDRESS, SUPER_CHAIN_ID, ZERO_ADDRESS),
                "reward > 0",
            ).to.be.revertedWith("!reward");
        });
        it("harvest rewards from auraBalVault wrong parameters length ", async () => {
            await expect(
                auraBalProxyOFT.connect(deployer.signer).harvest([100, 100, 100, 100, 100, 100], 100),
            ).to.be.revertedWith("!parity");
        });
        it("harvest rewards from auraBalVault correct chain wrong totalUnderlying = ZERO", async () => {
            await expect(auraBalProxyOFT.connect(deployer.signer).harvest([100], 0)).to.be.reverted;
        });
        it("harvest fails when caller is not authorized", async () => {
            await auraBalProxyOFT.updateAuthorizedHarvesters(deployer.address, false);
            expect(await auraBalProxyOFT.authorizedHarvesters(deployer.address)).eq(false);
            await expect(auraBalProxyOFT.harvest([100], 100)).to.be.revertedWith("!harvester");
        });
        it("vaultExecute fails if caller is not the owner", async () => {
            const setWithdrawalPenalty = AuraBalVault__factory.createInterface().encodeFunctionData(
                "setWithdrawalPenalty",
                [ZERO],
            );
            await expect(
                auraBalProxyOFT.connect(alice.signer).vaultExecute(ZERO, setWithdrawalPenalty),
                "onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
    });

    // All test coverage is tested in bundle at test/sidechain/AuraBalOFT.spec.ts
    // No need to add more tests here in isolation.
});
