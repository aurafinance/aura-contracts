import hre, { ethers } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";

describe("AuraClaimZap", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let deployer: Signer;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        mocks = await deployMocks(deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();
        const phase1 = await deployPhase1(deployer, mocks.addresses);
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
        await phase3.poolManager.setProtectPool(false);
        const contracts = await deployPhase4(deployer, phase3, mocks.addresses);
    });

    it("set approval for deposits", async () => {});
    it("check options for all combinations", async () => {});
    it("claim rewards from AuraLocker and cvxCrvStaking", async () => {});
    it("claims crv and then swaps for cxvCrv on balancer", async () => {});
});
