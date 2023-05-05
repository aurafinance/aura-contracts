import { table } from "table";
import { parseEther } from "@ethersproject/units";
import { expect } from "chai";
import { BigNumber, ContractTransaction, Signer } from "ethers";
import hre, { ethers } from "hardhat";
import {
    anyValue,
    DEAD_ADDRESS,
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
    ProxyOFT,
    VirtualBalanceRewardPool__factory,
} from "../../types/generated";
import shouldBehaveLikeERC20, { IERC20BehaviourContext } from "../shared/ERC20.behaviour";
import { ERRORS, OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import {
    CanonicalPhaseDeployed,
    SidechainDeployed,
    sidechainTestSetup,
    SideChainTestSetup,
} from "./sidechainTestSetup";
import { formatEther } from "ethers/lib/utils";

const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;
const debug = false;
const SET_CONFIG_SELECTOR = "setConfig(uint16,bytes4,(bytes,address))";

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
    // L1
    let cvxCrv: ERC20;
    let cvx: ERC20;
    let auraBalProxyOFT: AuraBalProxyOFT;
    let auraBalVault: AuraBalVault;
    let canonical: CanonicalPhaseDeployed;

    // Testing contract
    let testSetup: SideChainTestSetup;
    // L2
    let auraBalOFT: AuraBalOFT;
    let sidechain: SidechainDeployed;
    /* -- Declare shared functions -- */
    const setup = async () => {
        accounts = await ethers.getSigners();
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID, debug);
        deployer = testSetup.deployer;
        auraBalProxyOFT = testSetup.l1.canonical.auraBalProxyOFT;
        auraBalVault = testSetup.l1.vaultDeployment.vault;
        canonical = testSetup.l1.canonical;
        cvxCrv = testSetup.l1.phase2.cvxCrv;
        cvx = testSetup.l1.phase2.cvx;
        auraBalOFT = testSetup.l2.sidechain.auraBalOFT;
        sidechain = testSetup.l2.sidechain;

        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);

        // Send some balances in order to test
        // dirty trick to get some cvx balance.
        const cvxDepositorAccount = await impersonateAccount(testSetup.l1.phase2.vestedEscrows[0].address);
        const cvxConnected = cvx.connect(cvxDepositorAccount.signer);
        const cvxBalance = await cvxConnected.balanceOf(cvxDepositorAccount.address);
        await cvxConnected.transfer(deployer.address, cvxBalance);
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
    async function snapshotData(sender: Account, reason = "snapshot") {
        const auraBalBalance = await cvxCrv.balanceOf(sender.address);
        const auraBalance = await cvx.balanceOf(sender.address);

        const auraBalOFTBalance = await auraBalOFT.balanceOf(sender.address);
        const auraBalOFTTotalSupply = await auraBalOFT.totalSupply();
        const auraBalOFTCirculatingSupply = await auraBalOFT.circulatingSupply();
        const auraBalOFTBalanceOfStrategy = await auraBalOFT.balanceOf(sidechain.auraBalStrategy.address);
        const proxyVaultBalance = await auraBalVault.balanceOf(auraBalProxyOFT.address);
        const auraBalVaultTotalSupply = await auraBalVault.totalSupply();

        const sidechainAuraBalVaultBalanceOf = await sidechain.auraBalVault.balanceOf(sender.address);
        const sidechainAuraBalVaultTotalAssets = await sidechain.auraBalVault.totalAssets();
        const sidechainAuraBalVaultTotalUnderlying = await sidechain.auraBalVault.totalUnderlying();
        const sidechainAuraBalVaultTotalSupply = await sidechain.auraBalVault.totalSupply();

        const abpClaimableAuraBal = await auraBalProxyOFT.claimable(cvxCrv.address, L2_CHAIN_ID);
        const abpClaimableAura = await auraBalProxyOFT.claimable(cvx.address, L2_CHAIN_ID);
        const abpTotalClaimableAuraBal = await auraBalProxyOFT.totalClaimable(cvxCrv.address);
        const abpTotalClaimableAura = await auraBalProxyOFT.totalClaimable(cvx.address);
        const abpInternalTotalSupply = await auraBalProxyOFT.internalTotalSupply();
        const abpCirculatingSupply = await auraBalProxyOFT.circulatingSupply();
        const abpAuraBalBalance = await cvxCrv.balanceOf(auraBalProxyOFT.address);
        const abpAuraBalance = await cvx.balanceOf(auraBalProxyOFT.address);

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
                    ctx.ownable = auraBalOFT;
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
                    ctx.token = auraBalOFT;
                    ctx.initialHolder = deployer;
                    ctx.recipient = alice;
                    ctx.anotherAccount = dao;

                    // Initial supply of auraBalOFT by locking auraBal on L1 and bridge it to L2
                    await bridgeTokenFromL1ToL2(
                        deployer,
                        testSetup.l1.phase2.cvxCrv,
                        canonical.auraBalProxyOFT as unknown as ProxyOFT,
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
    describe("normal flow", () => {
        const bridgeAmount = simpleToExactAmount(10);
        it("can transfer auraBAL to sidechain", async () => {
            // AuraBalProxyOFT.sendFrom => AuraBalVault.deposit => AuraBalStrategy.stake => LZEndpointMock.send
            // LZEndpointMock.receivePayload => OFT.lzReceive
            const dataBefore = await snapshotData(deployer, "before bridge");
            // ON L1 it stakes the token on AuraBalVault
            // On L2 it mints oft
            const tx = await bridgeTokenFromL1ToL2(
                deployer,
                cvxCrv,
                canonical.auraBalProxyOFT as unknown as ProxyOFT,
                L2_CHAIN_ID,
                bridgeAmount,
            );
            const dataAfter = await snapshotData(deployer, "after bridge");

            expect(dataAfter.auraBalBalance, "token balance").to.be.eq(dataBefore.auraBalBalance.sub(bridgeAmount));
            expect(dataAfter.auraBalOFTBalance, "oft balance").to.be.eq(dataBefore.auraBalOFTBalance.add(bridgeAmount));
            expect(dataAfter.auraBalOFTTotalSupply, "oft totalSupply").to.be.eq(
                dataBefore.auraBalOFTTotalSupply.add(bridgeAmount),
            );
            expect(dataAfter.auraBalOFTCirculatingSupply, "oft CirculatingSupply").to.be.eq(
                dataBefore.auraBalOFTCirculatingSupply.add(bridgeAmount),
            );
            expect(dataAfter.proxyVaultBalance, "oft proxy vault balance").to.be.eq(
                dataBefore.proxyVaultBalance.add(bridgeAmount),
            );

            await expect(tx)
                .to.emit(cvxCrv, "Transfer")
                .withArgs(deployer.address, auraBalProxyOFT.address, bridgeAmount);
            await expect(tx)
                .to.emit(cvxCrv, "Transfer")
                .withArgs(auraBalProxyOFT.address, testSetup.l1.vaultDeployment.strategy.address, bridgeAmount);
            await expect(tx)
                .to.emit(auraBalVault, "Deposit")
                .withArgs(auraBalProxyOFT.address, auraBalProxyOFT.address, bridgeAmount, bridgeAmount);

            compareData("bridge(AURABAL)", dataBefore, dataAfter);
        });
        it("can lock auraBAL on sidechain vault", async () => {
            const dataBefore = await snapshotData(deployer, "beefore sidechain.auraBalVault.deposit");
            await sidechain.auraBalOFT.approve(sidechain.auraBalVault.address, ethers.constants.MaxUint256);
            await sidechain.auraBalVault.deposit(dataBefore.auraBalOFTBalance.div(2), deployer.address);
            expect(await sidechain.auraBalVault.balanceOf(deployer.address), "sidechain vault balance").to.be.gt(ZERO);
            const dataAfter = await snapshotData(deployer, "after sidechain.auraBalVault.deposit ");

            compareData("sidechain.auraBalVault.deposit(AURABAL)", dataBefore, dataAfter);
        });
        it("harvest rewards from auraBalVault as usual", async () => {
            const harvestAmount = simpleToExactAmount(1);
            const dataBefore = await snapshotData(deployer, "before harvest");

            // Harvest from auraBAL vault
            await auraBalVault.connect(deployer.signer).updateAuthorizedHarvesters(deployer.address, true);

            //  AuraBalVault.harvest() => AuraBalStrategy.harvest() => BaseRewardPool.getReward()
            await forceHarvestRewards(harvestAmount);

            await increaseTime(ONE_WEEK.mul(2));

            const dataAfter = await snapshotData(deployer, "after harvest");
            compareData("harvest", dataBefore, dataAfter);

            expect(dataAfter.proxyVaultBalance, "proxy vault balance").eq(dataBefore.proxyVaultBalance);
            expect(dataAfter.auraBalVaultBalanceOfUnderlyingProxy, "proxy vault balance of underlying").gt(
                dataBefore.auraBalVaultBalanceOfUnderlyingProxy,
            );
        });
        it("can harvest from auraBAL proxy OFT", async () => {
            // Harvest from auraBAL proxy OFT
            const dataBefore = await snapshotData(deployer, "before auraBalProxyOFT harvest");

            // Calculate harvest arguments
            const extraRewardsLength = await sidechain.auraBalVault.extraRewardsLength();
            expect(extraRewardsLength, "extra rewards no").to.be.eq(1);
            const extraRewardsAddress = await auraBalVault.extraRewards(0);
            const extraRewardsPool = VirtualBalanceRewardPool__factory.connect(extraRewardsAddress, deployer.signer);

            const srcChainIds = [L2_CHAIN_ID];
            const totalUnderlyings = [dataBefore.sidechainAuraBalVaultTotalUnderlying];
            const totalUnderlyingSum = totalUnderlyings[0];

            // Expect ZERO claimable as there it will be the first auraBalProxyOFT harvest
            expect(dataBefore.abpTotalClaimableAuraBal, "totalClaimable cvxCrv").to.be.eq(ZERO);
            expect(dataBefore.abpTotalClaimableAuraBal, "totalClaimable cvx").to.be.eq(ZERO);
            expect(dataBefore.abpClaimableAuraBal, "claimable cvxCrv").to.be.eq(ZERO);
            expect(dataBefore.abpClaimableAura, "claimable cvx").to.be.eq(ZERO);

            // call harvest
            // auraBalProxyOFT => VirtualBalanceRewardPool.getReward()
            await auraBalProxyOFT.connect(dao.signer).updateAuthorizedHarvesters(deployer.address, true);
            const tx = await auraBalProxyOFT
                .connect(deployer.signer)
                .harvest(srcChainIds, totalUnderlyings, totalUnderlyingSum);

            // No events

            // make sure extra rewards were collected
            await expect(tx).to.emit(extraRewardsPool, "RewardPaid").withArgs(auraBalProxyOFT.address, anyValue);
            await expect(tx)
                .to.emit(cvx, "Transfer")
                .withArgs(extraRewardsPool.address, auraBalProxyOFT.address, anyValue);

            const dataProxyHarvestAfter = await snapshotData(deployer, "after auraBalProxyOFT harvest");

            const totalClaimableAuraBalAfter = await auraBalProxyOFT.totalClaimable(cvxCrv.address);
            const totalClaimableAuraAfter = await auraBalProxyOFT.totalClaimable(cvx.address);
            const abpAuraBalBalanceAfter = await cvxCrv.balanceOf(auraBalProxyOFT.address);
            const abpAuraBalanceAfter = await cvx.balanceOf(auraBalProxyOFT.address);

            const deltaAbpAuraBalance = abpAuraBalanceAfter.sub(dataBefore.abpAuraBalance);

            expect(totalClaimableAuraBalAfter, "totalClaimable cvxCrv").gt(dataBefore.abpTotalClaimableAuraBal);
            expect(totalClaimableAuraAfter, "totalClaimable cvxCrv").gt(dataBefore.abpTotalClaimableAuraBal);

            const srcChainAuraBalClaimableAfter = await auraBalProxyOFT.claimable(cvxCrv.address, L2_CHAIN_ID);
            const srcChainAuraClaimableAfter = await auraBalProxyOFT.claimable(cvx.address, L2_CHAIN_ID);
            expect(srcChainAuraBalClaimableAfter).gte(dataBefore.abpClaimableAuraBal);
            expect(srcChainAuraClaimableAfter.sub(dataBefore.abpClaimableAura), "auraBalProxy src claimable cvx").eq(
                deltaAbpAuraBalance,
            );
            expect(
                totalClaimableAuraAfter.sub(dataBefore.abpTotalClaimableAuraBal),
                "auraBalProxy src claimable cvx",
            ).eq(deltaAbpAuraBalance);
            expect(abpAuraBalBalanceAfter, "no changes on cvxCrv balance").eq(dataBefore.abpAuraBalBalance);
            compareData("dataProxyHarvest", dataBefore, dataProxyHarvestAfter);
        });
        it("can claim auraBal tokens to sidechain", async () => {
            const dataBefore = await snapshotData(deployer, "before auraBalProxyOFT processClaimable");

            // L1
            const rewardReceiver = await auraBalProxyOFT.rewardReceiver(L2_CHAIN_ID);
            const internalTotalSupplyBefore = await auraBalProxyOFT.internalTotalSupply();

            // L2
            const auraBalOFTBalanceOfStrategyBefore = await auraBalOFT.balanceOf(sidechain.auraBalStrategy.address);
            const auraBalOFTTotalSupplyBefore = await auraBalOFT.totalSupply();
            const auraBalOFTCirculatingSupplyBefore = await auraBalOFT.circulatingSupply();

            // When processing auraBal , invoke _lzSend to bridge tokens to L2
            const tx = await auraBalProxyOFT.processClaimable(cvxCrv.address, auraBalProxyOFT.address, L2_CHAIN_ID, {
                value: NATIVE_FEE,
            });
            const dataProxyAfter = await snapshotData(deployer, "after auraBalProxyOFT processClaimable");

            // L1 Verify it was sent  and accounted
            const toAddress = ethers.utils.defaultAbiCoder.encode(["address"], [rewardReceiver]);
            await expect(tx)
                .to.emit(auraBalProxyOFT, "SendToChain")
                .withArgs(L2_CHAIN_ID, auraBalProxyOFT.address, toAddress, dataBefore.abpClaimableAuraBal);

            const totalClaimableAuraBalAfter = await auraBalProxyOFT.totalClaimable(cvxCrv.address);
            const totalClaimableAuraAfter = await auraBalProxyOFT.totalClaimable(cvx.address);

            const srcChainAuraBalClaimableAfter = await auraBalProxyOFT.claimable(cvxCrv.address, L2_CHAIN_ID);
            const srcChainAuraClaimableAfter = await auraBalProxyOFT.claimable(cvx.address, L2_CHAIN_ID);
            const internalTotalSupplyAfter = await canonical.auraBalProxyOFT.internalTotalSupply();

            expect(totalClaimableAuraBalAfter, "auraBalProxy total claimable cvxCrv").eq(ZERO);
            expect(srcChainAuraBalClaimableAfter, "auraBalProxy src claimable cvxCrv").eq(ZERO);
            expect(internalTotalSupplyAfter, "auraBalProxy internal total supply").eq(
                internalTotalSupplyBefore.add(dataBefore.abpTotalClaimableAuraBal),
            );
            expect(totalClaimableAuraAfter, "auraBalProxy total claimable cvx, no change").eq(
                dataBefore.abpTotalClaimableAura,
            );
            expect(srcChainAuraClaimableAfter, "auraBalProxy src claimable cvx, no change").eq(
                dataBefore.abpClaimableAura,
            );

            // L2 Verify it was received on sidechain
            await expect(tx)
                .to.emit(auraBalOFT, "Transfer")
                .withArgs(ZERO, rewardReceiver, dataBefore.abpTotalClaimableAuraBal);
            await expect(tx)
                .to.emit(auraBalOFT, "ReceiveFromChain")
                .withArgs(L1_CHAIN_ID, sidechain.auraBalStrategy.address, dataBefore.abpTotalClaimableAuraBal);

            const auraBalOFTBalanceOfStrategyAfter = await auraBalOFT.balanceOf(sidechain.auraBalStrategy.address);
            const auraBalOFTTotalSupplyAfter = await auraBalOFT.totalSupply();
            const auraBalOFTCirculatingSupplyAfter = await auraBalOFT.circulatingSupply();

            expect(auraBalOFTBalanceOfStrategyAfter, "auraBalOFTBalanceOfStrategy").to.be.eq(
                auraBalOFTBalanceOfStrategyBefore.add(dataBefore.abpTotalClaimableAuraBal),
            );
            expect(auraBalOFTTotalSupplyAfter, "auraBalOFTTotalSupply").to.be.eq(
                auraBalOFTTotalSupplyBefore.add(dataBefore.abpTotalClaimableAuraBal),
            );
            expect(auraBalOFTCirculatingSupplyAfter, "auraBalOFTCirculatingSupply").to.be.eq(
                auraBalOFTCirculatingSupplyBefore.add(dataBefore.abpTotalClaimableAuraBal),
            );

            compareData("processClaimable(AURABAL)", dataBefore, dataProxyAfter);
        });
        it("can claim aura tokens to sidechain", async () => {
            const dataBefore = await snapshotData(deployer, "before auraBalProxyOFT processClaimable");

            // L1
            const auraBalanceOfAuraProxyOFTBefore = await cvx.balanceOf(canonical.auraProxyOFT.address);
            const rewardReceiver = await auraBalProxyOFT.rewardReceiver(L2_CHAIN_ID);
            const internalTotalSupplyBefore = await auraBalProxyOFT.internalTotalSupply();

            // L2
            const auraOFTBalanceOfStrategyBefore = await sidechain.auraOFT.balanceOf(sidechain.auraBalStrategy.address);
            const auraOFTTotalSupplyBefore = await sidechain.auraOFT.totalSupply();
            const auraOFTCirculatingSupplyBefore = await sidechain.auraOFT.circulatingSupply();

            // When processing auraBal , invoke _lzSend to bridge tokens to L2
            //  AuraBalProxyOFT.processClaimable => AuraOFT.sendFrom => AuraOFT._send => AuraOFT._debitFrom => AuraOFT.lzReceive
            const tx = await auraBalProxyOFT.processClaimable(
                cvx.address,
                canonical.auraProxyOFT.address,
                L2_CHAIN_ID,
                { value: NATIVE_FEE, gasLimit: 1000000 },
            );

            const dataAfter = await snapshotData(deployer, "after auraProxyOFT processClaimable");
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

            const totalClaimableAuraAfter = await auraBalProxyOFT.totalClaimable(cvx.address);
            const srcChainAuraClaimableAfter = await auraBalProxyOFT.claimable(cvx.address, L2_CHAIN_ID);
            const internalTotalSupplyAfter = await canonical.auraBalProxyOFT.internalTotalSupply();

            expect(internalTotalSupplyAfter, "auraBalProxy internal total supply").eq(internalTotalSupplyBefore);
            expect(totalClaimableAuraAfter, "auraBalProxy total claimable cvx").eq(ZERO);
            expect(srcChainAuraClaimableAfter, "auraBalProxy src claimable cvx").eq(ZERO);

            // // L2 Verify it was received on sidechain
            await expect(tx)
                .to.emit(sidechain.auraOFT, "Transfer")
                .withArgs(ZERO, rewardReceiver, dataBefore.abpTotalClaimableAura);
            await expect(tx)
                .to.emit(sidechain.auraOFT, "ReceiveFromChain")
                .withArgs(L1_CHAIN_ID, sidechain.auraBalStrategy.address, dataBefore.abpTotalClaimableAura);

            const auraOFTBalanceOfStrategyAfter = await sidechain.auraOFT.balanceOf(sidechain.auraBalStrategy.address);
            const auraOFTTotalSupplyAfter = await sidechain.auraOFT.totalSupply();
            const auraOFTCirculatingSupplyAfter = await sidechain.auraOFT.circulatingSupply();

            expect(auraOFTBalanceOfStrategyAfter, "auraOFTBalanceOfStrategy").to.be.eq(
                auraOFTBalanceOfStrategyBefore.add(dataBefore.abpTotalClaimableAura),
            );
            expect(auraOFTTotalSupplyAfter, "auraOFTTotalSupply").to.be.eq(
                auraOFTTotalSupplyBefore.add(dataBefore.abpTotalClaimableAura),
            );
            expect(auraOFTCirculatingSupplyAfter, "auraOFTCirculatingSupply").to.be.eq(
                auraOFTCirculatingSupplyBefore.add(dataBefore.abpTotalClaimableAura),
            );

            compareData("processClaimable(AURA)", dataBefore, dataAfter);
        });
        it("can withdraw auraBAL from sidechain", async () => {
            await auraBalVault.connect(deployer.signer).transferOwnership(canonical.auraBalProxyOFT.address);
            await auraBalOFT.connect(dao.signer).setUseCustomAdapterParams(false);

            const auraBalVaultBalance = await sidechain.auraBalVault.balanceOf(deployer.address);
            await sidechain.auraBalVault.withdraw(auraBalVaultBalance, deployer.address, deployer.address);
            const auraBalOFTBalanceBefore = await auraBalOFT.balanceOf(deployer.address);
            const bridgeAmount = auraBalOFTBalanceBefore.div(10);
            const dataBefore = await snapshotData(deployer, "before auraBalOFT sendFrom");

            const tx = await sidechain.auraBalOFT
                .connect(deployer.signer)
                .sendFrom(
                    deployer.address,
                    L1_CHAIN_ID,
                    deployer.address,
                    bridgeAmount,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    [],
                    {
                        value: NATIVE_FEE,
                    },
                );

            const dataAfter = await snapshotData(deployer, "before auraBalOFT sendFrom");
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
    });
    describe("Edge cases", () => {
        // setMinDstGas
        describe("harvest", () => {
            xit("harvest for one sidechain but try to process to another sidechain", async () => {
                //TODO
            });
            xit("process claimable multiple times", async () => {
                //TODO
            });
            xit("harvest multiple times correct sidechain without processClaimable", async () => {
                const WRONG_CHAIN_ID = 8765;
                await expect(
                    auraBalProxyOFT.connect(deployer.signer).harvest([L2_CHAIN_ID, WRONG_CHAIN_ID], [50, 50], 100),
                ).to.be.revertedWith("!srcChainId");
            });
            xit("harvest rewards from auraBalVault wrong srcChainIds", async () => {
                const WRONG_CHAIN_ID = 8765;
                await expect(
                    auraBalProxyOFT.connect(deployer.signer).harvest([WRONG_CHAIN_ID], [100], 100),
                ).to.be.revertedWith("!srcChainId");
            });
            xit("harvest rewards from auraBalVault partially wrong srcChainIds", async () => {
                const WRONG_CHAIN_ID = 8765;
                await expect(
                    auraBalProxyOFT.connect(deployer.signer).harvest([L2_CHAIN_ID, WRONG_CHAIN_ID], [50, 50], 100),
                ).to.be.revertedWith("!srcChainId");
            });
            it("harvest rewards from auraBalVault wrong parameters length ", async () => {
                await expect(
                    auraBalProxyOFT.connect(deployer.signer).harvest([L2_CHAIN_ID, L2_CHAIN_ID], [100], 100),
                ).to.be.revertedWith("!parity");
            });
            it("harvest rewards from auraBalVault correct chain wrong totalUnderlying", async () => {
                await expect(
                    auraBalProxyOFT.connect(deployer.signer).harvest([L2_CHAIN_ID], [100], 300),
                ).to.be.revertedWith("!totalUnderlyingSum");
            });
            it("harvest rewards from auraBalVault correct chain wrong totalUnderlying = ZERO", async () => {
                await expect(auraBalProxyOFT.connect(deployer.signer).harvest([L2_CHAIN_ID], [100], 0)).to.be.reverted;
            });
            it("harvest fails when caller is not authorized", async () => {
                await auraBalProxyOFT.updateAuthorizedHarvesters(deployer.address, false);
                expect(await auraBalProxyOFT.authorizedHarvesters(deployer.address)).eq(false);
                await expect(auraBalProxyOFT.harvest([L2_CHAIN_ID], [100], 100)).to.be.revertedWith("!harvester");
            });
            it("harvest fails when parameters are wrong", async () => {
                await auraBalProxyOFT.updateAuthorizedHarvesters(deployer.address, true);
                await expect(
                    auraBalProxyOFT.connect(deployer.signer).harvest([L2_CHAIN_ID, L1_CHAIN_ID], [100], 100),
                ).to.be.revertedWith("!parity");
            });
        });

        it("setConfig fails if caller is not the owner", async () => {
            await expect(
                canonical.auraBalProxyOFT.connect(alice.signer)[SET_CONFIG_SELECTOR](L2_CHAIN_ID, "0xdd467064", {
                    adapterParams: "0x",
                    zroPaymentAddress: DEAD_ADDRESS,
                }),
                "onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("setRewardReceiver fails if caller is not the owner", async () => {
            await expect(
                auraBalProxyOFT.connect(alice.signer).setRewardReceiver(L2_CHAIN_ID, ZERO_ADDRESS),
                "onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("updateAuthorizedHarvesters fails if caller is not the owner", async () => {
            await expect(
                auraBalProxyOFT.connect(alice.signer).updateAuthorizedHarvesters(ZERO_ADDRESS, true),
                "onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
        it("processClaimable fails if with wrong token", async () => {
            await expect(auraBalProxyOFT.processClaimable(ZERO_ADDRESS, DEAD_ADDRESS, L2_CHAIN_ID), "wrong token").to.be
                .reverted;
        });
        xit("processClaimable fails if reward receiver is not set", async () => {
            const SUPER_CHAIN_ID = 99999;
            expect(await auraBalProxyOFT.rewardReceiver(SUPER_CHAIN_ID), "reward receiver").to.be.eq(ZERO_ADDRESS);
            await expect(
                auraBalProxyOFT.processClaimable(ZERO_ADDRESS, ZERO_ADDRESS, L2_CHAIN_ID),
                "receiver != address(0)",
            ).to.be.revertedWith("!receiver");
        });
        xit("processClaimable fails if there are no rewards", async () => {
            const SUPER_CHAIN_ID = 99999;
            await auraBalProxyOFT.setRewardReceiver(SUPER_CHAIN_ID, DEAD_ADDRESS);
            await expect(
                auraBalProxyOFT.processClaimable(ZERO_ADDRESS, ZERO_ADDRESS, SUPER_CHAIN_ID),
                "reward > 0",
            ).to.be.revertedWith("!reward");
        });
    });
});
