import { expect } from "chai";
import { BigNumber, ContractTransaction, Signer } from "ethers";
import { formatEther, parseEther } from "ethers/lib/utils";
import hre, { ethers } from "hardhat";
import { table } from "table";
import { EVENTS } from "../shared/PausableProxyOFT.behaviour";

import {
    BN,
    getTimestamp,
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
    BaseRewardPool4626__factory,
    ERC20,
    MockERC20__factory,
    VirtualBalanceRewardPool__factory,
} from "../../types/generated";
import balanceData from "./auraBalProxyOFTBalances.json";
import {
    L1TestSetup,
    L2TestSetup,
    SidechainDeployed,
    SideChainTestSetup,
    sidechainTestSetup,
} from "./sidechainTestSetup";

// Types
enum UserName {
    alice = "alice",
    bob = "bob",
    carol = "carol",
    daniel = "daniel",
}
interface Action {
    user: UserName;
    action: ActionName;
    actionArgs: string;
    amount: BN;
}
enum ActionName {
    balances = "balances",

    l1BridgeToL2 = "l1BridgeToL2",
    l1VaultDeposit = "l1VaultDeposit",
    l1VaultWithdraw = "l1VaultWithdraw",
    l1VaultGetReward = "l1VaultGetReward",
    l1VaultTransfer = "l1VaultTransfer",
    l1VaultHarvest = "l1VaultHarvest",
    l1OFTHarvest = "l1OFTHarvest",
    l1OFTProcessClaimableCvxCrv = "l1OFTProcessClaimableCvxCrv",
    l1OFTProcessClaimableCvx = "l1OFTProcessClaimableCvx",
    l2BridgeToL1 = "l2BridgeToL1",
    l2VaultDeposit = "l2VaultDeposit",
    l2VaultWithdraw = "l2VaultWithdraw",
    l2VaultGetReward = "l2VaultGetReward",
    l2VaultTransfer = "l2VaultTransfer",
    l2VaultHarvest = "l2VaultHarvest",
    l2OFTransfer = "l2OFTransfer",
}
interface Balance {
    user: UserName;
    auraBalBalanceOf: BN;
    auraBalanceOf: BN;
    auraBalOFTBalanceOf: BN;
    auraOFTBalanceOf: BN;
    auraBalVaultBalanceOf: BN;
    sidechainAuraBalVaultBalanceOf: BN;
}
interface EpochGroup {
    epoch: number;
    balances: Balance[];
    actions: Action[];
}
type Nullable<T> = T | null;

const userToAccount = async (user: UserName): Promise<Account> => {
    const signers = await ethers.getSigners();
    const signerToAccount = async (i: number) => ({ signer: signers[i], address: await signers[i].getAddress() });
    switch (user.toString()) {
        case UserName.alice.toString():
            return await signerToAccount(4);
        case UserName.bob.toString():
            return await signerToAccount(5);
        case UserName.carol.toString():
            return await signerToAccount(6);
        case UserName.daniel.toString():
            return await signerToAccount(7);
        default:
            return null;
    }
};
const getGroupedData = (): EpochGroup[] => {
    const scale = simpleToExactAmount(1);
    // multiply by 10 to allow at least one decimal point
    const parseAmount = (amount: Nullable<number>) => (amount == null ? 0 : BN.from(amount * 10).mul(scale.div(10)));

    const parsedData = balanceData.map(d => ({
        epoch: d.epoch,
        user: d.user as UserName,
        action: d.action as ActionName,
        actionArgs: d.actionArgs,
        amount: parseAmount(d.amount),
        auraBalBalanceOf: parseAmount(d.auraBalBalanceOf),
        auraBalanceOf: parseAmount(d.auraBalanceOf),
        auraBalOFTBalanceOf: parseAmount(d.auraBalOFTBalanceOf),
        auraBalVaultBalanceOf: parseAmount(d.auraBalVaultBalanceOf),
        sidechainAuraBalVaultBalanceOf: parseAmount(d.sidechainAuraBalVaultBalanceOf),
    }));
    const groupedData = [];
    parsedData.forEach(d => {
        let len = groupedData.length;
        if (len == 0 || groupedData[len - 1].epoch != d.epoch) {
            groupedData.push({
                epoch: d.epoch,
                balances: [],
                actions: [],
            });
            len += 1;
        }
        if (d.action == ActionName.balances) {
            groupedData[len - 1].balances.push({
                user: d.user,
                auraBalBalanceOf: d.auraBalBalanceOf,
                auraBalanceOf: d.auraBalanceOf,
                auraBalOFTBalanceOf: d.auraBalOFTBalanceOf,
                auraBalVaultBalanceOf: d.auraBalVaultBalanceOf,
                sidechainAuraBalVaultBalanceOf: d.sidechainAuraBalVaultBalanceOf,
            });
        } else {
            groupedData[len - 1].actions.push({
                user: d.user,
                action: d.action,
                actionArgs: d.actionArgs,
                amount: d.amount,
            });
        }
    });
    return groupedData;
};

