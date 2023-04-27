import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";
import { deployGnosisBridgeSender } from "../../scripts/deployBridgeDelegates";
import { config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import { config as gnosisConfig } from "../../tasks/deploy/gnosis-config";
import { impersonateAccount, simpleToExactAmount } from "../../test-utils";
import { Account, ERC20, MockERC20__factory, GnosisBridgeSender } from "../../types";

describe("GnosisBridge", () => {
    const balOnGnoWhale: string = "0x458cD345B4C05e8DF39d0A07220feb4Ec19F5e6f";
    const ambAddress: string = "0x75Df5AF045d91108662D8080fD1FEFAd6aA0bb59";
    const ambHelper: string = "0x7d94ece17e81355326e3359115D4B02411825EdD";
    const ambOnEth: string = "0x4C36d2919e407f0Cc2Ee3c993ccF8ac26d9CE64e";
    const xdaiBlockNumber: number = 27564475;
    const ethBlockNumber: number = 17096880;

    let deployer: Account;
    let dao: Account;

    // Canonical chain Contracts
    let crv: ERC20;

    // Sender Contract
    let gnosisBridgeSender: GnosisBridgeSender;

    //Data for testing
    let signData: string;
    let messageId: string;
    let signatures: string;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    async function getBal(to: string, amount: BigNumberish) {
        const tokenWhaleSigner = await impersonateAccount(balOnGnoWhale);
        await crv.connect(tokenWhaleSigner.signer).transfer(to, amount);
    }

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.GNOSIS_NODE_URL,
                        blockNumber: xdaiBlockNumber,
                    },
                },
            ],
        });

        const accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        dao = await impersonateAccount(mainnetConfig.multisigs.daoMultisig);

        // Deploy mocks
        crv = MockERC20__factory.connect(gnosisConfig.extConfig.token, deployer.signer);

        gnosisBridgeSender = await deployGnosisBridgeSender(
            hre,
            deployer.signer,
            gnosisConfig.bridging.nativeBridge,
            gnosisConfig.extConfig.token,
        );
    });

    describe("Check configs", () => {
        it("Should be able to set values", async () => {
            //Placeholder values while config is WIP
            await gnosisBridgeSender.setL1Receiver(deployer.address);
            await gnosisBridgeSender.setL2Coordinator(dao.address);
            expect(await gnosisBridgeSender.l1Receiver()).eq(deployer.address);
            expect(await gnosisBridgeSender.l2Coordinator()).eq(gnosisConfig.bridging.l1Receiver);
            expect(await gnosisBridgeSender.bridge()).eq(gnosisConfig.bridging.nativeBridge);
            expect(await gnosisBridgeSender.crv()).eq(gnosisConfig.extConfig.token);
        });
    });

    describe("Bridging", () => {
        it("Should be able to trigger a request for signatures to bridge some bal", async () => {
            const amount = simpleToExactAmount(100);
            await getBal(gnosisBridgeSender.address, amount);
            const balanceBefore = await crv.balanceOf(gnosisBridgeSender.address);
            const txn = await gnosisBridgeSender.send(balanceBefore.toString());

            //Everything from here should be a defender task
            const receipt = await txn.wait();

            let i;
            for (i in receipt.logs) {
                const log = receipt.logs[i];
                if (log.address == ambAddress) {
                    const iface = new ethers.utils.Interface([
                        "event UserRequestForSignature(bytes32 indexed messageId, bytes encodedData)",
                    ]);
                    signData = iface.parseLog(log).args.encodedData;
                    messageId = ethers.utils.keccak256(signData);
                }
            }

            const abi = ["function message(bytes32 messageId) external view returns(bytes)"];
            const smartContract = new ethers.Contract(ambAddress, abi);
            const message = await smartContract.connect(dao.signer).message(messageId);
            console.log(message);
            // expect(message).to.eq(signData);
        });
        it("Should be able to get signatures of an already signed transaction", async () => {
            signData =
                "0x00050000A7823D6F1E31569F51861E345B30C6BEBF70EBE70000000000010683F6A78083CA3E2A662D6DD1703C939C8ACE2E268D88AD09518695C6C3712AC10A214BE5109A655671000927C00101806401272255BB000000000000000000000000BA100000625A3754423978A60C9317C58A424E3D0000000000000000000000005FEA4413E3CC5CF3A29A49DB41AC0C24850417A000000000000000000000000000000000000000000000000000005ADBC8035800";

            const abi = ["function getSignatures(bytes calldata _message) external view returns(bytes memory)"];
            const smartContract = new ethers.Contract(ambHelper, abi);

            signatures = await smartContract.connect(deployer.signer).getSignatures(signData);

            console.log(signatures);
        });
        it("Should be able to execute signature on ethereum side", async () => {
            await network.provider.request({
                method: "hardhat_reset",
                params: [
                    {
                        forking: {
                            jsonRpcUrl: process.env.ETHEREUM_NODE_URL,
                            blockNumber: ethBlockNumber,
                        },
                    },
                ],
            });

            crv = MockERC20__factory.connect(mainnetConfig.addresses.token, deployer.signer);
            const startBalance = await crv.balanceOf(dao.address);

            const abi = ["function executeSignatures(bytes _data, bytes _signatures) external"];
            const smartContract = new ethers.Contract(ambOnEth, abi);

            await smartContract.connect(deployer.signer).executeSignatures(signData, signatures);

            const endBalance = await crv.balanceOf(dao.address);

            console.log("Bridged " + (Number(endBalance) - Number(startBalance)).toString() + " BAL");
            expect(Number(endBalance)).to.be.gt(Number(startBalance));
            console.log(dao.address);
        });
    });
});
