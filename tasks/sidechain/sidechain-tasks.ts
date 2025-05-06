import assert from "assert";
import { task } from "hardhat/config";
import { formatEther, parseEther } from "ethers/lib/utils";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

import { chainIds, getJsonProviderByChainId, getSigner, waitForTx } from "../utils";
import { Phase2Deployed } from "../../scripts/deploySystem";
import { simpleToExactAmount } from "../../test-utils/math";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import {
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
    SidechainPhase1Deployed,
    SidechainPhase2Deployed,
} from "../../scripts/deploySidechain";
import {
    canonicalChains,
    lzChainIds,
    canonicalConfigs,
    sidechainConfigs,
    sideChains,
} from "../deploy/sidechain-constants";
import { AuraBalOFT, AuraBalProxyOFT, AuraOFT, AuraProxyOFT } from "../../types";
import { ethers } from "ethers";

const debug = true;
type CanonicalSidechain = CanonicalPhase1Deployed & CanonicalPhase2Deployed;
type SidechainDeployed = SidechainPhase1Deployed & SidechainPhase2Deployed;

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

async function fetchSidechainDetails(hre: HardhatRuntimeEnvironment, remoteChainId: number, sideChainIds: number[]) {
    const auraBalOftChainIds = [chainIds.arbitrum, chainIds.base, chainIds.polygon];
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();
    const jsonProvider = await getJsonProviderByChainId(remoteChainId);
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
     * Config
    --------------------------------------------------------------- */
    log("Config", [
        `Deployer: ${deployerAddress}`,
        `Local chain ID: ${hre.network.config.chainId}`,
        `Remote chain ID: ${remoteChainId}`,
        `Remote node URL: ${jsonProvider.connection.url}`,
    ]);

    /* ---------------------------------------------------------------
     * Local
    --------------------------------------------------------------- */

    const local: CanonicalSidechain = canonicalConfig.getSidechain(deployer) as CanonicalSidechain;
    const phase2 = await canonicalConfig.getPhase2(deployer);

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

    console.log("Remote chain ID:", remoteChainId);

    const remote = sidechainConfig.getSidechain(jsonProvider) as SidechainDeployed;

    console.log("Remote l2Coordinator address:", remote.l2Coordinator.address);
    console.log("Remote auraOFT address:", remote.auraOFT.address);
    console.log("Remote auraBalOFT address:", remote.auraBalOFT.address);

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
            ...(remote.auraBalOFT.address != ZERO_ADDRESS
                ? [`AuraBalOFT balance: ${formatEther(await remote.auraBalOFT.balanceOf(deployerAddress))}`]
                : []),
        ],
    );
    /* ---------------------------------------------------------------
     * Other sidechains
    --------------------------------------------------------------- */
    log(
        `Sidechains ${remoteChainId}`,
        [
            ...(await Promise.all(
                sideChainIds
                    .filter(chainId => chainId !== remoteChainId)
                    .map(
                        async chainId =>
                            `AuraOFT (${remoteChainId}) Trusted remote (${
                                lzChainIds[chainId]
                            }): ${await remote.auraOFT.trustedRemoteLookup(lzChainIds[chainId])}`,
                    ),
            )),
        ],
        [
            // Only Base Polygon and Arbitrum have AuraBalOFT
            ...(remote.auraBalOFT.address != ZERO_ADDRESS
                ? await Promise.all(
                      auraBalOftChainIds
                          .filter(chainId => chainId !== remoteChainId)
                          .map(
                              async chainId =>
                                  `AuraBalOFT (${remoteChainId}) Trusted remote (${
                                      lzChainIds[chainId]
                                  }): ${await remote.auraBalOFT.trustedRemoteLookup(lzChainIds[chainId])}`,
                          ),
                  )
                : []),
        ],
    );
}

task("sidechain:aura-oft-info")
    .addOptionalParam("sidechainid", "Remote standard chain ID (can not be eth mainnet)")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const remoteChainId = tskArgs.sidechainid;
        const sideChainIds = [
            chainIds.arbitrum,
            chainIds.avalanche,
            chainIds.optimism,
            chainIds.base,
            chainIds.fraxtal,
            chainIds.gnosis,
            chainIds.polygon,
            chainIds.zkevm,
        ];

        const checkChainsIds = remoteChainId && remoteChainId.length > 0 ? [remoteChainId] : sideChainIds;

        // for each chain ID, check if it is a canonical chain
        for (const chainId of checkChainsIds) {
            console.log(`---------------------------------------------------------------------------------`);
            console.log(`------------------- ${chainId} --------------------------------------------------`);
            console.log(`---------------------------------------------------------------------------------`);
            await fetchSidechainDetails(hre, chainId, sideChainIds);
        }
    });

