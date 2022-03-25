import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4, SystemDeployed } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { increaseTime, ONE_WEEK, simpleToExactAmount, ZERO_ADDRESS } from "../test-utils";

describe("AuraStakingProxy", () => {
    let accounts: Signer[];
    let contracts: SystemDeployed;
    let mocks: DeployMocksResult;

    let deployer: Signer;

    let alice: Signer;
    let aliceAddress: string;
    let bob: Signer;
    let bobAddress: string;

    const setup = async () => {
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
        await phase3.poolManager.setProtectPool(false);
        contracts = await deployPhase4(deployer, phase3, mocks.addresses);

        alice = accounts[1];
        aliceAddress = await alice.getAddress();
        bob = accounts[2];
        bobAddress = await bob.getAddress();

        let tx = await contracts.cvx.transfer(aliceAddress, simpleToExactAmount(200));
        await tx.wait();

        tx = await contracts.cvx.transfer(bobAddress, simpleToExactAmount(100));
        await tx.wait();
    };

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];

        await setup();
    });

    it("has correct initial config", async () => {
        expect(await contracts.cvxStakingProxy.crv()).eq(mocks.crv.address);
        expect(await contracts.cvxStakingProxy.cvx()).eq(contracts.cvx.address);
        expect(await contracts.cvxStakingProxy.cvxCrv()).eq(contracts.cvxCrv.address);
        expect(await contracts.cvxStakingProxy.crvDepositorWrapper()).eq(contracts.crvDepositorWrapper.address);
        expect(await contracts.cvxStakingProxy.outputBps()).eq(9980);
        expect(await contracts.cvxStakingProxy.rewards()).eq(contracts.cvxLocker.address);
        expect(await contracts.cvxStakingProxy.owner()).eq(await accounts[0].getAddress());
        expect(await contracts.cvxStakingProxy.pendingOwner()).eq(ZERO_ADDRESS);
        expect(await contracts.cvxStakingProxy.callIncentive()).eq(25);
    });

    describe("admin fns", () => {
        describe("when called by EOA", () => {
            it("fails to set crvDepositorWrapper");
            it("fails to set the keeper", async () => {
                await expect(contracts.cvxStakingProxy.connect(accounts[2]).setKeeper(ZERO_ADDRESS)).to.be.revertedWith(
                    "!auth",
                );
            });
            it("fails to set pending owner");
            it("fails to apply pending owner");
            it("fails to set call incentive");
            it("fails to set reward contract");
            it("fails to rescue token");
        });
        describe("when called by owner", () => {
            it("fails to set crvDepositorWrapper if output bps out of range");
            it("sets crvDepositorWrapper");
            it("sets keeper", async () => {
                const oldKeeper = await contracts.cvxStakingProxy.keeper();
                const proposedKeeper = await accounts[2].getAddress();
                expect(oldKeeper).not.eq(proposedKeeper);
                await contracts.cvxStakingProxy.connect(accounts[0]).setKeeper(proposedKeeper);
                const newKeeper = await contracts.cvxStakingProxy.keeper();
                expect(newKeeper).eq(proposedKeeper);
            });
            it("sets pending owner");
            it("applies pending owner");
            it("switches owner back");
            it("sets rewards contract");
            it("rescues token");
        });
    });

    describe("distributing rewards", () => {
        it("fails to distribute if caller is not the keeper", async () => {
            const keeper = await accounts[1].getAddress();
            await contracts.cvxStakingProxy.setKeeper(keeper);
            await expect(contracts.cvxStakingProxy.connect(accounts[0]).distribute()).to.be.revertedWith("!auth");
            await contracts.cvxStakingProxy.connect(accounts[1]).distribute();
        });
        it("allows anyone to distribute if the keeper is 0", async () => {
            await contracts.cvxStakingProxy.setKeeper(ZERO_ADDRESS);
            await contracts.cvxStakingProxy.connect(accounts[0]).distribute();
        });
        it("deposits CRV into crvBPT via crvDepositorWrapper");
        it("fails to convert to crvBPT if the outputBps is too high");
        it("distribute rewards from the booster", async () => {
            await contracts.booster.earmarkRewards(0);
            await increaseTime(60 * 60 * 24);

            const incentive = await contracts.booster.stakerIncentive();
            const rate = await mocks.crvMinter.rate();
            const stakingProxyBalance = await mocks.crv.balanceOf(contracts.cvxStakingProxy.address);
            expect(stakingProxyBalance).to.equal(rate.mul(incentive).div(10000));

            const tx = await contracts.cvxStakingProxy.distribute();
            await tx.wait();

            // TODO - check for buying BPT etc
            // TODO - check cvxCrv balance of the auraLocker
        });
    });
});
