import hre, { ethers, network } from "hardhat";
import { Signer } from "ethers";
import { impersonateAccount } from "../test-utils";
import { config } from "../tasks/deploy/mainnet-config";
import { expect } from "chai";
import {
    MockCurveGauge,
    MockCurveGauge__factory,
    MockGaugeController__factory,
    PoolManagerV3__factory,
} from "../types";
import { deployContract } from "../tasks/utils";
import { Phase2Deployed } from "../scripts/deploySystem";

const debug = false;

describe("Add same LP Token twice", () => {
    let protocolDao: Signer;
    let lpToken: string;
    let gauge: string;
    let phase2: Phase2Deployed;
    let mockGauge: MockCurveGauge;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15135072,
                    },
                },
            ],
        });

        await impersonateAccount(config.multisigs.daoMultisig);
        protocolDao = await ethers.getSigner(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(protocolDao);
    });

    describe("PoolManager", () => {
        it("get existing LP token", async () => {
            const resp = await phase2.booster.poolInfo(0);
            lpToken = resp.lptoken;
            gauge = resp.gauge;
        });
        it("mock gauge controller", async () => {
            // Mock gauge controller with one that returns 1 when you query the weight
            await network.provider.send("hardhat_setCode", [
                config.addresses.gaugeController,
                MockGaugeController__factory.bytecode,
            ]);
        });
        it("deploy fake gauge with existing LP Token", async () => {
            mockGauge = await deployContract<MockCurveGauge>(
                hre,
                new MockCurveGauge__factory(protocolDao),
                "MockCurveGauge",
                ["MockCurveGauge", "MockCurveGauge", lpToken, []],
                {},
                debug,
            );
        });
        it("add existing lp token pool", async () => {
            const poolManager = PoolManagerV3__factory.connect(phase2.poolManager.address, protocolDao);
            await poolManager["addPool(address)"](mockGauge.address);
            const poolSize = await phase2.booster.poolLength();
            const resp = await phase2.booster.poolInfo(poolSize.sub(1));

            expect(resp.lptoken).eq(lpToken);
            expect(resp.gauge).not.eq(gauge);
        });
    });
});
