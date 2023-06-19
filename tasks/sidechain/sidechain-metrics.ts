/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-await-in-loop */
import { JsonRpcProvider } from "@ethersproject/providers";
import { BN } from "../../test-utils/math";
import assert from "assert";
import { ethers, Signer } from "ethers";
import { formatEther } from "ethers/lib/utils";
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { AuraBalVaultDeployed } from "tasks/deploy/mainnet-config";
import { ERC20__factory } from "../../types";

import {
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
    SidechainViewDeployed,
    CanonicalViewDeployed,
} from "../../scripts/deploySidechain";
import { ExtSystemConfig, Phase2Deployed } from "../../scripts/deploySystem";
import { canonicalChains, canonicalConfigs, lzChainIds, sidechainConfigs } from "../deploy/sidechain-constants";
import { getSigner } from "../utils";

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
    const canonicalData = await getCanonicalData(canonicalView.canonicalView, sidechainId);

    // Per sidechain
    const sidechainsData = [];
    console.log(canonicalData);
    const l1CoordinatorSidechainData = canonicalData.l1CoordinatorSidechainData[0];
    const auraBalProxyOFTSidechainData = canonicalData.aurabalProxySidechainData[0];

    sidechainsData.push({
        sidechainId,
        l1CoordinatorSidechainData: {
            feeDebtOf: formatEther(l1CoordinatorSidechainData.feeDebtOf),
            settledFeeDebtOf: formatEther(l1CoordinatorSidechainData.settledFeeDebtOf),
            distributedFeeDebtOf: formatEther(l1CoordinatorSidechainData.distributedFeeDebtOf),
            bridgeDelegate: l1CoordinatorSidechainData.bridgeDelegate,
            l2Coordinator: l1CoordinatorSidechainData.l2Coordinator,
            bridgeDelegateBalBalance: formatEther(l1CoordinatorSidechainData.bridgeDelegateBalBalance),
        },
        auraBalProxyOFTSidechainData: {
            claimableAuraBal: formatEther(auraBalProxyOFTSidechainData.claimableAuraBal),
            claimableAura: formatEther(auraBalProxyOFTSidechainData.claimableAura),
        },
    });

    return {
        l1CoordinatorData: {
            balBalance: formatEther(canonicalData.l1coordinator.balBalance),
        },
        auraProxyOFTData: {
            epoch: canonicalData.auraProxyOft.epoch.toNumber(),
            inflowLimit: formatEther(canonicalData.auraProxyOft.inflowLimit),
            outflow: formatEther(canonicalData.auraProxyOft.outflow),
            inflow: formatEther(canonicalData.auraProxyOft.inflow),
            circulatingSupply: formatEther(canonicalData.auraProxyOft.circulatingSupply),
            paused: canonicalData.auraProxyOft.paused,
            auraProxyOFTAuraBalance: formatEther(canonicalData.auraProxyOft.auraProxyOFTAuraBalance),
        },
        auraBalProxyOFTData: {
            epoch: canonicalData.aurabalProxyOft.epoch.toNumber(),
            inflowLimit: formatEther(canonicalData.aurabalProxyOft.inflowLimit),
            outflow: formatEther(canonicalData.aurabalProxyOft.outflow),
            inflow: formatEther(canonicalData.aurabalProxyOft.inflow),
            circulatingSupply: formatEther(canonicalData.aurabalProxyOft.circulatingSupply),
            paused: canonicalData.aurabalProxyOft.paused,
            totalClaimableAuraBal: formatEther(canonicalData.aurabalProxyOft.totalClaimableAuraBal),
            totalClaimableAura: formatEther(canonicalData.aurabalProxyOft.totalClaimableAura),
            internalTotalSupply: formatEther(canonicalData.aurabalProxyOft.internalTotalSupply),
            auraBalance: formatEther(canonicalData.aurabalProxyOft.auraBalance),
            auraBalBalance: formatEther(canonicalData.aurabalProxyOft.auraBalBalance),
            auraBalVaultBalance: formatEther(canonicalData.aurabalProxyOft.auraBalVaultBalance),
            auraBalVaultBalanceOfUnderlying: formatEther(canonicalData.aurabalProxyOft.auraBalVaultBalanceOfUnderlying),
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
            mintRate: formatEther(sidechainData.l2CoordData.mintRate),
            accBalRewards: formatEther(sidechainData.l2CoordData.accBalRewards),
            accAuraRewards: formatEther(sidechainData.l2CoordData.accAuraRewards),
            auraBalance: formatEther(sidechainData.l2CoordData.auraBalance),
            lzEndpoint: sidechainData.l2CoordData.lzEndpoint,
            trustedRemote: sidechainData.l2CoordData.trustedRemote,
        },
        auraOFTData: {
            address: sidechainData.auraOftData._address,
            circulatingSupply: formatEther(sidechainData.auraOftData.circulatingSupply),
            totalSupply: formatEther(sidechainData.auraOftData.totalSupply),
            paused: sidechainData.auraOftData.paused,
            bridgeDelegateAuraBalance: formatEther(sidechainData.auraOftData.bridgeDelegateAuraBalance),
            lzEndpoint: sidechainData.auraOftData.lzEndpoint,
            trustedRemote: sidechainData.auraOftData.trustedRemote,
        },
        auraBalOFTData: {
            address: sidechainData.auraBalOftData._address,
            circulatingSupply: formatEther(sidechainData.auraBalOftData.circulatingSupply),
            totalSupply: formatEther(sidechainData.auraBalOftData.totalSupply),
            paused: sidechainData.auraBalOftData.paused,
            auraBalStrategyAuraBalOFTBalance: formatEther(
                sidechainData.auraBalOftData.auraBalStrategyAuraBalOFTBalance,
            ),
            lzEndpoint: sidechainData.auraBalOftData.lzEndpoint,
            trustedRemote: sidechainData.auraBalOftData.trustedRemote,
        },
        deployer: {
            auraOftBalance: formatEther(sidechainData.auraBalanceOf),
            auraBalOftBalance: formatEther(sidechainData.auraBalBalanceOf),
        },
    };
}

