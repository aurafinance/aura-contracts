/* eslint-disable no-await-in-loop */
import { getSigner } from "../utils";

import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { ethers } from "ethers";

task("sidechain:gnosis:bridge")
    .addParam("txhash", "L2 TXN Hash of the bridge withdrawal")
    .setAction(async function (tskArgs: TaskArguments, hre: HardhatRuntimeEnvironment) {
        const withdrawTxHash = tskArgs.txhash;
        const deployer = await getSigner(hre);

        const ambAddress: string = "0x75Df5AF045d91108662D8080fD1FEFAd6aA0bb59";
        const ambHelper: string = "0x7d94ece17e81355326e3359115D4B02411825EdD";
        const ambOnEth: string = "0x4C36d2919e407f0Cc2Ee3c993ccF8ac26d9CE64e";

        console.log("==================================");
        console.log("Looking up GNO TX:", withdrawTxHash);

        const customProvider = new ethers.providers.JsonRpcProvider(process.env.GNOSIS_NODE_URL);
        const receipt = await customProvider.getTransactionReceipt(withdrawTxHash);

        console.log("==================================");
        console.log("Extracting data");

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

        console.log("==================================");
        console.log(signData);
        console.log("==================================");
        console.log("Looking up signatures");

        // look up signatures on gnosis chain
        const gnosisAbi = ["function getSignatures(bytes calldata _message) external view returns(bytes memory)"];
        const gnosisSmartContract = new ethers.Contract(ambHelper, gnosisAbi);

        const signatures = await gnosisSmartContract.connect(customProvider).getSignatures(signData);

        console.log("==================================");
        console.log(signatures);
        console.log("==================================");
        console.log("Sending Mainnet TX");

        //send withdraw tx on mainnet
        const mainnetAbi = ["function executeSignatures(bytes _data, bytes _signatures) external"];
        const mainnetSmartContract = new ethers.Contract(ambOnEth, mainnetAbi);

        await mainnetSmartContract.connect(deployer).executeSignatures(signData, signatures);

        console.log("==================================");
        console.log("Withdraw TX Sent on Mainnet");
    });
