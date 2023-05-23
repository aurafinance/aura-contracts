import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import { getSigner } from "../../tasks/utils";
import { Phase6Deployed } from "scripts/deploySystem";
import { config } from "../deploy/mainnet-config";
import { BigNumber, Contract } from "ethers";
import { table } from "table";
import axios from "axios";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(relativeTime);

interface PoolMetadata {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    stash: string;
    shutdown: boolean;
    pid: number;
    poolTotalSupply: BigNumber;
    poolValue: BigNumber;
    poolName: string;
    poolSymbol: string;
    periodFinish: BigNumber;
    isKilled: boolean;
}

const crvRewardsABI = [
    "function totalSupply() external view returns(uint256)",
    "function name() external view returns(string memory)",
    "function symbol() external view returns(string memory)",
    "function periodFinish() external view returns (uint256)",
];
const gaugeABI = ["function is_killed() external view returns (bool)"];
const specialSymbolMatches = [
    { oldPoolSymbol: "wsteth-acx", newPoolSymbol: "50wsteth-50acx" },
    { oldPoolSymbol: "sfrxeth-steth-reth", newPoolSymbol: "wsteth-reth-sfrxeth" },
];

const fetchAuraAPRs = async () => {
    const url = "https://cache.aura.finance/aura/tvl-deprecated";
    const response = await axios.get(url);
    return response.data;
};

const cleanUpSymbol = (poolSymbol: string): string =>
    poolSymbol
        .slice(4)
        .toLowerCase()
        .replace("-bpt-vault", "")
        .replace("-vault", "")
        .replace("bb-a-usd", "bbausd")
        .replace("bb-euler-usd", "bbausd");

const truncateNumber = (amount: number, fixed = 2) => Number.parseFloat(Number(amount).toFixed(fixed)).toLocaleString();

/**
 * Compares two pools by it symbol with the following criteria:
 * - Symbol lower case are the same, ie: wsteth-acx == wsteth-acx returns true.
 * - Symbol is reversed,  ie: wsteth-acx == acx-wsteth returns true
 * - Symbol Matches special criteria defined on constant `specialSymbolMatches`
 *
 * @param {PoolMetadata} newPool
 * @param {PoolMetadata} oldPool
 * @return {boolean}
 */
