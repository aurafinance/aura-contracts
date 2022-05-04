import { expect } from "chai";
import { ContractTransaction, Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { Account } from "types";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../scripts/deploySystem";
import { deployContract } from "../tasks/utils";
import {
    BN,
    getTimestamp,
    increaseTime,
    ONE_DAY,
    ONE_WEEK,
    simpleToExactAmount,
    ZERO,
    ZERO_ADDRESS,
} from "../test-utils";
import { impersonateAccount } from "../test-utils/fork";
import { AuraLocker, AuraToken } from "../types/generated";
import balanceData from "./auraLockerBalanceData.json";

console.log(balanceData);

enum UserName {
    alice = "alice",
    bob = "bob",
    carol = "carol",
    daniel = "daniel",
}

enum ActionName {
    lock = "lock",
    processExpiredClaim = "processExpiredClaim",
    processExpiredRelock = "processExpiredRelock",
    checkpointEpoch = "checkpointEpoch",
    delegate1 = "delegate 1",
    delegate2 = "delegate 2",
    delegate3 = "delegate 3",
    balances = "balances",
}

interface Balance {
    user: UserName;
    balanceOf: BN;
    totalSupply: BN;
    votes: BN;
}

interface Action {
    user: UserName;
    action: ActionName;
    amount: BN;
}

interface EpochGroup {
    epoch: number;
    balances: Balance[];
    actions: Action[];
}

describe("AuraLockerBalances", () => {
    let auraLocker: AuraLocker;
    let cvx: AuraToken;

    let groupedData: EpochGroup[];

    let alice: Account;
    let bob: Account;
    let carol: Account;
    let daniel: Account;

    before(async () => {
        const accounts = await ethers.getSigners();
        const deployer = accounts[0];

        const mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[1], accounts[2], accounts[3]);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        const phase2 = await deployPhase2(
            hre,
            deployer,
            phase1,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.connect(accounts[3]).setProtectPool(false);
        const contracts = await deployPhase4(hre, deployer, phase3, mocks.addresses);

        alice = {
            signer: accounts[4],
            address: await accounts[4].getAddress(),
        };
        bob = {
            signer: accounts[5],
            address: await accounts[5].getAddress(),
        };
        carol = {
            signer: accounts[6],
            address: await accounts[6].getAddress(),
        };
        daniel = {
            signer: accounts[7],
            address: await accounts[7].getAddress(),
        };

        const booster = contracts.booster;
        auraLocker = contracts.cvxLocker;
        cvx = contracts.cvx;

        const operatorAccount = await impersonateAccount(booster.address);
        await cvx.connect(operatorAccount.signer).mint(operatorAccount.address, simpleToExactAmount(100000, 18));
        await cvx.connect(alice.signer).approve(auraLocker.address, simpleToExactAmount(10000));
        await cvx.connect(operatorAccount.signer).transfer(bob.address, simpleToExactAmount(10000));
        await cvx.connect(bob.signer).approve(auraLocker.address, simpleToExactAmount(10000));
        await cvx.connect(operatorAccount.signer).transfer(carol.address, simpleToExactAmount(10000));
        await cvx.connect(carol.signer).approve(auraLocker.address, simpleToExactAmount(10000));
        await cvx.connect(operatorAccount.signer).transfer(daniel.address, simpleToExactAmount(10000));
        await cvx.connect(daniel.signer).approve(auraLocker.address, simpleToExactAmount(10000));

        const parsedData = balanceData.map(d => ({
            epoch: d.time,
            user: d.user as UserName,
            action: d.action as ActionName,
            amount: d.amount == null ? undefined : BN.from(d.amount),
            balanceOf: d.amount == null ? undefined : BN.from(d.amount),
            totalSupply: d.amount == null ? undefined : BN.from(d.amount),
            votes: d.amount == null ? undefined : BN.from(d.amount),
        }));

        groupedData = [];
        parsedData.map(d => {
            let len = groupedData.length;
            if (len == 0 || groupedData[len - 1].epoch != d.epoch) {
                groupedData.push({
                    epoch: d.epoch,
                    balances: [],
                    actions: [],
                });
                len += 1;
            }
            if (d.action == "balances") {
                groupedData[len - 1].balances.push({
                    user: d.user,
                    balanceOf: d.balanceOf,
                    totalSupply: d.totalSupply,
                    votes: d.votes,
                });
            } else {
                groupedData[len - 1].actions.push({
                    user: d.user,
                    action: d.action,
                    amount: d.amount,
                });
            }
        });
    });
    it("has the data", async () => {
        expect(groupedData.length).eq(23);
    });
});
