import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

import { canonicalConfigs, sidechainConfigs } from "../deploy/sidechain-constants";
import { Multicall3__factory } from "../../types";
import { Call3Struct } from "../../types/generated/Multicall3";
import { chainIds } from "../utils/networkAddressFactory";
import { getSigner } from "../utils/signerFactory";
import { waitForTx } from "../utils/deploy-utils";

const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
const txDebug = true;

async function getAuraBalAddress(chainId: number, signer: ethers.Signer): Promise<string | undefined> {
    if (chainId === chainIds.mainnet) {
        const canonicalConfig = canonicalConfigs[chainIds.mainnet];
        if (!canonicalConfig) return undefined;
        const phase2 = await canonicalConfig.getPhase2(signer);
        return phase2.cvxCrv.address;
    }
    const sidechainConfig = sidechainConfigs[chainId];
    if (!sidechainConfig) return undefined;
    const sidechain = sidechainConfig.getSidechain(signer);
    const addr = sidechain.auraBalOFT.address;
    return addr === ZERO_ADDRESS ? undefined : addr;
}
async function getAuraAddress(chainId: number, signer: ethers.Signer): Promise<string | undefined> {
    if (chainId === chainIds.mainnet) {
        const canonicalConfig = canonicalConfigs[chainIds.mainnet];
        if (!canonicalConfig) return undefined;
        const phase2 = await canonicalConfig.getPhase2(signer);
        return phase2.cvx.address;
    }

    const sidechainConfig = sidechainConfigs[chainId];
    if (!sidechainConfig) return undefined;
    const sidechain = sidechainConfig.getSidechain(signer);
    const addr = sidechain.auraOFT.address;
    return addr === ZERO_ADDRESS ? undefined : addr;
}
async function getVaultAuraRewardAddress(chainId: number, signer: ethers.Signer): Promise<string | undefined> {
    if (chainId === chainIds.mainnet) {
        const canonicalConfig = canonicalConfigs[chainIds.mainnet];
        if (!canonicalConfig) return undefined;
        const phase = await canonicalConfig.getAuraBalVault(signer);
        return phase.auraRewards.address;
    }
    const sidechainConfig = sidechainConfigs[chainId];
    if (!sidechainConfig) return undefined;
    const sidechain = sidechainConfig.getSidechain(signer);
    const addr = sidechain.auraBalVaultAuraRewards.address;
    return addr === ZERO_ADDRESS ? undefined : addr;
}
type Category = "lock" | "pools" | "vaults";
type PrefaceCategory = "AuraLock" | "Pools" | "Vaults";

type SupportedChain = {
    chainId: number;
    name: string;
};

type RewardToken = {
    address: string;
    symbol?: string;
    decimals: number;
};

type Reward = {
    token: RewardToken;
    earned: string;
};

type LockSnapshotUser = {
    lockerAddress: string;
    locked: string;
    unlockable: string;
    nextUnlockAt: number;
    locks: Array<{ amount: string; unlockTime: number }>;
    rewards: Reward[];
};

type LockSnapshot = Record<string, LockSnapshotUser>;

type PoolsSnapshot = Record<
    string,
    Array<{
        poolId: string;
        poolName: string;
        poolAddress: string;
        staked: string;
        rewards: Reward[];
    }>
>;

type VaultsSnapshot = Record<
    string,
    {
        vaultAddress: string;
        balance: string;
        rewards: Reward[];
    }
>;

type LockerCallDescriptor = {
    user: string;
    lockerAddress: string;
    rewards: Reward[];
    callData: string;
};

type VaultCallDescriptor = {
    user: string;
    vaultAddress: string;
    rewards: Reward[];
    callData: string;
};

type PoolCallDescriptor = {
    user: string;
    poolId: string;
    poolName: string;
    poolAddress: string;
    rewards: Reward[];
    callData: string;
};

const SUPPORTED_CHAINS: SupportedChain[] = [
    { name: "base", chainId: chainIds.base },
    { name: "avalanche", chainId: chainIds.avalanche },
    { name: "optimism", chainId: chainIds.optimism },
    { name: "mainnet", chainId: chainIds.mainnet },
    { name: "arbitrum", chainId: chainIds.arbitrum },
    { name: "polygon", chainId: chainIds.polygon },
    { name: "gnosis", chainId: chainIds.gnosis },
    { name: "fraxtal", chainId: chainIds.fraxtal },
];

const CATEGORY_LABELS: Record<Category, PrefaceCategory> = {
    lock: "AuraLock",
    pools: "Pools",
    vaults: "Vaults",
};

