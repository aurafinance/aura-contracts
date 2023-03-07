import * as fs from "fs";
import * as path from "path";
import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { HardhatRuntime } from "../utils/networkAddressFactory";
import { getSigner } from "../../tasks/utils";
import { Phase6Deployed } from "scripts/deploySystem";
import { config } from "../deploy/mainnet-config";
import { Contract, ethers } from "ethers";

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
            name: oldPool.poolName as string,
            symbol: oldPool.poolSymbol as string,
            isMigrated: false,
            migratedPc: 0,
            oldPool,
            newPool,
        };
        // If it is migrated, mark it and calculate the TVLs
        if (newPool) {
            poolMapped.isMigrated = true;
            poolMapped.migratedPc = newPool.poolTotalSupply
                .mul(100)
                .div(oldPool.poolTotalSupply.add(newPool.poolTotalSupply))
                .toNumber();

            console.log(` PoolMigrated  ${poolMapped.symbol} Old Pid:${oldPool.pid}, New Pid:${newPool.pid}, 
    Migrated Pc:${poolMapped.migratedPc},    Old TVL: ${ethers.utils.formatEther(
                oldPool.poolTotalSupply,
            )}    New TVL: ${ethers.utils.formatEther(newPool.poolTotalSupply)}`);
            newPool.poolTotalSupply = newPool.poolTotalSupply.toString();
        }
        oldPool.poolTotalSupply = oldPool.poolTotalSupply.toString();
        return poolMapped;
    });

    // Concat all pools that are not matched with old pools but are deployed with new stash version
    const poolsMappedNew = poolsNewStash
        .filter(newPool =>
            poolsMapped.find(poolMapped => poolMapped.isMigrated && poolMapped.newPool.pid !== newPool.pid),
        )
        .map(newPool => {
            newPool.poolTotalSupply = newPool.poolTotalSupply.toString();
            const poolMapped = {
                name: newPool.poolName as string,
                symbol: newPool.poolSymbol as string,
                isMigrated: true,
                migratedPc: 100,
                oldPool: undefined,
                newPool,
            };

            return poolMapped;
        });

    console.log("Total amount of pools after PID 47", poolsMappedNew.length);
    fs.writeFileSync(path.resolve(__dirname, "./pools_mapped.json"), JSON.stringify(poolsMapped));
});
