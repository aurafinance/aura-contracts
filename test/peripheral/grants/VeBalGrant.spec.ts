import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import { VeBalGrant, Account } from "../../../types";
import { ONE_WEEK, ZERO, ZERO_ADDRESS } from "../../../test-utils/constants";
import { DeployMocksResult, deployMocks } from "../../../scripts/deployMocks";
import { deployVeBalGrant } from "../../../scripts/deployPeripheral";
import { parseEther } from "ethers/lib/utils";
import { getTimestamp, increaseTime } from "../../../test-utils";

describe("VeBalGrant", () => {
    let mocks: DeployMocksResult;
    let balancerAccount: Account;
    let projectAccount: Account;
    let deployer: Signer;

    // Testing contract
    let veBalGrant: VeBalGrant;

    const setup = async () => {
        const accounts = await ethers.getSigners();
        deployer = accounts[0];
        mocks = await deployMocks(hre, deployer);
        balancerAccount = { signer: accounts[5], address: await accounts[5].getAddress() };
        projectAccount = { signer: accounts[6], address: await accounts[6].getAddress() };

        // Deploy test contract.
        ({ veBalGrant } = await deployVeBalGrant(
            hre,
            deployer,
            mocks.addresses,
            projectAccount.address,
            balancerAccount.address,
        ));

        await mocks.smartWalletChecker.approveWallet(veBalGrant.address);
        await mocks.balancerVault.setTokens(mocks.crv.address, mocks.weth.address);

        //    Allocate weth and bal to accounts
        await mocks.crv.transfer(balancerAccount.address, parseEther("50000"));
        await mocks.weth.transfer(balancerAccount.address, parseEther("45"));
        await mocks.crvBpt.transfer(balancerAccount.address, parseEther("45"));
        // Simulate balancer pool with  tokens
        await mocks.crv.transfer(mocks.balancerVault.address, parseEther("500000"));
        await mocks.weth.transfer(mocks.balancerVault.address, parseEther("450000"));

        await mocks.crv.connect(balancerAccount.signer).approve(veBalGrant.address, ethers.constants.MaxUint256);
        await mocks.weth.connect(balancerAccount.signer).approve(veBalGrant.address, ethers.constants.MaxUint256);
    };
    describe("constructor", async () => {
        before("init contract", async () => {
            await setup();
        });
        it("should properly store valid arguments", async () => {
            expect(await veBalGrant.WETH(), "WETH").to.eq(mocks.addresses.weth);
            expect(await veBalGrant.BAL(), "BAL").to.eq(mocks.addresses.token);
            expect(await veBalGrant.BAL_ETH_BPT(), "BAL_ETH_BPT").to.eq(mocks.addresses.tokenBpt);
            expect(await veBalGrant.votingEscrow(), "votingEscrow").to.eq(mocks.addresses.votingEscrow);
            expect(await veBalGrant.gaugeController(), "gaugeController").to.eq(mocks.addresses.gaugeController);
            expect(await veBalGrant.project(), "project").to.eq(projectAccount.address);
            expect(await veBalGrant.balancer(), "balancer").to.eq(balancerAccount.address);
            expect(await veBalGrant.BALANCER_VAULT(), "BALANCER_VAULT").to.eq(mocks.addresses.balancerVault);
            expect(await veBalGrant.BAL_ETH_POOL_ID(), "BAL_ETH_POOL_ID").to.eq(mocks.addresses.balancerPoolId);
            expect(await veBalGrant.active(), "active").to.eq(true);
            expect(await veBalGrant.totalEthContributed(), "totalEthContributed").to.eq(ZERO);
        });
        it("approvals should be correct", async () => {
            expect(
                await mocks.weth.allowance(veBalGrant.address, mocks.addresses.balancerVault),
                "weth allowance",
            ).to.be.eq(ethers.constants.MaxUint256);
            expect(
                await mocks.crv.allowance(veBalGrant.address, mocks.addresses.balancerVault),
                "bal allowance",
            ).to.be.eq(ethers.constants.MaxUint256);
        });
    });
    describe("normal flow", async () => {
        before(async () => {
            // Transfer tokens to the VeBalGrant
            await mocks.crv.connect(balancerAccount.signer).transfer(veBalGrant.address, parseEther("500"));
            await mocks.weth.connect(balancerAccount.signer).transfer(veBalGrant.address, parseEther("4"));
        });
        it("balancer can create initial lock", async () => {
            const unlockTime = (await getTimestamp()).add(ONE_WEEK.mul(26));
            const startVeBalance = await veBalGrant.veBalance();

            const wethBalance = await mocks.weth.balanceOf(veBalGrant.address);
            const balBalance = await mocks.crv.balanceOf(veBalGrant.address);
            // Given that
            expect(startVeBalance, "veBalance").to.be.eq(ZERO);
            expect(wethBalance, "has some weth").to.be.gt(ZERO);
            expect(balBalance, "has some bal").to.be.gt(ZERO);
            expect(await veBalGrant.totalEthContributed(), "totalEthContributed").to.eq(ZERO);

            // When  creates a lock
            await veBalGrant.connect(balancerAccount.signer).createLock(unlockTime, ZERO);
            // bal eth
            const endVeBalance = await veBalGrant.veBalance();
            expect(await veBalGrant.unlockTime()).to.be.eq(unlockTime);
            expect(endVeBalance).to.be.gt(startVeBalance);
        });
        it("project can increase lock length", async () => {
            const unlockTime = (await getTimestamp()).add(ONE_WEEK.mul(52));
            const startVeBalance = await veBalGrant.veBalance();
            const unlockTimeBefore = await veBalGrant.unlockTime();
            expect(unlockTimeBefore, "previous unlock time").to.be.gt(ZERO);

            await veBalGrant.connect(projectAccount.signer).increaseTime(unlockTime);

            const unlockTimeAfter = await veBalGrant.unlockTime();
            const endVeBalance = await veBalGrant.veBalance();
            expect(unlockTimeBefore, "unlock time increases").to.be.lt(unlockTimeAfter);
            expect(unlockTimeAfter, "unlock time expected").to.be.eq(unlockTime);
            expect(endVeBalance).to.be.eq(startVeBalance);
        });
        it("balancer increases lock size", async () => {
            const bptToken = mocks.crvBpt;
            const amount = parseEther("10");
            // Send BPT to the veBalGrant
            await bptToken.transfer(veBalGrant.address, amount);

            const escrowStartBPTBalance = await bptToken.balanceOf(veBalGrant.address);
            const startVeBalance = await veBalGrant.veBalance();
            expect(escrowStartBPTBalance).to.be.eq(amount);

            await veBalGrant.connect(balancerAccount.signer).increaseLock(amount);

            const escrowEndBPTBalance = await bptToken.balanceOf(veBalGrant.address);
            const endVeBalance = await veBalGrant.veBalance();
            expect(escrowEndBPTBalance).to.be.eq("0");
            expect(endVeBalance, "veBalance increases").to.be.gt(startVeBalance);
            expect(endVeBalance, "veBalance").to.be.eq(startVeBalance.add(amount));
        });
        it("can claim bal and lock it", async () => {
            await veBalGrant.connect(balancerAccount.signer).setActive(true);

            await increaseTime(ONE_WEEK.mul(4));
            const dist = mocks.feeDistribution;

            // Send crv to feeDistribution
            await dist.connect(balancerAccount.signer).checkpointToken(mocks.crv.address);
            await mocks.crv.transfer(mocks.feeDistribution.address, parseEther("1000"));
            await dist.connect(balancerAccount.signer).checkpointToken(mocks.crv.address);

            await increaseTime(ONE_WEEK.mul(4));

            const startVeBalance = await veBalGrant.veBalance();

            await veBalGrant
                .connect(projectAccount.signer)
                .claimFees(mocks.feeDistribution.address, mocks.crv.address, ZERO_ADDRESS, ZERO);

            const endVeBalance = await veBalGrant.veBalance();
            // Expect all weth and bal is locked
            const escrowBPTBalance = await mocks.crvBpt.balanceOf(veBalGrant.address);
            expect(escrowBPTBalance).to.be.eq("0");
            expect(endVeBalance, "veBalance increases").to.be.gt(startVeBalance);
        });
        it("can claim  weth and lock it", async () => {
            const dist = mocks.feeDistribution;

            // Send crv to feeDistribution
            await dist.connect(balancerAccount.signer).checkpointToken(mocks.weth.address);
            await mocks.weth.transfer(mocks.feeDistribution.address, parseEther("1000"));
            await dist.connect(balancerAccount.signer).checkpointToken(mocks.weth.address);

            await increaseTime(ONE_WEEK.mul(4));

            const startVeBalance = await veBalGrant.veBalance();

            await veBalGrant
                .connect(projectAccount.signer)
                .claimFees(mocks.feeDistribution.address, mocks.weth.address, ZERO_ADDRESS, ZERO);

            const endVeBalance = await veBalGrant.veBalance();
            // Expect all weth and bal is locked
            const escrowBPTBalance = await mocks.crvBpt.balanceOf(veBalGrant.address);
            expect(escrowBPTBalance).to.be.eq("0");
            expect(endVeBalance, "veBalance increases").to.be.gt(startVeBalance);
        });
        it("can claim  any other token", async () => {
            const dist = mocks.feeDistribution;

            // Send crv to feeDistribution
            await dist.connect(balancerAccount.signer).checkpointToken(mocks.lptoken.address);
            await mocks.lptoken.transfer(mocks.feeDistribution.address, parseEther("10"));
            await dist.connect(balancerAccount.signer).checkpointToken(mocks.lptoken.address);

            const startVeBalance = await veBalGrant.veBalance();
            const lpTokenBalanceBefore = await mocks.lptoken.balanceOf(projectAccount.address);

            await veBalGrant
                .connect(projectAccount.signer)
                .claimFees(mocks.feeDistribution.address, mocks.lptoken.address, projectAccount.address, ZERO);

            const lpTokenBalanceAfter = await mocks.lptoken.balanceOf(projectAccount.address);

            const endVeBalance = await veBalGrant.veBalance();
            // Expect all weth and bal is locked
            expect(lpTokenBalanceAfter, "veBalance eq").to.be.gt(lpTokenBalanceBefore);
            expect(endVeBalance, "veBalance eq").to.be.eq(startVeBalance);
        });
        it("project can call an arbitrary fn", async () => {
            const amount = parseEther("10");
            const allowanceBefore = await mocks.lptoken.allowance(veBalGrant.address, projectAccount.address);
            const data = mocks.lptoken.interface.encodeFunctionData("approve", [projectAccount.address, amount]);

            expect(await veBalGrant.active(), "active").to.be.eq(true);
            expect(allowanceBefore, "arbitrary fn change").to.be.eq(ZERO);

            await veBalGrant.connect(projectAccount.signer).execute(mocks.lptoken.address, "0", data);

            const allowanceAfter = await mocks.lptoken.allowance(veBalGrant.address, projectAccount.address);

            expect(allowanceAfter, "arbitrary fn change").to.be.eq(amount);
        });
        it("project can vote for a gauge", async () => {
            const gauge = mocks.addresses.gauges[0];
            const voteBefore = await mocks.voting.get_gauge_weight(gauge);
            await veBalGrant.connect(projectAccount.signer).voteGaugeWeight(gauge, "100");
            const voteAfter = await mocks.voting.get_gauge_weight(gauge);
            expect(voteAfter, "vote gauge").to.be.eq(voteBefore.add(100));
        });
        it("balancer can call an arbitrary fn", async () => {
            const amount = parseEther("100");
            const data = mocks.lptoken.interface.encodeFunctionData("approve", [projectAccount.address, amount]);
            await veBalGrant.connect(balancerAccount.signer).setActive(false);
            expect(await veBalGrant.active(), "active").to.be.eq(false);

            await veBalGrant.connect(balancerAccount.signer).execute(mocks.lptoken.address, "0", data);

            const allowanceAfter = await mocks.lptoken.allowance(veBalGrant.address, projectAccount.address);

            expect(allowanceAfter, "arbitrary fn change").to.be.eq(amount);
        });
        it("balancer can vote for a gauge", async () => {
            const gauge = mocks.addresses.gauges[0];
            const voteBefore = await mocks.voting.get_gauge_weight(gauge);
            expect(await veBalGrant.active(), "active").to.be.eq(false);

            await veBalGrant.connect(balancerAccount.signer).voteGaugeWeight(gauge, "100");
            const voteAfter = await mocks.voting.get_gauge_weight(gauge);
            expect(voteAfter, "vote gauge").to.be.eq(voteBefore.add(100));
        });
        it("can withdraw from ve when lock ends", async () => {
            const unlockTime = await mocks.votingEscrow.lockTimes(veBalGrant.address);
            await increaseTime(unlockTime.add(ONE_WEEK));

            const bptToken = mocks.crvBpt.connect(projectAccount.signer);
            const escrowStartBPTBalance = await bptToken.balanceOf(veBalGrant.address);

            expect(await veBalGrant.active(), "active").to.be.eq(false);
            await veBalGrant.connect(balancerAccount.signer).release();

            const escrowEndBPTBalance = await bptToken.balanceOf(veBalGrant.address);
            expect(escrowEndBPTBalance).to.be.gt(escrowStartBPTBalance);
            expect(await mocks.votingEscrow.lockAmounts(veBalGrant.address), "lockAmounts").to.be.eq(ZERO);
            expect(await mocks.votingEscrow.lockTimes(veBalGrant.address), "lockTimes").to.be.eq(ZERO);
        });

        it("can redeem bpt to underlying tokens", async () => {
            const wethToken = mocks.weth.connect(projectAccount.signer);
            const bptToken = mocks.crvBpt.connect(projectAccount.signer);
            const balToken = mocks.crv.connect(projectAccount.signer);

            const escrowStartWethBalance = await wethToken.balanceOf(veBalGrant.address);
            const escrowStartBalBalance = await balToken.balanceOf(veBalGrant.address);

            await veBalGrant.connect(balancerAccount.signer).setActive(false);

            // Test
            await veBalGrant.connect(balancerAccount.signer).redeem(ZERO, ZERO);
            const escrowEndWethBalance = await wethToken.balanceOf(veBalGrant.address);
            const escrowEndBalBalance = await balToken.balanceOf(veBalGrant.address);
            const escrowEndBPTBalance = await bptToken.balanceOf(veBalGrant.address);

            expect(escrowEndWethBalance).to.be.gt(escrowStartWethBalance);
            expect(escrowEndBalBalance).to.be.gt(escrowStartBalBalance);
            expect(escrowEndBPTBalance).to.be.eq("0");
        });

        it("can withdraw underlying tokens to project and balancer", async () => {
            const wethToken = mocks.weth.connect(projectAccount.signer);
            const balToken = mocks.crv.connect(projectAccount.signer);

            const balancerStartWethBalance = await wethToken.balanceOf(balancerAccount.address);
            const projectStartWethBalance = await wethToken.balanceOf(projectAccount.address);
            const escrowStartWethBalance = await wethToken.balanceOf(veBalGrant.address);

            const balancerStartBalBalance = await balToken.balanceOf(balancerAccount.address);
            const projectStartBalBalance = await balToken.balanceOf(projectAccount.address);
            const escrowStartBalBalance = await balToken.balanceOf(veBalGrant.address);

            await veBalGrant.connect(balancerAccount.signer).withdrawBalances();
            // Verify all WETH goes to project and all BAL goes to balancer

            const balancerEndWethBalance = await wethToken.balanceOf(balancerAccount.address);
            const projectEndWethBalance = await wethToken.balanceOf(projectAccount.address);
            const escrowEndWethBalance = await wethToken.balanceOf(veBalGrant.address);

            const projectEndBalBalance = await balToken.balanceOf(projectAccount.address);
            const balancerEndBalBalance = await balToken.balanceOf(balancerAccount.address);
            const escrowEndBalBalance = await balToken.balanceOf(veBalGrant.address);

            expect(projectEndWethBalance, "project weth balance").to.be.eq(
                projectStartWethBalance.add(escrowStartWethBalance),
            );
            expect(balancerEndWethBalance, "balancer weth balance").to.be.eq(balancerStartWethBalance);
            expect(escrowEndWethBalance, "veBalGrant weth balance").to.be.eq(0);

            expect(projectEndBalBalance, "project bal balance").to.be.eq(projectStartBalBalance);
            expect(balancerEndBalBalance, "balancer bal balance").to.be.eq(
                balancerStartBalBalance.add(escrowStartBalBalance),
            );
            expect(escrowEndBalBalance, "veBalGrant bal balance").to.be.eq(0);

            expect(await veBalGrant.totalEthContributed()).to.be.eq("0");
        });
    });
    describe("edge cases", async () => {
        beforeEach(async () => {
            await setup();
        });
        describe("createLock", async () => {
            it("fails if caller is not balancer", async () => {
                await expect(
                    veBalGrant.connect(projectAccount.signer).createLock(ZERO, ZERO),
                    "onlyBalancer",
                ).to.be.revertedWith("!balancer");
            });
            it("fails if the grant is not active", async () => {
                await veBalGrant.connect(balancerAccount.signer).setActive(false);
                await expect(
                    veBalGrant.connect(balancerAccount.signer).createLock(ZERO, ZERO),
                    "whileActive",
                ).to.be.revertedWith("!active");
            });
        });
        describe("increaseTime fails if ", async () => {
            it("caller is not the project", async () => {
                await expect(
                    veBalGrant.connect(balancerAccount.signer).increaseTime(ZERO),
                    "onlyBalancer",
                ).to.be.revertedWith("!project");
            });
            it("the grant is not active", async () => {
                await veBalGrant.connect(balancerAccount.signer).setActive(false);
                await expect(
                    veBalGrant.connect(projectAccount.signer).increaseTime(ZERO),
                    "whileActive",
                ).to.be.revertedWith("!active");
            });
        });
        describe("increaseLock fails if ", async () => {
            it("caller is not balancer", async () => {
                await expect(
                    veBalGrant.connect(projectAccount.signer).increaseLock(ZERO),
                    "onlyBalancer",
                ).to.be.revertedWith("!balancer");
            });
            it("the grant is not active", async () => {
                await veBalGrant.connect(balancerAccount.signer).setActive(false);
                await expect(
                    veBalGrant.connect(balancerAccount.signer).increaseLock(ZERO),
                    "whileActive",
                ).to.be.revertedWith("!active");
            });
        });
        describe("claimFees", async () => {
            it("fails if can claim to ZERO address", async () => {
                const dist = mocks.feeDistribution;

                // Send crv to feeDistribution
                await dist.connect(balancerAccount.signer).checkpointToken(mocks.lptoken.address);
                await mocks.lptoken.transfer(mocks.feeDistribution.address, parseEther("10"));
                await dist.connect(balancerAccount.signer).checkpointToken(mocks.lptoken.address);

                await expect(
                    veBalGrant
                        .connect(projectAccount.signer)
                        .claimFees(mocks.feeDistribution.address, mocks.lptoken.address, ZERO_ADDRESS, ZERO),
                    "to eq 0",
                ).to.be.revertedWith("!0");
            });
            it("fails if  caller is not balancer", async () => {
                await expect(
                    veBalGrant
                        .connect(balancerAccount.signer)
                        .claimFees(mocks.feeDistribution.address, mocks.crv.address, ZERO_ADDRESS, ZERO),
                    "onlyCurrentParty",
                ).to.be.revertedWith("!caller");
            });
            it("fails if the grant is not active", async () => {
                await veBalGrant.connect(balancerAccount.signer).setActive(false);
                await expect(
                    veBalGrant
                        .connect(projectAccount.signer)
                        .claimFees(mocks.feeDistribution.address, mocks.crv.address, ZERO_ADDRESS, ZERO),
                    "onlyCurrentParty",
                ).to.be.revertedWith("!caller");
            });
        });
        describe("execute", async () => {
            it("project cannot call it if grant is not active", async () => {
                const amount = parseEther("10");
                const data = mocks.lptoken.interface.encodeFunctionData("approve", [projectAccount.address, amount]);

                await veBalGrant.connect(balancerAccount.signer).setActive(false);
                await expect(
                    veBalGrant.connect(projectAccount.signer).execute(mocks.lptoken.address, "0", data),
                    "inactive, wrong caller",
                ).to.be.revertedWith("!caller");
            });
            it("balancer cannot call it if grant is active", async () => {
                const amount = parseEther("10");
                const data = mocks.lptoken.interface.encodeFunctionData("approve", [projectAccount.address, amount]);

                await veBalGrant.connect(balancerAccount.signer).setActive(true);
                await expect(
                    veBalGrant.connect(balancerAccount.signer).execute(mocks.lptoken.address, "0", data),
                    "active, wrong caller",
                ).to.be.revertedWith("!caller");
            });
            it("cannot call BAL, WETH, BPT or VotingEscrow", async () => {
                const amount = parseEther("10");
                const data = mocks.lptoken.interface.encodeFunctionData("approve", [projectAccount.address, amount]);

                await veBalGrant.connect(balancerAccount.signer).setActive(true);

                await expect(
                    veBalGrant.connect(projectAccount.signer).execute(mocks.crv.address, "0", data),
                    "target bal",
                ).to.be.revertedWith("invalid target");
                await expect(
                    veBalGrant.connect(projectAccount.signer).execute(mocks.weth.address, "0", data),
                    "target weth",
                ).to.be.revertedWith("invalid target");
                await expect(
                    veBalGrant.connect(projectAccount.signer).execute(mocks.votingEscrow.address, "0", data),
                    "target votingEscrow",
                ).to.be.revertedWith("invalid target");
            });
            it("cannot call feeDistributor.claim", async () => {
                let data = mocks.feeDistribution.interface.encodeFunctionData("claimToken", [
                    projectAccount.address,
                    mocks.crv.address,
                ]);

                await veBalGrant.connect(balancerAccount.signer).setActive(true);

                await expect(
                    veBalGrant.connect(projectAccount.signer).execute(mocks.feeDistribution.address, "0", data),
                    "claim",
                ).to.be.revertedWith("!allowed");

                data = mocks.feeDistribution.interface.encodeFunctionData("claimTokens", [
                    projectAccount.address,
                    [mocks.crv.address],
                ]);
                await expect(
                    veBalGrant.connect(projectAccount.signer).execute(mocks.feeDistribution.address, "0", data),
                    "claim",
                ).to.be.revertedWith("!allowed");
            });
        });
        describe("voteGaugeWeight", async () => {
            it("project cannot call it if grant is not active", async () => {
                await veBalGrant.connect(balancerAccount.signer).setActive(false);
                await expect(
                    veBalGrant.connect(projectAccount.signer).voteGaugeWeight(ZERO_ADDRESS, ZERO),
                    "inactive, wrong caller",
                ).to.be.revertedWith("!caller");
            });
            it("balancer cannot call it if grant is active", async () => {
                await veBalGrant.connect(balancerAccount.signer).setActive(true);
                await expect(
                    veBalGrant.connect(balancerAccount.signer).voteGaugeWeight(ZERO_ADDRESS, ZERO),
                    "active, wrong caller",
                ).to.be.revertedWith("!caller");
            });
        });
        it("set active can only be called by balancer", async () => {
            await expect(veBalGrant.connect(projectAccount.signer).setActive(true), "onlyBalancer").to.be.revertedWith(
                "!balancer",
            );
        });
        describe("release", async () => {
            it("fails if caller is not authorized ", async () => {
                await veBalGrant.connect(balancerAccount.signer).setActive(false);
                await expect(veBalGrant.connect(deployer).release(), "onlyBalancer").to.be.revertedWith("!balancer");
            });
            it("fails if grant is active", async () => {
                await veBalGrant.connect(balancerAccount.signer).setActive(true);
                await expect(veBalGrant.connect(balancerAccount.signer).release(), "whileInactive").to.be.revertedWith(
                    "active",
                );
            });
        });
        describe("redeem", async () => {
            it("fails if caller is not authorized ", async () => {
                await veBalGrant.connect(balancerAccount.signer).setActive(false);
                await expect(veBalGrant.connect(deployer).redeem(ZERO, ZERO), "onlyAuth").to.be.revertedWith(
                    "!balancer",
                );
            });
            it("fails grant is active", async () => {
                await veBalGrant.connect(balancerAccount.signer).setActive(true);
                await expect(
                    veBalGrant.connect(balancerAccount.signer).redeem(ZERO, ZERO),
                    "whileInactive",
                ).to.be.revertedWith("active");
            });
        });
        describe("withdrawBalances", async () => {
            it("fails if caller is not authorized ", async () => {
                await veBalGrant.connect(balancerAccount.signer).setActive(false);
                await expect(veBalGrant.connect(deployer).withdrawBalances(), "onlyAuth").to.be.revertedWith("!auth");
            });
            it("fails grant is active", async () => {
                await veBalGrant.connect(balancerAccount.signer).setActive(true);
                await expect(
                    veBalGrant.connect(balancerAccount.signer).withdrawBalances(),
                    "whileInactive",
                ).to.be.revertedWith("active");
            });
        });
    });
});
