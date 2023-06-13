import assert from "assert";
import { ethers } from "ethers";
import { task } from "hardhat/config";
import { formatEther, parseEther } from "ethers/lib/utils";
import { JsonRpcProvider } from "@ethersproject/providers";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

import { getSigner, waitForTx } from "../utils";
import { Phase2Deployed } from "../../scripts/deploySystem";
import { simpleToExactAmount } from "../../test-utils/math";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { CanonicalPhaseDeployed, SidechainDeployed } from "../../scripts/deploySidechain";
import { canonicalChains, remoteChainMap, lzChainIds, configs } from "../deploy/sidechain-constants";

const debug = true;

task("sidechain:aura-oft-info")
    .addParam("remotechainid", "Remote standard chain ID (can not be eth mainnet)")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const remoteNodeUrl = process.env.REMOTE_NODE_URL;
        assert(remoteNodeUrl.length > 0, "REMOTE_NODE_URL not set");
        assert(tskArgs.remotechainid !== 1, "Remote chain ID cannot be 1");

        const deployer = await getSigner(hre);
        const deployerAddress = await deployer.getAddress();

        const localChainId = hre.network.config.chainId;
        const localConfig = configs[localChainId];
        const localLzChainId = lzChainIds[localChainId];
        assert(localConfig, `Local config for chain ID ${hre.network.config.chainId} not found`);
        assert(localLzChainId, "Local LZ chain ID not found");
        assert("getPhase2" in localConfig, "Local config must be eth/goerli config");

        const remoteChainId = tskArgs.remotechainid;
        assert(
            Number(remoteChainId) === Number(remoteChainMap[hre.network.config.chainId]),
            `Incorrect remote chain ID ${remoteChainId} !== ${remoteChainMap[hre.network.config.chainId]}`,
        );

        const remoteConfig = configs[remoteChainId];
        assert(remoteConfig, `Remote config for chain ID ${remoteChainId} not found`);

        const remoteLzChainId = lzChainIds[remoteChainId];
        assert(remoteLzChainId, "Remote LZ chain ID not found");

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

        const local: CanonicalPhaseDeployed = localConfig.getSidechain(deployer) as any;
        const phase2 = await localConfig.getPhase2(deployer);

        log(
            "Local",
            [
                "AuraOFT address: " + local.auraProxyOFT.address,
                "AURA balance of AuraOFT: " + formatEther(await phase2.cvx.balanceOf(local.auraProxyOFT.address)),
                `Trusted remote address (${remoteLzChainId}): ${await local.auraProxyOFT.trustedRemoteLookup(
                    remoteLzChainId,
                )}`,
                `Endpoint: ${await local.auraProxyOFT.lzEndpoint()}`,
            ],
            [
                "Lock balance: " + formatEther((await phase2.cvxLocker.balances(deployerAddress)).locked),
                "AURA balance: " + formatEther(await phase2.cvx.balanceOf(deployerAddress)),
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
        const remote: SidechainDeployed = remoteConfig.getSidechain(remoteDeployer) as any;

        log(
            "Remote",
            [
                `Coordinator address: ${remote.l2Coordinator.address}`,
                `Total supply: ${await remote.auraOFT.totalSupply()}`,
                `Trusted remote address (${localLzChainId}): ${await remote.l2Coordinator.trustedRemoteLookup(
                    localLzChainId,
                )}`,
                `Endpoint AuraOFT: ${await remote.auraOFT.lzEndpoint()}`,
                `Endpoint l2Coordinator: ${await remote.l2Coordinator.lzEndpoint()}`,
            ],
            [`Balance of deployer: ${await remote.auraOFT.balanceOf(deployerAddress)}`],
        );
    });

task("sidechain:test:send-aura-to-sidechain")
    .addParam("wait", "Wait for blocks")
    .addParam("amount", "Amount of AURA")
    .addParam("remotechainid", "Remote chain to send AURA too")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const deployerAddress = await deployer.getAddress();

        const localConfig = configs[hre.network.config.chainId];
        assert(localConfig, `Local config for chain ID ${hre.network.config.chainId} not found`);

        const remoteChainId = tskArgs.remotechainid;
        assert(
            Number(remoteChainId) === Number(remoteChainMap[hre.network.config.chainId]),
            `Incorrect remote chain ID ${remoteChainId} !== ${remoteChainMap[hre.network.config.chainId]}`,
        );

        const remoteConfig = configs[remoteChainId];
        assert(remoteConfig, `Remote config for chain ID ${remoteChainId} not found`);

        const remoteLzChainId = lzChainIds[remoteChainId];
        assert(remoteLzChainId, "LZ chain ID not found");

        const local = localConfig.getSidechain(deployer);
        const remote = remoteConfig.getSidechain(deployer);

        if ("auraProxyOFT" in local && "l2Coordinator" in remote) {
            // L1 -> L2
            const phase2: Phase2Deployed = await (localConfig as any).getPhase2(deployer);
            const auraBalance = await phase2.cvx.balanceOf(deployerAddress);
            const scaledAmount = parseEther(tskArgs.amount);
            assert(auraBalance >= scaledAmount, "Not enough AURA");

            let tx = await phase2.cvx.approve(local.auraProxyOFT.address, scaledAmount);
            await waitForTx(tx, debug, tskArgs.wait);

            tx = await local.auraProxyOFT.sendFrom(
                deployerAddress,
                lzChainIds[tskArgs.remotechainid],
                deployerAddress,
                scaledAmount,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                [],
                {
                    value: simpleToExactAmount(0.05),
                    gasLimit: 600_000,
                },
            );
            await waitForTx(tx, debug, tskArgs.wait);
        } else if ("coordinator" in local && "auraOFT" in remote) {
            // L2 -> L1
            // TODO:
        }
    });

task("sidechhain:test:lock-aura")
    .addParam("wait", "Wait for blocks")
    .addParam("amount", "Amount of AURA to lock")
    .setAction(async (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) => {
        const deployer = await getSigner(hre);
        const deployerAddress = await deployer.getAddress();

        assert(!canonicalChains.includes(hre.network.config.chainId), "Using a canonical chain");

        const config = configs[hre.network.config.chainId];
        assert(config, `Local config for chain ID ${hre.network.config.chainId} not found`);

        const deployment = config.getSidechain(deployer);
        assert("l2Coordinator" in deployment, "Coordinator not found");

        const auraBalance = await deployment.auraOFT.balanceOf(deployerAddress);
        console.log("AURA amount:", formatEther(auraBalance));
        const scaledAmount = parseEther(tskArgs.amount);
        assert(auraBalance >= scaledAmount, "Not enough ARUA");

        const tx = await deployment.auraOFT.lock(scaledAmount, {
            value: simpleToExactAmount(0.05),
            gasLimit: 600_000,
        });
        await waitForTx(tx, debug, tskArgs.wait);
    });
