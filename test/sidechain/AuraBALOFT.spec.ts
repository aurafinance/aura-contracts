import { parseEther } from "@ethersproject/units";
import { expect } from "chai";
import { BigNumber, ContractTransaction, Signer } from "ethers";
import { formatEther } from "ethers/lib/utils";
import hre, { ethers } from "hardhat";
import { table } from "table";

import {
    anyValue,
    BN,
    impersonateAccount,
    increaseTime,
    ONE_WEEK,
    simpleToExactAmount,
    ZERO,
    ZERO_ADDRESS,
} from "../../test-utils";
import { Account } from "../../types";
import {
    AuraBalOFT,
    AuraBalProxyOFT,
    AuraBalVault,
    AuraBalVault__factory,
    ERC20,
    MockERC20__factory,
    PausableOFT,
    ProxyOFT,
    VirtualBalanceRewardPool__factory,
} from "../../types/generated";
import shouldBehaveLikeERC20, { IERC20BehaviourContext } from "../shared/ERC20.behaviour";
import { OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import { PausableOFTBehaviourContext, shouldBehaveLikePausableOFT } from "../shared/PausableOFT.behaviour";
import {
    CanonicalPhaseDeployed,
    deployL2,
    SidechainDeployed,
    SideChainTestSetup,
    sidechainTestSetup,
} from "./sidechainTestSetup";

const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const debug = false;
const toPrecision17 = (n: BN) => n.div(10).mul(10);

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
describe("AuraBalOFT", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;
    let auraBalVaultOwner: Account;
    let guardian: Account;
    const sideChainIds = [222, 333];

    // L1
    let cvxCrv: ERC20;
    let cvx: ERC20;
    let auraBalProxyOFT: AuraBalProxyOFT;
    let auraBalVault: AuraBalVault;
    let canonical: CanonicalPhaseDeployed;

    // Testing contract
    let testSetup: SideChainTestSetup;
    let sidechains: SidechainDeployed[];
    let idSnapShot: number;

    /* -- Declare shared functions -- */
    const setup = async () => {
        if (idSnapShot) {
            await hre.ethers.provider.send("evm_revert", [idSnapShot]);
            return;
        }
        accounts = await ethers.getSigners();
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, sideChainIds[0], debug);
        deployer = testSetup.deployer;
        auraBalProxyOFT = testSetup.l1.canonical.auraBalProxyOFT;
        auraBalVault = testSetup.l1.vaultDeployment.vault;
        canonical = testSetup.l1.canonical;
        cvxCrv = testSetup.l1.phase2.cvxCrv;
        cvx = testSetup.l1.phase2.cvx;
        sidechains = [testSetup.l2.sidechain];

        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);
        guardian = await impersonateAccount(testSetup.l2.multisigs.pauseGuardian);
        auraBalVaultOwner = await impersonateAccount(await auraBalVault.owner());

        // Send some balances in order to test
        // dirty trick to get some cvx balance.
        const cvxDepositorAccount = await impersonateAccount(testSetup.l1.phase2.vestedEscrows[0].address);
        const cvxConnected = cvx.connect(cvxDepositorAccount.signer);
        const cvxBalance = await cvxConnected.balanceOf(cvxDepositorAccount.address);
        await cvxConnected.transfer(deployer.address, cvxBalance);

        // dirty trick to get some crvCvx balance.
        const crvDepositorAccount = await impersonateAccount(testSetup.l1.phase2.crvDepositor.address);
        const cvxCrvConnected = testSetup.l1.phase2.cvxCrv.connect(crvDepositorAccount.signer);
        await cvxCrvConnected.mint(deployer.address, simpleToExactAmount(100));
        await cvxCrvConnected.mint(alice.address, simpleToExactAmount(100));
    };
    async function forceHarvestRewards(amount = parseEther("10"), minOut = ZERO, signer = deployer.signer) {
        const { mocks, phase2 } = testSetup.l1;
        const { crv } = mocks;
        const { strategy, vault, auraRewards } = testSetup.l1.vaultDeployment;

        const feeToken = MockERC20__factory.connect(mocks.addresses.feeToken, signer);

        // ----- Send some balance to the strategy to mock the harvest ----- //
        await crv.connect(signer).transfer(strategy.address, amount);
        await phase2.cvx.connect(signer).transfer(strategy.address, amount);
        await feeToken.connect(signer).transfer(strategy.address, amount);
        // ----- Send some balance to the balancer vault to mock swaps ----- //
        await phase2.cvxCrv.transfer(mocks.balancerVault.address, amount);
        await mocks.weth.transfer(mocks.balancerVault.address, amount);
        await mocks.balancerVault.setTokens(mocks.crvBpt.address, phase2.cvxCrv.address);

        expect(await crv.balanceOf(strategy.address), " crv balance").to.be.gt(0);
        expect(await feeToken.balanceOf(strategy.address), " feeToken balance").to.be.gt(0);
        expect(await phase2.cvx.balanceOf(strategy.address), " cvx balance").to.be.gt(0);

        const tx = await vault.connect(signer)["harvest(uint256)"](minOut);
        await expect(tx).to.emit(vault, "Harvest");
        // Queue new rewards
        await expect(tx).to.emit(auraRewards, "RewardAdded");

        expect(await crv.balanceOf(strategy.address), " crv balance").to.be.eq(0);
        expect(await feeToken.balanceOf(strategy.address), " feeToken balance").to.be.eq(0);
        expect(await phase2.cvx.balanceOf(strategy.address), " cvx balance").to.be.eq(0);
        return tx;
    }
    async function snapshotData(
        sidechain: SidechainDeployed,
        sidechainId: number,
        sender: Account,
        reason = "snapshot",
    ) {
        const auraBalBalance = await cvxCrv.balanceOf(sender.address);
        const auraBalance = await cvx.balanceOf(sender.address);

        const auraBalOFTBalance = await sidechain.auraBalOFT.balanceOf(sender.address);
        const auraBalOFTTotalSupply = await sidechain.auraBalOFT.totalSupply();
        const auraBalOFTCirculatingSupply = await sidechain.auraBalOFT.circulatingSupply();
        const auraBalOFTBalanceOfStrategy = await sidechain.auraBalOFT.balanceOf(sidechain.auraBalStrategy.address);
        const sidechainAuraBalVaultBalanceOf = await sidechain.auraBalVault.balanceOf(sender.address);
        const sidechainAuraBalVaultTotalAssets = await sidechain.auraBalVault.totalAssets();
        const sidechainAuraBalVaultTotalUnderlying = await sidechain.auraBalVault.totalUnderlying();
        const sidechainAuraBalVaultTotalSupply = await sidechain.auraBalVault.totalSupply();

        const abpClaimableAuraBal = await auraBalProxyOFT.claimable(cvxCrv.address, sidechainId);
        const abpClaimableAura = await auraBalProxyOFT.claimable(cvx.address, sidechainId);
        const abpTotalClaimableAuraBal = await auraBalProxyOFT.totalClaimable(cvxCrv.address);
        const abpTotalClaimableAura = await auraBalProxyOFT.totalClaimable(cvx.address);
        const abpInternalTotalSupply = await auraBalProxyOFT.internalTotalSupply();
        const abpCirculatingSupply = await auraBalProxyOFT.circulatingSupply();
        const abpAuraBalBalance = await cvxCrv.balanceOf(auraBalProxyOFT.address);
        const abpAuraBalance = await cvx.balanceOf(auraBalProxyOFT.address);
        const proxyVaultBalance = await auraBalVault.balanceOf(auraBalProxyOFT.address);
        const auraBalVaultTotalSupply = await auraBalVault.totalSupply();

        let auraBalVaultBalanceOfUnderlyingProxy = auraBalVaultTotalSupply;
        if (!auraBalVaultTotalSupply.eq(0)) {
            // If total supply is zero it reverts
            auraBalVaultBalanceOfUnderlyingProxy = await auraBalVault.balanceOfUnderlying(auraBalProxyOFT.address);
        }

        let sidechainAuraBalVaultBalanceOfUnderlyingProxy = sidechainAuraBalVaultTotalSupply;
        if (!sidechainAuraBalVaultTotalSupply.eq(0)) {
            // If total supply is zero it reverts
            sidechainAuraBalVaultBalanceOfUnderlyingProxy = await sidechain.auraBalVault.balanceOfUnderlying(
                auraBalProxyOFT.address,
            );
        }

        if (debug) {
            console.log(` snapshot ----------------------------  ${reason} ----------------------------`);
            console.log(`L1 auraBalBalance[sender]        ${formatEther(auraBalBalance)}`);
            console.log(`L1 auraBalance[sender]           ${formatEther(auraBalance)}`);

            console.log(`L1 proxyVaultBalance             ${formatEther(proxyVaultBalance)}`);
            console.log(`L1 auraBalVaultBalanceOfUndProxy ${formatEther(auraBalVaultBalanceOfUnderlyingProxy)}`);
            console.log(`L1 auraBalVaultTotalSupply       ${formatEther(auraBalVaultTotalSupply)}`);

            console.log(`L1 abpClaimableAuraBal           ${formatEther(abpClaimableAuraBal)}`);
            console.log(`L1 abpClaimableAura              ${formatEther(abpClaimableAura)}`);
            console.log(`L1 abpTotalClaimableAuraBal      ${formatEther(abpTotalClaimableAuraBal)}`);
            console.log(`L1 abpTotalClaimableAura         ${formatEther(abpTotalClaimableAura)}`);
            console.log(`L1 abpInternalTotalSupply        ${formatEther(abpInternalTotalSupply)}`);
            console.log(`L1 abpCirculatingSupply          ${formatEther(abpCirculatingSupply)}`);
            console.log(`L1 abpAuraBalBalance             ${formatEther(abpAuraBalBalance)}`);
            console.log(`L1 abpAuraBalance                ${formatEther(abpAuraBalance)}`);

            console.log(`L2 auraBalOFTBalance             ${formatEther(auraBalOFTBalance)}`);
            console.log(`L2 auraBalOFTTotalSupply         ${formatEther(auraBalOFTTotalSupply)}`);
            console.log(`L2 auraBalOFTCirculatingSupply   ${formatEther(auraBalOFTCirculatingSupply)}`);
            console.log(`L2 auraBalOFTBalanceOfStrategy   ${formatEther(auraBalOFTBalanceOfStrategy)}`);
            console.log(`L2 auraBalVaultBalanceOf         ${formatEther(sidechainAuraBalVaultBalanceOf)}`);
            console.log(`L2 auraBalVaultTotalAssets       ${formatEther(sidechainAuraBalVaultTotalAssets)}`);
            console.log(`L2 auraBalVaultTotalUnderlying   ${formatEther(sidechainAuraBalVaultTotalUnderlying)}`);
            console.log(`L2 auraBalVaultTotalSupply       ${formatEther(sidechainAuraBalVaultTotalSupply)}`);
            console.log(
                `L2 auraBalVaultBalanceOfUnderlyingProxy ${formatEther(sidechainAuraBalVaultBalanceOfUnderlyingProxy)}`,
            );
        }
        return {
            auraBalBalance,
            auraBalance,
            proxyVaultBalance,
            auraBalVaultBalanceOfUnderlyingProxy,
            auraBalVaultTotalSupply,
            abpClaimableAuraBal,
            abpClaimableAura,
            abpTotalClaimableAuraBal,
            abpTotalClaimableAura,
            abpInternalTotalSupply,
            abpCirculatingSupply,
            abpAuraBalBalance,
            abpAuraBalance,
            auraBalOFTBalance,
            auraBalOFTTotalSupply,
            auraBalOFTCirculatingSupply,
            auraBalOFTBalanceOfStrategy,
            sidechainAuraBalVaultBalanceOf,
            sidechainAuraBalVaultTotalAssets,
            sidechainAuraBalVaultTotalUnderlying,
            sidechainAuraBalVaultTotalSupply,
            sidechainAuraBalVaultBalanceOfUnderlyingProxy,
        };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function compareData(test: string, before: any, after: any) {
        const getDetails = (property: string) => [
            formatEther(before[property]),
            formatEther(after[property]),
            before[property].toString() === after[property].toString(),
        ];

        const testData = [
            ["L1 auraBalBalance[sender]        ", ...getDetails("auraBalBalance")],
            ["L1 auraBalance[sender]           ", ...getDetails("auraBalance")],
            ["L1 proxyVaultBalance             ", ...getDetails("proxyVaultBalance")],
            ["L1 auraBalVaultBalanceOfUndProxy ", ...getDetails("auraBalVaultBalanceOfUnderlyingProxy")],
            ["L1 auraBalVaultTotalSupply       ", ...getDetails("auraBalVaultTotalSupply")],
            ["L1 auraBalProxyOFT ClaimableAuraBal      ", ...getDetails("abpClaimableAuraBal")],
            ["L1 auraBalProxyOFT ClaimableAura         ", ...getDetails("abpClaimableAura")],
            ["L1 auraBalProxyOFT TotalClaimableAuraBal ", ...getDetails("abpTotalClaimableAuraBal")],
            ["L1 auraBalProxyOFT TotalClaimableAura    ", ...getDetails("abpTotalClaimableAura")],
            ["L1 auraBalProxyOFT InternalTotalSupply   ", ...getDetails("abpInternalTotalSupply")],
            ["L1 auraBalProxyOFT CirculatingSupply     ", ...getDetails("abpCirculatingSupply")],
            ["L1 auraBalProxyOFT AuraBalBalance        ", ...getDetails("abpAuraBalBalance")],
            ["L1 auraBalProxyOFT AuraBalance           ", ...getDetails("abpAuraBalance")],
            ["L2 auraBalOFTBalance             ", ...getDetails("auraBalOFTBalance")],
            ["L2 auraBalOFTTotalSupply         ", ...getDetails("auraBalOFTTotalSupply")],
            ["L2 auraBalOFTCirculatingSupply   ", ...getDetails("auraBalOFTCirculatingSupply")],
            ["L2 auraBalOFTBalanceOfStrategy   ", ...getDetails("auraBalOFTBalanceOfStrategy")],
            ["L2 auraBalVaultBalanceOf         ", ...getDetails("sidechainAuraBalVaultBalanceOf")],
            ["L2 auraBalVaultTotalAssets       ", ...getDetails("sidechainAuraBalVaultTotalAssets")],
            ["L2 auraBalVaultTotalUnderlying   ", ...getDetails("sidechainAuraBalVaultTotalUnderlying")],
            ["L2 auraBalVaultTotalSupply       ", ...getDetails("sidechainAuraBalVaultTotalSupply")],
            ["L2 auraBalVaultBalanceOfUndProxy ", ...getDetails("sidechainAuraBalVaultBalanceOfUnderlyingProxy")],
        ];

        if (debug) {
            console.log(`----------------------------  ${test} ----------------------------`);
            console.log(table([["Data", "Before", "After", "Equal"], ...testData.filter(t => !t[3])]));
        }
    }
    describe("behaviors", async () => {
        describe("should behave like Ownable ", async () => {
            const ctx: Partial<OwnableBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.owner = dao;
                    ctx.anotherAccount = alice;
                    ctx.ownable = sidechains[0].auraBalOFT;
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
                    ctx.token = sidechains[0].auraBalOFT;
                    ctx.initialHolder = deployer;
                    ctx.recipient = alice;
                    ctx.anotherAccount = dao;

                    // Initial supply of auraBalOFT by locking auraBal on L1 and bridge it to L2
                    await bridgeTokenFromL1ToL2(
                        deployer,
                        testSetup.l1.phase2.cvxCrv,
                        canonical.auraBalProxyOFT as unknown as ProxyOFT,
                        sideChainIds[0],
                        initialSupply,
                    );
                };
                await ctx.fixture();
            });
            shouldBehaveLikeERC20(() => ctx as IERC20BehaviourContext, "ERC20", initialSupply);
        });
        describe("should behave like PausableOFT", async () => {
            const ctx: Partial<PausableOFTBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.proxyOft = auraBalProxyOFT as unknown as PausableOFT;
                    ctx.oft = sidechains[0].auraBalOFT as unknown as PausableOFT;
                    ctx.owner = dao;
                    ctx.guardian = guardian;
                    ctx.anotherAccount = alice;
                    ctx.canonicalChainId = L1_CHAIN_ID;
                    ctx.sideChainId = sideChainIds[0];
                    return ctx as PausableOFTBehaviourContext;
                };
            });
            shouldBehaveLikePausableOFT(() => ctx as PausableOFTBehaviourContext);
        });
    });
    describe("constructor", async () => {
        let auraBalOFT: AuraBalOFT;
        before(async () => {
            await setup();
            auraBalOFT = sidechains[0].auraBalOFT;
        });
        it("should properly store valid arguments", async () => {
            // oFTCore
            expect(await auraBalOFT.NO_EXTRA_GAS(), "NO_EXTRA_GAS").to.eq(0);
            expect(await auraBalOFT.PT_SEND(), "PT_SEND").to.eq(0);
            expect(await auraBalOFT.useCustomAdapterParams(), "useCustomAdapterParams").to.eq(true);
            // lzApp
            expect(await auraBalOFT.DEFAULT_PAYLOAD_SIZE_LIMIT(), "DEFAULT_PAYLOAD_SIZE_LIMIT").to.eq(10000);
            expect(await auraBalOFT.lzEndpoint(), "lzEndpoint").to.eq(testSetup.l2.mocks.addresses.lzEndpoint);
            expect(await auraBalOFT.precrime(), "precrime").to.eq(ZERO_ADDRESS);
        });
        it("should be initialized", async () => {
            expect(await auraBalOFT.totalSupply(), "totalSupply").to.eq(0);
            expect(await auraBalOFT.circulatingSupply(), "circulatingSupply").to.eq(0);
            expect(await auraBalOFT.token(), "token").to.eq(auraBalOFT.address);
            expect(await auraBalOFT.symbol(), "symbol").to.eq(testSetup.l2.mocks.namingConfig.auraBalOftSymbol);
            expect(await auraBalOFT.owner(), "owner").to.eq(dao.address);
            expect(await auraBalOFT.name(), "name").to.eq(testSetup.l2.mocks.namingConfig.auraBalOftName);
            expect(await auraBalOFT.decimals(), "decimals").to.eq(18);
            expect(await auraBalOFT.trustedRemoteLookup(L1_CHAIN_ID), "trustedRemoteLookup").to.not.be.empty;
            expect(await auraBalOFT.payloadSizeLimitLookup(L1_CHAIN_ID), "payloadSizeLimitLookup").to.eq(0);
        });
    });
    describe("normal flow - multichain", () => {
        const bridgeAmount = simpleToExactAmount(10);
        before(async () => {
            // Add new sidechain
            sidechains.push((await deployL2(hre, accounts, testSetup.l1, L1_CHAIN_ID, sideChainIds[1])).l2.sidechain);
        });
        // Test is broken in 3 phases,
        // Common task for all sidechains previous to harvest
        // Harvest and distribute rewards on canonical chain
        // Common task for all sidechains after harvest
        describe("pre harvest", () => {
            for (let i = 0; i < sideChainIds.length; i++) {
                it(`can transfer auraBAL to sidechain ${sideChainIds[i]}`, async () => {
                    const sidechain = sidechains[i];
                    const sideChainId = sideChainIds[i];

                    // AuraBalProxyOFT.sendFrom => AuraBalVault.deposit => AuraBalStrategy.stake => LZEndpointMock.send
                    // LZEndpointMock.receivePayload => OFT.lzReceive
                    const dataBefore = await snapshotData(sidechain, sideChainId, deployer, "before bridge");
                    // ON L1 it stakes the token on AuraBalVault
                    // On L2 it mints oft
                    const tx = await bridgeTokenFromL1ToL2(
                        deployer,
                        cvxCrv,
                        canonical.auraBalProxyOFT as unknown as ProxyOFT,
                        sideChainId,
                        bridgeAmount,
                    );
                    const dataAfter = await snapshotData(sidechain, sideChainId, deployer, "after bridge");

                    expect(dataAfter.auraBalBalance, "token balance").to.be.eq(
                        dataBefore.auraBalBalance.sub(bridgeAmount),
                    );
                    expect(dataAfter.auraBalOFTBalance, "oft balance").to.be.eq(
                        dataBefore.auraBalOFTBalance.add(bridgeAmount),
                    );
                    expect(dataAfter.auraBalOFTTotalSupply, "oft totalSupply").to.be.eq(
                        dataBefore.auraBalOFTTotalSupply.add(bridgeAmount),
                    );
                    expect(dataAfter.auraBalOFTCirculatingSupply, "oft CirculatingSupply").to.be.eq(
                        dataBefore.auraBalOFTCirculatingSupply.add(bridgeAmount),
                    );
                    const expectedShares = await testSetup.l1.vaultDeployment.vault.previewDeposit(bridgeAmount);
                    expect(
                        dataAfter.auraBalVaultBalanceOfUnderlyingProxy,
                        "oft proxy vault balance of underlying",
                    ).to.be.eq(dataBefore.auraBalVaultBalanceOfUnderlyingProxy.add(bridgeAmount));
                    expect(dataAfter.proxyVaultBalance, "oft proxy vault balance").to.be.eq(
                        dataBefore.proxyVaultBalance.add(expectedShares),
                    );

                    await expect(tx)
                        .to.emit(cvxCrv, "Transfer")
                        .withArgs(deployer.address, auraBalProxyOFT.address, bridgeAmount);
                    await expect(tx)
                        .to.emit(cvxCrv, "Transfer")
                        .withArgs(auraBalProxyOFT.address, testSetup.l1.vaultDeployment.strategy.address, bridgeAmount);
                    await expect(tx)
                        .to.emit(auraBalVault, "Deposit")
                        .withArgs(auraBalProxyOFT.address, auraBalProxyOFT.address, bridgeAmount, expectedShares);

                    compareData("bridge(AURABAL)", dataBefore, dataAfter);
                });
                it(`can lock auraBAL on sidechain vault ${sideChainIds[i]}`, async () => {
                    const sidechain = sidechains[i];
                    const sideChainId = sideChainIds[i];

                    const dataBefore = await snapshotData(
                        sidechain,
                        sideChainId,
                        deployer,
                        "before sidechain.auraBalVault.deposit",
                    );
                    await sidechain.auraBalOFT.approve(sidechain.auraBalVault.address, ethers.constants.MaxUint256);
                    await sidechain.auraBalVault.deposit(dataBefore.auraBalOFTBalance.div(2), deployer.address);

                    expect(
                        await sidechain.auraBalVault.balanceOf(deployer.address),
                        "sidechain vault balance",
                    ).to.be.gt(ZERO);
                    const dataAfter = await snapshotData(
                        sidechain,
                        sideChainId,
                        deployer,
                        "after sidechain.auraBalVault.deposit ",
                    );

                    compareData("sidechain.auraBalVault.deposit(AURABAL)", dataBefore, dataAfter);
                });
                it(`harvest rewards from auraBalVault as usual`, async () => {
                    const sidechain = sidechains[i];
                    const sideChainId = sideChainIds[i];

                    const harvestAmount = simpleToExactAmount(1);
                    const dataBefore = await snapshotData(sidechain, sideChainId, deployer, "before harvest");

                    // Harvest from auraBAL vault
                    await auraBalVault
                        .connect(auraBalVaultOwner.signer)
                        .updateAuthorizedHarvesters(deployer.address, true);

                    //  AuraBalVault.harvest() => AuraBalStrategy.harvest() => BaseRewardPool.getReward()
                    await forceHarvestRewards(harvestAmount);

                    await increaseTime(ONE_WEEK.mul(2));

                    const dataAfter = await snapshotData(sidechain, sideChainId, deployer, "after harvest");
                    compareData("harvest", dataBefore, dataAfter);

                    expect(dataAfter.proxyVaultBalance, "proxy vault balance").eq(dataBefore.proxyVaultBalance);
                    expect(dataAfter.auraBalVaultBalanceOfUnderlyingProxy, "proxy vault balance of underlying").gt(
                        dataBefore.auraBalVaultBalanceOfUnderlyingProxy,
                    );
                });
            }
        });
        describe("harvest", () => {
            it(`can set harvest src chain ids`, async () => {
                await auraBalProxyOFT.setHarvestSrcChainIds(sideChainIds);
                expect(await auraBalProxyOFT.harvestSrcChainIds(0)).eq(sideChainIds[0]);
                expect(await auraBalProxyOFT.harvestSrcChainIds(1)).eq(sideChainIds[1]);
            });
            it(`can harvest from auraBAL proxy OFT`, async () => {
                // Harvest from auraBAL proxy OFT
                const datasBefore = await Promise.all(
                    sidechains.map((sidechain, j) =>
                        snapshotData(sidechain, sideChainIds[j], deployer, "before auraBalProxyOFT harvest"),
                    ),
                );
                function expectationsBeforeHarvest(dataBefore) {
                    expect(dataBefore.abpTotalClaimableAuraBal, "totalClaimable cvxCrv").to.be.eq(ZERO);
                    expect(dataBefore.abpTotalClaimableAura, "totalClaimable cvx").to.be.eq(ZERO);
                    expect(dataBefore.abpClaimableAuraBal, "claimable cvxCrv").to.be.eq(ZERO);
                    expect(dataBefore.abpClaimableAura, "claimable cvx").to.be.eq(ZERO);
                }
                // Calculate harvest arguments

                const totalUnderlyings = datasBefore.map(d => d.sidechainAuraBalVaultTotalUnderlying);
                const totalUnderlyingSum = totalUnderlyings.reduce((prev, curr) => prev.add(curr), ZERO);

                // Expect ZERO claimable as there it will be the first auraBalProxyOFT harvest
                expectationsBeforeHarvest(datasBefore[0]);
                expectationsBeforeHarvest(datasBefore[1]);

                // call harvest
                // auraBalProxyOFT => VirtualBalanceRewardPool.getReward()
                await auraBalProxyOFT.connect(dao.signer).updateAuthorizedHarvesters(deployer.address, true);
                const tx = await auraBalProxyOFT.connect(deployer.signer).harvest(totalUnderlyings, totalUnderlyingSum);

                // No events

                const datasAfter = await Promise.all(
                    sidechains.map((sidechain, j) =>
                        snapshotData(sidechain, sideChainIds[j], deployer, "after auraBalProxyOFT harvest"),
                    ),
                );

                const totalClaimableAuraBalAfter = await auraBalProxyOFT.totalClaimable(cvxCrv.address);
                const totalClaimableAuraAfter = await auraBalProxyOFT.totalClaimable(cvx.address);
                const abpAuraBalBalanceAfter = await cvxCrv.balanceOf(auraBalProxyOFT.address);
                const abpAuraBalanceAfter = await cvx.balanceOf(auraBalProxyOFT.address);

                const deltaAbpAuraBalance = abpAuraBalanceAfter.sub(datasBefore[0].abpAuraBalance);

                expect(totalClaimableAuraBalAfter, "totalClaimable cvxCrv").gt(datasBefore[0].abpTotalClaimableAuraBal);
                expect(totalClaimableAuraAfter, "totalClaimable cvxCrv").gt(datasBefore[0].abpTotalClaimableAura);

                expect(
                    toPrecision17(totalClaimableAuraAfter.sub(datasBefore[0].abpTotalClaimableAuraBal)),
                    "auraBalProxy src claimable cvxCrv",
                ).eq(toPrecision17(deltaAbpAuraBalance));

                expect(abpAuraBalBalanceAfter, "no changes on cvxCrv balance").eq(datasBefore[0].abpAuraBalBalance);

                for (let idx = 0; idx < datasBefore.length; idx++) {
                    const srcChainAuraBalClaimableAfter = await auraBalProxyOFT.claimable(
                        cvxCrv.address,
                        sideChainIds[idx],
                    );
                    const extraRewardsLength = await sidechains[idx].auraBalVault.extraRewardsLength();
                    expect(extraRewardsLength, "extra rewards no").to.be.eq(1);
                    const extraRewardsAddress = await auraBalVault.extraRewards(0);
                    const extraRewardsPool = VirtualBalanceRewardPool__factory.connect(
                        extraRewardsAddress,
                        deployer.signer,
                    );

                    // make sure extra rewards were collected
                    await expect(tx)
                        .to.emit(extraRewardsPool, "RewardPaid")
                        .withArgs(auraBalProxyOFT.address, anyValue);
                    await expect(tx)
                        .to.emit(cvx, "Transfer")
                        .withArgs(extraRewardsPool.address, auraBalProxyOFT.address, anyValue);

                    const srcChainAuraClaimableAfter = await auraBalProxyOFT.claimable(cvx.address, sideChainIds[idx]);
                    expect(srcChainAuraBalClaimableAfter).gte(datasBefore[idx].abpClaimableAuraBal);
                    expect(srcChainAuraClaimableAfter).gte(datasBefore[idx].abpClaimableAura);

                    compareData(`harvest sidechain ${sideChainIds[idx]}`, datasBefore[idx], datasAfter[idx]);
                }
            });
        });
        describe("after harvest", () => {
            for (let i = 0; i < sideChainIds.length; i++) {
                it(`can process claimable auraBal tokens to sidechain ${sideChainIds[i]}`, async () => {
                    const sidechain = sidechains[i];
                    const sideChainId = sideChainIds[i];

                    const dataBefore = await snapshotData(
                        sidechain,
                        sideChainId,
                        deployer,
                        "before auraBalProxyOFT processClaimable",
                    );

                    // L1
                    const rewardReceiver = await auraBalProxyOFT.rewardReceiver(sideChainId);
                    // L2
                    const auraBalOFTBalanceOfStrategyBefore = await sidechain.auraBalOFT.balanceOf(
                        sidechain.auraBalStrategy.address,
                    );
                    const auraBalOFTCirculatingSupplyBefore = await sidechain.auraBalOFT.circulatingSupply();

                    // When processing auraBal , invoke _lzSend to bridge tokens to L2
                    const tx = await auraBalProxyOFT.processClaimable(cvxCrv.address, sideChainId, {
                        value: NATIVE_FEE,
                    });
                    const dataAfter = await snapshotData(
                        sidechain,
                        sideChainId,
                        deployer,
                        "after auraBalProxyOFT processClaimable",
                    );
                    // L1 Verify it was sent  and accounted
                    const toAddress = ethers.utils.defaultAbiCoder.encode(["address"], [rewardReceiver]);
                    await expect(tx)
                        .to.emit(auraBalProxyOFT, "SendToChain")
                        .withArgs(sideChainId, auraBalProxyOFT.address, toAddress, dataBefore.abpClaimableAuraBal);

                    expect(dataAfter.abpTotalClaimableAuraBal, "auraBalProxy total claimable cvxCrv").eq(
                        dataBefore.abpTotalClaimableAuraBal.sub(dataBefore.abpClaimableAuraBal),
                    );
                    expect(dataAfter.abpClaimableAuraBal, "auraBalProxy src claimable cvxCrv").eq(ZERO);
                    expect(dataAfter.abpInternalTotalSupply, "auraBalProxy internal total supply").eq(
                        dataBefore.abpInternalTotalSupply.add(dataBefore.abpClaimableAuraBal),
                    );
                    expect(dataAfter.abpTotalClaimableAura, "auraBalProxy total claimable cvx, no change").eq(
                        dataBefore.abpTotalClaimableAura,
                    );
                    expect(dataAfter.abpClaimableAura, "auraBalProxy src claimable cvx, no change").eq(
                        dataBefore.abpClaimableAura,
                    );

                    // L2 Verify it was received on sidechain
                    await expect(tx)
                        .to.emit(sidechain.auraBalOFT, "Transfer")
                        .withArgs(ZERO, rewardReceiver, dataBefore.abpClaimableAuraBal);
                    await expect(tx)
                        .to.emit(sidechain.auraBalOFT, "ReceiveFromChain")
                        .withArgs(L1_CHAIN_ID, sidechain.auraBalStrategy.address, dataBefore.abpClaimableAuraBal);

                    const auraBalOFTBalanceOfStrategyAfter = await sidechain.auraBalOFT.balanceOf(
                        sidechain.auraBalStrategy.address,
                    );
                    const auraBalOFTCirculatingSupplyAfter = await sidechain.auraBalOFT.circulatingSupply();

                    expect(auraBalOFTBalanceOfStrategyAfter, "auraBalOFTBalanceOfStrategy").to.be.eq(
                        auraBalOFTBalanceOfStrategyBefore.add(dataBefore.abpClaimableAuraBal),
                    );
                    expect(dataAfter.auraBalOFTTotalSupply, "auraBalOFTTotalSupply").to.be.eq(
                        dataBefore.auraBalOFTTotalSupply.add(dataBefore.abpClaimableAuraBal),
                    );
                    expect(auraBalOFTCirculatingSupplyAfter, "auraBalOFTCirculatingSupply").to.be.eq(
                        auraBalOFTCirculatingSupplyBefore.add(dataBefore.abpClaimableAuraBal),
                    );

                    compareData("processClaimable(AURABAL)", dataBefore, dataAfter);
                });
                it(`can process claimable aura tokens to sidechain ${sideChainIds[i]}`, async () => {
                    const sidechain = sidechains[i];
                    const sideChainId = sideChainIds[i];

                    const dataBefore = await snapshotData(
                        sidechain,
                        sideChainId,
                        deployer,
                        "before auraBalProxyOFT processClaimable",
                    );

                    // L1
                    const auraBalanceOfAuraProxyOFTBefore = await cvx.balanceOf(canonical.auraProxyOFT.address);
                    const rewardReceiver = await auraBalProxyOFT.rewardReceiver(sideChainId);

                    // L2
                    const auraOFTBalanceOfStrategyBefore = await sidechain.auraOFT.balanceOf(
                        sidechain.auraBalStrategy.address,
                    );
                    const auraOFTTotalSupplyBefore = await sidechain.auraOFT.totalSupply();
                    const auraOFTCirculatingSupplyBefore = await sidechain.auraOFT.circulatingSupply();

                    // When processing auraBal , invoke _lzSend to bridge tokens to L2
                    //  AuraBalProxyOFT.processClaimable => AuraOFT.sendFrom => AuraOFT._send => AuraOFT._debitFrom => AuraOFT.lzReceive
                    const tx = await auraBalProxyOFT.processClaimable(cvx.address, sideChainId, {
                        value: NATIVE_FEE,
                        gasLimit: 1000000,
                    });

                    const dataAfter = await snapshotData(
                        sidechain,
                        sideChainId,
                        deployer,
                        "after auraProxyOFT processClaimable",
                    );

                    const auraBalanceOfAuraProxyOFTAfter = await cvx.balanceOf(canonical.auraProxyOFT.address);
                    expect(auraBalanceOfAuraProxyOFTAfter, "aura sent to auraProxyOFT").eq(
                        auraBalanceOfAuraProxyOFTBefore.add(dataBefore.abpClaimableAura),
                    );

                    // L1 Verify it was sent  and accounted
                    await expect(tx)
                        .to.emit(cvx, "Transfer")
                        .withArgs(
                            canonical.auraBalProxyOFT.address,
                            canonical.auraProxyOFT.address,
                            dataBefore.abpClaimableAura,
                        );

                    expect(dataAfter.abpInternalTotalSupply, "auraBalProxy internal total supply").eq(
                        dataBefore.abpInternalTotalSupply,
                    );
                    expect(dataAfter.abpTotalClaimableAura, "auraBalProxy total claimable cvx").eq(
                        dataBefore.abpTotalClaimableAura.sub(dataBefore.abpClaimableAura),
                    );
                    expect(dataAfter.abpClaimableAura, "auraBalProxy src claimable cvx").eq(ZERO);

                    // L2 Verify it was received on sidechain
                    await expect(tx)
                        .to.emit(sidechain.auraOFT, "Transfer")
                        .withArgs(ZERO, rewardReceiver, dataBefore.abpClaimableAura);
                    await expect(tx)
                        .to.emit(sidechain.auraOFT, "ReceiveFromChain")
                        .withArgs(L1_CHAIN_ID, sidechain.auraBalStrategy.address, dataBefore.abpClaimableAura);

                    const auraOFTBalanceOfStrategyAfter = await sidechain.auraOFT.balanceOf(
                        sidechain.auraBalStrategy.address,
                    );
                    const auraOFTTotalSupplyAfter = await sidechain.auraOFT.totalSupply();
                    const auraOFTCirculatingSupplyAfter = await sidechain.auraOFT.circulatingSupply();

                    expect(auraOFTBalanceOfStrategyAfter, "auraOFTBalanceOfStrategy").to.be.eq(
                        auraOFTBalanceOfStrategyBefore.add(dataBefore.abpClaimableAura),
                    );
                    expect(auraOFTTotalSupplyAfter, "auraOFTTotalSupply").to.be.eq(
                        auraOFTTotalSupplyBefore.add(dataBefore.abpClaimableAura),
                    );
                    expect(auraOFTCirculatingSupplyAfter, "auraOFTCirculatingSupply").to.be.eq(
                        auraOFTCirculatingSupplyBefore.add(dataBefore.abpClaimableAura),
                    );

                    compareData("processClaimable(AURA)", dataBefore, dataAfter);
                });
                it(`can not process claimable more than once ${sideChainIds[i]}`, async () => {
                    const sideChainId = sideChainIds[i];
                    await expect(
                        auraBalProxyOFT.processClaimable(cvxCrv.address, sideChainId, { value: NATIVE_FEE }),
                    ).to.be.revertedWith("!reward");
                });
                it(`can transfer position on sidechain vault ${sideChainIds[i]}`, async () => {
                    const sidechain = sidechains[i];
                    const sideChainId = sideChainIds[i];

                    // After processing claimable, rewards are on the vault's strategy
                    const sidechainAuraBalVaultOwner = await impersonateAccount(await sidechain.auraBalVault.owner());
                    await sidechain.auraBalVault
                        .connect(sidechainAuraBalVaultOwner.signer)
                        .updateAuthorizedHarvesters(deployer.address, true);
                    await sidechain.auraBalVault["harvest()"]();
                    await increaseTime(ONE_WEEK);
                    const dataBefore = await snapshotData(
                        sidechain,
                        sideChainId,
                        deployer,
                        "before sidechain vault transfer",
                    );
                    const extraRewards = await sidechain.auraBalVault.extraRewards(0);
                    const virtualBalanceRewardPool = VirtualBalanceRewardPool__factory.connect(
                        extraRewards,
                        deployer.signer,
                    );
                    const deployerEarnedBefore = await virtualBalanceRewardPool.earned(deployer.address);
                    const aliceEarnedBefore = await virtualBalanceRewardPool.earned(alice.address);

                    const deployerBalance = await sidechain.auraBalVault.balanceOf(deployer.address);

                    await sidechain.auraBalVault.transfer(alice.address, deployerBalance.div(2));
                    await increaseTime(ONE_WEEK);

                    const deployerEarnedAfter = await virtualBalanceRewardPool.earned(deployer.address);
                    const aliceEarnedAfter = await virtualBalanceRewardPool.earned(alice.address);

                    const dataAfter = await snapshotData(
                        sidechain,
                        sideChainId,
                        deployer,
                        "after sidechain vault transfer",
                    );

                    compareData("sidechain.auraBalVault.transfer", dataBefore, dataAfter);
                    expect(deployerEarnedBefore).to.be.eq(deployerEarnedAfter);
                    expect(aliceEarnedBefore).to.be.eq(aliceEarnedAfter);
                });
                it(`can withdraw auraBAL from sidechain ${sideChainIds[i]}`, async () => {
                    const sidechain = sidechains[i];
                    const sideChainId = sideChainIds[i];

                    const auraBalVaultBalance = await sidechain.auraBalVault.balanceOf(deployer.address);
                    await sidechain.auraBalVault.withdraw(auraBalVaultBalance, deployer.address, deployer.address);
                    const auraBalOFTBalanceBefore = await sidechain.auraBalOFT.balanceOf(deployer.address);
                    const bridgeAmount = auraBalOFTBalanceBefore.div(10);
                    const dataBefore = await snapshotData(
                        sidechain,
                        sideChainId,
                        deployer,
                        "before auraBalOFT sendFrom",
                    );
                    const tx = await sidechain.auraBalOFT
                        .connect(deployer.signer)
                        .sendFrom(
                            deployer.address,
                            L1_CHAIN_ID,
                            deployer.address,
                            bridgeAmount,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ethers.utils.solidityPack(["uint16", "uint256"], [1, 600_000]),
                            {
                                value: NATIVE_FEE,
                            },
                        );
                    await expect(tx).to.emit(canonical.auraBalProxyOFT, "ReceiveFromChain");

                    const dataAfter = await snapshotData(
                        sidechain,
                        sideChainId,
                        deployer,
                        "before auraBalOFT sendFrom",
                    );
                    compareData("auraBalOFT sendFrom(L2=>L1)", dataBefore, dataAfter);
                    // L2 Verify it was sent on sidechain
                    await expect(tx)
                        .to.emit(sidechain.auraBalOFT, "Transfer")
                        .withArgs(deployer.address, ZERO_ADDRESS, bridgeAmount);

                    expect(dataAfter.auraBalOFTBalance, "auraBalOFTBalance").to.be.eq(
                        dataBefore.auraBalOFTBalance.sub(bridgeAmount),
                    );
                    expect(dataAfter.auraBalOFTTotalSupply, "auraOFTTotalSupply").to.be.eq(
                        dataBefore.auraBalOFTTotalSupply.sub(bridgeAmount),
                    );
                    expect(dataAfter.auraBalOFTCirculatingSupply, "auraBalOFTCirculatingSupply").to.be.eq(
                        dataBefore.auraBalOFTCirculatingSupply.sub(bridgeAmount),
                    );
                });
            }
        });
    });
    describe("Edge cases", () => {
        it("only owner can set harvest src chain ids", async () => {
            await expect(auraBalProxyOFT.connect(alice.signer).setHarvestSrcChainIds([L1_CHAIN_ID])).to.be.revertedWith(
                "Ownable: caller is not the owner",
            );
        });
        it("can act as owner of the auraBalVault", async () => {
            const setWithdrawalPenalty = AuraBalVault__factory.createInterface().encodeFunctionData(
                "setWithdrawalPenalty",
                [ZERO],
            );
            const withdrawalPenalty = await auraBalVault.withdrawalPenalty();
            expect(withdrawalPenalty, "withdrawalPenalty").to.not.be.eq(ZERO);
            await auraBalProxyOFT.connect(dao.signer).vaultExecute(ZERO, setWithdrawalPenalty);
            // Verify the changed
            expect(await auraBalVault.withdrawalPenalty()).to.be.eq(ZERO);
        });
        describe("harvest", () => {
            it("harvest rewards from auraBalVault correct chain wrong totalUnderlying", async () => {
                const harvestAmount = simpleToExactAmount(1);
                await forceHarvestRewards(harvestAmount);
                await increaseTime(ONE_WEEK.mul(2));

                await expect(auraBalProxyOFT.connect(deployer.signer).harvest([100, 100], 300)).to.be.revertedWith(
                    "!sum",
                );
            });
        });
    });
});
