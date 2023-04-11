import { network } from "hardhat";
import { impersonateAccount, simpleToExactAmount } from "../../test-utils";
import { config } from "../../tasks/deploy/mainnet-config";
import { Phase6Deployed, Phase8Deployed } from "../../scripts/deploySystem";
import { Account } from "../../types/common";
import {
    ERC20,
    ERC20__factory,
    ExtraRewardStashV3,
    ExtraRewardStashV3__factory,
    VirtualBalanceRewardPool__factory,
} from "../../types";

const PID = 73;
const LDO = "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32";

describe("OHM Extra Rewards", () => {
    let phase6: Phase6Deployed;
    let phase8: Phase8Deployed;
    let dao: Account;
    let ldoWhale: Account;
    let ldo: ERC20;
    let stash: ExtraRewardStashV3;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 17023330,
                    },
                },
            ],
        });

        dao = await impersonateAccount(config.multisigs.daoMultisig);
        ldoWhale = await impersonateAccount("0x3e40D73EB977Dc6a537aF587D48316feE66E9C8c", true);
        phase6 = await config.getPhase6(dao.signer);
        phase8 = await config.getPhase8(dao.signer);
        ldo = ERC20__factory.connect(LDO, ldoWhale.signer);
    });
    it("add extra rewards", async () => {
        await phase8.boosterOwnerSecondary.setStashExtraReward(PID, LDO);
    });
    it("send extra rewards to stash", async () => {
        const poolInfo = await phase6.booster.poolInfo(PID);
        stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, dao.signer);
        await ldo.transfer(poolInfo.stash, simpleToExactAmount(100));
    });
    it("queue extra rewards", async () => {
        await phase6.booster.earmarkRewards(PID);

        console.log("Token count:", await stash.tokenCount());
        console.log("Token [0]:", await stash.tokenList(0));
        console.log("LDO:", LDO);

        const tokenInfo = await stash.tokenInfo(LDO);
        const v = VirtualBalanceRewardPool__factory.connect(tokenInfo.rewardAddress, dao.signer);

        console.log("Historical:", await v.historicalRewards());
        console.log("Current:", await v.currentRewards());
    });
});
