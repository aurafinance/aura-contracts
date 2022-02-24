import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockMultisigs, getMockDistro } from "../scripts/deployMocks";
import { Booster, MockCurveGauge__factory, PoolManagerV3, MockCurveGauge } from "../types/generated";
import { deployContract } from "../tasks/utils";
import { Signer } from "ethers";

describe("PoolManagerV3", () => {
    let booster: Booster;
    let poolManager: PoolManagerV3;
    let mocks: DeployMocksResult;
    let accounts: Signer[];

    before(async () => {
        accounts = await ethers.getSigners();

        mocks = await deployMocks(accounts[0]);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(accounts[0], mocks.addresses);
        const phase2 = await deployPhase2(accounts[0], phase1, multisigs, mocks.namingConfig);
        const contracts = await deployPhase3(
            hre,
            accounts[0],
            phase2,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );

        booster = contracts.booster;
        poolManager = contracts.poolManager;
    });

    describe("@method addPool", async () => {
        let badGauge: MockCurveGauge;

        before(async () => {
            const badLptoken = "0x0000000000000000000000000000000000000000";
            badGauge = await deployContract<MockCurveGauge>(
                new MockCurveGauge__factory(accounts[0]),
                "MockCurveGauge",
                ["BadGauge", "badGauge", badLptoken, []],
                {},
                false,
            );
        });

        it("happy path", async () => {
            const tx = await poolManager["addPool(address)"](mocks.gauge.address);
            await tx.wait();

            const lptoken = await mocks.gauge.lp_token();
            const pool = await booster.poolInfo(0);
            expect(pool.lptoken).to.equal(lptoken);
        });

        it("reverts if pool weight is 0", async () => {
            const failedTx = poolManager["addPool(address)"](badGauge.address);
            await expect(failedTx).to.revertedWith("must have weight");
        });

        it("reverts if lptoken address is 0", async () => {
            const tx = await mocks.voting.vote_for_gauge_weights(badGauge.address, 1);
            await tx.wait();

            const failedTx = poolManager["addPool(address)"](badGauge.address);
            await expect(failedTx).to.revertedWith("lp token is 0");
        });

        it("reverts if gauge has already been added", async () => {
            const failedTx = poolManager["addPool(address)"](mocks.gauge.address);
            await expect(failedTx).to.revertedWith("already registered gauge");
        });
    });

    describe("@method shutdownPool", () => {
        it("reverts if not called by operator", async () => {
            const failedTx = poolManager.connect(accounts[2]).shutdownPool(0);
            await expect(failedTx).to.revertedWith("!auth");
        });

        it("happy path", async () => {
            const tx = await poolManager.shutdownPool(0);
            await tx.wait();

            const pool = await booster.poolInfo(0);
            expect(pool.shutdown).to.equal(true);
        });
    });
});
