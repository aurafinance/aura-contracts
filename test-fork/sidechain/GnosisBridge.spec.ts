import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";
import { deployGnosisBridgeSender } from "../../scripts/deployBridgeDelegates";
import { config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import { impersonate, impersonateAccount, simpleToExactAmount, ZERO_ADDRESS } from "../../test-utils";
import { Account, ERC20, MockERC20__factory, GnosisBridgeSender } from "../../types";

describe("GnosisBridge", () => {
    const balOnGno: string = "0x7eF541E2a22058048904fE5744f9c7E4C57AF717";
    const balOnGnoWhale: string = "0x458cD345B4C05e8DF39d0A07220feb4Ec19F5e6f";
    const ambAddress: string = "0x75Df5AF045d91108662D8080fD1FEFAd6aA0bb59";
    const ambHelper: string = "0x7d94ece17e81355326e3359115D4B02411825EdD";
    const ambOnEth: string = "0x4C36d2919e407f0Cc2Ee3c993ccF8ac26d9CE64e";
    const xdaiBlockNumber: Number = 27564475;
    const ethBlockNumber: Number = 17096880;

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

    async function getEth(recipient: string) {
        const ethWhale = await impersonate(mainnetConfig.addresses.weth);
        await ethWhale.sendTransaction({
            to: recipient,
            value: simpleToExactAmount(1),
        });
    }

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
        crv = MockERC20__factory.connect(balOnGno, deployer.signer);

        gnosisBridgeSender = await deployGnosisBridgeSender(hre, deployer.signer, balOnGno);
    });

    describe("Check configs", () => {
        it("Should be able to set values", async () => {
            //Placeholder values while config is WIP
            await gnosisBridgeSender.setL1Receiver(deployer.address);
            await gnosisBridgeSender.setL2Coordinator(dao.address);
            expect(await gnosisBridgeSender.l1Receiver()).eq(deployer.address);
            expect(await gnosisBridgeSender.l2Coordinator()).eq(dao.address);
            expect(await gnosisBridgeSender.crv()).eq(crv.address);
        });
    });

    describe("Bridging", () => {
        it("Should be able to trigger a request for signatures to bridge some bal", async () => {
            const amount = simpleToExactAmount(100);
            await getBal(gnosisBridgeSender.address, amount);
            let balanceBefore = await crv.balanceOf(gnosisBridgeSender.address);
            let txn = await gnosisBridgeSender.send(ZERO_ADDRESS, balanceBefore.toString());

            //Everything from here should be a defender task
            let receipt = await txn.wait();

            for (var i in receipt.logs) {
                var log = receipt.logs[i];
                if (log.address == ambAddress) {
                    let iface = new ethers.utils.Interface([
                        "event UserRequestForSignature(bytes32 indexed messageId, bytes encodedData)",
                    ]);
                    signData = iface.parseLog(log).args.encodedData;
                    messageId = ethers.utils.keccak256(signData);
                }
            }

            let abi = ["function message(bytes32 messageId) external view returns(bytes)"];
            let smartContract = new ethers.Contract(ambAddress, abi);
            let message = await smartContract.connect(dao.signer).message(messageId);
            // console.log(message)
            // expect(message).to.eq(signData);
        });
        it("Should be able to get signatures of an already signed transaction", async () => {
            signData =
                "0x00050000A7823D6F1E31569F51861E345B30C6BEBF70EBE70000000000010683F6A78083CA3E2A662D6DD1703C939C8ACE2E268D88AD09518695C6C3712AC10A214BE5109A655671000927C00101806401272255BB000000000000000000000000BA100000625A3754423978A60C9317C58A424E3D0000000000000000000000005FEA4413E3CC5CF3A29A49DB41AC0C24850417A000000000000000000000000000000000000000000000000000005ADBC8035800";

            let abi = ["function getSignatures(bytes calldata _message) external view returns(bytes memory)"];
            let smartContract = new ethers.Contract(ambHelper, abi);

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
            let startBalance = await crv.balanceOf(dao.address);

            let abi = ["function executeSignatures(bytes _data, bytes _signatures) external"];
            let smartContract = new ethers.Contract(ambOnEth, abi);

            await smartContract.connect(deployer.signer).executeSignatures(signData, signatures);

            let endBalance = await crv.balanceOf(dao.address);

            console.log("Bridged " + (Number(endBalance) - Number(startBalance)).toString() + " BAL");
            expect(Number(endBalance)).to.be.gt(Number(startBalance));
            console.log(dao.address);
        });
    });
});
