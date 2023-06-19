/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-await-in-loop */
import { JsonRpcProvider } from "@ethersproject/providers";
import { BN } from "../../test-utils/math";
import assert from "assert";
import { BigNumber, BigNumberish, ethers, Signer } from "ethers";
import { formatEther } from "ethers/lib/utils";
import { table } from "table";
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { ERC20__factory } from "../../types";

import {
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
    SidechainViewDeployed,
    CanonicalViewDeployed,
} from "../../scripts/deploySidechain";
import { canonicalChains, canonicalConfigs, lzChainIds, sidechainConfigs } from "../deploy/sidechain-constants";
import { getSigner } from "../utils";
import { fullScale } from "../../test-utils/constants";
import { isBigNumberish } from "@ethersproject/bignumber/lib/bignumber";
import chalk from "chalk";

/*
 * * * * * * * * * * * * * * * * * * * * * *
 *  Canonical Metrics
 * * * * * * * * * * * * * * * * * * * * * *
 */

async function getL1CoordinatorSidechainData(
    l1Coordinator: ethers.Contract,
    bal: ethers.Contract,
    sidechainId: number,
) {
    const feeDebtOf: BN = await l1Coordinator.feeDebtOf(sidechainId);
    const settledFeeDebtOf: BN = await l1Coordinator.settledFeeDebtOf(sidechainId);
    const distributedFeeDebtOf: BN = await l1Coordinator.distributedFeeDebtOf(sidechainId);
    const bridgeDelegate: string = await l1Coordinator.bridgeDelegates(sidechainId);
    const l2Coordinator: string = await l1Coordinator.l2Coordinators(sidechainId);
    const bridgeDelegateBalBalance: BN = await bal.balanceOf(bridgeDelegate);
    return {
        feeDebtOf,
        settledFeeDebtOf,
        distributedFeeDebtOf,
        bridgeDelegate,
        l2Coordinator,
        bridgeDelegateBalBalance,
    };
}
async function getL1CoordinatorData(l1Coordinator: ethers.Contract, bal: ethers.Contract) {
    const balBalance = await bal.balanceOf(l1Coordinator.address);
    return { balBalance };
}

async function getProxyOFTData(proxyOFT: ethers.Contract) {
    const epoch: BN = await proxyOFT.getCurrentEpoch();
    const circulatingSupply = await proxyOFT.circulatingSupply();
    const inflowLimit = await proxyOFT.inflowLimit();
    const outflow = await proxyOFT.outflow(epoch);
    const inflow = await proxyOFT.inflow(epoch);
    const paused = await proxyOFT.paused();

    return { epoch, inflowLimit, outflow, inflow, circulatingSupply, paused };
}
async function getAuraBalProxyOFTData(
    auraBalProxyOFT: ethers.Contract,
    aura: ethers.Contract,
    auraBal: ethers.Contract,
    auraBalVault: ethers.Contract,
) {
    const totalClaimableAuraBal = await auraBalProxyOFT.totalClaimable(auraBal.address);
    const totalClaimableAura = await auraBalProxyOFT.totalClaimable(aura.address);
    const internalTotalSupply = await auraBalProxyOFT.internalTotalSupply();
    const proxyOFTData = await getProxyOFTData(auraBalProxyOFT);

    const auraBalBalance = await auraBal.balanceOf(auraBalProxyOFT.address);
    const auraBalance = await aura.balanceOf(auraBalProxyOFT.address);
    const auraBalVaultBalance = await auraBalVault.balanceOf(auraBalProxyOFT.address);
    const auraBalVaultBalanceOfUnderlying = await auraBalVault.balanceOfUnderlying(auraBalProxyOFT.address);

    return {
        ...proxyOFTData,
        totalClaimableAuraBal,
        totalClaimableAura,
        internalTotalSupply,
        auraBalance,
        auraBalBalance,
        auraBalVaultBalance,
        auraBalVaultBalanceOfUnderlying,
    };
}
async function getAuraBalProxyOFTSidechainData(
    auraBalProxyOFT: ethers.Contract,
    aura: ethers.Contract,
    auraBal: ethers.Contract,
    sidechainId: number,
) {
    const claimableAuraBal = await auraBalProxyOFT.claimable(auraBal.address, sidechainId);
    const claimableAura = await auraBalProxyOFT.claimable(aura.address, sidechainId);

    return {
        claimableAuraBal,
        claimableAura,
    };
}
async function getAuraProxyOFTData(auraProxyOFT: ethers.Contract, aura: ethers.Contract) {
    const proxyOFTData = await getProxyOFTData(auraProxyOFT);
    const auraProxyOFTAuraBalance = await aura.balanceOf(auraProxyOFT.address);

    return {
        ...proxyOFTData,
        auraProxyOFTAuraBalance,
    };
}

