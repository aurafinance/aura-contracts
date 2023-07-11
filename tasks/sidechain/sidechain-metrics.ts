/* eslint-disable no-await-in-loop */
import { JsonRpcProvider } from "@ethersproject/providers";
import assert from "assert";
import { BigNumber } from "ethers";
import { formatEther } from "ethers/lib/utils";
import { table } from "table";
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { ERC20__factory } from "../../types";

import { SidechainViewDeployed, CanonicalViewDeployed } from "../../scripts/deploySidechain";
import { canonicalChains, canonicalConfigs, lzChainIds, sidechainConfigs } from "../deploy/sidechain-constants";
import { chainIds, getSigner } from "../utils";
import { fullScale } from "../../test-utils/constants";
import chalk from "chalk";

async function getCanonicalMetrics(viewDeployment: CanonicalViewDeployed, sidechainIds: number[]) {
    const data = await viewDeployment.canonicalView.getCanonicalData(sidechainIds);

    const result = {
        l1CoordinatorData: {
            balBalance: data.l1coordinator.balBalance,
        },
        auraProxyOFTData: {
            epoch: data.auraProxyOft.epoch,
            inflowLimit: data.auraProxyOft.inflowLimit,
            outflow: data.auraProxyOft.outflow,
            inflow: data.auraProxyOft.inflow,
            circulatingSupply: data.auraProxyOft.circulatingSupply,
            paused: data.auraProxyOft.paused,
            auraProxyOFTAuraBalance: data.auraProxyOft.auraProxyOFTAuraBalance,
        },
        auraBalProxyOFTData: {
            epoch: data.aurabalProxyOft.epoch,
            inflowLimit: data.aurabalProxyOft.inflowLimit,
            outflow: data.aurabalProxyOft.outflow,
            inflow: data.aurabalProxyOft.inflow,
            circulatingSupply: data.aurabalProxyOft.circulatingSupply,
            paused: data.aurabalProxyOft.paused,
            totalClaimableAuraBal: data.aurabalProxyOft.totalClaimableAuraBal,
            totalClaimableAura: data.aurabalProxyOft.totalClaimableAura,
            internalTotalSupply: data.aurabalProxyOft.internalTotalSupply,
            auraBalance: data.aurabalProxyOft.auraBalance,
            auraBalBalance: data.aurabalProxyOft.auraBalBalance,
            auraBalVaultBalance: data.aurabalProxyOft.auraBalVaultBalance,
            auraBalVaultBalanceOfUnderlying: data.aurabalProxyOft.auraBalVaultBalanceOfUnderlying,
        },
        sidechains: {},
    };

    for (let i = 0; i < sidechainIds.length; i++) {
        const id = sidechainIds[i];
        // Per sidechain
        const l1CoordinatorSidechainData = await viewDeployment.canonicalView.getL1CoordSidechainData(id); //canonicalData.l1CoordinatorSidechainData//[0];
        const auraBalProxyOFTSidechainData = data.aurabalProxySidechainData[i];

        result.sidechains[id] = {
            l1CoordinatorSidechainData: {
                feeDebtOf: l1CoordinatorSidechainData.feeDebtOf,
                settledFeeDebtOf: l1CoordinatorSidechainData.settledFeeDebtOf,
                distributedFeeDebtOf: l1CoordinatorSidechainData.distributedFeeDebtOf,
                bridgeDelegate: l1CoordinatorSidechainData.bridgeDelegate,
                l2Coordinator: l1CoordinatorSidechainData.l2Coordinator,
                bridgeDelegateBalBalance: l1CoordinatorSidechainData.bridgeDelegateBalBalance,
            },
            auraBalProxyOFTSidechainData: {
                claimableAuraBal: auraBalProxyOFTSidechainData.claimableAuraBal,
                claimableAura: auraBalProxyOFTSidechainData.claimableAura,
            },
        };
    }

    return result;
}

