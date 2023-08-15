/* eslint-disable no-await-in-loop */
import { ethers } from "ethers";
import { table } from "table";
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { ERC20__factory, SimpleBridgeDelegateSender__factory } from "../../types";

import { canonicalConfigs, sidechainConfigs } from "../deploy/sidechain-constants";
import { getSigner } from "../utils";

import { CrossChainMessenger, MessageStatus } from "@eth-optimism/sdk";
import { L2ToL1MessageStatus, L2TransactionReceipt } from "@arbitrum/sdk";
import { SendEvent } from "types/generated/SimpleBridgeDelegateSender";
import _axios from "axios";
import { SignerOrProvider } from "@arbitrum/sdk/dist/lib/dataEntities/signerOrProvider";

task("sidechain:metrics:balances").setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const deployer = await getSigner(hre);

    const mainnetConfig = canonicalConfigs[1];

    const providers = [
        process.env.ARBITRUM_NODE_URL,
        process.env.OPTIMISM_NODE_URL,
        process.env.POLYGON_NODE_URL,
        process.env.GNOSIS_NODE_URL,
    ];

    const names = ["arbitrum", "optimism", "polygon", "gnosis"];

    const chainIds = [42161, 10, 137, 100];

    const data = {};
    const rows = [[["Contract"], ["Address"], ["Chain"], ["Bal Balance"]]];

    const tokenMainnet = mainnetConfig.addresses.token;
    const tokenMainnetContract = ERC20__factory.connect(tokenMainnet, deployer);

    const l1Coordinator = mainnetConfig.getSidechain(deployer).l1Coordinator.address;
    rows.push([
        ["L1 Coordinator"],
        [l1Coordinator],
        ["mainnet"],
        [((await tokenMainnetContract.balanceOf(l1Coordinator)).toNumber() / 1e18).toString()],
    ]);

    for (const n in names) {
        data[names[n]] = [];
        const customProvider = new ethers.providers.JsonRpcProvider(providers[n]);
        const config = sidechainConfigs[chainIds[n]];
        const token = config.extConfig.token;

        const tokenContract = ERC20__factory.connect(token, customProvider);

        const senderBalance = await tokenContract.balanceOf(config.bridging.l2Sender);
        const receiverBalance = await tokenMainnetContract.balanceOf(config.bridging.l1Receiver);

        rows.push([
            [names[n] + " L2 Sender"],
            [config.bridging.l2Sender],
            [names[n]],
            [(senderBalance.toNumber() / 1e18).toString()],
        ]);
        rows.push([
            [names[n] + " L1 Receiver"],
            [config.bridging.l1Receiver],
            ["Mainnet"],
            [(receiverBalance.toNumber() / 1e18).toString()],
        ]);
    }

    console.log(table(rows));
});

task("sidechain:metrics:bridge").setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const deployer = await getSigner(hre);

    const providers = [
        process.env.ARBITRUM_NODE_URL,
        process.env.OPTIMISM_NODE_URL,
        process.env.POLYGON_NODE_URL,
        process.env.GNOSIS_NODE_URL,
    ];

    const names = ["arbitrum", "optimism", "polygon", "gnosis"];

    const chainIds = [42161, 10, 137, 100];

    const data = {};
    const allBridges = [];
    const rows = [[["Network"], ["TX"], ["Time"], ["Amount"], ["Status"]]];

    for (const n in names) {
        data[names[n]] = [];
        const customProvider = new ethers.providers.JsonRpcProvider(providers[n]);
        const config = sidechainConfigs[chainIds[n]];
        const l2sender = config.bridging.l2Sender;

        const l2SenderContract = SimpleBridgeDelegateSender__factory.connect(l2sender, customProvider);

        const eventFilter = l2SenderContract.filters.Send();
        const events = await l2SenderContract.queryFilter(eventFilter);

        for (const e in events) {
            const event = events[e];

            const timestamp = (await customProvider.getBlock(event.blockNumber)).timestamp;
            let status;

            if (names[n] == "optimism") {
                status = await getOptimismStatus(customProvider, event, deployer);
            } else if (names[n] == "arbitrum") {
                const sidechainSigner = new ethers.Wallet(process.env.PRIVATE_KEY, customProvider);
                status = await getArbitrumStatus(sidechainSigner, event, deployer);
            } else if (names[n] == "polygon") {
                status = await getPolygonStatus(event, deployer);
            } else if (names[n] == "gnosis") {
                status = await getGnosisStatus(customProvider, event, deployer);
            }

            const eventData = {
                chain: names[n],
                txn: event.transactionHash,
                block: event.blockNumber,
                timestamp: timestamp,
                to: event.args.to,
                amount: Number(event.args.amount) / 1e18,
                status: status,
            };

            data[names[n]].push(eventData);
            allBridges.push(eventData);

            rows.push([
                [eventData.chain],
                [eventData.txn],
                [eventData.timestamp],
                [eventData.amount],
                [eventData.status],
            ]);
        }
    }

    console.log(table(rows));
});
async function getGnosisStatus(
    customProvider: ethers.providers.JsonRpcProvider,
    event: SendEvent,
    deployer: ethers.Signer,
) {
    const withdrawTxHash = event.transactionHash;

    const ambAddress: string = "0x75Df5AF045d91108662D8080fD1FEFAd6aA0bb59";
    const ambHelper: string = "0x7d94ece17e81355326e3359115D4B02411825EdD";
    const ambOnEth: string = "0x4C36d2919e407f0Cc2Ee3c993ccF8ac26d9CE64e";

    const receipt = await customProvider.getTransactionReceipt(withdrawTxHash);

    let signData;

    //Get the requested data
    let i;
    for (i in receipt.logs) {
        const log = receipt.logs[i];
        if (log.address == ambAddress) {
            const iface = new ethers.utils.Interface([
                "event UserRequestForSignature(bytes32 indexed messageId, bytes encodedData)",
            ]);
            signData = iface.parseLog(log).args.encodedData;
        }
    }

    // look up signatures on gnosis chain
    const gnosisAbi = ["function getSignatures(bytes calldata _message) external view returns(bytes memory)"];
    const gnosisSmartContract = new ethers.Contract(ambHelper, gnosisAbi);

    const signatures = await gnosisSmartContract.connect(customProvider).getSignatures(signData);

    //send withdraw tx on mainnet
    const mainnetAbi = ["function executeSignatures(bytes _data, bytes _signatures) external"];
    const mainnetSmartContract = new ethers.Contract(ambOnEth, mainnetAbi);

    let newStatus = "Unknown";
    newStatus = mainnetSmartContract
        .connect(deployer)
        .staticcall.executeSignatures(signData, signatures)
        .then(
            results => {
                results;

                return "Ready to Withdraw";
            },
            error => {
                error;

                return "Unknown: Likely Withdraw Successful";
            },
        );

    return newStatus;
}