async function getCanonicalData(canonicalView: ethers.Contract, sidechainId: number) {
    const canonicalData = await canonicalView.getCanonicalData([sidechainId]);
    return { ...canonicalData };
}

async function getCanonicalMetrics(
    signer: Signer,
    canonicalView: CanonicalViewDeployed,
    sidechainId: number,
): Promise<any> {
    let canonicalData = await getCanonicalData(canonicalView.canonicalView, sidechainId);

    // Per sidechain
    const sidechainsData = [];
    const l1CoordinatorSidechainData = await canonicalView.canonicalView.getL1CoordSidechainData(sidechainId); //canonicalData.l1CoordinatorSidechainData//[0];
    const auraBalProxyOFTSidechainData = canonicalData.aurabalProxySidechainData[0];

    sidechainsData.push({
        sidechainId,
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
    });

    return {
        l1CoordinatorData: {
            balBalance: canonicalData.l1coordinator.balBalance,
        },
        auraProxyOFTData: {
            epoch: canonicalData.auraProxyOft.epoch.toNumber(),
            inflowLimit: canonicalData.auraProxyOft.inflowLimit,
            outflow: canonicalData.auraProxyOft.outflow,
            inflow: canonicalData.auraProxyOft.inflow,
            circulatingSupply: canonicalData.auraProxyOft.circulatingSupply,
            paused: canonicalData.auraProxyOft.paused,
            auraProxyOFTAuraBalance: canonicalData.auraProxyOft.auraProxyOFTAuraBalance,
        },
        auraBalProxyOFTData: {
            epoch: canonicalData.aurabalProxyOft.epoch.toNumber(),
            inflowLimit: canonicalData.aurabalProxyOft.inflowLimit,
            outflow: canonicalData.aurabalProxyOft.outflow,
            inflow: canonicalData.aurabalProxyOft.inflow,
            circulatingSupply: canonicalData.aurabalProxyOft.circulatingSupply,
            paused: canonicalData.aurabalProxyOft.paused,
            totalClaimableAuraBal: canonicalData.aurabalProxyOft.totalClaimableAuraBal,
            totalClaimableAura: canonicalData.aurabalProxyOft.totalClaimableAura,
            internalTotalSupply: canonicalData.aurabalProxyOft.internalTotalSupply,
            auraBalance: canonicalData.aurabalProxyOft.auraBalance,
            auraBalBalance: canonicalData.aurabalProxyOft.auraBalBalance,
            auraBalVaultBalance: canonicalData.aurabalProxyOft.auraBalVaultBalance,
            auraBalVaultBalanceOfUnderlying: canonicalData.aurabalProxyOft.auraBalVaultBalanceOfUnderlying,
        },
        ...sidechainsData,
    };
}

/*
 * * * * * * * * * * * * * * * * * * * * * *
 *  Sidechain Metrics
 * * * * * * * * * * * * * * * * * * * * * *
 */

async function getSidechainData(sidechainView: ethers.Contract, address: string) {
    const sidechainData = await sidechainView.getDataAndBalances(address);
    return { ...sidechainData };
}

