import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";
import { deployOptimismBridgeSender } from "../../../scripts/deployBridgeDelegates";
import { config as mainnetConfig } from "../../../tasks/deploy/mainnet-config";
import { config as fraxtalConfig } from "../../../tasks/deploy/fraxtal-config";
import { impersonateAccount, simpleToExactAmount } from "../../../test-utils";
import { Account, ERC20, MockERC20__factory, OptimismBridgeSender } from "../../../types";
import { CrossChainMessenger, MessageStatus } from "@eth-optimism/sdk";

describe("FraxtalBridge", () => {
    const ethBlockNumber: number = 6029526;

    const crossDomainMessanger: string = "0x4200000000000000000000000000000000000007";
    const withdrawTxHash: string = "0x9d70f867ee6169e7fb24637a2c654e893cede412518704ab87f6cc01d492529b";

    let deployer: Account;
    let notAuth: Account;

    // Canonical chain Contracts
    let crv: ERC20;

    // Sender Contract
    let bridgeSender: OptimismBridgeSender;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    async function getBal(to: string, amount: BigNumberish) {
        // const tokenWhaleSigner = await impersonateAccount(fraxtalConfig.extConfig.balancerVault);
        // https://fraxscan.com/token/0x2FC7447F6cF71f9aa9E7FF8814B37E55b268Ec91#balances
        const tokenWhaleSigner = await impersonateAccount("0x9098b50ee2d9E4c3C69928A691DA3b192b4C9673"); // fraxtal BAL holder
        await crv.connect(tokenWhaleSigner.signer).transfer(to, amount);
    }

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.FRAXTAL_NODE_URL,
                    },
                },
            ],
        });

        const accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        notAuth = await impersonateAccount(await accounts[3].getAddress());

        // Deploy mocks
        crv = MockERC20__factory.connect(fraxtalConfig.extConfig.token, deployer.signer);

        bridgeSender = await deployOptimismBridgeSender(
            hre,
            deployer.signer,
            fraxtalConfig.bridging.nativeBridge,
            fraxtalConfig.extConfig.token,
            mainnetConfig.addresses.token,
        );
    });

    describe("Check configs", () => {
        it("Should be able to set values", async () => {
            //Placeholder values while config is WIP
            await bridgeSender.setL1Receiver(deployer.address);
            await bridgeSender.updateAuthorizedKeepers(deployer.address, true);
            expect(await bridgeSender.authorizedKeepers(deployer.address)).eq(true);
            expect(await bridgeSender.l1Receiver()).eq(deployer.address);
            expect(await bridgeSender.l2StandardBridge()).eq(fraxtalConfig.bridging.nativeBridge);
            expect(await bridgeSender.crv()).eq(fraxtalConfig.extConfig.token);
        });

        it("should fail to send if not a keeper", async () => {
            await expect(
                bridgeSender.connect(notAuth.signer).send("1"),
                "fails due to not being a keeper",
            ).to.be.revertedWith("!keeper");
        });
    });

    describe("Bridging", () => {
        it("Should be able to trigger a request for signatures to bridge some bal", async () => {
            const amount = simpleToExactAmount(0.2);
            await getBal(bridgeSender.address, amount);
            const balanceBefore = await crv.balanceOf(bridgeSender.address);
            const txn = await bridgeSender.send(balanceBefore.toString());

            //Everything from here should be a defender task
            const receipt = await txn.wait();

            let hasBridgeRequest = false;
            let hasMessageSent = false;

            let i;
            for (i in receipt.logs) {
                const log = receipt.logs[i];
                try {
                    if (log.address == fraxtalConfig.bridging.nativeBridge) {
                        const iface = new ethers.utils.Interface([
                            "event WithdrawalInitiated( address indexed _l1Token, address indexed _l2Token, address indexed _from, address _to, uint256 _amount, bytes _data)",
                        ]);
                        const logs = iface.parseLog(log);
                        expect(logs.args._to).eq(await bridgeSender.l1Receiver());
                        expect(logs.args._from).eq(bridgeSender.address);
                        expect(logs.args._l1Token).eq(mainnetConfig.addresses.token);
                        expect(logs.args._l2Token).eq(fraxtalConfig.extConfig.token);
                        hasBridgeRequest = true;
                    }
                    if (log.address == crossDomainMessanger) {
                        const iface = new ethers.utils.Interface([
                            "event SentMessage(address indexed target, address sender, bytes message, uint256 messageNonce, uint256 gasLimit)",
                        ]);
                        const logs = iface.parseLog(log);
                        expect(logs.args.sender).eq(fraxtalConfig.bridging.nativeBridge);
                        hasMessageSent = true;
                    }
                } catch {
                    continue;
                }
            }

            expect(hasMessageSent).eq(true);
            expect(hasBridgeRequest).eq(true);
        });

        it("Should be able to execute step 1 of the proof", async () => {
            const customProvider = new ethers.providers.JsonRpcProvider(process.env.FRAXTAL_NODE_URL);
            const receipt = await customProvider.getTransactionReceipt(withdrawTxHash);

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

            const accounts = await ethers.getSigners();
            deployer = await impersonateAccount(await accounts[0].getAddress());

            const CCM = new CrossChainMessenger({
                l1ChainId: 1,
                l1SignerOrProvider: deployer.signer,
                l2ChainId: 10,
                l2SignerOrProvider: process.env.FRAXTAL_NODE_URL,
                bedrock: true,
            });

            const message = await CCM.toCrossChainMessage(receipt);
            const status = await CCM.getMessageStatus(message);

            if (status == MessageStatus.READY_TO_PROVE) {
                const prove = await CCM.proveMessage(message);
                console.log(prove);
            } else if (status == MessageStatus.READY_FOR_RELAY) {
                const withdraw = await CCM.finalizeMessage(message);
                console.log(withdraw);
            }

            const newStatus = await CCM.getMessageStatus(message);
            expect(newStatus).not.eq(status);
        });
    });
});