const poolBySymbolVariants = (newPool: PoolMetadata, oldPool: PoolMetadata): boolean => {
    const ignorePIds = [2];
    if (ignorePIds.includes(oldPool.pid)) return false;

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

task("info:booster:pools-tvl", "Gets the TVL for each pool added to the booster")
    .addFlag("migrated", "Show only migrated pools")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntime) {
        // Handy constant to include or not on the report  pools above `maxOldStashPid`, default value false.
        const showAllPools = false;
        const showOnlyMigrated = tskArgs.migrated;
        const signer = await getSigner(hre);

        // Get pools to shutdown
        const phase6: Phase6Deployed = await config.getPhase6(signer);
        const poolLength = await phase6.booster.poolLength();
        const maxOldStashPid = 47;
        const result = await fetchAuraAPRs();
        const poolsTvlData = Object.keys(result.balancer.breakdown).map(lptoken => ({
            lptoken: lptoken,
            poolValue: result.balancer.breakdown[lptoken],
        }));
        const poolByLpToken = (poolTvlData, lptoken: string) =>
            poolTvlData.lptoken.toLowerCase() == lptoken.toLowerCase();

        // Get all pools
        const pools: Array<PoolMetadata> = await Promise.all(
            Array(poolLength.toNumber())
                .fill(null)
                .map(async (_, i) => {
                    const poolInfo = await phase6.booster.poolInfo(i);
                    const crvRewards = new Contract(poolInfo.crvRewards, crvRewardsABI, signer);
                    const gauge = new Contract(poolInfo.gauge, gaugeABI, signer);
                    const totalSupply = await crvRewards.totalSupply();
                    const poolTvlData = poolsTvlData.find(poolTvlData => poolByLpToken(poolTvlData, poolInfo.lptoken));

                    const poolValue = poolTvlData?.poolValue;
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
                        poolValue: poolValue ?? 0,
                        poolName: await crvRewards.name(),
                        poolSymbol: await crvRewards.symbol(),
                        periodFinish: await crvRewards.periodFinish(),
                        isKilled: await gauge.is_killed(),
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
                crvRewards: oldPool.crvRewards,
                name: oldPool.poolName as string,
                symbol: cleanUpSymbol(oldPool.poolSymbol),
                isMigrated: !!newPool,
                oldPool,
                newPool,
                periodFinish: oldPool.periodFinish,
                isKilled: oldPool.isKilled,
                shutdown: oldPool.shutdown,
            };
            return poolMapped;
        });

        // Concat all pools that are not matched with old pools but are deployed with new stash version
        const isPoolNotMigrated = (newPool: PoolMetadata) =>
            !poolsMapped.find(pm => pm.isMigrated && pm.newPool.pid === newPool.pid);
        const poolsMappedNew = poolsNewStash.filter(isPoolNotMigrated).map(newPool => {
            const poolMapped = {
                pid: newPool.pid,
                crvRewards: newPool.crvRewards,
                name: newPool.poolName as string,
                symbol: cleanUpSymbol(newPool.poolSymbol),
                isMigrated: true,
                oldPool: undefined,
                newPool,
                periodFinish: newPool.periodFinish,
                isKilled: newPool.isKilled,
                shutdown: newPool.shutdown,
            };

            return poolMapped;
        });

        let allPoolsMapped = [].concat(poolsMapped.concat(showAllPools ? poolsMappedNew : []));
        if (showOnlyMigrated) {
            allPoolsMapped = allPoolsMapped.filter(pool => pool.isMigrated);
        }

        const toConsoleData = pm => [
            pm.pid, // PID
            pm.symbol, // Name
            pm.isMigrated ? pm.newPool.pid : "N/A", // New Pid
            pm.oldPool ? truncateNumber(pm.oldPool.poolValue) : "N/A", // New Old Pool TVL
            pm.isMigrated ? truncateNumber(pm.newPool.poolValue) : "N/A", // New Pool TVL
            dayjs().to(dayjs(new Date(pm.periodFinish.mul(1000).toNumber()).toISOString())),
            pm.isKilled ? "\u001b[41m Killed \u001b[0m" : "",
            pm.shutdown ? "\u001b[41m Shutdown \u001b[0m" : "",
            pm.isMigrated ? "\u001b[42;1m Yes \u001b[43;1m" : "\u001b[41m No \u001b[0m",
        ]; // Migrated

        const poolsMappedData = [
            [
                "PID",
                "Name",
                "New PID",
                "Old Pool TVL",
                "New Pool TVL",
                "Reward Period Finish",
                "Status",
                "Shutdown",
                "Migrated",
            ],
            ...allPoolsMapped.map(toConsoleData),
        ];

        const totalsTVL = allPoolsMapped
            .map(pm => ({
                oldTvl: pm.oldPool ? pm.oldPool.poolValue : 0,
                newTvl: pm.isMigrated ? pm.newPool.poolValue : 0,
                count: pm.isMigrated ? 1 : 0,
            }))
            .reduce(
                (prev, curr) => ({
                    oldTvl: prev.oldTvl + curr.oldTvl,
                    newTvl: prev.newTvl + curr.newTvl,
                    count: prev.count + curr.count,
                }),
                {
                    oldTvl: 0,
                    newTvl: 0,
                    count: 0,
                },
            );

        const totalsData = [
            ["Totals", "", "", ""],
            ["Old TVL (1-47)", "New TVL (48+)", "Percentage Completed", "Pools Migrated"],
            [
                truncateNumber(totalsTVL.oldTvl),
                truncateNumber(totalsTVL.newTvl),
                truncateNumber((totalsTVL.newTvl * 100) / (totalsTVL.newTvl + totalsTVL.oldTvl)) + " %",
                totalsTVL.count + ` / ` + allPoolsMapped.length,
            ],
        ];

        console.log(table(poolsMappedData));
        console.log(table(totalsData));
    });