async function getSidechainMetrics(
    signer: Signer,
    sidechainViewDeployed: SidechainViewDeployed,
    sidechainId: string,
): Promise<any> {
    const sidechainData = await getSidechainData(sidechainViewDeployed.sidechainView, await signer.getAddress());

    return {
        sidechainId: sidechainData.sidechainId,
        canonicalId: sidechainData.canonicalChainId,
        l2CoordinatorData: {
            address: sidechainData.l2CoordData._address,
            mintRate: sidechainData.l2CoordData.mintRate,
            accBalRewards: sidechainData.l2CoordData.accBalRewards,
            accAuraRewards: sidechainData.l2CoordData.accAuraRewards,
            auraBalance: sidechainData.l2CoordData.auraBalance,
            lzEndpoint: sidechainData.l2CoordData.lzEndpoint,
            trustedRemote: sidechainData.l2CoordData.trustedRemote,
        },
        auraOFTData: {
            address: sidechainData.auraOftData._address,
            circulatingSupply: sidechainData.auraOftData.circulatingSupply,
            totalSupply: sidechainData.auraOftData.totalSupply,
            paused: sidechainData.auraOftData.paused,
            bridgeDelegateAuraBalance: sidechainData.auraOftData.bridgeDelegateAuraBalance,
            lzEndpoint: sidechainData.auraOftData.lzEndpoint,
            trustedRemote: sidechainData.auraOftData.trustedRemote,
        },
        auraBalOFTData: {
            address: sidechainData.auraBalOftData._address,
            circulatingSupply: sidechainData.auraBalOftData.circulatingSupply,
            totalSupply: sidechainData.auraBalOftData.totalSupply,
            paused: sidechainData.auraBalOftData.paused,
            auraBalStrategyAuraBalOFTBalance: sidechainData.auraBalOftData.auraBalStrategyAuraBalOFTBalance,
            lzEndpoint: sidechainData.auraBalOftData.lzEndpoint,
            trustedRemote: sidechainData.auraBalOftData.trustedRemote,
        },
        deployer: {
            auraOftBalance: sidechainData.auraBalanceOf,
            auraBalOftBalance: sidechainData.auraBalBalanceOf,
        },
    };
}