task("sidechain:metrics")
    .addParam("sidechainid", "Remote standard chain ID (can not be eth mainnet)")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const remoteNodeUrl = process.env.REMOTE_NODE_URL;
        assert(remoteNodeUrl.length > 0, "REMOTE_NODE_URL not set");

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

        const log = (title: string, general?: string[], signer?: string[]) => {
            console.log("===================");
            console.log(title);
            console.log("===================");
            console.log("");
            if (general) {
                console.log("#### General ####");
                general.forEach(s => console.log(s));
                console.log("");
            }
            if (signer) {
                console.log("#### Signer ####");
                signer.forEach(s => console.log(s));
                console.log("");
            }
            console.log("");
        };

        /* ---------------------------------------------------------------
         * Config 
        --------------------------------------------------------------- */

        log("Config", [
            `Deployer: ${deployerAddress}`,
            `Local chain ID: ${hre.network.config.chainId}`,
            `Remote chain ID: ${remoteChainId}`,
            `Remote node URL: ${remoteNodeUrl}`,
        ]);

        /* ---------------------------------------------------------------
         * Local 
        --------------------------------------------------------------- */

        const local: CanonicalPhase1Deployed & CanonicalPhase2Deployed = canonicalConfig.getSidechain(deployer) as any;
        const phase2 = await canonicalConfig.getPhase2(deployer);
        const canonicalView = await canonicalConfig.getCanonicalView(deployer);

        const canonicalMetrics = await getCanonicalMetrics(deployer, canonicalView, remoteChainId);

        log(
            "Local",
            [
                `AuraOFT address:                                   ${local.auraProxyOFT.address}`,
                `AuraBalOFT address:                                ${local.auraBalProxyOFT.address}`,
                `AURA balance of AuraOFT:                           ${formatEther(
                    await phase2.cvx.balanceOf(local.auraProxyOFT.address),
                )}`,
                `Trusted remote address (${sidechainLzChainId}):        ${await local.auraProxyOFT.trustedRemoteLookup(
                    sidechainLzChainId,
                )}`,
                `Endpoint:                                          ${await local.auraProxyOFT.lzEndpoint()}`,
            ],
            [
                `Lock balance:                                      ${formatEther(
                    (await phase2.cvxLocker.balances(deployerAddress)).locked,
                )}`,
                `AURA balance:                                      ${formatEther(
                    await phase2.cvx.balanceOf(deployerAddress),
                )}`,
                `auraBAL balance:                                   ${formatEther(
                    await phase2.cvxCrv.balanceOf(deployerAddress),
                )}`,
            ],
        );

        /* ---------------------------------------------------------------
         * Local Metrics 
        --------------------------------------------------------------- */
        const canonicalCoordinatorInformation = canonicalMetrics[0];
        log("Local Metrics", [
            `Sidechain ID:                                      ${canonicalCoordinatorInformation.sidechainId}`,
            `L1Coordinator BAL Balance:                         ${canonicalMetrics.l1CoordinatorData.balBalance}`,
            `L1Coordinator feeDebtOf:                           ${canonicalCoordinatorInformation.l1CoordinatorSidechainData.feeDebtOf}`,
            `L1Coordinator settledFeeDebtOf:                    ${canonicalCoordinatorInformation.l1CoordinatorSidechainData.settledFeeDebtOf}`,
            `L1Coordinator settledFeeDebtOf:                    ${canonicalCoordinatorInformation.l1CoordinatorSidechainData.settledFeeDebtOf}`,
            `L1Coordinator distributedFeeDebtOf:                ${canonicalCoordinatorInformation.l1CoordinatorSidechainData.distributedFeeDebtOf}`,
            `L1Coordinator bridgeDelegate:                      ${canonicalCoordinatorInformation.l1CoordinatorSidechainData.bridgeDelegate}`,
            `L1Coordinator l2Coordinator:                       ${canonicalCoordinatorInformation.l1CoordinatorSidechainData.l2Coordinator}`,
            `L1Coordinator bridgeDelegateBalBalance:            ${canonicalCoordinatorInformation.l1CoordinatorSidechainData.bridgeDelegateBalBalance}`,
            `auraProxyOFT Epoch:                                ${canonicalMetrics.auraProxyOFTData.epoch}`,
            `auraProxyOFT inflowLimit:                          ${canonicalMetrics.auraProxyOFTData.inflowLimit}`,
            `auraProxyOFT outflow:                              ${canonicalMetrics.auraProxyOFTData.outflow}`,
            `auraProxyOFT inflow:                               ${canonicalMetrics.auraProxyOFTData.inflow}`,
            `auraProxyOFT circulatingSupply:                    ${canonicalMetrics.auraProxyOFTData.circulatingSupply}`,
            `auraProxyOFT paused:                               ${canonicalMetrics.auraProxyOFTData.paused}`,
            `auraProxyOFT auraProxyOFTAuraBalance:              ${canonicalMetrics.auraProxyOFTData.auraProxyOFTAuraBalance}`,
            `auraBalProxyOFT epoch:                             ${canonicalMetrics.auraBalProxyOFTData.epoch}`,
            `auraBalProxyOFT inflowLimit:                       ${canonicalMetrics.auraBalProxyOFTData.inflowLimit}`,
            `auraBalProxyOFT outflow:                           ${canonicalMetrics.auraBalProxyOFTData.outflow}`,
            `auraBalProxyOFT inflow:                            ${canonicalMetrics.auraBalProxyOFTData.inflow}`,
            `auraBalProxyOFT circulatingSupply:                 ${canonicalMetrics.auraBalProxyOFTData.circulatingSupply}`,
            `auraBalProxyOFT paused:                            ${canonicalMetrics.auraBalProxyOFTData.paused}`,
            `auraBalProxyOFT totalClaimableAuraBal:             ${canonicalMetrics.auraBalProxyOFTData.totalClaimableAuraBal}`,
            `auraBalProxyOFT totalClaimableAura:                ${canonicalMetrics.auraBalProxyOFTData.totalClaimableAura}`,
            `auraBalProxyOFT internalTotalSupply:               ${canonicalMetrics.auraBalProxyOFTData.internalTotalSupply}`,
            `auraBalProxyOFT auraBalance:                       ${canonicalMetrics.auraBalProxyOFTData.auraBalance}`,
            `auraBalProxyOFT auraBalBalance:                    ${canonicalMetrics.auraBalProxyOFTData.auraBalBalance}`,
            `auraBalProxyOFT auraBalVaultBalance:               ${canonicalMetrics.auraBalProxyOFTData.auraBalVaultBalance}`,
            `auraBalProxyOFT auraBalVaultBalanceOfUnderlying:   ${canonicalMetrics.auraBalProxyOFTData.auraBalVaultBalanceOfUnderlying}`,
            `auraBalProxyOFT claimableAuraBal:                  ${canonicalCoordinatorInformation.auraBalProxyOFTSidechainData.claimableAuraBal}`,
            `auraBalProxyOFT claimableAura:                     ${canonicalCoordinatorInformation.auraBalProxyOFTSidechainData.claimableAura}`,
        ]);
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
            "Local Metrics",
            [
                `Sidechain ID:                                      ${remoteMetrics.sidechainId}`,
                `L2CoordinatorData address:                         ${remoteMetrics.l2CoordinatorData.address}`,
                `L2CoordinatorData mintRate:                        ${remoteMetrics.l2CoordinatorData.mintRate}`,
                `L2CoordinatorData accBalRewards:                   ${remoteMetrics.l2CoordinatorData.accBalRewards}`,
                `L2CoordinatorData accAuraRewards:                  ${remoteMetrics.l2CoordinatorData.accAuraRewards}`,
                `L2CoordinatorData auraBalance:                     ${remoteMetrics.l2CoordinatorData.auraBalance}`,
                `L2CoordinatorData trustedRemote:                   ${remoteMetrics.l2CoordinatorData.trustedRemote}`,

                `auraOFT address:                                   ${remoteMetrics.auraOFTData.address}`,
                `auraOFT circulatingSupply:                         ${remoteMetrics.auraOFTData.circulatingSupply}`,
                `auraOFT totalSupply:                               ${remoteMetrics.auraOFTData.totalSupply}`,
                `auraOFT paused:                                    ${remoteMetrics.auraOFTData.paused}`,
                `auraOFT bridgeDelegateAuraBalance:                 ${remoteMetrics.auraOFTData.bridgeDelegateAuraBalance}`,
                `auraOFT trustedRemote:                             ${remoteMetrics.auraOFTData.trustedRemote}`,

                `auraBalOFT address:                                ${remoteMetrics.auraBalOFTData.address}`,
                `auraBalOFT circulatingSupply:                      ${remoteMetrics.auraBalOFTData.circulatingSupply}`,
                `auraBalOFT totalSupply:                            ${remoteMetrics.auraBalOFTData.totalSupply}`,
                `auraBalOFT paused:                                 ${remoteMetrics.auraBalOFTData.paused}`,
                `auraBalOFT auraBalStrategyAuraBalOFTBalance:       ${remoteMetrics.auraBalOFTData.auraBalStrategyAuraBalOFTBalance}`,
                `auraBalOFT trustedRemote:                          ${remoteMetrics.auraBalOFTData.trustedRemote}`,

                `Endpoint l2Coordinator:                            ${remoteMetrics.l2CoordinatorData.lzEndpoint}`,
                `Endpoint AuraOFT:                                  ${remoteMetrics.auraOFTData.lzEndpoint}`,
                `Endpoint AuraBalOFT:                               ${remoteMetrics.auraBalOFTData.lzEndpoint}`,
            ],
            [
                `AuraOFT balance:                                   ${remoteMetrics.deployer.auraOftBalance}`,
                `AuraBalOFT balance:                                ${remoteMetrics.deployer.auraBalOftBalance}`,
            ],
        );
    });
