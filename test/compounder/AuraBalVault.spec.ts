import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import {
    AuraBalStrategy,
    AuraBalVault,
    BalancerSwapsHandler,
    IERC4626,
    MockERC20__factory,
    VirtualBalanceRewardPool,
} from "../../types/generated";
import {
    increaseTime,
    impersonateAccount,
    simpleToExactAmount,
    DEAD_ADDRESS,
    ONE_WEEK,
    ZERO,
    ZERO_ADDRESS,
    assertBNClosePercent,
    assertBNClose,
} from "../../test-utils";
import {
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    Phase2Deployed,
    Phase4Deployed,
    Phase6Deployed,
} from "../../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import shouldBehaveLikeERC20, { IERC20BehaviourContext } from "../shared/ERC20.behaviour";
import shouldBehaveLikeERC4626, { IERC4626BehaviourContext } from "../shared/ERC4626.behaviour";
import { deployVault } from "../../scripts/deployVault";
import { parseEther } from "ethers/lib/utils";

describe("AuraBalVault", () => {
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

    let auraRewards: VirtualBalanceRewardPool;
    let strategy: AuraBalStrategy;
    let feeTokenHandler: BalancerSwapsHandler;
    let idSnapShot: number;

    // Testing contract
    let vault: AuraBalVault;

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

        // Deploy test contract.
        const result = await deployVault(
            {
                addresses: mocks.addresses,
                multisigs,
                getPhase2: async (__: Signer) => phase2,
                getPhase6: async (__: Signer) => {
                    const phase6: Partial<Phase6Deployed> = {};
                    phase6.cvxCrvRewards = phase4.cvxCrvRewards;
                    return phase6 as Phase6Deployed;
                },
            },
            hre,
            deployer,
            false,
        );
        vault = result.vault;
        strategy = result.strategy;
        auraRewards = result.auraRewards;
        feeTokenHandler = result.bbusdHandler;

        // Send crvCvx to account, so it can make deposits
        const crvDepositorAccount = await impersonateAccount(phase2.crvDepositor.address);
        const cvxCrvConnected = phase2.cvxCrv.connect(crvDepositorAccount.signer);
        await cvxCrvConnected.mint(deployerAddress, simpleToExactAmount(simpleToExactAmount(1000000)));

        // Send some aura to mocked strategy to simulate harvest
        await increaseTime(ONE_WEEK.mul(156));
        await phase4.minter.connect(daoSigner).mint(deployerAddress, simpleToExactAmount(1000000));
    };

    // Force a reward harvest by transferring BAL, BBaUSD and Aura tokens directly
    // to the reward contract the contract will then swap it for
    // auraBAL and queue it for rewards
    async function forceHarvestRewards(amount = parseEther("10"), minOut = ZERO, signer = deployer) {
        const { crv } = mocks;
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
    before(async () => {
        idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
    });
    after(async () => {
        await hre.ethers.provider.send("evm_revert", [idSnapShot]);
    });
    describe("behaviors", async () => {
        describe("should behave like ERC20 ", async () => {
            const ctx: Partial<IERC20BehaviourContext> = {};
            const initialSupply = simpleToExactAmount(2);

            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.token = vault;
                    ctx.initialHolder = { signer: deployer, address: deployerAddress };
                    ctx.recipient = { signer: alice, address: aliceAddress };
                    ctx.anotherAccount = { signer: daoSigner, address: await daoSigner.getAddress() };

                    await phase2.cvxCrv.connect(deployer).approve(vault.address, initialSupply);
                    await vault.connect(deployer).deposit(initialSupply, deployerAddress);
                };
            });
            shouldBehaveLikeERC20(() => ctx as IERC20BehaviourContext, "ERC20", initialSupply);
        });
        describe("should behave like ERC4626 with fees", async () => {
            const ctx: Partial<IERC4626BehaviourContext> = {};
            const initialSupply = simpleToExactAmount(2, 18);
            const depositAmount = simpleToExactAmount(10, 18);

            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.vault = vault as unknown as IERC4626;
                    ctx.asset = phase2.cvxCrv;
                    ctx.initialHolder = { signer: deployer, address: deployerAddress };
                    ctx.recipient = { signer: alice, address: aliceAddress };
                    ctx.anotherAccount = { signer: daoSigner, address: await daoSigner.getAddress() };
                    ctx.amounts = {
                        initialDeposit: initialSupply,
                        deposit: depositAmount,
                        mint: depositAmount,
                        withdraw: depositAmount,
                        redeem: depositAmount,
                    };
                    return ctx as IERC4626BehaviourContext;
                };
            });
            shouldBehaveLikeERC4626(() => ctx as IERC4626BehaviourContext);
        });
    });
    describe("constructor", async () => {
        before("init contract", async () => {
            await setup();
        });
        it("should properly store valid arguments", async () => {
            expect(await vault.FEE_DENOMINATOR(), "FEE_DENOMINATOR").to.eq(10000);
            expect(await vault.underlying(), "underlying").to.eq(phase2.cvxCrv.address);
            expect(await vault.strategy(), "strategy").to.eq(strategy.address);
            expect(await vault.extraRewardsLength(), "extraRewardsLength").to.eq(1);
        });
        it("should properly store ERC20 arguments", async () => {
            expect(await vault.name(), "name").to.eq("Staked " + (await phase2.cvxCrv.name()));
            expect(await vault.symbol(), "symbol").to.eq("stk" + (await phase2.cvxCrv.symbol()));
        });
        it("should properly store Ownable arguments", async () => {
            expect(await vault.owner(), "Owner").to.eq(deployerAddress);
        });
    });
    describe("normal flow", async () => {
        before("init contract", async () => {
            await setup();
        });
        it("checks strategy", async () => {
            expect(strategy.address, "strategy").to.be.eq(await vault.strategy());
        });
        it("checks Reward tokens to strategy", async () => {
            expect(await strategy.totalRewardTokens()).eq(1);
            expect(await strategy.rewardTokens(0)).eq(mocks.addresses.feeToken);
            expect(await strategy.rewardHandlers(mocks.addresses.feeToken)).eq(feeTokenHandler.address);
        });
        it("checks extra rewards", async () => {
            expect(await vault.extraRewardsLength(), "extraRewardsLength").to.eq(1);
            expect(await vault.extraRewards(0), "extraRewards").to.eq(auraRewards.address);
        });
        it("First user deposit into the autocompounder 1:1", async () => {
            const amount = simpleToExactAmount(10);
            const totalUnderlyingBefore = await vault.totalUnderlying();
            const totalSupplyBefore = await vault.totalSupply();
            const userSharesBefore = await vault.balanceOf(deployerAddress);
            const cvxCrvUserBalanceBefore = await phase2.cvxCrv.balanceOf(deployerAddress);
            await phase2.cvxCrv.approve(vault.address, amount);

            expect(totalSupplyBefore, "totalSupply").to.be.eq(ZERO);

            const tx = await vault.deposit(amount, deployerAddress);
            await expect(tx).to.emit(vault, "Deposit").withArgs(deployerAddress, deployerAddress, amount, amount);

            // Expect 1:1 asset:shares as totalSupply was zero
            const totalUnderlyingAfter = await vault.totalUnderlying();
            const totalSupplyAfter = await vault.totalSupply();
            const userBalanceAfter = await vault.balanceOf(deployerAddress);
            const cvxCrvUserBalanceAfter = await phase2.cvxCrv.balanceOf(deployerAddress);

            expect(totalUnderlyingAfter.sub(totalUnderlyingBefore), "totalUnderlying").to.be.eq(amount);
            expect(totalSupplyAfter.sub(totalSupplyBefore), "totalSupply").to.be.eq(amount);
            expect(userBalanceAfter.sub(userSharesBefore), "userBalance").to.be.eq(amount);
            expect(cvxCrvUserBalanceBefore.sub(cvxCrvUserBalanceAfter), "cvxCrvUserBalance").to.be.eq(amount);

            // For each extra reward it stakes on the reward pool.
            await expect(tx).to.emit(auraRewards, "Staked").withArgs(deployerAddress, amount);
        });
        it("Only harvester harvest the autocompounder", async () => {
            await vault.updateAuthorizedHarvesters(deployerAddress, true);
            expect(await vault.isHarvestPermissioned(), "isHarvestPermissioned").to.be.eq(true);
            expect(await vault.authorizedHarvesters(deployerAddress), "authorizedHarvesters").to.be.eq(true);

            await forceHarvestRewards(simpleToExactAmount(10));
        });
        it("User deposits again into the autocompounder", async () => {
            const cvxCrvUserBalanceBefore = await phase2.cvxCrv.balanceOf(deployerAddress);
            const amount = simpleToExactAmount(20);
            const totalUnderlyingBefore = await vault.totalUnderlying();
            const totalSupplyBefore = await vault.totalSupply();
            const userSharesBefore = await vault.balanceOf(deployerAddress);
            const expectedShares = amount.mul(totalSupplyBefore).div(totalUnderlyingBefore);

            await phase2.cvxCrv.approve(vault.address, amount);

            const shares = await vault.previewDeposit(amount);
            const tx = await vault.deposit(amount, deployerAddress);

            await expect(tx).to.emit(vault, "Deposit").withArgs(deployerAddress, deployerAddress, amount, shares);

            // Expect 1:1 asset:shares as totalSupply was zero
            const totalUnderlyingAfter = await vault.totalUnderlying();
            const totalSupplyAfter = await vault.totalSupply();
            const userBalanceAfter = await vault.balanceOf(deployerAddress);

            expect(totalUnderlyingAfter.sub(totalUnderlyingBefore), "totalUnderlying").to.be.eq(amount);
            expect(totalSupplyAfter.sub(totalSupplyBefore), "totalSupply").to.be.eq(expectedShares);
            expect(userBalanceAfter.sub(userSharesBefore), "userBalance").to.be.eq(expectedShares);
            const cvxCrvUserBalanceAfter = await phase2.cvxCrv.balanceOf(deployerAddress);
            expect(cvxCrvUserBalanceBefore.sub(cvxCrvUserBalanceAfter), "cvxCrvUserBalance").to.be.eq(amount);

            // For each extra reward it stakes on the reward pool.
            await expect(tx).to.emit(auraRewards, "Staked");
        });
        it("Anyone harvest when total supply is zero", async () => {
            await vault.updateAuthorizedHarvesters(deployerAddress, false);
            await vault.setHarvestPermissions(false);

            expect(await vault.isHarvestPermissioned(), "isHarvestPermissioned").to.be.eq(false);
            expect(await vault.authorizedHarvesters(deployerAddress), "authorizedHarvesters").to.be.eq(false);
            await forceHarvestRewards(simpleToExactAmount(1), ZERO, deployer);
        });
        it("Unstake and withdraw underlying tokens", async () => {
            const amount = simpleToExactAmount(10);
            const totalUnderlyingBefore = await vault.totalUnderlying();
            const totalSupplyBefore = await vault.totalSupply();
            const userSharesBefore = await vault.balanceOf(deployerAddress);
            const cvxCrvUserBalanceBefore = await phase2.cvxCrv.balanceOf(deployerAddress);

            const shares = await vault.previewWithdraw(amount);
            const tx = await vault.withdraw(amount, deployerAddress, deployerAddress);
            // Withdraw from extra rewards
            await expect(tx)
                .to.emit(vault, "Withdraw")
                .withArgs(deployerAddress, deployerAddress, deployerAddress, amount, shares);

            const totalUnderlyingAfter = await vault.totalUnderlying();
            const totalSupplyAfter = await vault.totalSupply();
            const userBalanceAfter = await vault.balanceOf(deployerAddress);
            const cvxCrvUserBalanceAfter = await phase2.cvxCrv.balanceOf(deployerAddress);

            assertBNClose(totalUnderlyingBefore.sub(totalUnderlyingAfter), amount, 1, "totalUnderlying");
            expect(totalSupplyBefore.sub(totalSupplyAfter), "totalSupply").to.be.eq(shares);
            expect(userSharesBefore.sub(userBalanceAfter), "userBalance").to.be.eq(shares);
            assertBNClose(cvxCrvUserBalanceAfter.sub(cvxCrvUserBalanceBefore), amount, 1, "cvxCrvUserBalance");

            // For each extra reward
            await expect(tx).to.emit(auraRewards, "Withdrawn");
        });
        it("Unstake and redeem all shares", async () => {
            const totalUnderlyingBefore = await vault.totalUnderlying();
            const totalSupplyBefore = await vault.totalSupply();
            const userSharesBefore = await vault.balanceOf(deployerAddress);
            const cvxCrvUserBalanceBefore = await phase2.cvxCrv.balanceOf(deployerAddress);

            const assets = await vault.previewRedeem(userSharesBefore);

            const tx = await vault.redeem(userSharesBefore, deployerAddress, deployerAddress);
            // Withdraw from extra rewards
            await expect(tx).to.emit(vault, "Withdraw");
            // As it is the last withdraw from the vault, it will invoke first harvest and then the withdraw
            // this will also impact on the variance of preview withdraw
            await expect(tx).to.emit(vault, "Harvest");

            // For each extra reward
            await expect(tx).to.emit(auraRewards, "Withdrawn");

            const totalUnderlyingAfter = await vault.totalUnderlying();
            const totalSupplyAfter = await vault.totalSupply();
            const userBalanceAfter = await vault.balanceOf(deployerAddress);
            const cvxCrvUserBalanceAfter = await phase2.cvxCrv.balanceOf(deployerAddress);

            assertBNClosePercent(totalUnderlyingBefore.sub(totalUnderlyingAfter), assets, "1.1", "totalUnderlying");
            expect(totalSupplyBefore.sub(totalSupplyAfter), "totalSupply").to.be.eq(userSharesBefore);
            expect(userSharesBefore.sub(userBalanceAfter), "userBalance").to.be.eq(userSharesBefore);
            assertBNClosePercent(
                cvxCrvUserBalanceAfter.sub(cvxCrvUserBalanceBefore),
                assets,
                "1.1",
                "cvxCrvUserBalance",
            );
        });
    });
    describe("edge cases", async () => {
        before("init contract", async () => {
            await setup();
        });
        describe("setStrategy", async () => {
            it("fails if caller is not owner", async () => {
                await expect(vault.connect(alice).setStrategy(DEAD_ADDRESS), "fails due to owner").to.be.revertedWith(
                    "Ownable: caller is not the owner",
                );
            });
            it("fails if wrong address", async () => {
                await expect(vault.setStrategy(ZERO_ADDRESS), "fails due to").to.be.revertedWith("Invalid address!");
            });
            it("fails if strategy is already set", async () => {
                await expect(vault.setStrategy(DEAD_ADDRESS), "fails due to already set").to.be.revertedWith(
                    "Strategy already set",
                );
            });
        });
        describe("harvest", async () => {
            it("does not sell token without handlers", async () => {
                //  Deposit to make sure totalSupply is not ZERO
                const amount = simpleToExactAmount(10);
                await phase2.cvxCrv.approve(vault.address, amount);
                await vault.deposit(amount, deployerAddress);
                await vault.setHarvestPermissions(false);

                // Disable fee token handler
                await strategy.updateRewardToken(mocks.addresses.feeToken, ZERO_ADDRESS);

                // ----- Send some balance to the strategy to mock the harvest ----- //
                const { crv } = mocks;
                const feeToken = MockERC20__factory.connect(mocks.addresses.feeToken, deployer);
                await crv.transfer(strategy.address, amount);
                await phase2.cvx.transfer(strategy.address, amount);
                await feeToken.transfer(strategy.address, amount);
                // ----- Send some balance to the balancer vault to mock swaps ----- //
                await phase2.cvxCrv.transfer(mocks.balancerVault.address, amount);
                await mocks.weth.transfer(mocks.balancerVault.address, amount);
                await mocks.balancerVault.setTokens(mocks.crvBpt.address, phase2.cvxCrv.address);

                const feeTokenBalance = await feeToken.balanceOf(strategy.address);

                expect(await feeToken.balanceOf(strategy.address), " feeToken balance").to.be.gt(0);

                // Test harvest without fee token handler

                const tx = await vault["harvest(uint256)"](0);
                await expect(tx).to.emit(vault, "Harvest");
                // Queue new rewards
                await expect(tx).to.emit(auraRewards, "RewardAdded");
                expect(await feeToken.balanceOf(strategy.address), " feeToken balance").to.be.eq(feeTokenBalance);
            });
            it("fails if permissioned  and not whitelisted ", async () => {
                //  Deposit to make sure totalSupply is not ZERO
                const amount = simpleToExactAmount(10);
                await phase2.cvxCrv.approve(vault.address, amount);
                await vault.deposit(amount, deployerAddress);
                await vault.setHarvestPermissions(true);

                await expect(vault.connect(alice)["harvest()"](), "fails ").to.be.revertedWith("permissioned harvest");
            });
        });
        describe("addExtraReward", async () => {
            it("fails if caller is not owner", async () => {
                await expect(
                    vault.connect(alice).addExtraReward(DEAD_ADDRESS),
                    "fails due to owner",
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });
            it("fails if wrong address", async () => {
                await expect(vault.addExtraReward(ZERO_ADDRESS), "fails due to").to.be.revertedWith("Invalid address!");
            });
            it("does not add more than 12 rewards", async () => {
                const extraRewardsLength = await vault.extraRewardsLength();
                const zero_padded = "0x00000000000000000000000000000000000000";
                // 12 is the max number of extra
                for (let i = extraRewardsLength.toNumber(); i <= 11; i++) {
                    const rewardAddress = zero_padded + (i + 10).toString();
                    await vault.addExtraReward(rewardAddress);
                }
                await expect(vault.addExtraReward(zero_padded + (13 + 10).toString())).to.be.revertedWith(
                    "too many rewards",
                );
            });
        });
        describe("clearExtraRewards", async () => {
            it("clearExtraRewards should remove all extra rewards", async () => {
                await vault.clearExtraRewards();
                expect(await vault.extraRewardsLength(), "extraRewardsLength").to.eq(0);
            });
            it("fails if caller is not owner", async () => {
                await expect(vault.connect(alice).clearExtraRewards(), "fails due to owner").to.be.revertedWith(
                    "Ownable: caller is not the owner",
                );
            });
        });
        describe("setHarvestPermissions", async () => {
            it("fails if caller is not owner", async () => {
                await expect(vault.connect(alice).setHarvestPermissions(true), "fails due to owner").to.be.revertedWith(
                    "Ownable: caller is not the owner",
                );
            });
        });
        describe("updateAuthorizedHarvesters", async () => {
            it("fails if caller is not owner", async () => {
                await expect(
                    vault.connect(alice).updateAuthorizedHarvesters(deployerAddress, true),
                    "fails due to owner",
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });
        });
    });
});