async function getSidechainMetrics(sidechainViewDeployed: SidechainViewDeployed): Promise<any> {
    const data = await sidechainViewDeployed.sidechainView.getData();

    return {
        sidechainId: data.sidechainId,
        canonicalId: data.canonicalChainId,
        l2CoordinatorData: {
            address: data.l2CoordData._address,
            mintRate: data.l2CoordData.mintRate,
            accBalRewards: data.l2CoordData.accBalRewards,
            accAuraRewards: data.l2CoordData.accAuraRewards,
            auraBalance: data.l2CoordData.auraBalance,
            lzEndpoint: data.l2CoordData.lzEndpoint,
            trustedRemote: data.l2CoordData.trustedRemote,
        },
        auraOFTData: {
            address: data.auraOftData._address,
            circulatingSupply: data.auraOftData.circulatingSupply,
            totalSupply: data.auraOftData.totalSupply,
            paused: data.auraOftData.paused,
            bridgeDelegateAuraBalance: data.auraOftData.bridgeDelegateAuraBalance,
            lzEndpoint: data.auraOftData.lzEndpoint,
            trustedRemote: data.auraOftData.trustedRemote,
        },
        auraBalOFTData: {
            address: data.auraBalOftData._address,
            circulatingSupply: data.auraBalOftData.circulatingSupply,
            totalSupply: data.auraBalOftData.totalSupply,
            paused: data.auraBalOftData.paused,
            auraBalStrategyAuraBalOFTBalance: data.auraBalOftData.auraBalStrategyAuraBalOFTBalance,
            lzEndpoint: data.auraBalOftData.lzEndpoint,
            trustedRemote: data.auraBalOftData.trustedRemote,
        },
        deployer: {
            auraOftBalance: data.auraBalanceOf,
            auraBalOftBalance: data.auraBalBalanceOf,
        },
    };
}