function toCategory(categoryArg: string): Category | "all" {
    const lowered = categoryArg.toLowerCase();
    if (lowered === "all") return "all";
    if (lowered === "lock" || lowered === "pools" || lowered === "vaults") {
        return lowered;
    }
    throw new Error(`Invalid category: ${categoryArg}. Use one of: lock, pools, vaults, all`);
}

function toChainScope(chainIdArg: string): number | "all" {
    const lowered = chainIdArg.toLowerCase();
    if (lowered === "all") return "all";

    const parsed = Number(chainIdArg);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid chainid: ${chainIdArg}. Use one of supported chain IDs or 'all'.`);
    }
    return parsed;
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

function getSnapshotPath(category: Category, chainId: number): string {
    return path.resolve(__dirname, `./withdrawSnapshots/${category}-${chainId}.json`);
}

function readSnapshotIfExists<T>(category: Category, chainId: number): T | null {
    const filePath = getSnapshotPath(category, chainId);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function getRewardSymbol(token: RewardToken, auraBalAddress?: string): string {
    if (token.symbol && token.symbol.trim().length > 0) return token.symbol;
    if (auraBalAddress && token.address.toLowerCase() === auraBalAddress.toLowerCase()) return "auraBal";
    return token.address;
}

function formatRewardAmount(earned: string, decimals: number): string {
    try {
        return ethers.utils.formatUnits(earned, decimals);
    } catch {
        return earned;
    }
}

function aggregateRewardTotals<T extends { rewards: Reward[] }>(
    calls: T[],
    auraBalAddress?: string,
): Map<string, { symbol: string; decimals: number; total: ethers.BigNumber }> {
    const rewardTotals = new Map<string, { symbol: string; decimals: number; total: ethers.BigNumber }>();

    for (const call of calls) {
        for (const reward of call.rewards) {
            const key = reward.token.address.toLowerCase();
            const symbol = getRewardSymbol(reward.token, auraBalAddress);
            const existing = rewardTotals.get(key);
            const amount = ethers.BigNumber.from(reward.earned);
            if (existing) {
                existing.total = existing.total.add(amount);
            } else {
                rewardTotals.set(key, { symbol, decimals: reward.token.decimals, total: amount });
            }
        }
    }

    return rewardTotals;
}

async function executeBatchedMulticalls<T>(
    multicall3: ethers.Contract,
    callBatches: T[][],
    getTargetAndData: (call: T) => { target: string; callData: string },
    waitForBlocks: number,
): Promise<{ txHashes: string[]; totalGasUsed: ethers.BigNumber }> {
    const txHashes: string[] = [];
    let totalGasUsed = ethers.BigNumber.from(0);

    for (const [index, batch] of callBatches.entries()) {
        console.log(`  submitting batch ${index + 1}/${callBatches.length} (${batch.length} calls)...`);
        const aggregateCalls: Call3Struct[] = batch.map(call => {
            const { target, callData } = getTargetAndData(call);
            return {
                target,
                allowFailure: true,
                callData,
            };
        });
        const tx = await multicall3.aggregate3(aggregateCalls);
        const receipt = await waitForTx(tx, txDebug, waitForBlocks);
        txHashes.push(receipt.transactionHash);
        totalGasUsed = totalGasUsed.add(receipt.gasUsed);
        console.log(
            `  batch ${index + 1}/${callBatches.length} confirmed in block ${receipt.blockNumber}, tx: ${
                receipt.transactionHash
            }, gasUsed: ${receipt.gasUsed.toString()}`,
        );
    }

    return { txHashes, totalGasUsed };
}

function logRewardSummary(
    chain: SupportedChain,
    totalUsers: number,
    claimableUsers: number,
    totalGasUsed: ethers.BigNumber,
    rewardTotals: Map<string, { symbol: string; decimals: number; total: ethers.BigNumber }>,
    extraLines: string[] = [],
): void {
    console.log(`\n  --- ${chain.name} (${chain.chainId}) summary ---`);
    console.log(`  total users in snapshot : ${totalUsers}`);
    console.log(`  claimable users         : ${claimableUsers}`);
    for (const line of extraLines) {
        console.log(line);
    }
    console.log(`  total gas used          : ${totalGasUsed.toString()}`);
    console.log(`  claimed rewards:`);
    for (const [address, { symbol, decimals, total }] of rewardTotals.entries()) {
        console.log(
            `    ${symbol} (${address}): ${formatRewardAmount(total.toString(), decimals)} (${total.toString()} raw)`,
        );
    }
}

function parseLockCalls(lockSnapshot: LockSnapshot): LockerCallDescriptor[] {
    const calls: LockerCallDescriptor[] = [];

    for (const [user, lockData] of Object.entries(lockSnapshot)) {
        const claimableRewards = (lockData.rewards || []).filter(reward => {
            try {
                // Mainnet: 1 AURA min threshold
                return ethers.BigNumber.from(reward.earned).gte("1000000000000000000");
                // return ethers.BigNumber.from(reward.earned).gte("1");
            } catch {
                return false;
            }
        });

        if (claimableRewards.length === 0) continue;
        if (txDebug) {
            console.log(
                `User ${user} has ${claimableRewards.length} claimable rewards, total earned: ${lockData.rewards
                    .map(r => `${formatRewardAmount(r.earned, r.token.decimals)} ${getRewardSymbol(r.token)}`)
                    .join(", ")}`,
            );
        }
        calls.push({
            user,
            lockerAddress: lockData.lockerAddress,
            rewards: claimableRewards,
            callData: new ethers.utils.Interface(["function getReward(address,bool)"]).encodeFunctionData("getReward", [
                user,
                false,
            ]),
        });
    }

    return calls;
}

function parseVaultCalls(vaultsSnapshot: VaultsSnapshot, auraAddress: string, chainId: number): VaultCallDescriptor[] {
    const vaultIface = new ethers.utils.Interface(["function getReward(address)"]);
    const calls: VaultCallDescriptor[] = [];

    for (const [user, vaultData] of Object.entries(vaultsSnapshot)) {
        if (user.toLowerCase() === DEAD_ADDRESS) {
            console.log(`  skipping dead address user ${user}`);
            continue;
        }

        const claimableRewards = (vaultData.rewards || []).filter(reward => {
            try {
                if (chainId === chainIds.mainnet) {
                    return ethers.BigNumber.from(reward.earned).gte("1000000000000000000");
                } else {
                    return ethers.BigNumber.from(reward.earned).gt(0);
                }
            } catch {
                return false;
            }
        });

        if (claimableRewards.length === 0) continue;

        for (const reward of claimableRewards) {
            if (auraAddress && reward.token.address.toLowerCase() !== auraAddress.toLowerCase()) {
                console.warn(
                    `  [WARN] user ${user} vault ${vaultData.vaultAddress}: unexpected reward token ${reward.token.address} (expected AURA ${auraAddress})`,
                );
            }
            const symbol = getRewardSymbol(reward.token);
            const formattedAmount = formatRewardAmount(reward.earned, reward.token.decimals);
            if (txDebug) {
                console.log(
                    `  User ${user} has ${formattedAmount} (${reward.earned}) of token ${reward.token.address} (${symbol})`,
                );
            }
        }

        calls.push({
            user,
            vaultAddress: vaultData.vaultAddress,
            rewards: claimableRewards,
            callData: vaultIface.encodeFunctionData("getReward", [user]),
        });
    }

    return calls;
}

function parsePoolCalls(poolsSnapshot: PoolsSnapshot, chainId: number): PoolCallDescriptor[] {
    const poolIface = new ethers.utils.Interface(["function getReward(address,bool)"]);
    const calls: PoolCallDescriptor[] = [];

    for (const [user, pools] of Object.entries(poolsSnapshot)) {
        if (user.toLowerCase() === DEAD_ADDRESS) {
            console.log(`  skipping dead address user ${user}`);
            continue;
        }

        for (const pool of pools || []) {
            const claimableRewards = (pool.rewards || []).filter(reward => {
                try {
                    // Avoid dust claims on some chains by requiring a minimum threshold of 1 AURA, but on other chains where rewards are typically smaller, allow any non-zero amount
                    if (chainId === chainIds.arbitrum || chainId === chainIds.polygon || chainId === chainIds.mainnet) {
                        return ethers.BigNumber.from(reward.earned).gte("1000000000000000000");
                    } else {
                        return ethers.BigNumber.from(reward.earned).gt(0);
                    }
                } catch {
                    return false;
                }
            });

            if (claimableRewards.length === 0) continue;

            for (const reward of claimableRewards) {
                const symbol = getRewardSymbol(reward.token);
                const formattedAmount = formatRewardAmount(reward.earned, reward.token.decimals);
                if (txDebug) {
                    console.log(
                        `  User ${user} pool ${pool.poolAddress} has ${formattedAmount} (${reward.earned}) of token ${reward.token.address} (${symbol})`,
                    );
                }
            }

            calls.push({
                user,
                poolId: pool.poolId,
                poolName: pool.poolName,
                poolAddress: pool.poolAddress,
                rewards: claimableRewards,
                callData: poolIface.encodeFunctionData("getReward", [user, true]),
            });
        }
    }

    return calls;
}

// # yarn task:fork winddown:claimrewards --wait 0 --category lock  --chainid 1 --batchsize 30
// # yarn task:fork winddown:claimrewards --wait 0 --category vaults --chainid 1 --batchsize 30
// # yarn task:fork winddown:claimrewards --wait 0 --category pools --chainid 1 --batchsize 10

task("winddown:claimrewards", "Builds category preface data from withdraw snapshots")
    .addOptionalParam("category", "Category to process: lock, pools, vaults, all", "all")
    .addOptionalParam("chainid", "Chain ID to process, or all", "all")
    .addOptionalParam("batchsize", "Max calls per multicall batch", 50, types.int)
    .addParam("wait", "How many blocks to wait for transaction confirmation", 1, types.int)
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const categoryScope = toCategory(String(tskArgs.category));
        const chainScope = toChainScope(String(tskArgs.chainid));
        const batchSize = Number(tskArgs.batchsize);
        const waitForBlocks = Number(tskArgs.wait);

        const feeEnvSummary = {
            MAX_FEE_PER_GAS: process.env.MAX_FEE_PER_GAS?.trim() || "unset",
            GAS_PRICE: process.env.GAS_PRICE?.trim() || "unset",
            MAX_PRIORITY_FEE_PER_GAS: process.env.MAX_PRIORITY_FEE_PER_GAS?.trim() || "unset",
            MAX_FEE_PER_GAS_CAP_GWEI: process.env.MAX_FEE_PER_GAS_CAP_GWEI?.trim() || "unset",
            MAX_PRIORITY_FEE_PER_GAS_CAP_GWEI: process.env.MAX_PRIORITY_FEE_PER_GAS_CAP_GWEI?.trim() || "unset",
            GAS_PRICE_CAP_GWEI: process.env.GAS_PRICE_CAP_GWEI?.trim() || "unset",
        };
        console.log("Fee env overrides/caps:", feeEnvSummary);

        if (!Number.isInteger(batchSize) || batchSize <= 0) {
            throw new Error(`Invalid batchsize: ${tskArgs.batchsize}. Must be a positive integer.`);
        }

        const categories: Category[] =
            categoryScope === "all" ? ["lock", "pools", "vaults"] : [categoryScope as Category];

        const selectedChains = SUPPORTED_CHAINS.filter(chain => chainScope === "all" || chain.chainId === chainScope);
        if (selectedChains.length === 0) {
            throw new Error(`No supported chains matched chainid=${tskArgs.chainid}`);
        }

        console.log(
            `Preface configuration: categories=${categories.join(",")}, chains=${selectedChains
                .map(chain => `${chain.name}:${chain.chainId}`)
                .join(",")}, batchSize=${batchSize}`,
        );
        const signer = await getSigner(hre);
        for (const category of categories) {
            console.log(`\nCategory ${CATEGORY_LABELS[category]} (${category})`);

            for (const chain of selectedChains) {
                const snapshotFilePath = getSnapshotPath(category, chain.chainId);
                if (!fs.existsSync(snapshotFilePath)) {
                    console.log(
                        `- ${chain.name} (${chain.chainId}): snapshot not found at ${snapshotFilePath}, skipping`,
                    );
                    continue;
                }

                if (category === "lock") {
                    const lockSnapshot = readSnapshotIfExists<LockSnapshot>(category, chain.chainId);
                    if (!lockSnapshot) {
                        console.log(`- ${chain.name} (${chain.chainId}): unable to read lock snapshot, skipping`);
                        continue;
                    }

                    const auraBalAddress = await getAuraBalAddress(chain.chainId, signer);

                    const lockCalls = parseLockCalls(lockSnapshot);
                    const callBatches = chunk(lockCalls, batchSize);

                    console.log(
                        `- ${chain.name} (${chain.chainId}): users=${
                            Object.keys(lockSnapshot).length
                        }, claimableUsers=${lockCalls.length}, multicallBatches=${callBatches.length}`,
                    );

                    for (const lockCall of lockCalls) {
                        for (const reward of lockCall.rewards) {
                            const symbol = getRewardSymbol(reward.token, auraBalAddress);
                            const formattedAmount = formatRewardAmount(reward.earned, reward.token.decimals);
                            console.log(
                                `  User ${lockCall.user} has ${formattedAmount} (${reward.earned}) of token ${reward.token.address} (${symbol})`,
                            );
                        }
                    }

                    if (lockCalls.length === 0) {
                        console.log(`  no claimable rewards, skipping`);
                        continue;
                    }

                    const multicall3 = Multicall3__factory.connect(MULTICALL3_ADDRESS, signer);
                    const { txHashes, totalGasUsed } = await executeBatchedMulticalls(
                        multicall3,
                        callBatches,
                        call => ({ target: call.lockerAddress, callData: call.callData }),
                        waitForBlocks,
                    );
                    console.log(
                        `  executed ${txHashes.length} multicalls with total gas used: ${totalGasUsed.toString()}`,
                    );
                    console.log(`  individual tx hashes: ${txHashes.join(", ")}`);
                    const rewardTotals = aggregateRewardTotals(lockCalls, auraBalAddress);
                    logRewardSummary(
                        chain,
                        Object.keys(lockSnapshot).length,
                        lockCalls.length,
                        totalGasUsed,
                        rewardTotals,
                    );

                    continue;
                }

                if (category === "vaults") {
                    const vaultsSnapshot = readSnapshotIfExists<VaultsSnapshot>(category, chain.chainId);
                    if (!vaultsSnapshot) {
                        console.log(`- ${chain.name} (${chain.chainId}): unable to read vaults snapshot, skipping`);
                        continue;
                    }

                    const auraAddress = await getAuraAddress(chain.chainId, signer);
                    const vaultAuraRewardAddress = await getVaultAuraRewardAddress(chain.chainId, signer);
                    const vaultCalls = parseVaultCalls(vaultsSnapshot, auraAddress, chain.chainId);
                    const callBatches = chunk(vaultCalls, batchSize);

                    console.log(
                        `- ${chain.name} (${chain.chainId}): users=${
                            Object.keys(vaultsSnapshot).length
                        }, claimableUsers=${vaultCalls.length}, multicallBatches=${callBatches.length}`,
                    );

                    if (vaultCalls.length === 0) {
                        console.log(`  no claimable rewards, skipping`);
                        continue;
                    }

                    const multicall3 = Multicall3__factory.connect(MULTICALL3_ADDRESS, signer);
                    const { txHashes, totalGasUsed } = await executeBatchedMulticalls(
                        multicall3,
                        callBatches,
                        call => ({ target: vaultAuraRewardAddress, callData: call.callData }),
                        waitForBlocks,
                    );
                    console.log(
                        `  executed ${txHashes.length} multicalls with total gas used: ${totalGasUsed.toString()}`,
                    );
                    console.log(`  individual tx hashes: ${txHashes.join(", ")}`);

                    const rewardTotals = aggregateRewardTotals(vaultCalls);
                    logRewardSummary(
                        chain,
                        Object.keys(vaultsSnapshot).length,
                        vaultCalls.length,
                        totalGasUsed,
                        rewardTotals,
                    );

                    continue;
                }

                if (category === "pools") {
                    const poolsSnapshot = readSnapshotIfExists<PoolsSnapshot>(category, chain.chainId);
                    if (!poolsSnapshot) {
                        console.log(`- ${chain.name} (${chain.chainId}): unable to read pools snapshot, skipping`);
                        continue;
                    }

                    const poolCalls = parsePoolCalls(poolsSnapshot, chain.chainId);
                    const callBatches = chunk(poolCalls, batchSize);

                    const claimableUsers = new Set(poolCalls.map(call => call.user.toLowerCase()));
                    console.log(
                        `- ${chain.name} (${chain.chainId}): users=${
                            Object.keys(poolsSnapshot).length
                        }, claimableUsers=${claimableUsers.size}, claimablePools=${
                            poolCalls.length
                        }, multicallBatches=${callBatches.length}`,
                    );

                    if (poolCalls.length === 0) {
                        console.log(`  no claimable rewards, skipping`);
                        continue;
                    }

                    const multicall3 = Multicall3__factory.connect(MULTICALL3_ADDRESS, signer);
                    const { txHashes, totalGasUsed } = await executeBatchedMulticalls(
                        multicall3,
                        callBatches,
                        call => ({ target: call.poolAddress, callData: call.callData }),
                        waitForBlocks,
                    );

                    console.log(
                        `  executed ${txHashes.length} multicalls with total gas used: ${totalGasUsed.toString()}`,
                    );
                    console.log(`  individual tx hashes: ${txHashes.join(", ")}`);

                    const rewardTotals = aggregateRewardTotals(poolCalls);
                    logRewardSummary(
                        chain,
                        Object.keys(poolsSnapshot).length,
                        claimableUsers.size,
                        totalGasUsed,
                        rewardTotals,
                        [`  claimable pools         : ${poolCalls.length}`],
                    );

                    continue;
                }

                throw new Error(
                    `Category '${category}' is not yet implemented. Supported categories: lock, pools, vaults.`,
                );
            }
        }
    });