const debug = true;
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;
const NATIVE_FEE = simpleToExactAmount("0.2");

describe("AuraBalProxyOFTBalances", () => {
    /* -- Declare shared variables -- */
    let signers: Signer[];
    let accounts: { [key: string]: Account };
    let deployer: Account;
    let alice: Account; // TODO , DELETE ALICE
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
        signers = await ethers.getSigners();
        // signers  0 - 3 reserved for multisig
        deployer = await impersonateAccount(await signers[0].getAddress());
        alice = await impersonateAccount(await signers[4].getAddress());
        accounts = {};
        accounts[UserName.alice] = await impersonateAccount(await signers[4].getAddress());
        accounts[UserName.bob] = await impersonateAccount(await signers[5].getAddress());
        accounts[UserName.carol] = await impersonateAccount(await signers[6].getAddress());
        accounts[UserName.daniel] = await impersonateAccount(await signers[7].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, signers, L1_CHAIN_ID, L2_CHAIN_ID);
        ({ l1, l2 } = testSetup);
        auraBalProxyOFT = l1.canonical.auraBalProxyOFT;
        cvxCrv = l1.phase2.cvxCrv;
        ({ sidechain } = l2);
        auraBalOFT = sidechain.auraBalOFT;

        dao = await impersonateAccount(l2.multisigs.daoMultisig);
        guardian = await impersonateAccount(l2.multisigs.pauseGuardian);
        // Send some balances in order to test
        // dirty trick to get some cvx balance.
        const cvxDepositorAccount = await impersonateAccount(testSetup.l1.phase2.vestedEscrows[0].address);
        const cvxConnected = l1.phase2.cvx.connect(cvxDepositorAccount.signer);
        const cvxBalance = await cvxConnected.balanceOf(cvxDepositorAccount.address);
        await cvxConnected.transfer(deployer.address, cvxBalance);

        // dirty trick to get some crvCvx balance.
        const crvDepositorAccount = await impersonateAccount(l1.phase2.crvDepositor.address);
        const cvxCrvConnected = l1.phase2.cvxCrv.connect(crvDepositorAccount.signer);
        await cvxCrvConnected.mint(deployer.address, simpleToExactAmount(100));
        for (const userName in accounts) {
            await cvxCrvConnected.mint(accounts[userName].address, simpleToExactAmount(100));

            await l1.phase2.cvxCrv
                .connect(accounts[userName].signer)
                .approve(auraBalProxyOFT.address, ethers.constants.MaxUint256);
        }
    };
    async function snapshotData(reason = "snapshot") {
        // const auraBalBalanceOf = await cvxCrv.balanceOf(sender.address);
        // const auraBalanceOf = await l1.phase2.cvx.balanceOf(sender.address);
        // const auraBalOFTBalanceOf = await auraBalOFT.balanceOf(sender.address);
        // const sidechainAuraBalVaultBalanceOf = await sidechain.auraBalVault.balanceOf(sender.address);
        const accountsBalances = {};
        for (const userName in accounts) {
            const auraBalBalanceOf = await cvxCrv.balanceOf(accounts[userName].address);
            const auraBalanceOf = await l1.phase2.cvx.balanceOf(accounts[userName].address);
            const auraBalOFTBalanceOf = await auraBalOFT.balanceOf(accounts[userName].address);
            const auraOFTBalanceOf = await sidechain.auraOFT.balanceOf(accounts[userName].address);
            const auraBalVaultBalanceOf = await l1.vaultDeployment.vault.balanceOf(accounts[userName].address);

            const sidechainAuraBalVaultBalanceOf = await sidechain.auraBalVault.balanceOf(accounts[userName].address);
            accountsBalances[userName] = {
                auraBalBalanceOf,
                auraBalanceOf,
                auraBalOFTBalanceOf,
                auraOFTBalanceOf,
                auraBalVaultBalanceOf,
                sidechainAuraBalVaultBalanceOf,
            };
        }

        const auraBalOFTTotalSupply = await auraBalOFT.totalSupply();
        const auraBalOFTCirculatingSupply = await auraBalOFT.circulatingSupply();
        const auraOFTBalanceOfStrategy = await sidechain.auraOFT.balanceOf(sidechain.auraBalStrategy.address);
        const auraBalOFTBalanceOfStrategy = await auraBalOFT.balanceOf(sidechain.auraBalStrategy.address);
        const proxyVaultBalance = await l1.vaultDeployment.vault.balanceOf(auraBalProxyOFT.address);
        const auraBalVaultTotalSupply = await l1.vaultDeployment.vault.totalSupply();

        const sidechainAuraBalVaultTotalAssets = await sidechain.auraBalVault.totalAssets();
        const sidechainAuraBalVaultTotalUnderlying = await sidechain.auraBalVault.totalUnderlying();
        const sidechainAuraBalVaultTotalSupply = await sidechain.auraBalVault.totalSupply();

        const abpClaimableAuraBal = await auraBalProxyOFT.claimable(cvxCrv.address, L2_CHAIN_ID);
        const abpClaimableAura = await auraBalProxyOFT.claimable(l1.phase2.cvx.address, L2_CHAIN_ID);
        const abpTotalClaimableAuraBal = await auraBalProxyOFT.totalClaimable(cvxCrv.address);
        const abpTotalClaimableAura = await auraBalProxyOFT.totalClaimable(l1.phase2.cvx.address);
        const abpInternalTotalSupply = await auraBalProxyOFT.internalTotalSupply();
        const abpCirculatingSupply = await auraBalProxyOFT.circulatingSupply();
        const abpAuraBalBalance = await cvxCrv.balanceOf(auraBalProxyOFT.address);
        const abpAuraBalance = await l1.phase2.cvx.balanceOf(auraBalProxyOFT.address);

        let auraBalVaultBalanceOfUnderlyingProxy = auraBalVaultTotalSupply;
        if (!auraBalVaultTotalSupply.eq(0)) {
            // If total supply is zero it reverts
            auraBalVaultBalanceOfUnderlyingProxy = await l1.vaultDeployment.vault.balanceOfUnderlying(
                auraBalProxyOFT.address,
            );
        }

        let sidechainAuraBalVaultBalanceOfUnderlyingProxy = sidechainAuraBalVaultTotalSupply;
        if (!sidechainAuraBalVaultTotalSupply.eq(0)) {
            // If total supply is zero it reverts
            sidechainAuraBalVaultBalanceOfUnderlyingProxy = await sidechain.auraBalVault.balanceOfUnderlying(
                auraBalProxyOFT.address,
            );
        }

        if (false) {
            console.log(` snapshot ----------------------------  ${reason} ----------------------------`);

            for (const userName in accounts) {
                console.log(
                    `L1 auraBalBalanceOf[${userName}]      ${formatEther(accountsBalances[userName].auraBalBalanceOf)}`,
                );
                console.log(
                    `L1 auraBalanceOf[${userName}]         ${formatEther(accountsBalances[userName].auraBalanceOf)}`,
                );
                console.log(
                    `L2 auraBalVaultBalanceOf[${userName}] ${formatEther(
                        accountsBalances[userName].auraBalVaultBalanceOf,
                    )}`,
                );

                console.log(
                    `L2 auraBalOFTBalanceOf[${userName}]     ${formatEther(
                        accountsBalances[userName].auraBalOFTBalanceOf,
                    )}`,
                );
                console.log(
                    `L2 auraOFTBalanceOf[${userName}]     ${formatEther(accountsBalances[userName].auraOFTBalanceOf)}`,
                );

                console.log(
                    `L2 auraBalVaultBalanceOf[${userName}] ${formatEther(
                        accountsBalances[userName].sidechainAuraBalVaultBalanceOf,
                    )}`,
                );
            }

            // console.log(`L1 auraBalBalanceOf[sender]        ${formatEther(auraBalBalanceOf)}`);
            // console.log(`L1 auraBalanceOf[sender]           ${formatEther(auraBalanceOf)}`);

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

            // console.log(`L2 auraBalOFTBalanceOf             ${formatEther(auraBalOFTBalanceOf)}`);
            console.log(`L2 auraBalOFTTotalSupply         ${formatEther(auraBalOFTTotalSupply)}`);
            console.log(`L2 auraBalOFTCirculatingSupply   ${formatEther(auraBalOFTCirculatingSupply)}`);
            console.log(`L2 auraBalOFTBalanceOfStrategy   ${formatEther(auraBalOFTBalanceOfStrategy)}`);
            // console.log(`L2 auraOFTBalanceOfStrategy   ${formatEther(auraOFTBalanceOfStrategy)}`);
            // console.log(`L2 auraBalVaultBalanceOf         ${formatEther(sidechainAuraBalVaultBalanceOf)}`);
            console.log(`L2 auraBalVaultTotalAssets       ${formatEther(sidechainAuraBalVaultTotalAssets)}`);
            console.log(`L2 auraBalVaultTotalUnderlying   ${formatEther(sidechainAuraBalVaultTotalUnderlying)}`);
            console.log(`L2 auraBalVaultTotalSupply       ${formatEther(sidechainAuraBalVaultTotalSupply)}`);
            console.log(
                `L2 auraBalVaultBalanceOfUnderlyingProxy ${formatEther(sidechainAuraBalVaultBalanceOfUnderlyingProxy)}`,
            );
        }
        return {
            // auraBalBalanceOf,
            // auraBalanceOf,
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
            // auraBalOFTBalanceOf,
            auraBalOFTTotalSupply,
            auraBalOFTCirculatingSupply,
            auraBalOFTBalanceOfStrategy,
            auraOFTBalanceOfStrategy,
            // sidechainAuraBalVaultBalanceOf,
            sidechainAuraBalVaultTotalAssets,
            sidechainAuraBalVaultTotalUnderlying,
            sidechainAuraBalVaultTotalSupply,
            sidechainAuraBalVaultBalanceOfUnderlyingProxy,
            //  all accounts different balances
            accountsBalances,
        };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function compareData(test: string, before: any, after: any) {
        const compareObj = (objBefore, objAfter, property: string) => [
            formatEther(objBefore[property]),
            formatEther(objAfter[property]),
            objBefore[property].toString() === objAfter[property].toString(),
        ];

        const getDetails = (property: string) => compareObj(before, after, property);
        const getAccountDetails = (account: string, property: string) =>
            compareObj(before.accountsBalances[account], after.accountsBalances[account], property);
        // const getAccountDetails = (account:string, property: string) => [
        //     before.accountsBalances[account][property],
        //     after.accountsBalances[account][property],
        //     before.accountsBalances[account][property].toString() === after.accountsBalances[account][property].toString(),
        // ];

        // const getDetails = (property: string) => [
        //     formatEther(before[property]),
        //     formatEther(after[property]),
        //     before[property].toString() === after[property].toString(),
        // ];
        // const getAccountDetails = (account:string, property: string) => [
        //     formatEther(before.accountsBalances[account][property]),
        //     formatEther(after.accountsBalances[account][property]),
        //     before.accountsBalances[account][property].toString() === after.accountsBalances[account][property].toString(),
        // ];

        const accountsBalances = [];
        for (const userName in before.accountsBalances) {
            accountsBalances.push([
                `L1 auraBalBalanceOf[${userName}]     `,
                ...getAccountDetails(userName, "auraBalBalanceOf"),
            ]);
            accountsBalances.push([
                `L1 auraBalanceOf[${userName}]        `,
                ...getAccountDetails(userName, "auraBalanceOf"),
            ]);
            accountsBalances.push([
                `L1 auraBalVaultBalanceOf[${userName}]`,
                ...getAccountDetails(userName, "auraBalVaultBalanceOf"),
            ]);
            accountsBalances.push([
                `L2 auraBalOFTBalanceOf[${userName}]    `,
                ...getAccountDetails(userName, "auraBalOFTBalanceOf"),
            ]);
            accountsBalances.push([
                `L2 auraOFTBalanceOf[${userName}]    `,
                ...getAccountDetails(userName, "auraOFTBalanceOf"),
            ]);
            accountsBalances.push([
                `L2 auraBalVaultBalanceOf[${userName}]`,
                ...getAccountDetails(userName, "sidechainAuraBalVaultBalanceOf"),
            ]);
        }
        const testData = [
            // ["L1 auraBalBalanceOf[sender]        ", ...getDetails("auraBalBalanceOf")],
            // ["L1 auraBalanceOf[sender]           ", ...getDetails("auraBalanceOf")],
            ...accountsBalances,
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
            // ["L2 auraBalOFTBalanceOf             ", ...getDetails("auraBalOFTBalanceOf")],
            ["L2 auraBalOFTTotalSupply         ", ...getDetails("auraBalOFTTotalSupply")],
            ["L2 auraBalOFTCirculatingSupply   ", ...getDetails("auraBalOFTCirculatingSupply")],
            ["L2 auraBalOFTBalanceOfStrategy   ", ...getDetails("auraBalOFTBalanceOfStrategy")],
            ["L2 auraOFTBalanceOfStrategy   ", ...getDetails("auraOFTBalanceOfStrategy")],
            // ["L2 auraBalVaultBalanceOf         ", ...getDetails("sidechainAuraBalVaultBalanceOf")],
            ["L2 auraBalVaultTotalAssets       ", ...getDetails("sidechainAuraBalVaultTotalAssets")],
            ["L2 auraBalVaultTotalUnderlying   ", ...getDetails("sidechainAuraBalVaultTotalUnderlying")],
            ["L2 auraBalVaultTotalSupply       ", ...getDetails("sidechainAuraBalVaultTotalSupply")],
            ["L2 auraBalVaultBalanceOfUndProxy ", ...getDetails("sidechainAuraBalVaultBalanceOfUnderlyingProxy")],
        ];

        if (debug) {
            console.log(`----------------------------  ${test} ----------------------------`);
            console.log(table([["Data", "Before", "After", "Equal"], ...testData.filter(t => !t[3] || false)]));
        }
    }
    async function expectSendFromL1toL2(
        test: string,
        sender: Account,
        receiver: Account,
        owner: Account,
        amount: BigNumber,
    ): Promise<ContractTransaction> {
        const { canonical } = l1;
        const { sidechain } = l2;
        // const defaultOFTAdapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 600_000]);
        const defaultOFTAdapterParams = [];

        await l1.phase2.cvxCrv.connect(sender.signer).approve(canonical.auraBalProxyOFT.address, amount);

        const tx = await canonical.auraBalProxyOFT
            .connect(sender.signer)
            .sendFrom(
                owner.address,
                L2_CHAIN_ID,
                receiver.address,
                amount,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                defaultOFTAdapterParams,
                {
                    value: NATIVE_FEE,
                },
            );
        // Verify it was send from L1
        await expect(tx)
            .to.emit(canonical.auraBalProxyOFT, "SendToChain")
            .withArgs(L2_CHAIN_ID, owner.address, receiver.address.toLowerCase(), amount);

        //  expect(dataAfter.proxyOftOutflow, "outflow").to.eq(dataBefore.proxyOftOutflow.add(amount));
        //  expect(dataAfter.proxyOftInflow, "inflow").to.eq(dataBefore.proxyOftInflow);
        //  expect(dataAfter.proxyOftCirculatingSupply, "proxyOft CirculatingSupply").to.eq(
        //      dataBefore.proxyOftCirculatingSupply.sub(amount),
        //  );

        // Verify it was received on L2
        await expect(tx)
            .to.emit(sidechain.auraBalOFT, EVENTS.RECEIVED_FROM_CHAIN)
            .withArgs(L1_CHAIN_ID, receiver.address, amount);
        await expect(tx).to.emit(sidechain.auraBalOFT, "Transfer").withArgs(ZERO_ADDRESS, receiver.address, amount);
        //  expect(dataAfter.oftBalanceOf, "oft balanceOf").to.eq(dataBefore.oftBalanceOf.add(amount));
        //  expect(dataAfter.oftCirculatingSupply, "oft circulatingSupply").to.eq(
        //      dataBefore.oftCirculatingSupply.add(amount),
        //  );
        //  expect(dataAfter.oftTotalSupply, "oft balanceOf").to.eq(dataBefore.oftTotalSupply.add(amount));

        return tx;
    }

    async function expectSendFromL2toL1(test: string, sender: Account, receiver: Account, owner: Account, amount: BN) {
        const { canonical } = l1;
        const { sidechain } = l2;
        const defaultOFTAdapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 600_000]);
        // const proxyOftUseCustom = await ctx.proxyOft.useCustomAdapterParams();
        // proxyOftAdapterParams = proxyOftUseCustom ? defaultOFTAdapterParams : [];

        await sidechain.auraBalOFT.connect(owner.signer).approve(sidechain.auraBalOFT.address, amount);

        // const dataBefore = await snapshotData(ctx, { from: owner.address, to: receiver.address });

        // When the proxy receives tokens it flows as usual
        // const oftAdapterParams: BytesLike = (await sidechain.auraBalOFT.useCustomAdapterParams()) ? defaultOFTAdapterParams : [];
        const tx = await sidechain.auraBalOFT
            .connect(sender.signer)
            .sendFrom(
                owner.address,
                L1_CHAIN_ID,
                receiver.address,
                amount,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                defaultOFTAdapterParams,
                { value: NATIVE_FEE },
            );

        // const dataAfter = await snapshotData(ctx, { from: owner.address, to: receiver.address });
        // compareData(test, dataBefore, dataAfter);

        // Verify it was send from L2
        await expect(tx).to.emit(sidechain.auraBalOFT, "Transfer").withArgs(owner.address, ZERO_ADDRESS, amount);
        await expect(tx)
            .to.emit(sidechain.auraBalOFT, "SendToChain")
            .withArgs(L1_CHAIN_ID, owner.address, receiver.address.toLowerCase(), amount);

        // expect(dataAfter.oftBalanceOfFrom, "oft balanceOf").to.eq(dataBefore.oftBalanceOfFrom.sub(amount));
        // expect(dataAfter.oftCirculatingSupply, "oft circulatingSupply").to.eq(dataBefore.oftCirculatingSupply.sub(amount));
        // expect(dataAfter.oftTotalSupply, "oft balanceOf").to.eq(dataBefore.oftTotalSupply.sub(amount));

        // Verify it was received on L1
        // await expect(tx).to.emit(proxyOft, EVENTS.RECEIVED_FROM_CHAIN).withArgs(L2_CHAIN_ID, receiver.address, amount);
        // expect(dataAfter.proxyOftCirculatingSupply, "proxyOftCirculatingSupply").to.eq(
        //     dataBefore.proxyOftCirculatingSupply.add(amount),
        // );
        // expect(dataAfter.tokenBalanceOfTo, "tokenBalanceOfTo").to.eq(dataBefore.tokenBalanceOfTo.add(amount));

        return tx;
    }
    async function expectDepositVaultL1(
        test: string,
        sender: Account,
        receiver: Account,
        amount: BigNumber,
    ): Promise<ContractTransaction> {
        const { canonical } = l1;
        const { sidechain } = l2;

        await l1.phase2.cvxCrv.connect(sender.signer).approve(l1.vaultDeployment.vault.address, amount);
        const tx = await l1.vaultDeployment.vault.connect(sender.signer).deposit(amount, receiver.address);
        return tx;
    }

    async function expectDepositVaultL2(
        test: string,
        sender: Account,
        receiver: Account,
        amount: BigNumber,
    ): Promise<ContractTransaction> {
        const { canonical } = l1;
        const { sidechain } = l2;

        await sidechain.auraBalOFT.connect(sender.signer).approve(sidechain.auraBalVault.address, amount);
        const tx = await sidechain.auraBalVault.connect(sender.signer).deposit(amount, receiver.address);
        return tx;
    }
    async function expectL2OFTTransfer(
        test: string,
        sender: Account,
        receiver: Account,
        amount: BigNumber,
    ): Promise<ContractTransaction> {
        const { canonical } = l1;
        const { sidechain } = l2;

        const tx = await sidechain.auraBalOFT.connect(sender.signer).transfer(receiver.address, amount);
        return tx;
    }
    async function forceHarvestRewards(amount = parseEther("10"), minOut = ZERO, signer = deployer.signer) {
        const { mocks, phase2 } = l1;
        const { crv } = mocks;
        const { strategy, vault, auraRewards } = l1.vaultDeployment;

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
    async function expectAuraBalProxyOFTHarvest() {
        const sidechainAuraBalVaultTotalUnderlying = await sidechain.auraBalVault.totalUnderlying();
        const totalUnderlyings = [sidechainAuraBalVaultTotalUnderlying];
        const totalUnderlyingSum = sidechainAuraBalVaultTotalUnderlying;

        return await auraBalProxyOFT.connect(deployer.signer).harvest(totalUnderlyings, totalUnderlyingSum);
    }
    before(async () => {
        idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
        await setup();
    });
    after(async () => {
        await hre.ethers.provider.send("evm_revert", [idSnapShot]);
    });
    describe("Run all the epochs", () => {
        for (const epochData of getGroupedData()) {
            describe(`Epoch ${epochData.epoch}`, () => {
                let startTime: BN;
                let epochId: number;
                before(async () => {
                    startTime = await getTimestamp();
                    epochId = Math.floor(epochData.epoch);
                    console.log("Epoch", startTime, epochId);
                });
                after(async () => {
                    await increaseTime(ONE_WEEK);
                });
                xit("can transfer auraBAL to sidechain", async () => {
                    const dataBefore = await snapshotData("before bridge");
                    const dataAfter = await snapshotData("after bridge");
                    compareData("bridge(AURABAL)", dataBefore, dataAfter);
                });
                // Just a sanity check to ensure that the balance lookups can just be mapped by index

                const checkBalances = (wen: string) => {
                    describe(`checking balances ${wen}`, () => {
                        it(`check balances at epoch ${epochData.epoch} for users`, async () => {
                            const data = await snapshotData("before");
                            const { accountsBalances } = data;
                            const expectBalancesForUser = (user: string, idx: number) => {
                                expect(epochData.balances[idx].auraBalBalanceOf, `${user} auraBalBalanceOf`).eq(
                                    accountsBalances[user].auraBalBalanceOf,
                                );
                                expect(epochData.balances[idx].auraBalanceOf, `${user} auraBalanceOf`).eq(
                                    accountsBalances[user].auraBalanceOf,
                                );
                                expect(epochData.balances[idx].auraBalOFTBalanceOf, `${user} auraBalOFTBalanceOf`).eq(
                                    accountsBalances[user].auraBalOFTBalanceOf,
                                );
                                // expect(epochData.balances[idx].auraOFTBalanceOf, `${user} auraBalOFTBalanceOf`).eq(accountsBalances[user].auraOFTBalanceOf);

                                expect(
                                    epochData.balances[idx].auraBalVaultBalanceOf,
                                    `${user} auraBalVaultBalanceOf`,
                                ).eq(accountsBalances[user].auraBalVaultBalanceOf);
                                expect(
                                    epochData.balances[idx].sidechainAuraBalVaultBalanceOf,
                                    `${user} sidechainAuraBalVaultBalanceOf`,
                                ).eq(accountsBalances[user].sidechainAuraBalVaultBalanceOf);
                            };
                            expectBalancesForUser(UserName.alice, 0);
                            expectBalancesForUser(UserName.bob, 1);
                            expectBalancesForUser(UserName.carol, 2);
                            expectBalancesForUser(UserName.daniel, 3);
                        });
                    });
                };
                if (epochData.balances.length > 0) {
                    it("has balances in correct order", () => {
                        expect(epochData.balances[0].user).eq(UserName.alice);
                        expect(epochData.balances[1].user).eq(UserName.bob);
                        expect(epochData.balances[2].user).eq(UserName.carol);
                        expect(epochData.balances[3].user).eq(UserName.daniel);
                    });
                    checkBalances("before");
                }
                if (epochData.actions.length > 0) {
                    describe("performing actions", () => {
                        let dataBefore;
                        let dataAfter;
                        let testCase = "test";
                        before(async () => {
                            dataBefore = await snapshotData(`before ${epochData.epoch}`);
                        });
                        after(async () => {
                            dataAfter = await snapshotData(`after ${epochData.epoch}`);
                            compareData(`test at epoch ${epochData.epoch}`, dataBefore, dataAfter);
                        });

                        for (const actionData of epochData.actions) {
                            switch (actionData.action) {
                                case ActionName.l1BridgeToL2:
                                    it(`${actionData.user} bridges from L1 to L2 ${formatEther(
                                        actionData.amount,
                                    )}`, async () => {
                                        const sender = accounts[actionData.user];
                                        const [from, to] = actionData.actionArgs
                                            .split(",")
                                            .map(account => accounts[account]);
                                        const users = actionData.actionArgs.split(",");
                                        testCase = `bridge L1 => L2 sender: ${actionData.user}, from ${users[0]}, to ${
                                            users[1]
                                        }, amount ${formatEther(actionData.amount)}`;
                                        console.log(testCase);
                                        await expectSendFromL1toL2(testCase, sender, to, from, actionData.amount);
                                    });
                                    break;
                                case ActionName.l1VaultDeposit:
                                    it(`${actionData.user} deposits auraBAL on canonical vault ${formatEther(
                                        actionData.amount,
                                    )}`, async () => {
                                        const sender = accounts[actionData.user];
                                        const to = accounts[actionData.actionArgs];
                                        testCase = `l1VaultDeposit sender: ${actionData.user}, from ${
                                            actionData.user
                                        }, to ${actionData.actionArgs}, amount ${formatEther(actionData.amount)}`;
                                        console.log(testCase);
                                        await expectDepositVaultL1(testCase, sender, to, actionData.amount);
                                    });
                                    break;
                                case ActionName.l1VaultHarvest:
                                    it(`${actionData.user} harvest auraBALVault on canonical ${formatEther(
                                        actionData.amount,
                                    )}`, async () => {
                                        // const sender = accounts[actionData.user]
                                        testCase = `l1VaultHarvest sender: ${actionData.user}, amount ${formatEther(
                                            actionData.amount,
                                        )}`;
                                        console.log(testCase);
                                        const auraBalVaultOwner = await impersonateAccount(
                                            await l1.vaultDeployment.vault.owner(),
                                        );
                                        await l1.vaultDeployment.vault
                                            .connect(auraBalVaultOwner.signer)
                                            .updateAuthorizedHarvesters(deployer.address, true);
                                        await forceHarvestRewards(actionData.amount);
                                    });
                                    break;
                                case ActionName.l1OFTHarvest:
                                    it(`${actionData.user} harvest auraBAL OFT on canonical ${formatEther(
                                        actionData.amount,
                                    )}`, async () => {
                                        // const sender = accounts[actionData.user]
                                        testCase = `l1OFTHarvest sender: ${actionData.user}, amount ${formatEther(
                                            actionData.amount,
                                        )}`;
                                        await auraBalProxyOFT.connect(dao.signer).setHarvestSrcChainIds([L2_CHAIN_ID]);
                                        await auraBalProxyOFT
                                            .connect(dao.signer)
                                            .updateAuthorizedHarvesters(deployer.address, true);

                                        console.log(testCase);
                                        await expectAuraBalProxyOFTHarvest();
                                    });
                                    break;
                                case ActionName.l1OFTProcessClaimableCvx:
                                    it(`${actionData.user} process claimable Cvx ${formatEther(
                                        actionData.amount,
                                    )}`, async () => {
                                        // const sender = accounts[actionData.user]
                                        testCase = `l1OFTProcessClaimableCvx sender: ${
                                            actionData.user
                                        }, amount ${formatEther(actionData.amount)}`;

                                        console.log(testCase);
                                        const tx = await auraBalProxyOFT.processClaimable(
                                            l1.phase2.cvx.address,
                                            L2_CHAIN_ID,
                                            {
                                                value: NATIVE_FEE,
                                            },
                                        );
                                    });
                                    break;
                                case ActionName.l1OFTProcessClaimableCvxCrv:
                                    it(`${actionData.user} process claimable CvxCrv  ${formatEther(
                                        actionData.amount,
                                    )}`, async () => {
                                        // const sender = accounts[actionData.user]
                                        testCase = `l1OFTProcessClaimableCvxCrv sender: ${
                                            actionData.user
                                        }, amount ${formatEther(actionData.amount)}`;

                                        console.log(testCase);
                                        const tx = await auraBalProxyOFT.processClaimable(cvxCrv.address, L2_CHAIN_ID, {
                                            value: NATIVE_FEE,
                                        });
                                    });
                                    break;
                                case ActionName.l2VaultDeposit:
                                    it(`${actionData.user} deposits auraBAL on sidechain vault ${formatEther(
                                        actionData.amount,
                                    )}`, async () => {
                                        const sender = accounts[actionData.user];
                                        const to = accounts[actionData.actionArgs];
                                        testCase = `l2VaultDeposit sender: ${actionData.user}, from ${
                                            actionData.user
                                        }, to ${actionData.actionArgs}, amount ${formatEther(actionData.amount)}`;
                                        console.log(testCase);
                                        await expectDepositVaultL2(testCase, sender, to, actionData.amount);
                                    });
                                    break;
                                case ActionName.l2OFTransfer:
                                    it(`${actionData.user} transfers auraBAL on sidechain ${formatEther(
                                        actionData.amount,
                                    )}`, async () => {
                                        const sender = accounts[actionData.user];
                                        const to = accounts[actionData.actionArgs];
                                        testCase = `l2OFTransfer sender: ${actionData.user}, from ${
                                            actionData.user
                                        }, to ${actionData.actionArgs}, amount ${formatEther(actionData.amount)}`;
                                        console.log(testCase);
                                        await expectL2OFTTransfer(testCase, sender, to, actionData.amount);
                                    });
                                    break;
                                case ActionName.l2VaultHarvest:
                                    it(`${actionData.user} harvest sidechain vault  ${formatEther(
                                        actionData.amount,
                                    )}`, async () => {
                                        // const sender = accounts[actionData.user]
                                        testCase = `l2VaultHarvest sender: ${actionData.user}, amount ${formatEther(
                                            actionData.amount,
                                        )}`;

                                        console.log(testCase);
                                        const auraBalVaultOwner = await impersonateAccount(
                                            await sidechain.auraBalVault.owner(),
                                        );
                                        await sidechain.auraBalVault
                                            .connect(auraBalVaultOwner.signer)
                                            .updateAuthorizedHarvesters(deployer.address, true);
                                        await sidechain.auraBalVault.connect(deployer.signer)["harvest()"]();
                                    });
                                    break;
                                case ActionName.l2VaultTransfer:
                                    it(`${actionData.user} transfer sidechain vault  ${formatEther(
                                        actionData.amount,
                                    )}`, async () => {
                                        const sender = accounts[actionData.user];
                                        const to = accounts[actionData.actionArgs];
                                        testCase = `l2VaultTransfer sender: ${actionData.user}, amount ${formatEther(
                                            actionData.amount,
                                        )}`;

                                        console.log(testCase);

                                        await sidechain.auraBalVault
                                            .connect(sender.signer)
                                            .transfer(to.address, actionData.amount);
                                    });
                                    break;
                                case ActionName.l2VaultGetReward:
                                    it(`${actionData.user} get reward sidechain vault  ${formatEther(
                                        actionData.amount,
                                    )}`, async () => {
                                        const sender = accounts[actionData.user];
                                        testCase = `l2VaultGetReward sender: ${actionData.user}, amount ${formatEther(
                                            actionData.amount,
                                        )}`;

                                        console.log(testCase);
                                        const extraRewards = await sidechain.auraBalVault.extraRewards(0);
                                        const virtualBalanceRewardPool = VirtualBalanceRewardPool__factory.connect(
                                            extraRewards,
                                            sender.signer,
                                        );
                                        const earned = await virtualBalanceRewardPool.earned(sender.address);
                                        console.log("earned", earned);
                                        await virtualBalanceRewardPool["getReward()"]();
                                    });
                                    break;
                                default:
                                    break;
                            }
                        }
                    });
                }
            });
        }
    });
});
