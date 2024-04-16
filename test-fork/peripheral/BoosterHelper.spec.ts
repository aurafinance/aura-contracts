import { expect } from "chai";
import { Signer } from "ethers";
import hre, { network } from "hardhat";
import { deployBoosterHelper } from "../../scripts/deployPeripheral";
import { config } from "../../tasks/deploy/mainnet-config";
import { impersonate } from "../../test-utils";
import { Booster, BoosterHelper, Booster__factory, Create2Factory__factory } from "../../types/generated";
import { ExtSidechainConfig } from "types";

const keeperAddress = "0xcc247cde79624801169475c9ba1f716db3959b8f";
const boosterAddress = "0xA57b8d98dAE62B26Ec3bcC4a365338157060B234";

describe("BoosterHelper", () => {
    let boosterHelper: BoosterHelper;
    let booster: Booster;
    let signer: Signer;
    let deployer: Signer;
    let keeper: Signer;
    let deployerAddress: string;

    const setup = async (blockNumber: number) => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: blockNumber,
                    },
                },
            ],
        });
        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        deployer = await impersonate(deployerAddress);
        keeper = await impersonate(keeperAddress);

        signer = keeper;
        const create2Factory = await new Create2Factory__factory(signer).deploy();
        booster = Booster__factory.connect(boosterAddress, signer);
        ({ boosterHelper } = await deployBoosterHelper(
            hre,
            deployer,
            { token: config.addresses.token, create2Factory: create2Factory.address } as ExtSidechainConfig,
            { booster },
        ));
    };
    const start = 57;

    it("get expired pools", async () => {
        await setup(18613470);
        const daysToExpiration = 0;
        const expiredPools = await boosterHelper.getExpiredPools(start, daysToExpiration);
        const expiredPoolIds = expiredPools.map(poolInfo => poolInfo.pid).map(bn => bn.toNumber());

        // Expected result https://etherscan.io/tx/0x0191e2bee45b4df9d12b849fac71a82b50faf5aeb33f2fdfcc7a47c097ed82de
        // 111,132,146,97
        // Automation will need to verify if the given pid has claimable tokens on the gauge.
        // IE const claimableTokens = await gauge.claimable_tokens(voterProxyAddress);
        expect(expiredPools.length).to.be.eq(30);

        expect(expiredPoolIds.includes(97)).to.be.true;
        expect(expiredPoolIds.includes(111)).to.be.true;
        expect(expiredPoolIds.includes(132)).to.be.true;
        expect(expiredPoolIds.includes(146)).to.be.true;

        // Negative expectations
        expect(expiredPoolIds.includes(start - 1)).to.be.false;
        expect(expiredPoolIds.includes(46)).to.be.false;

        await boosterHelper.earmarkRewards([97, 111, 132]);

        // Search for the missing pool
        const expiredPoolsAfter = await boosterHelper.getExpiredPools(140, daysToExpiration);
        const expiredPoolIdsAfter = expiredPoolsAfter.map(poolInfo => poolInfo.pid).map(bn => bn.toNumber());

        expect(expiredPoolIdsAfter.includes(146)).to.be.true;
        // Processed
        expect(expiredPoolIdsAfter.includes(97)).to.be.false;
        expect(expiredPoolIdsAfter.includes(111)).to.be.false;
        expect(expiredPoolIdsAfter.includes(132)).to.be.false;
    });

    it("get idle pools", async () => {
        await setup(18618054);
        const idlePoolIdsBN = await boosterHelper.getIdlePoolIds(start);
        const idlePoolIds = idlePoolIdsBN.map(bn => bn.toNumber());

        expect(idlePoolIds.length).to.be.eq(2);
        expect(idlePoolIds.includes(109)).to.be.true;
        expect(idlePoolIds.includes(161)).to.be.true;

        // Test
        await boosterHelper.processIdleRewards(idlePoolIds);

        const idlePoolIdsAfter = await boosterHelper.getIdlePoolIds(start);
        expect(idlePoolIdsAfter.length).to.be.eq(0);
    });
    it("get idle base and virtual pools", async () => {
        await setup(18618054);
        const idlePoolIds = await boosterHelper.getIdleBaseAndVirtualPools(150);
        expect(idlePoolIds.length).to.be.eq(1);
        expect(idlePoolIds[0]).to.be.eq("0xC2E2D76a5e02eA65Ecd3be6c9cd3Fa29022f4548");

        // Test
        await boosterHelper.processIdleRewardsByAddress(idlePoolIds);

        const idlePoolIdAfter = await boosterHelper.getIdleBaseAndVirtualPools(150);
        expect(idlePoolIdAfter.length).to.be.eq(0);
    });
});
