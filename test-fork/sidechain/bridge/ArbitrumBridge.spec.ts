import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";
import { deployArbitrumBridgeSender } from "../../../scripts/deployBridgeDelegates";
import { config as mainnetConfig } from "../../../tasks/deploy/mainnet-config";
import { config as arbitrumConfig } from "../../../tasks/deploy/arbitrum-config";
import { impersonateAccount, simpleToExactAmount } from "../../../test-utils";
import { Account, ERC20, MockERC20__factory, ArbitrumBridgeSender } from "../../../types";

describe("ArbitrumBridge", () => {
    let deployer: Account;
    let notAuth: Account;

    // Canonical chain Contracts
    let crv: ERC20;

    // Sender Contract
    let bridgeSender: ArbitrumBridgeSender;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    async function getBal(to: string, amount: BigNumberish) {
        const tokenWhaleSigner = await impersonateAccount(arbitrumConfig.extConfig.balancerVault);
        await crv.connect(tokenWhaleSigner.signer).transfer(to, amount);
    }

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.ARBITRUM_NODE_URL,
                    },
                },
            ],
        });

        const accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        notAuth = await impersonateAccount(await accounts[3].getAddress());

        // Deploy mocks
        crv = MockERC20__factory.connect(arbitrumConfig.extConfig.token, deployer.signer);

        bridgeSender = await deployArbitrumBridgeSender(
            hre,
            deployer.signer,
            arbitrumConfig.bridging.nativeBridge,
            arbitrumConfig.extConfig.token,
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
            expect(await bridgeSender.gatewayRouter()).eq(arbitrumConfig.bridging.nativeBridge);
            expect(await bridgeSender.crv()).eq(arbitrumConfig.extConfig.token);
        });
        it("should fail to send if not a keeper", async () => {
            await expect(
                bridgeSender.connect(notAuth.signer).send("1"),
                "fails due to not being a keeper",
            ).to.be.revertedWith("!keeper");
        });
    });

    // Case Not Working:
    // describe("Bridging", () => {
    //     it("Should be able to trigger a bridge request", async () => {
    //         const amount = simpleToExactAmount(100);
    //         await getBal(bridgeSender.address, amount);
    //         const balanceBefore = await crv.balanceOf(bridgeSender.address);
    //         const txn = await bridgeSender.send(balanceBefore.toString());

    //         //Everything from here should be a defender task
    //         const receipt = await txn.wait();

    //         let hasMessageSent = false;

    //         let i;
    //         for (i in receipt.logs) {
    //             const log = receipt.logs[i];
    //             try {
    //                 if (log.address == arbitrumConfig.bridging.nativeBridge) {
    //                     hasMessageSent = true;
    //                 }
    //             } catch {
    //                 continue;
    //             }
    //         }

    //         expect(hasMessageSent).eq(true);
    //     });
    // });
});