task("sidechain:test:send-aura-oft")
    .addParam("wait", "Wait for blocks")
    .addParam("amount", "Amount of AURA")
    .addParam("remotechainid", "Remote chain to send AURA too")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const deployerAddress = await deployer.getAddress();
        const remoteChainId = tskArgs.remotechainid;
        const scaledAmount = parseEther(tskArgs.amount);

        const configs = { ...sidechainConfigs, ...canonicalConfigs };

        let oft: AuraProxyOFT | AuraOFT;

        if (canonicalChains.includes(hre.network.config.chainId)) {
            // Canonical chain config
            const config = configs[hre.network.config.chainId] as any;
            const contracts = config.getSidechain(deployer);
            const phase2: Phase2Deployed = await config.getPhase2(deployer);
            const tx = await phase2.cvx.approve(contracts.auraProxyOFT.address, scaledAmount);
            await waitForTx(tx, debug, tskArgs.wait);

            oft = contracts.auraProxyOFT;
        } else {
            // Sidechain config
            const config = configs[hre.network.config.chainId] as any;
            const contracts = config.getSidechain(deployer);
            oft = contracts.auraOFT;
        }

        const fees = await oft.estimateSendFee(lzChainIds[remoteChainId], deployerAddress, scaledAmount, false, []);
        const tx = await oft.sendFrom(
            deployerAddress,
            lzChainIds[remoteChainId],
            deployerAddress,
            scaledAmount,
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            [],
            {
                value: fees.nativeFee,
                gasLimit: 600_000,
            },
        );
        await waitForTx(tx, debug, tskArgs.wait);
    });

task("sidechhain:test:lock-aura")
    .addParam("wait", "Wait for blocks")
    .addParam("amount", "Amount of AURA to lock")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const deployerAddress = await deployer.getAddress();

        assert(sideChains.includes(hre.network.config.chainId), "Using a canonical chain");

        const config = sidechainConfigs[hre.network.config.chainId];
        assert(config, `Local config for chain ID ${hre.network.config.chainId} not found`);

        const deployment = config.getSidechain(deployer);
        assert("l2Coordinator" in deployment, "Coordinator not found");

        const auraBalance = await deployment.auraOFT.balanceOf(deployerAddress);
        console.log("AURA amount:", formatEther(auraBalance));
        const scaledAmount = parseEther(tskArgs.amount);
        assert(auraBalance >= scaledAmount, "Not enough ARUA");

        const tx = await deployment.auraOFT.lock(deployerAddress, scaledAmount, ZERO_ADDRESS, {
            value: simpleToExactAmount(0.05),
            gasLimit: 600_000,
        });
        await waitForTx(tx, debug, tskArgs.wait);
    });

task("sidechain:test:send-auraBal-oft")
    .addParam("wait", "Wait for blocks")
    .addParam("amount", "Amount of AURA")
    .addParam("remotechainid", "Remote chain to send AURA too")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const deployerAddress = await deployer.getAddress();
        const remoteChainId = tskArgs.remotechainid;
        const scaledAmount = parseEther(tskArgs.amount);

        const configs = { ...sidechainConfigs, ...canonicalConfigs };

        let oft: AuraBalProxyOFT | AuraBalOFT;

        const isCanonical = canonicalChains.includes(hre.network.config.chainId);

        if (isCanonical) {
            // Canonical chain config
            const config = configs[hre.network.config.chainId] as any;
            const contracts = config.getSidechain(deployer);
            const phase2: Phase2Deployed = await config.getPhase2(deployer);

            const allowance = await phase2.cvxCrv.allowance(deployerAddress, contracts.auraBalProxyOFT.address);
            if (allowance.lt(scaledAmount)) {
                const tx = await phase2.cvxCrv.approve(contracts.auraBalProxyOFT.address, scaledAmount);
                await waitForTx(tx, debug, tskArgs.wait);
            }

            oft = contracts.auraBalProxyOFT;
        } else {
            // Sidechain config
            const config = configs[hre.network.config.chainId] as any;
            const contracts = config.getSidechain(deployer);
            oft = contracts.auraBalOFT;
        }

        const adapterParams = isCanonical ? [] : ethers.utils.solidityPack(["uint16", "uint256"], [1, 600_000]);
        const fees = await oft.estimateSendFee(
            lzChainIds[remoteChainId],
            deployerAddress,
            scaledAmount,
            false,
            adapterParams,
        );
        const tx = await oft.sendFrom(
            deployerAddress,
            lzChainIds[remoteChainId],
            deployerAddress,
            scaledAmount,
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            adapterParams,
            {
                value: fees.nativeFee,
                gasLimit: 600_000,
            },
        );
        await waitForTx(tx, debug, tskArgs.wait);
    });
