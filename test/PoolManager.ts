import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockMultisigs, getMockDistro } from "../scripts/deployMocks";
import { Booster, PoolManagerV3 } from "types";

describe("PoolManagerV3", () => {
    let booster: Booster;
    let poolManager: PoolManagerV3;

    let mocks: DeployMocksResult;

    before(async () => {
        const accounts = await ethers.getSigners();

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

    it("@method addPool", async () => {
        const gauge = mocks.gauge;
        const tx = await poolManager["addPool(address)"](gauge.address);
        await tx.wait();

        const lptoken = await gauge.lp_token();
        const pool = await booster.poolInfo(0);
        expect(pool.lptoken).to.equal(lptoken);
    });

    it("@method shutdownPool", async () => {
        const tx = await poolManager.shutdownPool(0);
        await tx.wait();

        const pool = await booster.poolInfo(0);
        expect(pool.shutdown).to.equal(true);
    });
});