task("sidechain:metrics").setAction(async function (_: TaskArguments, hre: HardhatRuntimeEnvironment) {
    /* ---------------------------------------------------------------
     * Setup 
    --------------------------------------------------------------- */

    const deployer = await getSigner(hre);

    const canonicalConfig = canonicalConfigs[hre.network.config.chainId];
    const canonicalLzChainId = lzChainIds[hre.network.config.chainId];
    assert(canonicalConfig, `Local config for chain ID ${hre.network.config.chainId} not found`);
    assert(canonicalLzChainId, "Local LZ chain ID not found");
    assert(canonicalChains.includes(hre.network.config.chainId), "Not canonical chain");

    /* ---------------------------------------------------------------
     * Data 
    --------------------------------------------------------------- */

    const arbConfig = sidechainConfigs[chainIds.arbitrum];
    const arbLzChainId = lzChainIds[chainIds.arbitrum];

    const optConfig = sidechainConfigs[chainIds.optimism];
    const optLzChainId = lzChainIds[chainIds.optimism];

    console.log("Fetching canonical data...");
    const canonicalView = canonicalConfig.getCanonicalView(deployer);
    const canonicalMetrics = await getCanonicalMetrics(canonicalView, [arbLzChainId, optLzChainId]);

    // Arbitrum
    const arbNodeUrl = process.env.ARB_NODE_URL;
    assert(arbNodeUrl?.length > 0, "ARB_NODE_URL not set");

    const arbJsonProvider = new JsonRpcProvider(arbNodeUrl);
    console.log("Waiting for arb provider...");
    await arbJsonProvider.ready;
    console.log("Arb Provider ready!");

    console.log("Fetching arb data...");
    const arbDeployer = deployer.connect(arbJsonProvider);
    const arbView: SidechainViewDeployed = arbConfig.getView(arbDeployer) as any;
    const arbMetrics = await getSidechainMetrics(arbView);

    // Optimism
    const optNodeUrl = process.env.OPT_NODE_URL;
    assert(optNodeUrl?.length > 0, "OPT_NODE_URL not set");

    const optJsonProvider = new JsonRpcProvider(optNodeUrl);
    console.log("Waiting for opt provider...");
    await optJsonProvider.ready;
    console.log("Opt Provider ready!");

    console.log("Fetching opt data...");
    const optDeployer = deployer.connect(optJsonProvider);
    const optView: SidechainViewDeployed = optConfig.getView(optDeployer) as any;
    const optMetrics = await getSidechainMetrics(optView);

    /* ---------------------------------------------------------------
     * Helpers 
    --------------------------------------------------------------- */

    const formatBool = (b: boolean, str?: string) => {
        return (b ? chalk.bgGreen.black : chalk.bgRed.white)(` ${str || (b ? "YES" : "NO")} `);
    };

    const formatPaused = (paused: boolean) => {
        return (paused ? chalk.bgRed.white : chalk.bgGreen.black)(` ${paused ? "PAUSED" : "NOT PAUSED"} `);
    };

    const arbitrumText = (s: string) => chalk.bgBlue.white("[ARB] " + s);
    const optimismText = (s: string) => chalk.bgMagenta.black("[OPT] " + s);

    /* ---------------------------------------------------------------
     * Aura OFT 
    --------------------------------------------------------------- */

    {
        const auraProxyOftAuraBalance = canonicalMetrics.auraProxyOFTData.auraProxyOFTAuraBalance;
        const auraIsFunded = arbMetrics.auraOFTData.totalSupply
            .add(optMetrics.auraOFTData.totalSupply)
            .eq(auraProxyOftAuraBalance);
        const outflow = canonicalMetrics.auraProxyOFTData.outflow;
        const inflow = canonicalMetrics.auraProxyOFTData.inflow;
        const inflowLimit = canonicalMetrics.auraProxyOFTData.inflowLimit;
        const netInflow = outflow.sub(inflow);
        const netInflowBelowLimit = netInflow.lte(inflowLimit);

        const rows = [
            ["Aura OFTs are funded", formatBool(auraIsFunded)],
            ["AuraProxyOFT AURA balance", formatEther(auraProxyOftAuraBalance)],
            [arbitrumText("AuraOFT total supply"), formatEther(arbMetrics.auraOFTData.totalSupply)],
            [optimismText("AuraOFT total supply"), formatEther(optMetrics.auraOFTData.totalSupply)],
            ["AuraProxyOFT net inflow", formatBool(netInflowBelowLimit, formatEther(netInflow))],
            ["AuraProxyOFT inflow", formatEther(inflow)],
            ["AuraProxyOFT outflow", formatEther(outflow)],
            ["AuraProxyOFT inflow limit", formatEther(inflowLimit)],
            ["AuraProxyOFT paused", formatPaused(canonicalMetrics.auraProxyOFTData.paused)],
            [arbitrumText("AuraOFT paused"), formatPaused(arbMetrics.auraOFTData.paused)],
            [optimismText("AuraOFT paused"), formatPaused(optMetrics.auraOFTData.paused)],
        ];

        console.log(table([[chalk.bold("AURA OFT"), ""], ...rows]));
    }

    /* ---------------------------------------------------------------
     * AuraBal OFT
    --------------------------------------------------------------- */

    {
        const auraBalProxyOftAuraBalBalance = canonicalMetrics.auraBalProxyOFTData.auraBalVaultBalanceOfUnderlying;
        const auraBalIsFunded = arbMetrics.auraBalOFTData.totalSupply.lte(auraBalProxyOftAuraBalBalance);
        const auraBalShortfall = arbMetrics.auraBalOFTData.totalSupply.sub(auraBalProxyOftAuraBalBalance);
        const outflow = canonicalMetrics.auraBalProxyOFTData.outflow;
        const inflow = canonicalMetrics.auraBalProxyOFTData.inflow;
        const inflowLimit = canonicalMetrics.auraBalProxyOFTData.inflowLimit;
        const netInflow = outflow.sub(inflow);
        const netInflowBelowLimit = netInflow.lte(inflowLimit);
        const internalTotalSupply = canonicalMetrics.auraBalProxyOFTData.internalTotalSupply;
        const claimableAura = canonicalMetrics.auraBalProxyOFTData.totalClaimableAura;
        const claimableAuraBal = auraBalProxyOftAuraBalBalance.sub(internalTotalSupply);

        const rows = [
            ["AuraBal OFTs are funded", formatBool(auraBalIsFunded)],
            ["AuraBal OFTs shortfall", formatEther(auraBalShortfall)],
            ["AuraBalProxyOFT auraBAL balance", formatEther(auraBalProxyOftAuraBalBalance)],
            ["AuraBalProxyOFT internal total supply", formatEther(internalTotalSupply)],
            [arbitrumText("AuraBalOFT total supply"), formatEther(arbMetrics.auraBalOFTData.totalSupply)],
            [
                arbitrumText("Claimable auraBAL"),
                formatBool(claimableAuraBal.lt(fullScale), formatEther(claimableAuraBal)),
            ],
            [arbitrumText("Claimable AURA"), formatBool(claimableAura.lt(fullScale), formatEther(claimableAura))],
            ["AuraBalProxyOFT net inflow", formatBool(netInflowBelowLimit, formatEther(netInflow))],
            ["AuraBalProxyOFT inflow", formatEther(inflow)],
            ["AuraBalProxyOFT outflow", formatEther(outflow)],
            ["AuraBalProxyOFT inflow limit", formatEther(inflowLimit)],
            ["AuraBalProxyOFT paused", formatPaused(canonicalMetrics.auraBalProxyOFTData.paused)],
            [arbitrumText("AuraBalOFT paused"), formatPaused(arbMetrics.auraBalOFTData.paused)],
        ];

        console.log(table([[chalk.bold("auraBAL OFT"), ""], ...rows]));
    }

    /* ---------------------------------------------------------------
     * Fee Debts 
    --------------------------------------------------------------- */

    {
        const sidechain = canonicalMetrics.sidechains[arbLzChainId];

        const feeDebt = sidechain.l1CoordinatorSidechainData.feeDebtOf;
        const settledFeeDebt = sidechain.l1CoordinatorSidechainData.settledFeeDebtOf;
        const distributedFeeDebt = sidechain.l1CoordinatorSidechainData.distributedFeeDebtOf;

        const rows = [
            [arbitrumText("Fee debt"), formatEther(feeDebt)],
            [arbitrumText("Settled fee debt"), formatBool(settledFeeDebt.lte(feeDebt), formatEther(settledFeeDebt))],
            [
                arbitrumText("Distributed fee debt"),
                formatBool(distributedFeeDebt.lte(feeDebt), formatEther(distributedFeeDebt)),
            ],
        ];

        console.log(table([[chalk.bold("Fee Debts"), ""], ...rows]));
    }

    {
        const sidechain = canonicalMetrics.sidechains[optLzChainId];

        const feeDebt = sidechain.l1CoordinatorSidechainData.feeDebtOf;
        const settledFeeDebt = sidechain.l1CoordinatorSidechainData.settledFeeDebtOf;
        const distributedFeeDebt = sidechain.l1CoordinatorSidechainData.distributedFeeDebtOf;

        const rows = [
            [optimismText("Fee debt"), formatEther(feeDebt)],
            [optimismText("Settled fee debt"), formatBool(settledFeeDebt.lte(feeDebt), formatEther(settledFeeDebt))],
            [
                optimismText("Distributed fee debt"),
                formatBool(distributedFeeDebt.lte(feeDebt), formatEther(distributedFeeDebt)),
            ],
        ];

        console.log(table([[chalk.bold("Fee Debts"), ""], ...rows]));
    }

    /* ---------------------------------------------------------------
     * Mint Rate 
    --------------------------------------------------------------- */

    {
        console.log("Fetching arb mint rate data...");

        // check funding.
        const arb = arbConfig.getSidechain(arbDeployer);
        const poolLength = await arb.booster.poolLength();
        const balOnSidechain = ERC20__factory.connect(arbConfig.extConfig.token, arbDeployer);

        let totalBal = BigNumber.from(0);
        for (let i = 0; i < Number(poolLength); i++) {
            const pool = await arb.booster.poolInfo(i);
            const balance = await balOnSidechain.balanceOf(pool.crvRewards);
            totalBal = totalBal.add(balance);
        }
        const mintRate = arbMetrics.l2CoordinatorData.mintRate;
        const totalPendingAura = totalBal.mul(mintRate).div(fullScale);
        const enoughAura = arbMetrics.l2CoordinatorData.auraBalance.gt(totalPendingAura);
        const shortfall = enoughAura ? 0 : totalPendingAura.sub(arbMetrics.l2CoordinatorData.auraBalance);

        const rows = [
            [arbitrumText("Mint rate"), formatEther(mintRate)],
            [arbitrumText("l2 coordinator has enough aura rewards"), formatBool(enoughAura)],
            [arbitrumText("shortfall"), formatBool(enoughAura, formatEther(shortfall))],
            [arbitrumText("pending bal rewards is"), formatEther(totalBal)],
            [arbitrumText("pending aura rewards is"), formatEther(totalPendingAura)],
            [arbitrumText("Acc BAL rewards"), formatEther(arbMetrics.l2CoordinatorData.accBalRewards)],
            [arbitrumText("Acc AURA rewards"), formatEther(arbMetrics.l2CoordinatorData.accAuraRewards)],
        ];

        console.log(table([[chalk.bold("Mint rate"), ""], ...rows]));
    }

    {
        console.log("Fetching opt mint rate data...");

        // check funding.
        const opt = optConfig.getSidechain(optDeployer);
        const poolLength = await opt.booster.poolLength();
        const balOnSidechain = ERC20__factory.connect(optConfig.extConfig.token, optDeployer);

        let totalBal = BigNumber.from(0);
        for (let i = 0; i < Number(poolLength); i++) {
            const pool = await opt.booster.poolInfo(i);
            const balance = await balOnSidechain.balanceOf(pool.crvRewards);
            totalBal = totalBal.add(balance);
        }
        const mintRate = optMetrics.l2CoordinatorData.mintRate;
        const totalPendingAura = totalBal.mul(mintRate).div(fullScale);
        const enoughAura = optMetrics.l2CoordinatorData.auraBalance.gt(totalPendingAura);
        const shortfall = enoughAura ? 0 : totalPendingAura.sub(optMetrics.l2CoordinatorData.auraBalance);

        const rows = [
            [optimismText("Mint rate"), formatEther(mintRate)],
            [optimismText("l2 coordinator has enough aura rewards"), formatBool(enoughAura)],
            [optimismText("shortfall"), formatBool(enoughAura, formatEther(shortfall))],
            [optimismText("pending bal rewards is"), formatEther(totalBal)],
            [optimismText("pending aura rewards is"), formatEther(totalPendingAura)],
            [optimismText("Acc BAL rewards"), formatEther(optMetrics.l2CoordinatorData.accBalRewards)],
            [optimismText("Acc AURA rewards"), formatEther(optMetrics.l2CoordinatorData.accAuraRewards)],
        ];

        console.log(table([[chalk.bold("Mint rate"), ""], ...rows]));
    }
});
