import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import {
    GenericUnionVault,
    GenericUnionVault__factory,
    MockStrategy,
    MockStrategy__factory,
    VirtualShareRewardPool,
    VirtualShareRewardPool__factory,
} from "../../types/generated";
import { simpleToExactAmount } from "../../test-utils/math";
import { deployContract } from "../../tasks/utils";
import { DEAD_ADDRESS, ONE_WEEK, ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import { increaseTime } from "../../test-utils/time";
import {
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    Phase2Deployed,
    Phase4Deployed,
} from "../../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import shouldBehaveLikeERC20, { IERC20BehaviourContext } from "../shared/ERC20.behaviour";

const debug = false;

describe("GenericUnionVault", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let phase2: Phase2Deployed;
    let phase4: Phase4Deployed;
    let daoSigner: Signer;
    let deployer: Signer;
    let deployerAddress: string;
    let alice: Signer;
    let aliceAddress: string;
    let strategyAddress: string;

    let auraRewards: VirtualShareRewardPool;

    // Testing contract
    let genericUnionVault: GenericUnionVault;

    /* -- Declare shared functions -- */

    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();
        daoSigner = accounts[6];
        alice = accounts[1];
        aliceAddress = await alice.getAddress();
        mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], daoSigner);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        phase2 = await deployPhase2(hre, deployer, phase1, distro, multisigs, mocks.namingConfig, mocks.addresses);
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.connect(accounts[6]).setProtectPool(false);
        phase4 = await deployPhase4(hre, deployer, phase3, mocks.addresses);

        // Deploy dependencies of test contract.
        const mockStrategy = await deployContract<MockStrategy>(
            hre,
            new MockStrategy__factory(deployer),
            "MockStrategy",
            [mocks.lptoken.address, [phase2.cvx.address]],
            {},
            debug,
        );
        strategyAddress = mockStrategy.address;

        // Deploy test contract.
        genericUnionVault = await deployContract<GenericUnionVault>(
            hre,
            new GenericUnionVault__factory(deployer),
            "GenericUnionVault",
            [mocks.lptoken.address],
            {},
            debug,
        );

        auraRewards = await deployContract<VirtualShareRewardPool>(
            hre,
            new VirtualShareRewardPool__factory(deployer),
            "VirtualShareRewardPool",
            [genericUnionVault.address, phase2.cvx.address, mockStrategy.address],
            {},
            debug,
        );

        // Send some aura to mocked strategy to simulate harvest
        await increaseTime(ONE_WEEK.mul(156));
        await phase4.minter.connect(daoSigner).mint(strategyAddress, simpleToExactAmount(1000000));
    };

    describe("behaviors", async () => {
        describe("should behave like ERC20 ", async () => {
            const ctx: Partial<IERC20BehaviourContext> = {};
            const initialSupply = simpleToExactAmount(2);

            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.token = genericUnionVault;
                    ctx.initialHolder = { signer: deployer, address: deployerAddress };
                    ctx.recipient = { signer: alice, address: aliceAddress };
                    ctx.anotherAccount = { signer: daoSigner, address: await daoSigner.getAddress() };

                    await genericUnionVault.setStrategy(strategyAddress);
                    await mocks.lptoken.connect(deployer).approve(genericUnionVault.address, initialSupply);
                    await genericUnionVault.connect(deployer).deposit(initialSupply);
                };
            });
            shouldBehaveLikeERC20(() => ctx as IERC20BehaviourContext, "ERC20", initialSupply);
        });
    });
    describe("constructor", async () => {
        before("init contract", async () => {
            await setup();
        });
        it("should properly store valid arguments", async () => {
            expect(await genericUnionVault.callIncentive(), "callIncentive").to.eq(500);
            expect(await genericUnionVault.MAX_CALL_INCENTIVE(), "MAX_CALL_INCENTIVE").to.eq(500);
            expect(await genericUnionVault.FEE_DENOMINATOR(), "FEE_DENOMINATOR").to.eq(10000);
            expect(await genericUnionVault.underlying(), "underlying").to.eq(mocks.lptoken.address);
            expect(await genericUnionVault.strategy(), "strategy").to.eq(ZERO_ADDRESS);
            expect(await genericUnionVault.extraRewardsLength(), "extraRewardsLength").to.eq(0);
        });
        it("should properly store ERC20 arguments", async () => {
            expect(await genericUnionVault.name(), "name").to.eq("Staked " + (await mocks.lptoken.name()));
            expect(await genericUnionVault.symbol(), "symbol").to.eq("stk" + (await mocks.lptoken.symbol()));
        });
        it("should properly store Ownable arguments", async () => {
            expect(await genericUnionVault.owner(), "Owner").to.eq(deployerAddress);
        });
    });
    describe("normal flow", async () => {
        before("init contract", async () => {
            await setup();
        });
        it("Set a new strategy", async () => {
            // Given that
            expect(deployerAddress, "owner").to.be.eq(await genericUnionVault.owner());
            expect(ZERO_ADDRESS, "strategy").to.be.eq(await genericUnionVault.strategy());
            const tx = await genericUnionVault.connect(deployer).setStrategy(strategyAddress);
            // Verify events, storage change
            await expect(tx).to.emit(genericUnionVault, "StrategySet").withArgs(strategyAddress);

            expect(strategyAddress, "strategy").to.be.eq(await genericUnionVault.strategy());
        });
        it("Adds extra rewards", async () => {
            const extraRewardsLength = await genericUnionVault.extraRewardsLength();

            await genericUnionVault.addExtraReward(auraRewards.address);
            // Verify events, storage change.
            expect(await genericUnionVault.extraRewardsLength(), "extraRewardsLength").to.eq(extraRewardsLength.add(1));
            expect(await genericUnionVault.extraRewards(0), "extraRewards").to.eq(auraRewards.address);
        });
        it("First user deposit into the autocompounder 1:1", async () => {
            const amount = simpleToExactAmount(10);
            const totalUnderlyingBefore = await genericUnionVault.totalUnderlying();
            const totalSupplyBefore = await genericUnionVault.totalSupply();
            const userBalanceBefore = await genericUnionVault.balanceOf(deployerAddress);
            const lpUserBalanceBefore = await mocks.lptoken.balanceOf(deployerAddress);
            await mocks.lptoken.approve(genericUnionVault.address, amount);

            expect(totalSupplyBefore, "totalSupply").to.be.eq(ZERO);

            const tx = await genericUnionVault.deposit(amount);
            await expect(tx).to.emit(genericUnionVault, "Deposit").withArgs(deployerAddress, amount);

            // Expect 1:1 asset:shares as totalSupply was zero
            const totalUnderlyingAfter = await genericUnionVault.totalUnderlying();
            const totalSupplyAfter = await genericUnionVault.totalSupply();
            const userBalanceAfter = await genericUnionVault.balanceOf(deployerAddress);
            const lpUserBalanceAfter = await mocks.lptoken.balanceOf(deployerAddress);

            expect(totalUnderlyingAfter.sub(totalUnderlyingBefore), "totalUnderlying").to.be.eq(amount);
            expect(totalSupplyAfter.sub(totalSupplyBefore), "totalSupply").to.be.eq(amount);
            expect(userBalanceAfter.sub(userBalanceBefore), "userBalance").to.be.eq(amount);
            expect(lpUserBalanceBefore.sub(lpUserBalanceAfter), "lpUserBalance").to.be.eq(amount);

            // For each extra reward it stakes on the reward pool.
            await expect(tx).to.emit(auraRewards, "Staked").withArgs(deployerAddress, amount);
        });
        it("Harvest the autocompounder", async () => {
            const tx = await genericUnionVault.harvest();
            await expect(tx).to.emit(genericUnionVault, "Harvest");
        });
        it("User depositAll into the autocompounder", async () => {
            const lpUserBalanceBefore = await mocks.lptoken.balanceOf(deployerAddress);
            const amount = lpUserBalanceBefore;
            const totalUnderlyingBefore = await genericUnionVault.totalUnderlying();
            const totalSupplyBefore = await genericUnionVault.totalSupply();
            const userBalanceBefore = await genericUnionVault.balanceOf(deployerAddress);
            const expectedShares = amount.mul(totalSupplyBefore).div(totalUnderlyingBefore);

            await mocks.lptoken.approve(genericUnionVault.address, amount);

            const tx = await genericUnionVault.deposit(amount);
            await expect(tx).to.emit(genericUnionVault, "Deposit").withArgs(deployerAddress, amount);

            // Expect 1:1 asset:shares as totalSupply was zero
            const totalUnderlyingAfter = await genericUnionVault.totalUnderlying();
            const totalSupplyAfter = await genericUnionVault.totalSupply();
            const userBalanceAfter = await genericUnionVault.balanceOf(deployerAddress);

            expect(totalUnderlyingAfter.sub(totalUnderlyingBefore), "totalUnderlying").to.be.eq(amount);
            expect(totalSupplyAfter.sub(totalSupplyBefore), "totalSupply").to.be.eq(expectedShares);
            expect(userBalanceAfter.sub(userBalanceBefore), "userBalance").to.be.eq(expectedShares);
            const lpUserBalanceAfter = await mocks.lptoken.balanceOf(deployerAddress);
            expect(lpUserBalanceBefore.sub(lpUserBalanceAfter), "lpUserBalance").to.be.eq(amount);

            // For each extra reward it stakes on the reward pool.
            await expect(tx).to.emit(auraRewards, "Staked").withArgs(deployerAddress, amount);
        });

        it("Unstake and withdraw underlying tokens", async () => {
            const amount = simpleToExactAmount(10);
            const totalUnderlyingBefore = await genericUnionVault.totalUnderlying();
            const totalSupplyBefore = await genericUnionVault.totalSupply();
            const userBalanceBefore = await genericUnionVault.balanceOf(deployerAddress);
            const lpUserBalanceBefore = await mocks.lptoken.balanceOf(deployerAddress);

            const tx = await genericUnionVault.withdraw(amount);
            // Withdraw from extra rewards
            await expect(tx).to.emit(genericUnionVault, "Withdraw").withArgs(deployerAddress, amount);

            // Expect 1:1 asset:shares
            const totalUnderlyingAfter = await genericUnionVault.totalUnderlying();
            const totalSupplyAfter = await genericUnionVault.totalSupply();
            const userBalanceAfter = await genericUnionVault.balanceOf(deployerAddress);
            const lpUserBalanceAfter = await mocks.lptoken.balanceOf(deployerAddress);

            expect(totalUnderlyingBefore.sub(totalUnderlyingAfter), "totalUnderlying").to.be.eq(amount);
            expect(totalSupplyBefore.sub(totalSupplyAfter), "totalSupply").to.be.eq(amount);
            expect(userBalanceBefore.sub(userBalanceAfter), "userBalance").to.be.eq(amount);
            expect(lpUserBalanceAfter.sub(lpUserBalanceBefore), "lpUserBalance").to.be.eq(amount);

            // For each extra reward
            await expect(tx).to.emit(auraRewards, "Withdrawn").withArgs(deployerAddress, amount);
        });
        it("Unstake and withdraw all underlying tokens", async () => {
            const totalUnderlyingBefore = await genericUnionVault.totalUnderlying();
            const totalSupplyBefore = await genericUnionVault.totalSupply();
            const userBalanceBefore = await genericUnionVault.balanceOf(deployerAddress);
            const lpUserBalanceBefore = await mocks.lptoken.balanceOf(deployerAddress);
            const amount = userBalanceBefore;

            const tx = await genericUnionVault.withdrawAll();
            // Withdraw from extra rewards
            await expect(tx).to.emit(genericUnionVault, "Withdraw").withArgs(deployerAddress, amount);
            await expect(tx).to.emit(genericUnionVault, "Harvest");

            // Expect 1:1 asset:shares
            const totalUnderlyingAfter = await genericUnionVault.totalUnderlying();
            const totalSupplyAfter = await genericUnionVault.totalSupply();
            const userBalanceAfter = await genericUnionVault.balanceOf(deployerAddress);
            const lpUserBalanceAfter = await mocks.lptoken.balanceOf(deployerAddress);

            expect(totalUnderlyingBefore.sub(totalUnderlyingAfter), "totalUnderlying").to.be.eq(amount);
            expect(totalSupplyBefore.sub(totalSupplyAfter), "totalSupply").to.be.eq(amount);
            expect(userBalanceBefore.sub(userBalanceAfter), "userBalance").to.be.eq(amount);
            expect(lpUserBalanceAfter.sub(lpUserBalanceBefore), "lpUserBalance").to.be.eq(amount);

            // For each extra reward
            await expect(tx).to.emit(auraRewards, "Withdrawn").withArgs(deployerAddress, amount);
        });
    });
    describe("edge cases", async () => {
        before("init contract", async () => {
            await setup();
        });
        describe("setStrategy", async () => {
            it("fails if caller is not owner", async () => {
                await expect(
                    genericUnionVault.connect(alice).setStrategy(DEAD_ADDRESS),
                    "fails due to owner",
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });
            it("fails if wrong address", async () => {
                await expect(genericUnionVault.setStrategy(ZERO_ADDRESS), "fails due to").to.be.revertedWith(
                    "Invalid address!",
                );
            });
            it("fails if strategy is already set", async () => {
                await genericUnionVault.setStrategy(strategyAddress);
                await expect(
                    genericUnionVault.setStrategy(DEAD_ADDRESS),
                    "fails due to already set",
                ).to.be.revertedWith("Strategy already set");
            });
        });
        describe("addExtraReward", async () => {
            it("fails if caller is not owner", async () => {
                await expect(
                    genericUnionVault.connect(alice).addExtraReward(DEAD_ADDRESS),
                    "fails due to owner",
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("fails if wrong address", async () => {
                await expect(genericUnionVault.addExtraReward(ZERO_ADDRESS), "fails due to").to.be.revertedWith(
                    "Invalid address!",
                );
            });
            it("does not add more than 12 rewards", async () => {
                const extraRewardsLength = await genericUnionVault.extraRewardsLength();
                // 12 is the max number of extra
                for (let i = extraRewardsLength.toNumber(); i <= 14; i++) {
                    await genericUnionVault.addExtraReward(auraRewards.address);
                }
                expect(await genericUnionVault.extraRewardsLength(), "extraRewardsLength").to.eq(12);
            });
        });
        describe("clearExtraRewards", async () => {
            it("clearExtraRewards should ...", async () => {
                await genericUnionVault.clearExtraRewards();
                expect(await genericUnionVault.extraRewardsLength(), "extraRewardsLength").to.eq(0);
            });
            it("fails if caller is not owner", async () => {
                await expect(
                    genericUnionVault.connect(alice).clearExtraRewards(),
                    "fails due to owner",
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });
        });
    });
});