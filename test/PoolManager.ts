import { ethers } from "hardhat";
import { expect } from "chai";
import deployBooster from "../scripts/deployBooster";
import deployMocks, { DeployMocksResult } from "../scripts/deployMocks";
import { Booster, PoolManagerV3 } from "types";

describe("PoolManagerV3", () => {
    let booster: Booster;
    let poolManager: PoolManagerV3;

    let mocks: DeployMocksResult;

    before(async () => {
        const accounts = await ethers.getSigners();

        mocks = await deployMocks(accounts[0]);

        const contracts = await deployBooster(accounts[0], {
            crv: mocks.crv.address,
            crvMinter: mocks.crv.address,
            votingEscrow: mocks.votingEscrow.address,
            gaugeController: mocks.voting.address,
            crvRegistry: mocks.registry.address,
            voteOwnership: mocks.voting.address,
            voteParameter: mocks.voting.address,
            feeDistro: mocks.feeDistro.address,
        });

        booster = contracts.booster;
        poolManager = contracts.poolManager;
    });

    it("@method addPool", async () => {
        const gauge = mocks.gauge;
        const tx = await poolManager["addPool(address)"](gauge.address);
        await tx.wait();

        const lptoken = await gauge.lp_token();
        const pool = await booster.poolInfo("0");
        expect(pool.lptoken).to.equal(lptoken);
    });

    it("@method shutdownPool", () => {
        // TODO:
    });
});
