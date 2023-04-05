import { expect } from "chai";
import hre, { ethers, network } from "hardhat";
import { BigNumber } from "ethers";

import { ONE_DAY } from "../../test-utils/constants";
import { config } from "../../tasks/deploy/mainnet-config";
import { impersonateAccount } from "../../test-utils/fork";
import { increaseTime, getTimestamp } from "../../test-utils";
import { deployFeeScheduler } from "../../scripts/deployPeripheral";
import { ERC20__factory, ERC20, Account, FeeForwarder, FeeScheduler, AuraBalStrategy } from "../../types";

describe("FeeScheduler", () => {
    let deployer: Account;
    let dao: Account;
    let strategy: AuraBalStrategy;
    let scheduler: FeeScheduler;
    let feeForwarder: FeeForwarder;
    let bal: ERC20;
    let forwardedBalance: BigNumber;

    const FORK_BLOCK_NUMBER = 16975757;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: FORK_BLOCK_NUMBER,
                    },
                },
            ],
        });

        const accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress(), true);
        dao = await impersonateAccount(config.multisigs.daoMultisig, true);

        strategy = (await config.getAuraBalVault(deployer.signer)).strategy;
        feeForwarder = (await config.getFeeForwarder(deployer.signer)).feeForwarder;
        bal = ERC20__factory.connect(config.addresses.token, deployer.signer);

        const results = await deployFeeScheduler(hre, deployer.signer);

        scheduler = results.feeScheduler;
    });

    describe("FeeScheduler config", () => {
        it("has the right config", async () => {
            expect(await scheduler.duration()).eq(ONE_DAY.mul(2));
            expect(await scheduler.nEpochs()).eq(5);
            expect(await scheduler.dao()).eq(config.multisigs.daoMultisig);
            expect(await scheduler.to()).eq(strategy.address);
            expect(await scheduler.bal()).eq(config.addresses.token);
            expect(await scheduler.startTime()).eq(0);
            expect(await scheduler.startBalance()).eq(0);
            expect(await scheduler.forwardedBalance()).eq(0);
        });
    });

    describe("Initialize", () => {
        it("only callable by the DAO", async () => {
            await expect(scheduler.connect(deployer.signer).init()).to.be.revertedWith("!dao");
        });
        it("fails if BAL balance is 0", async () => {
            await expect(scheduler.connect(dao.signer).init()).to.be.revertedWith("balance<0");
        });
        it("[DAO TX] forward fees to FeeScheduler", async () => {
            forwardedBalance = await bal.balanceOf(feeForwarder.address);
            expect(forwardedBalance).gt(0);
            await feeForwarder.connect(dao.signer).forward(scheduler.address, config.addresses.token, forwardedBalance);
            expect(await bal.balanceOf(feeForwarder.address)).eq(0);
            expect(await bal.balanceOf(scheduler.address)).eq(forwardedBalance);
        });
        it("cannot call forward while not active", async () => {
            await expect(scheduler.forward()).to.be.revertedWith("!active");
        });
        it("can call init", async () => {
            const blocktime = await getTimestamp();

            await scheduler.connect(dao.signer).init();
            expect(await scheduler.startTime()).gte(blocktime);
            expect(await scheduler.startBalance()).eq(forwardedBalance);
        });
        it("can not call init again", async () => {
            await expect(scheduler.connect(dao.signer).init()).to.be.revertedWith("already started");
        });
    });

    describe("Forward fees", () => {
        const expectForward = async (epoch: number) => {
            const expected = forwardedBalance.div(await scheduler.nEpochs());
            const expectedTotal = expected.mul(epoch);

            if (epoch > 1) {
                await increaseTime(ONE_DAY.mul(2));
            }

            const balBefore = await bal.balanceOf(scheduler.address);
            const balBefore0 = await bal.balanceOf(strategy.address);

            await scheduler.forward();

            const balAfter = await bal.balanceOf(scheduler.address);
            const balAfter0 = await bal.balanceOf(strategy.address);

            expect(await scheduler.forwardedBalance()).eq(expectedTotal);
            expect(balBefore.sub(balAfter)).eq(expected);
            expect(balAfter0.sub(balBefore0)).eq(expected);

            await expect(scheduler.forward()).to.be.revertedWith("!amount");
        };
        it("epoch 1", async () => {
            await expectForward(1);
        });
        it("epoch 2", async () => {
            await expectForward(2);
        });
        it("epoch 3", async () => {
            await expectForward(3);
        });
        it("epoch 4", async () => {
            await expectForward(4);
        });
        it("epoch 5", async () => {
            await expectForward(5);
        });
        it("FeeScheduler is empty", async () => {
            expect(await bal.balanceOf(scheduler.address)).eq(0);
            await increaseTime(ONE_DAY.mul(2));
            await expect(scheduler.forward()).to.be.revertedWith("!amount");
        });
    });
});
