import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import { deployPhase1, deployPhase2, deployPhase3 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { CrvDepositor, CvxCrvToken } from "../types/generated";

describe("CrvDepositor", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let crvDepositor: CrvDepositor;
    let cvxCrv: CvxCrvToken;
    let deployer: Signer;
    let deployerAddress: string;
    let alice: Signer;
    let aliceAddress: string;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();

        mocks = await deployMocks(deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(deployer, mocks.addresses);
        const phase2 = await deployPhase2(deployer, phase1, multisigs, mocks.namingConfig);
        const contracts = await deployPhase3(
            hre,
            deployer,
            phase2,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        crvDepositor = contracts.crvDepositor.connect(alice);
        cvxCrv = contracts.cvxCrv.connect(alice);

        const crvBalance = await mocks.crv.balanceOf(deployerAddress);

        const calls = [await mocks.crv.transfer(aliceAddress, crvBalance.mul(90).div(100))];

        await Promise.all(calls.map(tx => tx.wait()));
    });

    it("@method CrvDepositor.deposit", async () => {
        const lock = true;
        const stakeAddress = "0x0000000000000000000000000000000000000000";
        const crvBalance = await mocks.crv.balanceOf(aliceAddress);

        let tx = await mocks.crv.connect(alice).approve(crvDepositor.address, crvBalance);
        await tx.wait();

        tx = await crvDepositor["deposit(uint256,bool,address)"](crvBalance, lock, stakeAddress);
        await tx.wait();

        const cvxCrvBalance = await cvxCrv.balanceOf(aliceAddress);
        expect(cvxCrvBalance.toString()).to.equal(crvBalance.toString());
    });
});
