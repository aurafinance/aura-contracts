import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import { AuraBalStrategyBase, BalancerSwapsHandler, ERC20, ERC20__factory } from "../../types/generated";
import { Account } from "../../types";
import {
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    Phase2Deployed,
    Phase6Deployed,
} from "../../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import { HandlerBaseBehaviourContext, shouldBehaveLikeHandlerBase } from "../shared/HandlerBase.behaviour";
import { deployVault } from "../../scripts/deployVault";
import { ZERO, impersonate, simpleToExactAmount } from "../../test-utils";

describe("BalancerSwapsHandler", () => {
    let mocks: DeployMocksResult;
    let phase2: Phase2Deployed;
    let owner: Account;
    let anotherAccount: Account;
    let token: ERC20;
    let strategy: AuraBalStrategyBase;

    // Testing contract
    let rewardHandler: BalancerSwapsHandler;

    const setup = async () => {
        const accounts = await ethers.getSigners();
        const deployer = accounts[0];
        const daoSigner = accounts[6];
        anotherAccount = { signer: accounts[1], address: await accounts[1].getAddress() };
        mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], daoSigner);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        phase2 = await deployPhase2(hre, deployer, phase1, distro, multisigs, mocks.namingConfig, mocks.addresses);
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.connect(accounts[6]).setProtectPool(false);
        const phase4 = await deployPhase4(hre, deployer, phase3, mocks.addresses);

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

        rewardHandler = result.feeTokenHandler as BalancerSwapsHandler;
        strategy = result.strategy;

        owner = { signer: deployer, address: await deployer.getAddress() };
        token = ERC20__factory.connect(mocks.addresses.feeToken, owner.signer);
    };

    before("init contract", async () => {
        await setup();
    });
    describe("behaviors", async () => {
        describe("should behave like HandlerBase ", async () => {
            const ctx: Partial<HandlerBaseBehaviourContext> = {};

            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.rewardHandler = rewardHandler;
                    ctx.token = token;
                    ctx.owner = owner;
                    ctx.anotherAccount = anotherAccount;
                    ctx.strategy = strategy;
                    ctx.addresses = {
                        weth: mocks.addresses.weth,
                        balancerVault: mocks.addresses.balancerVault,
                    };

                    return ctx as HandlerBaseBehaviourContext;
                };
            });

            shouldBehaveLikeHandlerBase(() => ctx as HandlerBaseBehaviourContext);
        });
    });

    describe("constructor", async () => {
        it("should properly store constructor arguments", async () => {
            const swapPath = await rewardHandler.getSwapPath();
            expect(await rewardHandler.balVault(), "balVault").to.eq(mocks.addresses.balancerVault);
            expect(swapPath.poolIds.toString(), "swap path poolIds").to.eq(
                mocks.addresses.feeTokenHandlerPath.poolIds.toString(),
            );
            expect(swapPath.assetsIn.toString(), "swap path assetsIn").to.eq(
                mocks.addresses.feeTokenHandlerPath.assetsIn.toString(),
            );
        });
        it("balancer vault should have allowance", async () => {
            const maxAllowance = ethers.constants.MaxUint256;
            expect(await token.allowance(rewardHandler.address, mocks.addresses.balancerVault), "allowance").to.be.eq(
                maxAllowance,
            );
            expect(await token.allowance(rewardHandler.address, mocks.addresses.balancerVault), "allowance").to.be.eq(
                maxAllowance,
            );
        });
    });
    describe("sell", async () => {
        const amount = simpleToExactAmount(300);
        before(async () => {
            // Given that the handler has some token balance
            await token.transfer(rewardHandler.address, amount);
            // Provide the balancer mock with weth to swap
            await mocks.weth.transfer(mocks.balancerVault.address, amount);
        });
        it("should allow call set approvals again", async () => {
            await rewardHandler.setApprovals();
            const maxAllowance = ethers.constants.MaxUint256;
            expect(await token.allowance(rewardHandler.address, mocks.addresses.balancerVault), "allowance").to.be.eq(
                maxAllowance,
            );
            expect(await token.allowance(rewardHandler.address, mocks.addresses.balancerVault), "allowance").to.be.eq(
                maxAllowance,
            );
        });
        it("should swap token for weth", async () => {
            const wethBalanceBefore = await mocks.weth.balanceOf(strategy.address);
            expect(await token.balanceOf(rewardHandler.address), "token balance").to.be.eq(amount);
            const strategyAccount = await impersonate(strategy.address);

            await rewardHandler.connect(strategyAccount).sell();
            // no events

            const wethBalanceAfter = await mocks.weth.balanceOf(strategy.address);
            const tokenBalanceAfter = await token.balanceOf(rewardHandler.address);
            // hardcoded 1:1 price on mock balancer vault
            expect(tokenBalanceAfter, "token balance").to.be.eq(ZERO);
            expect(wethBalanceAfter, "weth balance").to.be.gt(wethBalanceBefore);
            expect(wethBalanceAfter.sub(wethBalanceBefore), "weth balance delta").to.be.eq(amount);
        });
    });
});
