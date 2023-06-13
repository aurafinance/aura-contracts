import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";

import { DeployL2MocksResult } from "../../scripts/deploySidechainMocks";
import { deployContract } from "../../tasks/utils";
import { impersonateAccount } from "../../test-utils/fork";
import {
    Account,
    BoosterLite,
    MockCurveGauge,
    MockCurveGauge__factory,
    MockERC20,
    MockERC20__factory,
    PoolManagerLite,
} from "../../types";
import { sidechainTestSetup } from "../sidechain/sidechainTestSetup";
import { DEAD_ADDRESS } from "../../test-utils";

describe("PoolManagerLite", () => {
    let booster: BoosterLite;
    let poolManager: PoolManagerLite;
    let accounts: Signer[];

    let alice: Signer;
    let deployer: Account;
    let dao: Account;
    let mocks: DeployL2MocksResult;

    before(async () => {
        accounts = await ethers.getSigners();
        const testSetup = await sidechainTestSetup(hre, accounts);
        deployer = testSetup.deployer;
        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);
        mocks = testSetup.l2.mocks;

        alice = accounts[5];

        booster = testSetup.l2.sidechain.booster;
        poolManager = testSetup.l2.sidechain.poolManager;
    });

    describe("@method addPool", async () => {
        let gauge: MockCurveGauge;
        let lptoken: MockERC20;

        before(async () => {
            lptoken = await deployContract<MockERC20>(
                hre,
                new MockERC20__factory(deployer.signer),
                "MockCRV",
                ["mockCrv", "mockCrv", 18, deployer.address, 10000000],
                {},
                false,
            );

            gauge = await deployContract<MockCurveGauge>(
                hre,
                new MockCurveGauge__factory(accounts[0]),
                "MockCurveGauge",
                ["mockGauge", "mockGauge", lptoken.address, []],
                {},
                false,
            );
        });

        it("addPool called by operator", async () => {
            // const tx = await poolManager["addPool(address)"](gauge.address);
            const tx = await poolManager.connect(dao.signer)["addPool(address)"](gauge.address);

            await tx.wait();

            const lptoken = await gauge.lp_token();
            const pool = await booster.poolInfo(1);
            expect(pool.lptoken).to.equal(lptoken);
        });

        it("reverts if gauge has already been added", async () => {
            const failedTx = poolManager.connect(dao.signer)["addPool(address)"](gauge.address);
            await expect(failedTx).to.revertedWith("already registered gauge");
        });
        it("reverts if gauge/lptoken has already been added", async () => {
            const gaugeWithSameToken = await deployContract<MockCurveGauge>(
                hre,
                new MockCurveGauge__factory(accounts[0]),
                "MockCurveGauge",
                ["mockGauge", "mockGauge", gauge.address, []],
                {},
                false,
            );

            const failedTx = poolManager.connect(dao.signer)["addPool(address)"](gaugeWithSameToken.address);
            await expect(failedTx).to.revertedWith("already registered lptoken");
        });
    });

    describe("@method shutdownPool", () => {
        it("reverts if not called by operator", async () => {
            const failedTx = poolManager.connect(alice).shutdownPool(0);
            await expect(failedTx).to.revertedWith("!auth");
        });

        it("happy path", async () => {
            await poolManager.connect(dao.signer).shutdownPool(0);
            await poolManager.connect(dao.signer).shutdownPool(1);

            let pool = await booster.poolInfo(0);
            expect(pool.shutdown).to.equal(true);
            pool = await booster.poolInfo(1);
            expect(pool.shutdown).to.equal(true);
        });
        it("reverts if already shutdown", async () => {
            const failedTx = poolManager.connect(dao.signer).shutdownPool(0);
            await expect(failedTx).to.revertedWith("already shutdown");
        });
    });
    describe("@method shutdownPool", () => {
        it("reverts if not called by operator", async () => {
            const failedTx = poolManager.connect(alice).shutdownSystem();
            await expect(failedTx).to.revertedWith("!auth");
        });

        it("happy path", async () => {
            await poolManager.connect(dao.signer).shutdownSystem();
            expect(await poolManager.isShutdown()).to.equal(true);
        });
        xit("reverts if already shutdown and try to add pool", async () => {
            const lp_token = await deployContract<MockERC20>(
                hre,
                new MockERC20__factory(deployer.signer),
                "MockCRV",
                ["mockCrv", "mockCrv", 18, deployer.address, 10000000],
                {},
                false,
            );
            const gauge = await deployContract<MockCurveGauge>(
                hre,
                new MockCurveGauge__factory(accounts[0]),
                "MockCurveGauge",
                ["BadGauge", "badGauge", lp_token.address, []],
                {},
                false,
            );
            const failedTx = await poolManager.connect(alice)["addPool(address)"](gauge.address);
            await expect(failedTx).to.revertedWith("already shutdown");
        });
    });
});
