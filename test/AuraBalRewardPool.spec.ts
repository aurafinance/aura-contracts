import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4, SystemDeployed } from "../scripts/deploySystem";
import { deployMocks, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { AuraBalRewardPool, ERC20 } from "../types/generated";
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "../test-utils/constants";
import { increaseTime, getTimestamp } from "../test-utils/time";
import { BN } from "../test-utils/math";

describe("AuraBalRewardPool", () => {
    let accounts: Signer[];

    let contracts: SystemDeployed;
    let rewards: AuraBalRewardPool;
    let cvxCrv: ERC20;

    let deployer: Signer;

    let alice: Signer;
    let aliceAddress: string;
    let initialBal: BN;

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

        rewards = contracts.initialCvxCrvStaking.connect(alice);
        cvxCrv = contracts.cvxCrv.connect(alice) as ERC20;

        initialBal = await mocks.crvBpt.balanceOf(await deployer.getAddress());
        await mocks.crvBpt.transfer(aliceAddress, initialBal);
        await mocks.crvBpt.connect(alice).approve(contracts.crvDepositor.address, initialBal);
        await contracts.crvDepositor.connect(alice)["deposit(uint256,bool,address)"](initialBal, true, ZERO_ADDRESS);
    });

    it("initial configuration is correct", async () => {
        expect(await rewards.stakingToken()).eq(cvxCrv.address);
        expect(await rewards.rewardToken()).eq(contracts.cvx.address);
        expect(await rewards.rewardManager()).eq(await deployer.getAddress());
        expect(await rewards.auraLocker()).eq(contracts.cvxLocker.address);
        expect(await rewards.penaltyForwarder()).eq(contracts.penaltyForwarder.address);
        const currentTime = await getTimestamp();
        expect(await rewards.startTime()).gt(currentTime.add(ONE_DAY.mul(6)));
        expect(await rewards.startTime()).lt(currentTime.add(ONE_DAY.mul(8)));
        expect(await contracts.cvx.balanceOf(rewards.address)).gt(0);
    });
    describe("basic flow", () => {
        it("allows users to deposit before rewards are added (no rewards accrued)", async () => {
            await cvxCrv.approve(rewards.address, initialBal.div(5));
            await rewards.stake(initialBal.div(5));
            expect(await rewards.rewardPerTokenStored()).eq(0);
        });
        it("allows anyone to trigger rewards distribution after startTime", async () => {
            await increaseTime(ONE_WEEK.mul(2));
            await rewards.initialiseRewards();
        });
        it("accrues rewards to existing depositors following startTime");
        it("allows subsequent deposits");
        it("penalises claimers who do not lock");
        it("gives all rewards to claimers who lock");
        it("allows anyone to forward penalty on to the PenaltyForwarder");
    });
    describe("funding rewards", () => {
        it("blocks funding before startTime");
        it("allows rewardManager to start process early");
        it("only allows funding to be called once, ever");
        it("sets a two week epoch");
    });
});