async function getPolygonStatus(event: SendEvent, deployer: ethers.Signer) {
    const mainnetBridge = "0xA0c68C638235ee32657e8f720a23ceC1bFc77C77";
    const baseURL = "https://proof-generator.polygon.technology/api/v1/matic/exit-payload/";
    const eventSig = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const eventSignature = "?eventSignature=";

    const axios = _axios.create({
        baseURL,
    });

    const withdrawalData = await axios.get(event.transactionHash + eventSignature + eventSig, {
        params: { limit: 100, offset: 0 },
    });

    let newStatus = "unknown";

    if (withdrawalData.data.message == "Payload generation success") {
        const proof = withdrawalData.data.result;
        const abi = ["function exit(bytes inputData)"];

        const bridgeContract = new ethers.Contract(mainnetBridge, abi);

        newStatus = await bridgeContract
            .connect(deployer)
            .callStatic.exit(proof)
            .then(
                results => {
                    results;

                    return "Ready to Withdraw";
                },
                error => {
                    let specifics = error["error"];
                    specifics = specifics.toString().split("\n");

                    for (const i in specifics) {
                        if (specifics[i].includes("EXIT_ALREADY_PROCESSED") == true) {
                            return "Withdraw Successful";
                        }
                    }
                },
            );
    } else {
        newStatus = "Unknown - Likely in 3 Hour Wait Period";
    }

    return newStatus;
}

async function getArbitrumStatus(customProvider: ethers.Wallet, event: SendEvent, deployer: ethers.Signer) {
    const receipt = await customProvider.provider.getTransactionReceipt(event.transactionHash);
    const l2Receipt = new L2TransactionReceipt(receipt);

    const messages = await l2Receipt.getL2ToL1Messages(deployer as SignerOrProvider);
    const l2ToL1Msg = messages[0];
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const messageStatus = await l2ToL1Msg.status(customProvider.provider as ethers.providers.Provider);
    let newStatus;

    if (messageStatus === L2ToL1MessageStatus.EXECUTED) {
        newStatus = "Withdraw Successful";
    } else if (messageStatus === L2ToL1MessageStatus.UNCONFIRMED) {
        newStatus = "Ready to Withdraw";
    } else if (messageStatus === L2ToL1MessageStatus.CONFIRMED) {
        newStatus = "In 7 day wait period";
    }
    return newStatus;
}

async function getOptimismStatus(
    customProvider: ethers.providers.JsonRpcProvider,
    event: SendEvent,
    deployer: ethers.Signer,
) {
    const receipt = await customProvider.getTransactionReceipt(event.transactionHash);

    const CCM = new CrossChainMessenger({
        l1ChainId: 1,
        l1SignerOrProvider: deployer,
        l2ChainId: 10,
        l2SignerOrProvider: process.env.OPTIMISM_NODE_URL,
        bedrock: true,
    });

    const message = await CCM.toCrossChainMessage(receipt);
    const status = await CCM.getMessageStatus(message);

    let newStatus;

    if (status == MessageStatus.STATE_ROOT_NOT_PUBLISHED) {
        newStatus = "State root not yet published";
    } else if (status == MessageStatus.READY_TO_PROVE) {
        newStatus = "Ready to Prove";
    } else if (status == MessageStatus.IN_CHALLENGE_PERIOD) {
        newStatus = "In 7 day dispute period";
    } else if (status == MessageStatus.READY_FOR_RELAY) {
        newStatus = "Ready to Withdraw";
    } else if (status == MessageStatus.RELAYED) {
        newStatus = "Withdraw Successful";
    }

    return newStatus;
}
