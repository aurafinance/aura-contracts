import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";
import { deployOptimismBridgeSender } from "../../../scripts/deployBridgeDelegates";
import { config as mainnetConfig } from "../../../tasks/deploy/mainnet-config";
import { config as optimismConfig } from "../../../tasks/deploy/optimism-config";
import { impersonateAccount, simpleToExactAmount } from "../../../test-utils";
import { Account, ERC20, MockERC20__factory, OptimismBridgeSender } from "../../../types";
import { CrossChainMessenger, MessageStatus } from "@eth-optimism/sdk";

describe("OptimismBridge", () => {
    const ethBlockNumber: number = 17612600;

    const crossDomainMessanger: string = "0x4200000000000000000000000000000000000007";
    const withdrawTxHash: string = "0x90db8fc43d4182fb1804136cc183ab6f8fa42bcf80f01093d22976c0743f53a2";

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
        const tokenWhaleSigner = await impersonateAccount(optimismConfig.extConfig.balancerVault);
        await crv.connect(tokenWhaleSigner.signer).transfer(to, amount);
    }

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.OPTIMISM_NODE_URL,
                    },
                },
            ],
        });

        const accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        notAuth = await impersonateAccount(await accounts[3].getAddress());

        // Deploy mocks
        crv = MockERC20__factory.connect(optimismConfig.extConfig.token, deployer.signer);

        bridgeSender = await deployOptimismBridgeSender(
            hre,
            deployer.signer,
            optimismConfig.bridging.nativeBridge,
            optimismConfig.extConfig.token,
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
            expect(await bridgeSender.l2StandardBridge()).eq(optimismConfig.bridging.nativeBridge);
            expect(await bridgeSender.crv()).eq(optimismConfig.extConfig.token);
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
            const amount = simpleToExactAmount(100);
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
                    if (log.address == optimismConfig.bridging.nativeBridge) {
                        const iface = new ethers.utils.Interface([
                            "event WithdrawalInitiated( address indexed _l1Token, address indexed _l2Token, address indexed _from, address _to, uint256 _amount, bytes _data)",
                        ]);
                        const logs = iface.parseLog(log);
                        expect(logs.args._to).eq(await bridgeSender.l1Receiver());
                        expect(logs.args._from).eq(bridgeSender.address);
                        expect(logs.args._l1Token).eq(mainnetConfig.addresses.token);
                        expect(logs.args._l2Token).eq(optimismConfig.extConfig.token);
                        hasBridgeRequest = true;
                    }
                    if (log.address == crossDomainMessanger) {
                        const iface = new ethers.utils.Interface([
                            "event SentMessage(address indexed target, address sender, bytes message, uint256 messageNonce, uint256 gasLimit)",
                        ]);
                        const logs = iface.parseLog(log);
                        expect(logs.args.sender).eq(optimismConfig.bridging.nativeBridge);
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
            const customProvider = new ethers.providers.JsonRpcProvider(process.env.OPTIMISM_NODE_URL);
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
                l2SignerOrProvider: process.env.OPTIMISM_NODE_URL,
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
