import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4, deployPhase6 } from "../../scripts/deploySystem";
import { deployMocks, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import { VoterProxyLite, VoterProxyLite__factory, BoosterLite__factory } from "../../types/generated";
import { BigNumberish, Signer } from "ethers";
import { ZERO_ADDRESS, ZERO } from "../../test-utils/constants";
import { impersonateAccount } from "../../test-utils/fork";
import { SidechainDeployed, deployCanonicalPhase, deploySidechainSystem } from "../../scripts/deploySidechain";
import { Account } from "types";
import {
    DeployL2MocksResult,
    deploySidechainMocks,
    getMockMultisigs as getL2MockMultisigs,
} from "../../scripts/deploySidechainMocks";
import { simpleToExactAmount } from "../../test-utils";

describe("VoterProxyLite", () => {
    let accounts: Signer[];
    let voterProxyLite: VoterProxyLite;
    let l2mocks: DeployL2MocksResult;
    let deployer: Account;
    let dao: Account;

    // Sidechain Contracts
    let sidechain: SidechainDeployed;
    const setup = async () => {
        accounts = await ethers.getSigners();

        deployer = await impersonateAccount(await accounts[0].getAddress());

        const mocks = await deployMocks(hre, deployer.signer);
        l2mocks = await deploySidechainMocks(hre, deployer.signer);
        const multisigs = await getMockMultisigs(accounts[1], accounts[2], accounts[3]);
        const l2Multisigs = await getL2MockMultisigs(accounts[3]);
        dao = await impersonateAccount(l2Multisigs.daoMultisig);

        const distro = getMockDistro();
        const phase1 = await deployPhase1(hre, deployer.signer, mocks.addresses);
        const phase2 = await deployPhase2(
            hre,
            deployer.signer,
            phase1,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );
        const phase3 = await deployPhase3(hre, deployer.signer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.connect(dao.signer).setProtectPool(false);
        await deployPhase4(hre, deployer.signer, phase3, mocks.addresses);
        const phase6 = await deployPhase6(hre, deployer.signer, phase2, multisigs, mocks.namingConfig, mocks.addresses);

        // deploy canonicalPhase
        const canonical = await deployCanonicalPhase(hre, deployer.signer, mocks.addresses, phase2, phase6);
        // deploy sidechain

        sidechain = await deploySidechainSystem(
            hre,
            deployer.signer,
            mocks.addresses,
            canonical,
            l2mocks.namingConfig,
            l2Multisigs,
            l2mocks.addresses,
        );

        voterProxyLite = sidechain.voterProxy;
    };
    async function boosterDepositIntoVoterProxy(gauge: string, amount: BigNumberish) {
        const operator = await voterProxyLite.operator();
        const operatorAccount = await impersonateAccount(operator);

        // Test send tokens to voter proxy and call deposit
        await l2mocks.lptoken.transfer(voterProxyLite.address, amount);
        const voterProxyBalanceBefore = await l2mocks.lptoken.balanceOf(voterProxyLite.address);
        const gaugeBalanceBefore = await l2mocks.lptoken.balanceOf(gauge);
        // Test
        await voterProxyLite.connect(operatorAccount.signer).deposit(l2mocks.lptoken.address, gauge);
        return { voterProxyBalanceBefore, gaugeBalanceBefore };
    }
    before("init contract", async () => {
        await setup();
    });
    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            expect(await voterProxyLite.mintr(), "mintr").to.eq(l2mocks.addresses.minter);
            expect(await voterProxyLite.crv(), "crv").to.eq(l2mocks.addresses.token);
            expect(await voterProxyLite.owner(), "owner").to.eq(dao.address);
            expect(await voterProxyLite.operator(), "operator").to.eq(sidechain.booster.address);
            expect(await voterProxyLite.getName(), "name").to.eq("BalancerVoterProxy");
        });
        it("fails if initialize is called more than once", async () => {
            await expect(
                voterProxyLite.connect(dao.signer).initialize(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS),
                "init call twice",
            ).to.be.revertedWith("Only once");
        });
        it("fails if initialize is not called by owner", async () => {
            await expect(
                voterProxyLite.connect(deployer.signer).initialize(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS),
                "not owner",
            ).to.be.revertedWith("!auth");
        });
    });
    describe("setOwner", async () => {
        it("should  update the owner", async () => {
            const currentOwner = await voterProxyLite.owner();
            expect(currentOwner, "current owner").to.not.be.eq(deployer.address);

            await voterProxyLite.connect(dao.signer).setOwner(deployer.address);
            expect(await voterProxyLite.owner(), "new owner").to.be.eq(deployer.address);
            // Reverts change
            await voterProxyLite.setOwner(currentOwner);
        });
        it("fails if caller is not owner", async () => {
            const currentOwner = await voterProxyLite.owner();
            expect(currentOwner, "current owner").to.not.be.eq(deployer.address);
            await expect(
                voterProxyLite.connect(deployer.signer).setOwner(deployer.address),
                "fails due to auth",
            ).to.be.revertedWith("!auth");
        });
    });
    describe("setSystemConfig", async () => {
        it("should  update the mintr", async () => {
            const currentMintr = await voterProxyLite.mintr();
            const owner = await voterProxyLite.owner();
            expect(owner, "only owner").to.be.eq(dao.address);

            await voterProxyLite.connect(dao.signer).setSystemConfig(ZERO_ADDRESS);
            expect(await voterProxyLite.mintr(), "new system config").to.be.eq(ZERO_ADDRESS);
            // Reverts change
            await voterProxyLite.connect(dao.signer).setSystemConfig(currentMintr);
        });
        it("fails if caller is not owner", async () => {
            const owner = await voterProxyLite.owner();
            expect(owner, "owner").to.not.be.eq(deployer.address);
            await expect(
                voterProxyLite.connect(deployer.signer).setSystemConfig(deployer.address),
                "fails due to auth",
            ).to.be.revertedWith("!auth");
        });
    });
    describe("setOperator", async () => {
        it("fails if caller is not owner", async () => {
            const owner = await voterProxyLite.owner();
            expect(owner, "owner").to.not.be.eq(deployer.address);
            await expect(
                voterProxyLite.connect(deployer.signer).setOperator(deployer.address),
                "fails due to auth",
            ).to.be.revertedWith("!auth");
        });
        it("fails if operator is already set and is not shutdown", async () => {
            const owner = await voterProxyLite.owner();
            const operator = await voterProxyLite.operator();

            expect(owner, "owner").to.be.eq(dao.address);
            expect(operator, "operator").to.not.be.eq(ZERO_ADDRESS);

            await expect(voterProxyLite.connect(dao.signer).setOperator(deployer.address), "fails").to.be.revertedWith(
                "needs shutdown",
            );
        });
        it("should  update the operator for the first time", async () => {
            const newVoterProxyLite = await new VoterProxyLite__factory(deployer.signer).deploy();

            const operator = await newVoterProxyLite.operator();
            const owner = await newVoterProxyLite.owner();
            expect(owner, "only owner").to.be.eq(deployer.address);
            expect(operator, "operator").to.be.eq(ZERO_ADDRESS);

            await newVoterProxyLite.connect(deployer.signer).setOperator(sidechain.booster.address);
            expect(await newVoterProxyLite.operator(), "new operator").to.be.eq(sidechain.booster.address);
        });
        it("should  update the operator after shutdown previous operator", async () => {
            const newVoterProxyLite = await new VoterProxyLite__factory(deployer.signer).deploy();
            const newBoosterLiteToShutdown = await new BoosterLite__factory(deployer.signer).deploy(
                newVoterProxyLite.address,
            );
            const newBoosterLiteAlive = await new BoosterLite__factory(deployer.signer).deploy(
                newVoterProxyLite.address,
            );

            const operator = await newVoterProxyLite.operator();
            const owner = await newVoterProxyLite.owner();
            expect(owner, "only owner").to.be.eq(deployer.address);
            expect(operator, "operator").to.be.eq(ZERO_ADDRESS);

            // Set operator for the first time
            await newVoterProxyLite.connect(deployer.signer).setOperator(newBoosterLiteToShutdown.address);
            // Shutdown operator
            await newBoosterLiteToShutdown.shutdownSystem();
            expect(await newBoosterLiteToShutdown.isShutdown(), "booster shutdown").to.be.eq(true);
            // Set new booster to voter proxy

            await newVoterProxyLite.connect(deployer.signer).setOperator(newBoosterLiteAlive.address);
            expect(await newVoterProxyLite.operator(), "new operator").to.be.eq(newBoosterLiteAlive.address);
        });
    });
    describe("setStashAccess", async () => {
        it("only operator can call", async () => {
            const status = true;
            const operator = await voterProxyLite.operator();
            expect(operator, "only operator").to.be.eq(sidechain.booster.address);
            const operatorAccount = await impersonateAccount(operator);

            // Just validate it does not revert , it keeps compatibility with booster internal calls
            await voterProxyLite.connect(operatorAccount.signer).setStashAccess(deployer.address, status);
        });
        it("fails if caller is not operator", async () => {
            const operator = await voterProxyLite.operator();
            expect(operator, "only operator").to.not.be.eq(deployer.address);
            await expect(
                voterProxyLite.connect(deployer.signer).setStashAccess(ZERO_ADDRESS, true),
                "fails due to auth",
            ).to.be.revertedWith("!auth");
        });
    });
    describe("deposit", async () => {
        let gauge: string;
        before(async () => {
            gauge = l2mocks.addresses.gauges[0];
        });
        it("fails if caller is not operator", async () => {
            const operator = await voterProxyLite.operator();
            expect(operator, "only operator").to.not.be.eq(deployer.address);
            await expect(
                voterProxyLite.connect(deployer.signer).deposit(ZERO_ADDRESS, ZERO_ADDRESS),
                "fails due to auth",
            ).to.be.revertedWith("!auth");
        });

        it("operator deposits into voter proxy", async () => {
            const amount = simpleToExactAmount(10);
            const { voterProxyBalanceBefore, gaugeBalanceBefore } = await boosterDepositIntoVoterProxy(gauge, amount);

            const voterProxyBalanceAfter = await l2mocks.lptoken.balanceOf(voterProxyLite.address);
            const gaugeBalanceAfter = await l2mocks.lptoken.balanceOf(gauge);

            expect(voterProxyBalanceAfter, "voter proxy balance").to.be.eq(voterProxyBalanceBefore.sub(amount));
            expect(voterProxyBalanceAfter, "full voter proxy balance must be deposited").to.be.eq(ZERO);
            expect(gaugeBalanceAfter, "gauge balance increases").to.be.eq(gaugeBalanceBefore.add(amount));
        });
    });
    describe("withdraw LP tokens from a gauge", async () => {
        let gauge: string;
        before(async () => {
            gauge = l2mocks.addresses.gauges[0];
        });
        it("withdraw LP tokens from a voter proxy when there is some balance on the voter", async () => {
            const operator = await voterProxyLite.operator();
            const operatorAccount = await impersonateAccount(operator);
            const amount = simpleToExactAmount(10);
            await l2mocks.lptoken.transfer(voterProxyLite.address, amount.mul(2));
            // Given that
            const boosterBalanceBefore = await l2mocks.lptoken.balanceOf(sidechain.booster.address);
            const voterProxyBalanceBefore = await l2mocks.lptoken.balanceOf(voterProxyLite.address);
            const gaugeBalanceBefore = await l2mocks.lptoken.balanceOf(gauge);
            expect(voterProxyBalanceBefore, "voter proxy balance > amount").to.be.gt(amount);
            // When withdraw
            await voterProxyLite
                .connect(operatorAccount.signer)
                ["withdraw(address,address,uint256)"](l2mocks.lptoken.address, gauge, amount);

            // Then transfer tokens from voter proxy only to the booster
            const boosterBalanceAfter = await l2mocks.lptoken.balanceOf(sidechain.booster.address);
            const voterProxyBalanceAfter = await l2mocks.lptoken.balanceOf(voterProxyLite.address);
            const gaugeBalanceAfter = await l2mocks.lptoken.balanceOf(gauge);
            expect(boosterBalanceAfter, "booster balance").to.be.eq(boosterBalanceBefore.add(amount));
            expect(voterProxyBalanceAfter, "voter proxy balance").to.be.eq(voterProxyBalanceBefore.sub(amount));
            expect(gaugeBalanceAfter, "gauge balance").to.be.eq(gaugeBalanceBefore);
        });
        it("withdraw LP tokens from a voter proxy and the gauge", async () => {
            const operator = await voterProxyLite.operator();
            const operatorAccount = await impersonateAccount(operator);
            const amount = simpleToExactAmount(20);
            // Given that
            const boosterBalanceBefore = await l2mocks.lptoken.balanceOf(sidechain.booster.address);
            const voterProxyBalanceBefore = await l2mocks.lptoken.balanceOf(voterProxyLite.address);
            const gaugeBalanceBefore = await l2mocks.lptoken.balanceOf(gauge);
            expect(voterProxyBalanceBefore, "voter proxy balance > ZERO").to.be.gt(ZERO);
            expect(voterProxyBalanceBefore, "voter proxy balance < amount").to.be.lt(amount);
            const expectGaugeWithdraw = amount.sub(boosterBalanceBefore);

            // When withdraw
            await voterProxyLite
                .connect(operatorAccount.signer)
                ["withdraw(address,address,uint256)"](l2mocks.lptoken.address, gauge, amount);

            // Then withdraws from gauge and voter proxy to the booster
            const boosterBalanceAfter = await l2mocks.lptoken.balanceOf(sidechain.booster.address);
            const voterProxyBalanceAfter = await l2mocks.lptoken.balanceOf(voterProxyLite.address);
            const gaugeBalanceAfter = await l2mocks.lptoken.balanceOf(gauge);
            expect(boosterBalanceAfter, "booster balance").to.be.eq(boosterBalanceBefore.add(amount));
            expect(voterProxyBalanceAfter, "voter proxy balance").to.be.eq(ZERO);
            expect(gaugeBalanceAfter, "gauge balance").to.be.eq(gaugeBalanceBefore.sub(expectGaugeWithdraw));
        });
        it("withdraw all balance from the gauge", async () => {
            const operator = await voterProxyLite.operator();
            const operatorAccount = await impersonateAccount(operator);
            const amount = simpleToExactAmount(20);
            // Given that
            await boosterDepositIntoVoterProxy(gauge, amount);
            const gaugeBalanceBefore = await l2mocks.lptoken.balanceOf(gauge);
            const boosterBalanceBefore = await l2mocks.lptoken.balanceOf(sidechain.booster.address);
            expect(gaugeBalanceBefore, "gauge balance").to.be.gt(ZERO);

            // When withdraw all
            await voterProxyLite.connect(operatorAccount.signer).withdrawAll(l2mocks.lptoken.address, gauge);

            // Then withdraws from gauge and voter proxy to the booster
            const boosterBalanceAfter = await l2mocks.lptoken.balanceOf(sidechain.booster.address);
            const voterProxyBalanceAfter = await l2mocks.lptoken.balanceOf(voterProxyLite.address);
            const gaugeBalanceAfter = await l2mocks.lptoken.balanceOf(gauge);
            expect(boosterBalanceAfter, "booster balance").to.be.eq(boosterBalanceBefore.add(gaugeBalanceBefore));
            expect(voterProxyBalanceAfter, "voter proxy balance").to.be.eq(ZERO);
            expect(gaugeBalanceAfter, "gauge balance").to.be.eq(gaugeBalanceBefore.sub(gaugeBalanceBefore));
        });
        it("withdraw fails if caller is not operator", async () => {
            const operator = await voterProxyLite.operator();
            expect(operator, "only operator").to.not.be.eq(deployer.address);
            await expect(
                voterProxyLite
                    .connect(deployer.signer)
                    ["withdraw(address,address,uint256)"](ZERO_ADDRESS, ZERO_ADDRESS, 0),
                "fails due to auth",
            ).to.be.revertedWith("!auth");
        });
        it("withdrawAll fails if caller is not operator", async () => {
            const operator = await voterProxyLite.operator();
            expect(operator, "only operator").to.not.be.eq(deployer.address);
            await expect(
                voterProxyLite.connect(deployer.signer).withdrawAll(ZERO_ADDRESS, ZERO_ADDRESS),
                "fails due to auth",
            ).to.be.revertedWith("!auth");
        });
    });
    describe("claimCrv", async () => {
        let operator: string;
        let operatorAccount: Account;
        before(async () => {
            operator = await voterProxyLite.operator();
            operatorAccount = await impersonateAccount(operator);
        });

        it("should mint and send crv to operator", async () => {
            const boosterBalanceBefore = await l2mocks.crv.balanceOf(sidechain.booster.address);
            // Test
            const tx = await voterProxyLite.connect(operatorAccount.signer).claimCrv(l2mocks.addresses.gauges[0]);

            const boosterBalanceAfter = await l2mocks.crv.balanceOf(sidechain.booster.address);
            expect(boosterBalanceAfter, "booster crv balance").to.be.gt(boosterBalanceBefore);
        });
        it("fails if operator is not the caller", async () => {
            expect(operator, "only operator").to.not.be.eq(deployer.address);
            await expect(
                voterProxyLite.connect(deployer.signer).claimCrv(ZERO_ADDRESS),
                "fails due to auth",
            ).to.be.revertedWith("!auth");
        });
    });
    describe("claimRewards", async () => {
        let operator: string;
        let operatorAccount: Account;
        before(async () => {
            operator = await voterProxyLite.operator();
            operatorAccount = await impersonateAccount(operator);
        });

        it("should not fail even if there are no extra rewards on the gauge", async () => {
            await expect(voterProxyLite.connect(operatorAccount.signer).claimRewards(l2mocks.addresses.gauges[0])).to
                .not.be.reverted;
        });
        it("fails if operator is not the caller", async () => {
            expect(operator, "only operator").to.not.be.eq(deployer.address);
            await expect(
                voterProxyLite.connect(deployer.signer).claimRewards(ZERO_ADDRESS),
                "fails due to auth",
            ).to.be.revertedWith("!auth");
        });
    });
    describe("when shutting down", async () => {
        let operator: string;
        let operatorAccount: Account;
        before(async () => {
            operator = await voterProxyLite.operator();
            operatorAccount = await impersonateAccount(operator);
        });
        it("migrate tokens via `execute`", async () => {
            const balance = await l2mocks.lptoken.balanceOf(voterProxyLite.address);
            const receiverAcc = await accounts[7].getAddress();
            const data = l2mocks.lptoken.interface.encodeFunctionData("transfer", [receiverAcc, balance]);
            await voterProxyLite.connect(operatorAccount.signer).execute(l2mocks.lptoken.address, "0", data);

            const newBalance = await l2mocks.lptoken.balanceOf(voterProxyLite.address);
            expect(newBalance).eq(ZERO);

            const receiverAccBalance = await l2mocks.lptoken.balanceOf(receiverAcc);
            expect(receiverAccBalance).eq(balance);
        });
        it("fails if operator is not the caller", async () => {
            expect(operator, "only operator").to.not.be.eq(deployer.address);
            await expect(
                voterProxyLite.connect(deployer.signer).execute(ZERO_ADDRESS, ZERO_ADDRESS, "0x"),
                "fails due to auth",
            ).to.be.revertedWith("!auth");
        });
    });
});
