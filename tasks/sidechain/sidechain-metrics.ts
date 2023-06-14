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
import { ERC20__factory } from "types";

import {
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
    SidechainPhase1Deployed,
    SidechainPhase2Deployed,
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

async function getCanonicalMetrics(
    signer: Signer,
    addresses: ExtSystemConfig,
    phase2: Phase2Deployed,
    vaultDeployment: AuraBalVaultDeployed,
    canonicalSidechain: CanonicalPhase1Deployed & CanonicalPhase2Deployed,
    sidechains: Array<{ sidechainId: number }>,
): Promise<any> {
    const { auraProxyOFT, auraBalProxyOFT, l1Coordinator } = canonicalSidechain;
    const { vault: auraBalVault } = vaultDeployment;

    const aura = phase2.cvx;
    const bal = ERC20__factory.connect(addresses.token, signer);
    const auraBal = phase2.cvxCrv;

    // Mainnet
    const l1CoordinatorData = await getL1CoordinatorData(l1Coordinator, bal);
    const auraProxyOFTData = await getAuraProxyOFTData(auraProxyOFT, aura);
    const auraBalProxyOFTData = await getAuraBalProxyOFTData(auraBalProxyOFT, aura, auraBal, auraBalVault);

    // Per sidechain
    const sidechainsData = [];
    for (let i = 0; i < sidechains.length; i++) {
        const { sidechainId } = sidechains[i];
        const l1CoordinatorSidechainData = await getL1CoordinatorSidechainData(l1Coordinator, bal, sidechainId);
        const auraBalProxyOFTSidechainData = await getAuraBalProxyOFTSidechainData(
            auraBalProxyOFT,
            aura,
            auraBal,
            sidechainId,
        );

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
    }

    return {
        l1CoordinatorData: {
            balBalance: formatEther(l1CoordinatorData.balBalance),
        },
        auraProxyOFTData: {
            epoch: auraProxyOFTData.epoch.toNumber(),
            inflowLimit: formatEther(auraProxyOFTData.inflowLimit),
            outflow: formatEther(auraProxyOFTData.outflow),
            inflow: formatEther(auraProxyOFTData.inflow),
            circulatingSupply: formatEther(auraProxyOFTData.circulatingSupply),
            paused: auraProxyOFTData.paused,
            auraProxyOFTAuraBalance: formatEther(auraProxyOFTData.auraProxyOFTAuraBalance),
        },
        auraBalProxyOFTData: {
            epoch: auraBalProxyOFTData.epoch.toNumber(),
            inflowLimit: formatEther(auraBalProxyOFTData.inflowLimit),
            outflow: formatEther(auraBalProxyOFTData.outflow),
            inflow: formatEther(auraBalProxyOFTData.inflow),
            circulatingSupply: formatEther(auraBalProxyOFTData.circulatingSupply),
            paused: auraBalProxyOFTData.paused,
            totalClaimableAuraBal: formatEther(auraBalProxyOFTData.totalClaimableAuraBal),
            totalClaimableAura: formatEther(auraBalProxyOFTData.totalClaimableAura),
            internalTotalSupply: formatEther(auraBalProxyOFTData.internalTotalSupply),
            auraBalance: formatEther(auraBalProxyOFTData.auraBalance),
            auraBalBalance: formatEther(auraBalProxyOFTData.auraBalBalance),
            auraBalVaultBalance: formatEther(auraBalProxyOFTData.auraBalVaultBalance),
            auraBalVaultBalanceOfUnderlying: formatEther(auraBalProxyOFTData.auraBalVaultBalanceOfUnderlying),
        },
        ...sidechainsData,
    };
}

/*
 * * * * * * * * * * * * * * * * * * * * * *
 *  Sidechain Metrics
 * * * * * * * * * * * * * * * * * * * * * *
 */

async function getL2CoordinatorData(l2Coordinator: ethers.Contract, auraOFT: ethers.Contract) {
    const mintRate: BN = await l2Coordinator.mintRate();
    const accBalRewards: BN = await l2Coordinator.accBalRewards();
    const accAuraRewards: BN = await l2Coordinator.accAuraRewards();
    const auraBalance = await auraOFT.balanceOf(l2Coordinator.address);
    return { mintRate, accBalRewards, accAuraRewards, auraBalance };
}
async function getOFTData(oft: ethers.Contract) {
    const totalSupply = await oft.totalSupply();
    const circulatingSupply = await oft.circulatingSupply();
    const paused = await oft.paused();

    return { circulatingSupply, totalSupply, paused };
}
async function getAuraOFTData(auraOFT: ethers.Contract, bridgeDelegateAddress: string) {
    const oftData = await getOFTData(auraOFT);
    const bridgeDelegateAuraBalance = await auraOFT.balanceOf(bridgeDelegateAddress);
    return { ...oftData, bridgeDelegateAuraBalance };
}

async function getAuraBalOFTData(auraBalOFT: ethers.Contract, auraBalStrategyAddress: string) {
    const oftData = await getOFTData(auraBalOFT);
    const auraBalStrategyAuraBalOFTBalance: BN = await auraBalOFT.balanceOf(auraBalStrategyAddress);

    return { ...oftData, auraBalStrategyAuraBalOFTBalance };
}

async function getSidechainMetrics(
    signer: Signer,
    sidechainDeployed: SidechainPhase1Deployed & SidechainPhase2Deployed,
    bridgeDelegateAddress: string,
    sidechainId: string,
): Promise<any> {
    const { l2Coordinator, auraOFT, auraBalOFT, auraBalStrategy } = sidechainDeployed;

    const l2CoordinatorData = await getL2CoordinatorData(l2Coordinator, auraOFT);
    const auraOFTData = await getAuraOFTData(auraOFT, bridgeDelegateAddress);
    const auraBalOFTData = await getAuraBalOFTData(auraBalOFT, auraBalStrategy.address);

    return {
        sidechainId,
        l2CoordinatorData: {
            mintRate: formatEther(l2CoordinatorData.mintRate),
            accBalRewards: formatEther(l2CoordinatorData.accBalRewards),
            accAuraRewards: formatEther(l2CoordinatorData.accAuraRewards),
            auraBalance: formatEther(l2CoordinatorData.auraBalance),
        },
        auraOFTData: {
            circulatingSupply: formatEther(auraOFTData.circulatingSupply),
            totalSupply: formatEther(auraOFTData.totalSupply),
            paused: auraOFTData.paused,
            bridgeDelegateAuraBalance: formatEther(auraOFTData.bridgeDelegateAuraBalance),
        },
        auraBalOFTData: {
            circulatingSupply: formatEther(auraBalOFTData.circulatingSupply),
            totalSupply: formatEther(auraBalOFTData.totalSupply),
            paused: auraOFTData.paused,
            auraBalStrategyAuraBalOFTBalance: formatEther(auraBalOFTData.auraBalStrategyAuraBalOFTBalance),
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
        const canonicalSidechain = canonicalConfig.getSidechain(deployer);
        const getAuraBalVault = await canonicalConfig.getAuraBalVault(deployer);

        const canonicalMetrics = await getCanonicalMetrics(
            deployer,
            canonicalConfig.addresses,
            phase2,
            getAuraBalVault,
            canonicalSidechain,
            [{ sidechainId: remoteChainId }],
        );

        log(
            "Local",
            [
                "AuraOFT address: " + local.auraProxyOFT.address,
                "AuraBalOFT address: " + local.auraBalProxyOFT.address,
                "AURA balance of AuraOFT: " + formatEther(await phase2.cvx.balanceOf(local.auraProxyOFT.address)),
                `Trusted remote address (${sidechainLzChainId}): ${await local.auraProxyOFT.trustedRemoteLookup(
                    sidechainLzChainId,
                )}`,
                `Endpoint: ${await local.auraProxyOFT.lzEndpoint()}`,
            ],
            [
                "Lock balance: " + formatEther((await phase2.cvxLocker.balances(deployerAddress)).locked),
                "AURA balance: " + formatEther(await phase2.cvx.balanceOf(deployerAddress)),
                "auraBAL balance: " + formatEther(await phase2.cvxCrv.balanceOf(deployerAddress)),
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
        const remote: SidechainPhase1Deployed & SidechainPhase2Deployed = sidechainConfig.getSidechain(
            remoteDeployer,
        ) as any;
        const remoteMetrics = await getSidechainMetrics(deployer, remote, "bridgeDelegateAddress", remoteChainId);
        log(
            "Remote",
            [
                `Coordinator address: ${remote.l2Coordinator.address}`,
                `Total supply: ${await remote.auraOFT.totalSupply()}`,
                `Trusted remote address (${canonicalLzChainId}): ${await remote.l2Coordinator.trustedRemoteLookup(
                    canonicalLzChainId,
                )}`,
                `Endpoint AuraOFT: ${await remote.auraOFT.lzEndpoint()}`,
                `Endpoint l2Coordinator: ${await remote.l2Coordinator.lzEndpoint()}`,
            ],
            [
                `AuraOFT balance: ${formatEther(await remote.auraOFT.balanceOf(deployerAddress))}`,
                `AuraBalOFT balance: ${formatEther(await remote.auraBalOFT.balanceOf(deployerAddress))}`,
            ],
        );
    });
