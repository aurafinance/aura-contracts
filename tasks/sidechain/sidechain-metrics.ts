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
import { getSigner } from "../utils";
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

task("sidechain:metrics")
    .addParam("sidechainid", "Remote standard chain ID (can not be eth mainnet)")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        /* ---------------------------------------------------------------
         * Setup 
        --------------------------------------------------------------- */

        const remoteNodeUrl = process.env.REMOTE_NODE_URL;
        assert(remoteNodeUrl?.length > 0, "REMOTE_NODE_URL not set");

        const deployer = await getSigner(hre);
        const remoteChainId = tskArgs.sidechainid;

        const canonicalConfig = canonicalConfigs[hre.network.config.chainId];
        const canonicalLzChainId = lzChainIds[hre.network.config.chainId];
        assert(canonicalConfig, `Local config for chain ID ${hre.network.config.chainId} not found`);
        assert(canonicalLzChainId, "Local LZ chain ID not found");
        assert(canonicalChains.includes(hre.network.config.chainId), "Not canonical chain");

        const sidechainConfig = sidechainConfigs[remoteChainId];
        assert(sidechainConfig, `Remote config for chain ID ${remoteChainId} not found`);

        const sidechainLzChainId = lzChainIds[remoteChainId];
        assert(sidechainLzChainId, "Remote LZ chain ID not found");

        /* ---------------------------------------------------------------
         * Data 
        --------------------------------------------------------------- */

        console.log("Fetching canonical data...");
        const canonicalView = canonicalConfig.getCanonicalView(deployer);
        const canonicalMetrics = await getCanonicalMetrics(canonicalView, [sidechainLzChainId]);

        const jsonProvider = new JsonRpcProvider(remoteNodeUrl);
        console.log("Waiting for provider...");
        await jsonProvider.ready;
        console.log("Provider ready!");

        console.log("Fetching sidechain data...");
        const remoteDeployer = deployer.connect(jsonProvider);
        const remoteView: SidechainViewDeployed = sidechainConfig.getView(remoteDeployer) as any;
        const remoteMetrics = await getSidechainMetrics(remoteView);

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

        /* ---------------------------------------------------------------
         * Aura OFT 
        --------------------------------------------------------------- */

        {
            const auraProxyOftAuraBalance = canonicalMetrics.auraProxyOFTData.auraProxyOFTAuraBalance;
            const auraIsFunded = remoteMetrics.auraOFTData.totalSupply.eq(auraProxyOftAuraBalance);
            const outflow = canonicalMetrics.auraProxyOFTData.outflow;
            const inflow = canonicalMetrics.auraProxyOFTData.inflow;
            const inflowLimit = canonicalMetrics.auraProxyOFTData.inflowLimit;
            const netInflow = outflow.sub(inflow);
            const netInflowBelowLimit = netInflow.lte(inflowLimit);

            const rows = [
                ["Aura OFTs are funded", formatBool(auraIsFunded)],
                ["AuraProxyOFT AURA balance", formatEther(auraProxyOftAuraBalance)],
                [arbitrumText("AuraOFT total supply"), formatEther(remoteMetrics.auraOFTData.totalSupply)],
                ["AuraProxyOFT net inflow", formatBool(netInflowBelowLimit, formatEther(netInflow))],
                ["AuraProxyOFT inflow", formatEther(inflow)],
                ["AuraProxyOFT outflow", formatEther(outflow)],
                ["AuraProxyOFT inflow limit", formatEther(inflowLimit)],
                ["AuraProxyOFT paused", formatPaused(canonicalMetrics.auraProxyOFTData.paused)],
                [arbitrumText("AuraOFT paused"), formatPaused(remoteMetrics.auraOFTData.paused)],
            ];

            console.log(table([[chalk.bold("AURA OFT"), ""], ...rows]));
        }

        /* ---------------------------------------------------------------
         * AuraBal OFT
        --------------------------------------------------------------- */

        {
            const auraBalProxyOftAuraBalBalance = canonicalMetrics.auraBalProxyOFTData.auraBalVaultBalanceOfUnderlying;
            const auraBalIsFunded = remoteMetrics.auraBalOFTData.totalSupply.lte(auraBalProxyOftAuraBalBalance);
            const outflow = canonicalMetrics.auraBalProxyOFTData.outflow;
            const inflow = canonicalMetrics.auraBalProxyOFTData.inflow;
            const inflowLimit = canonicalMetrics.auraBalProxyOFTData.inflowLimit;
            const netInflow = outflow.sub(inflow);
            const netInflowBelowLimit = netInflow.lte(inflowLimit);
            const internalTotalSupply = canonicalMetrics.auraBalProxyOFTData.internalTotalSupply;
            const claimableAura = canonicalMetrics.auraBalProxyOFTData.totalClaimableAura;
            const claimableAuraBal = auraBalProxyOftAuraBalBalance.sub(internalTotalSupply);

            const rows = [
                ["AuraBal OFTs are funded", auraBalIsFunded],
                ["AuraBalProxyOFT auraBAL balance", formatEther(auraBalProxyOftAuraBalBalance)],
                ["AuraBalProxyOFT internal total supply", formatEther(internalTotalSupply)],
                [arbitrumText("AuraBalOFT total supply"), formatEther(remoteMetrics.auraBalOFTData.totalSupply)],
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
                [arbitrumText("AuraBalOFT paused"), formatPaused(remoteMetrics.auraBalOFTData.paused)],
            ];

            console.log(table([[chalk.bold("auraBAL OFT"), ""], ...rows]));
        }

        /* ---------------------------------------------------------------
         * Fee Debts 
        --------------------------------------------------------------- */

        {
            const sidechain = canonicalMetrics.sidechains[sidechainLzChainId];

            const feeDebt = sidechain.l1CoordinatorSidechainData.feeDebtOf;
            const settledFeeDebt = sidechain.l1CoordinatorSidechainData.settledFeeDebtOf;
            const distributedFeeDebt = sidechain.l1CoordinatorSidechainData.distributedFeeDebtOf;

            const rows = [
                [arbitrumText("Fee debt"), formatEther(feeDebt)],
                [
                    arbitrumText("Settled fee debt"),
                    formatBool(settledFeeDebt.lte(feeDebt), formatEther(settledFeeDebt)),
                ],
                [
                    arbitrumText("Distributed fee debt"),
                    formatBool(distributedFeeDebt.lte(feeDebt), formatEther(distributedFeeDebt)),
                ],
            ];

            console.log(table([[chalk.bold("Fee Debts"), ""], ...rows]));
        }

        /* ---------------------------------------------------------------
         * Mint Rate 
        --------------------------------------------------------------- */

        {
            console.log("Fetching mint rate data...");

            // check funding.
            const sidechain = sidechainConfig.getSidechain(remoteDeployer);
            const poolLength = await sidechain.booster.poolLength();
            const balOnSidechain = ERC20__factory.connect(sidechainConfig.extConfig.token, remoteDeployer);

            let totalBal = BigNumber.from(0);
            for (let i = 0; i < Number(poolLength); i++) {
                const pool = await sidechain.booster.poolInfo(i);
                const balance = await balOnSidechain.balanceOf(pool.crvRewards);
                totalBal = totalBal.add(balance);
            }
            const mintRate = remoteMetrics.l2CoordinatorData.mintRate;
            const totalPendingAura = totalBal.mul(mintRate).div(fullScale);
            const enoughAura = remoteMetrics.l2CoordinatorData.auraBalance.gt(totalPendingAura);
            const shortfall = enoughAura ? 0 : totalPendingAura.sub(remoteMetrics.l2CoordinatorData.auraBalance);

            const rows = [
                [arbitrumText("Mint rate"), formatEther(mintRate)],
                ["l2 coordinator has enough aura rewards", formatBool(enoughAura)],
                ["shortfall", formatBool(enoughAura, formatEther(shortfall))],
                ["pending bal rewards is", formatEther(totalBal)],
                ["pending aura rewards is", formatEther(totalPendingAura)],
                ["Acc BAL rewards", formatEther(remoteMetrics.l2CoordinatorData.accBalRewards)],
                ["Acc AURA rewards", formatEther(remoteMetrics.l2CoordinatorData.accAuraRewards)],
            ];

            console.log(table([[chalk.bold("Mint rate"), ""], ...rows]));
        }
    });
