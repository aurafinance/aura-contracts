import hre, { ethers } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { Booster, CurveVoterProxy, AuraToken } from "../types/generated";
import { simpleToExactAmount, ZERO_ADDRESS } from "../test-utils";

describe("AuraToken", () => {
    let accounts: Signer[];
    let booster: Booster;
    let cvx: AuraToken;
    let mocks: DeployMocksResult;
    let voterProxy: CurveVoterProxy;

    let deployer: Signer;

    let alice: Signer;
    let aliceAddress: string;
    let aliceInitialCvxBalance: BigNumberish;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        mocks = await deployMocks(deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();
        const phase1 = await deployPhase1(deployer, mocks.addresses);
        const phase2 = await deployPhase2(deployer, phase1, multisigs, mocks.namingConfig);
        const phase3 = await deployPhase3(
            hre,
            deployer,
            phase2,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );
        const contracts = await deployPhase4(deployer, phase3, mocks.addresses);

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        booster = contracts.booster;
        cvx = contracts.cvx;
        voterProxy = phase1.voterProxy;
        const tx = await cvx.transfer(aliceAddress, ethers.utils.parseEther("100"));
        await tx.wait();

        aliceInitialCvxBalance = await cvx.balanceOf(aliceAddress);
    });

    beforeEach(async () => {
        /* before each context */
    });

    it("initial configuration is correct", async () => {
        expect(await cvx.name()).to.equal(mocks.namingConfig.cvxName);
        expect(await cvx.symbol()).to.equal(mocks.namingConfig.cvxSymbol);
        expect(await cvx.operator()).to.equal(booster.address);
        expect(await cvx.vecrvProxy()).to.equal(voterProxy.address);
        expect(await cvx.owner()).to.equal(await deployer.getAddress());
        expect(await cvx.reductionPerCliff()).to.equal(simpleToExactAmount(10, 22));
    });
    it("@method AuraToken.setOperator fails if it is not the owner", async () => {
        const aliceAddress = await alice.getAddress();
        const tx = cvx.connect(alice).setOperator(aliceAddress);
        await expect(tx).to.revertedWith("Ownable: caller is not the owner");
    });
    it("@method AuraToken.setOperator fails invalid operator", async () => {
        const tx = cvx.connect(deployer).setOperator(ZERO_ADDRESS);
        await expect(tx).to.revertedWith("invalid operator");
    });
    it("@method AuraToken.setOperator sets new operator", async () => {
        const previousOperator = await cvx.operator();
        const tx = cvx.connect(deployer).setOperator(booster.address);
        await expect(tx).to.emit(cvx, "OperatorChanged").withArgs(previousOperator, booster.address);
    });
    it("@method AuraToken.mint does not mint if sender is not the operator", async () => {
        const beforeBalance = await cvx.balanceOf(aliceAddress);
        const beforeTotalSupply = await cvx.totalSupply();
        await cvx.mint(aliceAddress, 1000);
        const afterBalance = await cvx.balanceOf(aliceAddress);
        const afterTotalSupply = await cvx.totalSupply();
        expect(beforeBalance, "balance does not change").to.eq(afterBalance);
        expect(beforeTotalSupply, "total supply does not change").to.eq(afterTotalSupply);
    });
    it("@method AuraToken.mint mints an amount to address - DRAFT ", async () => {
        // const previousOperator = await cvx.operator();
        // const tx = cvx.connect(deployer).setOperator(booster.address);
        const beforeBalance = await cvx.balanceOf(aliceAddress);
        const beforeTotalSupply = await cvx.totalSupply();
        // const operatorSigner = ethers.provider.getSigner(booster.address);
        // const operatorSigner = getSigner(booster.address);
        console.log(await cvx.operator(), await booster.address, await booster.signer.getAddress());
        await cvx.connect(deployer).setOperator(await booster.signer.getAddress());
        await cvx.mint(aliceAddress, simpleToExactAmount(50000000, 18));
        await cvx.mint(aliceAddress, simpleToExactAmount(50000000, 18));
        await cvx.mint(aliceAddress, simpleToExactAmount(50000000, 18));
        await cvx.mint(aliceAddress, simpleToExactAmount(50000000, 18));
        await cvx.mint(aliceAddress, simpleToExactAmount(50000000, 18));
        await cvx.mint(aliceAddress, simpleToExactAmount(50000000, 18));
        await cvx.mint(aliceAddress, simpleToExactAmount(50000000, 18));
        await cvx.mint(aliceAddress, simpleToExactAmount(50000000, 18));

        await cvx.mint(aliceAddress, simpleToExactAmount(50000000, 18));
        await cvx.mint(aliceAddress, simpleToExactAmount(50000000, 18));
        await cvx.mint(aliceAddress, simpleToExactAmount(50000000, 18));
        // await cvx.connect(booster.signer).mint(aliceAddress, simpleToExactAmount(2,3));
        // await cvx.connect(alice).mint(aliceAddress, simpleToExactAmount(7,3));
        const afterBalance = await cvx.balanceOf(aliceAddress);
        const afterTotalSupply = await cvx.totalSupply();
        console.log("balance    ", beforeBalance.toString(), afterBalance.toString());
        console.log("totalSupply", beforeTotalSupply.toString(), afterTotalSupply.toString());

        expect(aliceInitialCvxBalance, "balance does change").to.lt(afterBalance);
        expect(beforeBalance, "balance does change").to.lt(afterBalance);
        expect(beforeTotalSupply, "total supply does change").to.lt(afterTotalSupply);
    });
});
