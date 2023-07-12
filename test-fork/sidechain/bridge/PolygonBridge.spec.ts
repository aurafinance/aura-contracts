import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";
import { deployPolygonBridgeSender } from "../../../scripts/deployBridgeDelegates";
import { config as polygonConfig } from "../../../tasks/deploy/polygon-config";
import { Account, ERC20, MockERC20__factory, PolygonBridgeSender } from "../../../types";
import { impersonateAccount, ZERO_ADDRESS } from "../../../test-utils";

describe("PolygonBridgeSender", () => {
    const whaleAddress: string = "0xba12222222228d8ba445958a75a0704d566bf2c8";

    let deployer: Account;

    // Canonical chain Contracts
    let crv: ERC20;

    // Sender Contract
    let polygonBridgeSender: PolygonBridgeSender;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    async function getBal(to: string, amount: BigNumberish) {
        const tokenWhaleSigner = await impersonateAccount(whaleAddress);
        await crv.connect(tokenWhaleSigner.signer).transfer(to, amount);
    }

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.POLYGON_NODE_URL,
                    },
                },
            ],
        });

        const accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());

        crv = MockERC20__factory.connect(polygonConfig.extConfig.token, deployer.signer);

        polygonBridgeSender = await deployPolygonBridgeSender(hre, deployer.signer, polygonConfig.extConfig.token);
    });

    describe("Check configs", () => {
        it("Should be able to set values", async () => {
            //Placeholder values while config is WIP
            await polygonBridgeSender.setL1Receiver(deployer.address);
            await polygonBridgeSender.updateAuthorizedKeepers(deployer.address, true);
            expect(await polygonBridgeSender.authorizedKeepers(deployer.address)).eq(true);
            expect(await polygonBridgeSender.l1Receiver()).eq(deployer.address);
            expect(await polygonBridgeSender.crv()).eq(polygonConfig.extConfig.token);
            expect(await polygonBridgeSender.owner()).eq(deployer.address);
        });
    });

    describe("Bridging From Polygon", () => {
        it("Should be able to trigger a request for signatures to bridge some bal", async () => {
            const amount = "100";
            await getBal(polygonBridgeSender.address, amount);
            const balanceBefore = await crv.balanceOf(polygonBridgeSender.address);
            const txn = await polygonBridgeSender.send(amount);

            //Everything from here should be a defender task
            const receipt = await txn.wait();

            let hasBurn;
            let i;

            for (i in receipt.logs) {
                const log = receipt.logs[i];
                if (log.address == polygonConfig.extConfig.token) {
                    const iface = new ethers.utils.Interface([
                        "event Transfer(address indexed from, address indexed to, uint256 amount)",
                    ]);

                    const logData = iface.parseLog(log);

                    if (logData.args.from == polygonBridgeSender.address && logData.args.to == ZERO_ADDRESS) {
                        hasBurn = true;
                    }
                }
            }

            const balanceAfter = await crv.balanceOf(polygonBridgeSender.address);
            expect(hasBurn).eq(true);
            expect(balanceBefore).gt(balanceAfter);
        });
    });
});
