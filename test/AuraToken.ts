import hre, { ethers } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { Booster, CurveVoterProxy, AuraToken } from "../types/generated";
import { simpleToExactAmount, ZERO_ADDRESS } from "../test-utils";

const EMISSIONS_MAX_SUPPLY = 100000000;

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

    it("initial configuration is correct", async () => {
        expect(await cvx.name()).to.equal(mocks.namingConfig.cvxName);
        expect(await cvx.symbol()).to.equal(mocks.namingConfig.cvxSymbol);
        expect(await cvx.operator()).to.equal(booster.address);
        expect(await cvx.vecrvProxy()).to.equal(voterProxy.address);
        expect(await cvx.owner()).to.equal(await deployer.getAddress());
        // Expects to be pre-mined with 50 m tokens. (as per deployment script)
        expect(await cvx.totalSupply()).to.eq(simpleToExactAmount(50000000));
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
    it("@method AuraToken.mint mints per BAL yearly schedule ", async () => {
        const beforeTotalSupply = await cvx.totalSupply();
        const mintRatio = await cvx.mintRatio();

        // Updates operator so mint function can be tested
        await cvx.connect(deployer).setOperator(await booster.signer.getAddress());
        // governance max supply 100m
        // Year 1 - BAL emissions
        let tx = await cvx.mint(aliceAddress, simpleToExactAmount(7560714, 18));
        // simpleToExactAmount(1230601060217844, 10)
        await expect(tx)
            .to.emit(cvx, "Transfer")
            .withArgs(
                ZERO_ADDRESS,
                aliceAddress,
                simpleToExactAmount(7560714, 18).mul(mintRatio).div(simpleToExactAmount(1)),
            );

        // Year 2 - BAL emissions
        tx = await cvx.mint(aliceAddress, simpleToExactAmount(6357778, 18));
        await expect(tx)
            .to.emit(cvx, "Transfer")
            .withArgs(ZERO_ADDRESS, aliceAddress, simpleToExactAmount(1034808134182788, 10));

        // Year 3 - BAL emissions
        tx = await cvx.mint(aliceAddress, simpleToExactAmount(5346232, 18));
        await expect(tx)
            .to.emit(cvx, "Transfer")
            .withArgs(ZERO_ADDRESS, aliceAddress, simpleToExactAmount(870166331826672, 10));

        // Year 4 - BAL emissions
        tx = await cvx.mint(aliceAddress, simpleToExactAmount(4495628, 18));
        await expect(tx)
            .to.emit(cvx, "Transfer")
            .withArgs(ZERO_ADDRESS, aliceAddress, simpleToExactAmount(731719859148888, 10));

        // Year 5 - BAL emissions
        tx = await cvx.mint(aliceAddress, simpleToExactAmount(3780357, 18));
        await expect(tx)
            .to.emit(cvx, "Transfer")
            .withArgs(ZERO_ADDRESS, aliceAddress, simpleToExactAmount(615300530108922, 10));

        const afterBalance = await cvx.balanceOf(aliceAddress);
        const afterTotalSupply = await cvx.totalSupply();

        expect(aliceInitialCvxBalance, "balance does change").to.lt(afterBalance);
        expect(beforeTotalSupply, "total supply does change").to.lt(afterTotalSupply);
    });

    it("@method AuraToken.setMintRatio updates the ratio to slow down the emissions", async () => {
        // Mint 1 Aura per BAL
        await cvx.connect(deployer).setMintRatio(simpleToExactAmount(1));
        // Year 6 - BAL emissions
        let tx = await cvx.mint(aliceAddress, simpleToExactAmount(3178889, 18));
        // Expects 1:1 mint
        await expect(tx)
            .to.emit(cvx, "Transfer")
            .withArgs(ZERO_ADDRESS, aliceAddress, simpleToExactAmount(3178889, 18));
        // Year 6 , plus dust
        const remainingEmissions = simpleToExactAmount(EMISSIONS_MAX_SUPPLY).sub(await cvx.totalSupply());
        await cvx.mint(aliceAddress, remainingEmissions);
        // Reach the governance max supply, does not fail but it does not mint any more
        const maxTotalSupply = await cvx.totalSupply();
        tx = await cvx.mint(aliceAddress, simpleToExactAmount(1, 18));
        await expect(await cvx.totalSupply()).to.eq(maxTotalSupply);

        const afterTotalSupply = await cvx.totalSupply();
        expect(afterTotalSupply, "total supply does change").to.eq(simpleToExactAmount(EMISSIONS_MAX_SUPPLY));
    });
    it("@method AuraToken.governanceMint mints additional AURA", async () => {
        await cvx.connect(deployer).setOperator(await booster.signer.getAddress());
        const govMaxSupply = await cvx.govMaxSupply();

        // Increments 100 the governance max supply
        await cvx.setGovMaxSupply(govMaxSupply.add(simpleToExactAmount(100)));
        expect(await cvx.govMaxSupply(), "governance max supply increases").to.eq(
            govMaxSupply.add(simpleToExactAmount(100)),
        );

        // It should mint via governance
        await cvx.connect(deployer).governanceMint(aliceAddress, simpleToExactAmount(100));
        await expect(cvx.connect(deployer).governanceMint(aliceAddress, simpleToExactAmount(1, 18))).to.revertedWith(
            "token max supply",
        );
    });
    it("@method AuraToken.mint does not mint additional AURA", async () => {
        await cvx.connect(deployer).setOperator(await booster.signer.getAddress());
        const govMaxSupply = await cvx.govMaxSupply();

        // Increments 100 the governance max supply
        await cvx.setGovMaxSupply(govMaxSupply.add(simpleToExactAmount(100)));
        expect(await cvx.govMaxSupply(), "total supply is eq to governance max supply").to.eq(
            govMaxSupply.add(simpleToExactAmount(100)),
        );

        // it should does not to mint more tokens via scheduled mints as the max amount has been reached previously,
        // changing governance max supply via governance does not affect schedule minting.
        const totalSupply = await cvx.totalSupply();
        await cvx.mint(aliceAddress, simpleToExactAmount(1, 18));
        await expect(await cvx.totalSupply()).to.eq(totalSupply);
    });
    it("@method AuraToken.governanceMint fails if governance is not the caller", async () => {
        // it should fail if governance is not the caller
        await expect(cvx.connect(alice).governanceMint(aliceAddress, simpleToExactAmount(1))).to.revertedWith(
            "Ownable: caller is not the owner",
        );
    });
});
