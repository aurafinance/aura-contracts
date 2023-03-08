import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import { getSigner } from "../../tasks/utils";
import { Phase6Deployed } from "scripts/deploySystem";
import { config } from "../deploy/mainnet-config";
import { Contract, ethers } from "ethers";
import { table } from "table";
import { BigNumber as BN, utils } from "ethers";

const crvRewardsABI = [
    "function totalSupply() external view returns(uint256)",
    "function name() external view returns(string memory)",
    "function symbol() external view returns(string memory)",
];

const cleanUpSymbol = (poolSymbol: string): string =>
    poolSymbol
        .slice(4)
        .toLowerCase()
        .replace("-bpt-vault", "")
        .replace("-vault", "")
        .replace("bb-a-usd", "bbausd")
        .replace("bb-euler-usd", "bbausd");

const specialSymbolMatches = [
    { oldPoolSymbol: "wsteth-acx", newPoolSymbol: "50wsteth-50acx" },
    { oldPoolSymbol: "sfrxeth-steth-reth", newPoolSymbol: "wsteth-reth-sfrxeth" },
];
const truncateNumber = (amount: BN, decimals = 18, fixed = 2) =>
    Number(utils.formatUnits(amount, decimals)).toFixed(fixed);

/**
 * Compares two pools by it symbol with the following criteria:
 * - Symbol lower case are the same, ie: wsteth-acx == wsteth-acx returns true.
 * - Symbol is reversed,  ie: wsteth-acx == acx-wsteth returns true
 * - Symbol Matches special criteria defined on constant `specialSymbolMatches`
 *
 * @param {*} newPool
 * @param {*} oldPool
 * @return {boolean}
 */
const poolBySymbolVariants = (newPool, oldPool): boolean => {
    const isSameSymbol = cleanUpSymbol(newPool.poolSymbol) === cleanUpSymbol(oldPool.poolSymbol);
    if (isSameSymbol) return true;
    // aura
    const newPoolSymbol = cleanUpSymbol(newPool.poolSymbol);
    const oldPoolSymbol = cleanUpSymbol(oldPool.poolSymbol);
    const oldPoolSymbolReversed = oldPoolSymbol.split("-").reverse().join("-");
    const isReverseSymbol = newPoolSymbol == oldPoolSymbolReversed;
    if (isReverseSymbol) return true;

    const isSpecialMath = specialSymbolMatches.find(
        m => oldPoolSymbol == m.oldPoolSymbol && newPoolSymbol == m.newPoolSymbol,
    );
    return !!isSpecialMath;
};

task("info:booster:pools-tvl", "Gets the TVL for each pool added to the booster").setAction(async function (
    _: TaskArguments,
    hre: HardhatRuntime,
) {
    // Handy constant to include or not on the report  pools above `maxOldStashPid`, default value false.
    const showAllPools = false;
    const signer = await getSigner(hre);

    // Get pools to shutdown
    const phase6: Phase6Deployed = await config.getPhase6(signer);
    const poolLength = await phase6.booster.poolLength();
    const maxOldStashPid = 47;

    // Get all pools
    const pools = await Promise.all(
        Array(poolLength.toNumber())
            .fill(null)
            .map(async (_, i) => {
                const poolInfo = await phase6.booster.poolInfo(i);
                const crvRewards = new Contract(poolInfo.crvRewards, crvRewardsABI, signer);
                const totalSupply = await crvRewards.totalSupply();
                return {
                    lptoken: poolInfo.lptoken,
                    token: poolInfo.token,
                    gauge: poolInfo.gauge,
                    crvRewards: poolInfo.crvRewards,
                    stash: poolInfo.stash,
                    shutdown: poolInfo.shutdown,
                    // ---- additional information ------//
                    pid: i,
                    poolTotalSupply: totalSupply,
                    poolName: await crvRewards.name(),
                    poolSymbol: await crvRewards.symbol(),
                };
            }),
    );
    const poolsOldStash = pools.filter(p => p.pid <= maxOldStashPid);
    const poolsNewStash = pools.filter(p => p.pid > maxOldStashPid);

    // for each old pool, search if it has already being migrated.
    const poolsMapped = poolsOldStash.map(oldPool => {
        const newPool = poolsNewStash.find(newPool => poolBySymbolVariants(newPool, oldPool));
        const poolMapped = {
            pid: oldPool.pid,
            name: oldPool.poolName as string,
            symbol: cleanUpSymbol(oldPool.poolSymbol),
            isMigrated: !!newPool,
            oldPool,
            newPool,
        };
        return poolMapped;
    });

    // Concat all pools that are not matched with old pools but are deployed with new stash version
    const isPoolNotMigrated = newPool => !poolsMapped.find(pm => pm.isMigrated && pm.newPool.pid === newPool.pid);
    const poolsMappedNew = poolsNewStash.filter(isPoolNotMigrated).map(newPool => {
        const poolMapped = {
            pid: newPool.pid,
            name: newPool.poolName as string,
            symbol: cleanUpSymbol(newPool.poolSymbol),
            isMigrated: true,
            oldPool: undefined,
            newPool,
        };

        return poolMapped;
    });

    const allPoolsMapped = [].concat(poolsMapped.concat(showAllPools ? poolsMappedNew : []));

    const toConsoleData = pm => [
        pm.pid, // PID
        pm.symbol, // Name
        pm.isMigrated ? pm.newPool.pid : "N/A", // New Pid
        pm.oldPool ? truncateNumber(pm.oldPool.poolTotalSupply) : "N/A", // New Old Pool TVL
        pm.isMigrated ? truncateNumber(pm.newPool.poolTotalSupply) : "N/A", // New Pool TVL
        pm.isMigrated ? "\u001b[42;1m Yes \u001b[43;1m" : "\u001b[41m No \u001b[0m",
    ]; // Migrated

    const poolsMappedData = [
        ["PID", "Name", "New PID", "Old Pool TVL", "New Pool TVL", "Migrated"],
        ...allPoolsMapped.map(toConsoleData),
    ];

    const totalsTVL = allPoolsMapped
        .map(pm => ({
            oldTvl: pm.oldPool ? pm.oldPool.poolTotalSupply : 0,
            newTvl: pm.isMigrated ? pm.newPool.poolTotalSupply : 0,
            count: pm.isMigrated ? 1 : 0,
        }))
        .reduce(
            (prev, curr) => ({
                oldTvl: prev.oldTvl.add(curr.oldTvl),
                newTvl: prev.newTvl.add(curr.newTvl),
                count: prev.count + curr.count,
            }),
            {
                oldTvl: ethers.utils.parseEther("0"),
                newTvl: ethers.utils.parseEther("0"),
                count: 0,
            },
        );

    const totalsData = [
        ["Totals", "", "", ""],
        ["Old TVL (1-47)", "New TVL (48+)", "Percentage Completed", "Pools Migrated"],
        [
            truncateNumber(totalsTVL.oldTvl),
            truncateNumber(totalsTVL.newTvl),
            truncateNumber(
                totalsTVL.newTvl.mul(ethers.utils.parseEther("100")).div(totalsTVL.newTvl.add(totalsTVL.oldTvl)),
            ) + " %",
            totalsTVL.count + ` / ` + allPoolsMapped.length,
        ],
    ];

    console.log(table(poolsMappedData));
    console.log(table(totalsData));
});
