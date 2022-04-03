import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4, SystemDeployed } from "../scripts/deploySystem";
import { deployMocks, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { AuraLocker, MockERC20, MockERC20__factory, ExtraRewardsDistributor } from "../types/generated";
import { impersonateAccount } from "../test-utils/fork";
import { ONE_WEEK } from "../test-utils/constants";
import { increaseTime } from "../test-utils/time";
import { simpleToExactAmount } from "../test-utils/math";

describe("ExtraRewardsDistributor", () => {
    let accounts: Signer[];

    let distributor: ExtraRewardsDistributor;
    let contracts: SystemDeployed;
    let mockErc20: MockERC20;
    let auraLocker: AuraLocker;

    let deployer: Signer;

    let alice: Signer;
    let aliceAddress: string;

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        const mocks = await deployMocks(deployer);
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
        contracts = await deployPhase4(deployer, phase3, mocks.addresses);

        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        distributor = contracts.extraRewardsDistributor.connect(alice);
        auraLocker = contracts.cvxLocker.connect(alice);

        const operatorAccount = await impersonateAccount(contracts.booster.address);
        await contracts.cvx
            .connect(operatorAccount.signer)
            .mint(operatorAccount.address, simpleToExactAmount(100000, 18));
        await contracts.cvx.connect(operatorAccount.signer).transfer(aliceAddress, simpleToExactAmount(200));
        await contracts.cvx.connect(alice).approve(auraLocker.address, simpleToExactAmount(200));
        await auraLocker.lock(aliceAddress, simpleToExactAmount(1));

        mockErc20 = await new MockERC20__factory(alice).deploy("MockERC20", "mk20", 18, aliceAddress, 100);
    });

    it("initial configuration is correct", async () => {
        expect(await distributor.auraLocker()).eq(contracts.cvxLocker.address);
    });
    it("distributes rewards", async () => {
        await increaseTime(ONE_WEEK);
        const fundAmt = simpleToExactAmount(1);
        await mockErc20.approve(distributor.address, fundAmt);
        await expect(distributor.addReward(mockErc20.address, fundAmt))
            .to.emit(distributor, "RewardAdded")
            .withArgs(mockErc20.address, 1, fundAmt);
    });
    describe("funding rewards", async () => {
        it("allows anyone to fund");
        it("adds multiple occurances to same epoch");
        it("adds to the current vlAURA epoch");
        it("does not allow claiming until the epoch has finished");
    });
    describe("claiming rewards", async () => {
        // This is important logic as it basically combines forfeit rewards and claim into one to reduce gas
        it("allows users to specify a start index");
        it("does not allow the same epoch to be claimed twice");
        it("sends the tokens to the user");
    });
    describe("forfeiting rewards", () => {
        it("allows users to forfeit rewards");
        it("fails if the index is in the past or the future");
    });
});