task("sidechain:metrics")
    .addParam("sidechainid", "Remote standard chain ID (can not be eth mainnet)")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const remoteNodeUrl = process.env.REMOTE_NODE_URL;
        assert(remoteNodeUrl?.length > 0, "REMOTE_NODE_URL not set");

        const deployer = await getSigner(hre);
        const deployerAddress = await deployer.getAddress();
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

        const log = (
            logLabel: string,
            rows: ([string, BigNumberish | boolean, (x: BigNumberish) => string] | [string, BigNumberish | boolean])[],
        ) => {
            console.log(
                table(
                    rows.map(([label, value, formatter]) => {
                        return [
                            label,
                            formatter && isBigNumberish(value)
                                ? formatter(value)
                                : typeof value === "boolean"
                                ? value
                                    ? chalk.bgGreen.black(" YES ")
                                    : chalk.bgRed.white(" NO ")
                                : value,
                        ];
                    }),
                    {
                        header: {
                            alignment: "center",
                            content: logLabel,
                        },
                    },
                ),
            );
        };

        /* ---------------------------------------------------------------
         * Config 
        --------------------------------------------------------------- */

        log("Config", [
            ["Deployer", deployerAddress],
            ["Local chain ID", hre.network.config.chainId],
            ["Remote chain ID", remoteChainId],
            ["Remote node URL", remoteNodeUrl],
        ]);

        /* ---------------------------------------------------------------
         * Local 
        --------------------------------------------------------------- */

        const local: CanonicalPhase1Deployed & CanonicalPhase2Deployed = canonicalConfig.getSidechain(deployer) as any;
        const phase2 = await canonicalConfig.getPhase2(deployer);
        const canonicalView = canonicalConfig.getCanonicalView(deployer);

        const canonicalMetrics = await getCanonicalMetrics(deployer, canonicalView, sidechainLzChainId);

        log(
            "Canonical chain",
            // prettier-ignore
            [
                ["AuraOFT address",                           local.auraProxyOFT.address],
                ["AuraBalOFT address",                        local.auraBalProxyOFT.address],
                ["AURA balance of AuraOFT",                   await phase2.cvx.balanceOf(local.auraProxyOFT.address), formatEther],
                [`Trusted remote (${sidechainLzChainId})`,    await local.auraProxyOFT.trustedRemoteLookup(sidechainLzChainId)],
                ["Endpoint",                                  await local.auraProxyOFT.lzEndpoint()],
            ],
        );

        /* ---------------------------------------------------------------
         * Local Metrics 
        --------------------------------------------------------------- */

        const canonicalCoordinatorInformation = canonicalMetrics[0];
        log(
            "Local Metrics",
            // prettier-ignore
            [
              ["Sidechain ID",                                      canonicalCoordinatorInformation.sidechainId],
              ["L1Coordinator BAL Balance",                         canonicalMetrics.l1CoordinatorData.balBalance, formatEther],
              ["L1Coordinator feeDebtOf",                           canonicalCoordinatorInformation.l1CoordinatorSidechainData.feeDebtOf, formatEther],
              ["L1Coordinator settledFeeDebtOf",                    canonicalCoordinatorInformation.l1CoordinatorSidechainData.settledFeeDebtOf, formatEther],
              ["L1Coordinator settledFeeDebtOf",                    canonicalCoordinatorInformation.l1CoordinatorSidechainData.settledFeeDebtOf, formatEther],
              ["L1Coordinator distributedFeeDebtOf",                canonicalCoordinatorInformation.l1CoordinatorSidechainData.distributedFeeDebtOf, formatEther],
              ["L1Coordinator bridgeDelegate",                      canonicalCoordinatorInformation.l1CoordinatorSidechainData.bridgeDelegate],
              ["L1Coordinator l2Coordinator",                       canonicalCoordinatorInformation.l1CoordinatorSidechainData.l2Coordinator],
              ["L1Coordinator bridgeDelegateBalBalance",            canonicalCoordinatorInformation.l1CoordinatorSidechainData.bridgeDelegateBalBalance, formatEther],
              ["auraProxyOFT Epoch",                                canonicalMetrics.auraProxyOFTData.epoch],
              ["auraProxyOFT inflowLimit",                          canonicalMetrics.auraProxyOFTData.inflowLimit, formatEther],
              ["auraProxyOFT outflow",                              canonicalMetrics.auraProxyOFTData.outflow, formatEther],
              ["auraProxyOFT inflow",                               canonicalMetrics.auraProxyOFTData.inflow, formatEther],
              ["auraProxyOFT circulatingSupply",                    canonicalMetrics.auraProxyOFTData.circulatingSupply, formatEther],
              ["auraProxyOFT paused",                               canonicalMetrics.auraProxyOFTData.paused],
              ["auraProxyOFT auraProxyOFTAuraBalance",              canonicalMetrics.auraProxyOFTData.auraProxyOFTAuraBalance, formatEther],
              ["auraBalProxyOFT epoch",                             canonicalMetrics.auraBalProxyOFTData.epoch],
              ["auraBalProxyOFT inflowLimit",                       canonicalMetrics.auraBalProxyOFTData.inflowLimit, formatEther],
              ["auraBalProxyOFT outflow",                           canonicalMetrics.auraBalProxyOFTData.outflow, formatEther],
              ["auraBalProxyOFT inflow",                            canonicalMetrics.auraBalProxyOFTData.inflow, formatEther],
              ["auraBalProxyOFT circulatingSupply",                 canonicalMetrics.auraBalProxyOFTData.circulatingSupply, formatEther],
              ["auraBalProxyOFT paused",                            canonicalMetrics.auraBalProxyOFTData.paused],
              ["auraBalProxyOFT totalClaimableAuraBal",             canonicalMetrics.auraBalProxyOFTData.totalClaimableAuraBal, formatEther],
              ["auraBalProxyOFT totalClaimableAura",                canonicalMetrics.auraBalProxyOFTData.totalClaimableAura, formatEther],
              ["auraBalProxyOFT internalTotalSupply",               canonicalMetrics.auraBalProxyOFTData.internalTotalSupply, formatEther],
              ["auraBalProxyOFT auraBalance",                       canonicalMetrics.auraBalProxyOFTData.auraBalance, formatEther],
              ["auraBalProxyOFT auraBalBalance",                    canonicalMetrics.auraBalProxyOFTData.auraBalBalance, formatEther],
              ["auraBalProxyOFT auraBalVaultBalance",               canonicalMetrics.auraBalProxyOFTData.auraBalVaultBalance, formatEther],
              ["auraBalProxyOFT auraBalVaultBalanceOfUnderlying",   canonicalMetrics.auraBalProxyOFTData.auraBalVaultBalanceOfUnderlying, formatEther],
              ["auraBalProxyOFT claimableAuraBal",                  canonicalCoordinatorInformation.auraBalProxyOFTSidechainData.claimableAuraBal, formatEther],
              ["auraBalProxyOFT claimableAura",                     canonicalCoordinatorInformation.auraBalProxyOFTSidechainData.claimableAura, formatEther],
          ],
        );

        /* ---------------------------------------------------------------
         * Remote 
        --------------------------------------------------------------- */

        const jsonProvider = new JsonRpcProvider(remoteNodeUrl);
        console.log("Waiting for provider...");
        await jsonProvider.ready;
        console.log("Provider ready!");

        const remoteDeployer = deployer.connect(jsonProvider);
        const remoteView: SidechainViewDeployed = sidechainConfig.getView(remoteDeployer) as any;
        const remoteMetrics = await getSidechainMetrics(deployer, remoteView, remoteChainId);

        /* ---------------------------------------------------------------
         * Remote Metrics 
        --------------------------------------------------------------- */
        log(
            "Remote Metrics",
            // prettier-ignore
            [
                ["Sidechain ID",                                      remoteMetrics.sidechainId],
                ["L2CoordinatorData address",                         remoteMetrics.l2CoordinatorData.address],
                ["L2CoordinatorData mintRate",                        remoteMetrics.l2CoordinatorData.mintRate, formatEther],
                ["L2CoordinatorData accBalRewards",                   remoteMetrics.l2CoordinatorData.accBalRewards, formatEther],
                ["L2CoordinatorData accAuraRewards",                  remoteMetrics.l2CoordinatorData.accAuraRewards, formatEther],
                ["L2CoordinatorData auraBalance",                     remoteMetrics.l2CoordinatorData.auraBalance, formatEther],
                ["auraOFT address",                                   remoteMetrics.auraOFTData.address],
                ["auraOFT circulatingSupply",                         remoteMetrics.auraOFTData.circulatingSupply, formatEther],
                ["auraOFT totalSupply",                               remoteMetrics.auraOFTData.totalSupply, formatEther],
                ["auraOFT paused",                                    remoteMetrics.auraOFTData.paused],
                ["auraOFT bridgeDelegateAuraBalance",                 remoteMetrics.auraOFTData.bridgeDelegateAuraBalance, formatEther],
                ["auraBalOFT address",                                remoteMetrics.auraBalOFTData.address],
                ["auraBalOFT circulatingSupply",                      remoteMetrics.auraBalOFTData.circulatingSupply, formatEther],
                ["auraBalOFT totalSupply",                            remoteMetrics.auraBalOFTData.totalSupply, formatEther],
                ["auraBalOFT paused",                                 remoteMetrics.auraBalOFTData.paused],
                ["auraBalOFT auraBalStrategyAuraBalOFTBalance",       remoteMetrics.auraBalOFTData.auraBalStrategyAuraBalOFTBalance, formatEther],
                ["Endpoint l2Coordinator",                            remoteMetrics.l2CoordinatorData.lzEndpoint],
                ["Endpoint AuraOFT",                                  remoteMetrics.auraOFTData.lzEndpoint],
                ["Endpoint AuraBalOFT",                               remoteMetrics.auraBalOFTData.lzEndpoint],
                ["AuraOFT balance",                                   remoteMetrics.deployer.auraOftBalance, formatEther],
                ["AuraBalOFT balance",                                remoteMetrics.deployer.auraBalOftBalance, formatEther],
            ],
        );

        /* ---------------------------------------------------------------
         * SAFETY CHECKS
        --------------------------------------------------------------- */

        const checksResults: (
            | [string, BigNumberish | boolean, (x: BigNumberish) => string]
            | [string, BigNumberish | boolean]
        )[] = [];

        const auraIsFunded = remoteMetrics.auraOFTData.totalSupply.eq(
            canonicalMetrics.auraProxyOFTData.auraProxyOFTAuraBalance,
        );
        const auraInflow = canonicalMetrics.auraProxyOFTData.outflow
            .sub(canonicalMetrics.auraProxyOFTData.inflow)
            .lte(canonicalMetrics.auraProxyOFTData.inflowLimit);
        const auraBalInflow = canonicalMetrics.auraBalProxyOFTData.outflow
            .sub(canonicalMetrics.auraBalProxyOFTData.inflow)
            .lte(canonicalMetrics.auraBalProxyOFTData.inflowLimit);

        checksResults.push(["auraOFT is funded", auraIsFunded]);
        checksResults.push(["auraInflow is within limit", auraInflow]);
        checksResults.push(["auraBalInflow is within limit", auraBalInflow]);

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
        const totalPendingAura = totalBal.mul(remoteMetrics.l2CoordinatorData.mintRate).div(fullScale);
        const enoughAura = remoteMetrics.l2CoordinatorData.auraBalance.gt(totalPendingAura);

        checksResults.push(["pending bal rewards is", totalBal, formatEther]);
        checksResults.push(["pending aura rewards is", totalPendingAura, formatEther]);
        checksResults.push(["l2 coordinator has enough aura rewards", enoughAura]);

        if (!enoughAura) {
            const shortFall = totalPendingAura.sub(remoteMetrics.l2CoordinatorData.auraBalance);
            checksResults.push(["l2 coordinator aura shortfall", shortFall, formatEther]);
        }

        log("Checks", checksResults);
    });
