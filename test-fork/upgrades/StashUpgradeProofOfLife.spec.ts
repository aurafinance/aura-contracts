import hre, { network } from "hardhat";
import { expect } from "chai";
import { BigNumberish, Signer } from "ethers";
import { Phase2Deployed, Phase6Deployed } from "scripts/deploySystem";
import {
    Account,
    BaseRewardPool,
    BaseRewardPool__factory,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    MockERC20__factory,
    VirtualBalanceRewardPool,
    VirtualBalanceRewardPool__factory,
} from "../../types";
import { impersonateAccount, increaseTime, ONE_WEEK, simpleToExactAmount } from "../../test-utils";
import { config } from "../../tasks/deploy/mainnet-config";

const PID = 58;

describe("Extra Reward Stash Proof of Life", () => {
    let protocolDao: Account;
    let deployer: Signer;
    let phase6: Phase6Deployed;
    let phase2: Phase2Deployed;

    let rewards: BaseRewardPool;
    let virtualRewards: VirtualBalanceRewardPool;
    let stash: ExtraRewardStashV3;

    let depositor: Account;

    async function getAura(to: string, amount: BigNumberish) {
        const whale = await impersonateAccount("0xc9Cea7A3984CefD7a8D2A0405999CB62e8d206DC");
        const token = MockERC20__factory.connect(phase2.cvx.address, whale.signer);
        await token.transfer(to, amount);
    }

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 16748960,
                    },
                },
            ],
        });

        const signers = await hre.ethers.getSigners();
        deployer = signers[0];

        protocolDao = await impersonateAccount(config.multisigs.daoMultisig);
        phase6 = await config.getPhase6(protocolDao.signer);
        phase2 = await config.getPhase2(protocolDao.signer);

        depositor = await impersonateAccount("0x2Fd2C33E0DF6883B797662c721BA39601A86Fd27");
    });
    it("get extra rewards", async () => {
        const info = await phase6.booster.poolInfo(PID);

        stash = ExtraRewardStashV3__factory.connect(info.stash, deployer);
        rewards = BaseRewardPool__factory.connect(info.crvRewards, deployer);

        expect(await stash.tokenCount()).eq(1);
        expect(await stash.tokenList(0)).eq(phase2.cvx.address);

        const tInfo = await stash.tokenInfo(phase2.cvx.address);
        virtualRewards = VirtualBalanceRewardPool__factory.connect(tInfo.rewardAddress, deployer);
    });
    it("send AURA to stash", async () => {
        const amount = simpleToExactAmount(10);
        await getAura(stash.address, amount);
        expect(await phase2.cvx.balanceOf(stash.address)).gte(amount);
    });
    it("earmark rewards", async () => {
        await phase6.booster.earmarkRewards(PID);
        const currentRewards = await virtualRewards.currentRewards();
        expect(currentRewards).eq(simpleToExactAmount(10));
    });
    it("Get AURA rewards", async () => {
        const bal = await rewards.balanceOf(depositor.address);
        expect(bal).gt(0);
        expect(await rewards.totalSupply(), "only depositor").eq(bal);

        await increaseTime(ONE_WEEK.mul(2));
        const earned = await virtualRewards.earned(depositor.address);
        expect(earned).gt(0);

        const auraBalBefore = await phase2.cvx.balanceOf(depositor.address);
        await virtualRewards.connect(depositor.signer)["getReward()"]();
        const auraBalAfter = await phase2.cvx.balanceOf(depositor.address);
        expect(auraBalAfter.sub(auraBalBefore)).eq(earned);
        expect(await virtualRewards.earned(depositor.address)).eq(0);
    });
});
