import hre from "hardhat";
import { getSigner } from "../tasks/utils";
import { config } from "../tasks/deploy/arbitrum-config";
import { BaseRewardPool__factory, ERC20__factory } from "../types";
import { getAddress } from "ethers/lib/utils";
import { BigNumber } from "ethers";
import { increaseTime, ONE_WEEK } from "../test-utils";

async function main() {
    await hre.network.provider.request({
        method: "hardhat_reset",
        params: [
            {
                forking: {
                    jsonRpcUrl: process.env.NODE_URL,
                    blockNumber: 126042274,
                },
            },
        ],
    });

    const deployer = await getSigner(hre);
    const contracts = config.getSidechain(deployer);
    const len = await contracts.booster.poolLength();

    let total = BigNumber.from(0);
    let atotal = BigNumber.from(0);
    let cache = {};

    await increaseTime(ONE_WEEK.mul(2));

    for (let i = 0; i < len.toNumber(); i++) {
        const info = await contracts.booster.poolInfo(i);
        const r = BaseRewardPool__factory.connect(info.crvRewards, deployer);
        const bal = ERC20__factory.connect("0x040d1edc9569d4bab2d15287dc5a4f10f56a56b8", deployer);

        total = total.add(await r.queuedRewards());
        atotal = atotal.add(await bal.balanceOf(r.address));

        const filter = r.filters.Staked();

        const logs = await deployer.provider.getLogs({
            ...filter,
            fromBlock: 0,
            toBlock: "latest",
        });

        for (const log of logs) {
            const a = getAddress("0x" + log.topics[1].slice(26));
            if (cache[a]) continue;
            cache[a] = true;
            const b0 = await bal.balanceOf(a);
            await r["getReward(address,bool)"](a, false);
            const b1 = await bal.balanceOf(a);
            total = total.add(b1.sub(b0));
        }
    }

    console.log(total, atotal);
}

main();
