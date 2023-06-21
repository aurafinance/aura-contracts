import hre, { network } from "hardhat";
import { BigNumberish } from "ethers";
import { expect } from "chai";
import { deployBridgeDelegateReceiverHelper } from "../../../scripts/deploySidechain";
import { Account } from "types/common";

import { config } from "../../../tasks/deploy/mainnet-config";
import { impersonateAccount } from "../../../test-utils";
import { BridgeDelegateReceiverHelper, BridgeDelegateReceiver, IERC20__factory } from "../../../types/generated";
import { deploySimpleBridgeReceiver } from "../../../scripts/deployBridgeDelegates";

const ALCHEMY_API_KEY = process.env.NODE_URL;
const relayerAddress = "0xfc3f4e28d914da71447d94829c48b1248c7c0b46";

async function getBal(to: string, amount: BigNumberish) {
    const balWhaleAddr = "0x740a4AEEfb44484853AA96aB12545FC0290805F3";
    const balWhale = await impersonateAccount(balWhaleAddr);
    await IERC20__factory.connect(config.addresses.token, balWhale.signer).transfer(to, amount);
}

describe("BridgeDelegateReceiverHelper", () => {
    let deployer: Account;
    let relayer: Account;
    let owner: Account;
    let bridgeDelegateReceiverHelper: BridgeDelegateReceiverHelper;
    let bridgeDelegateReceiver: BridgeDelegateReceiver;
    let sidechain;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: ALCHEMY_API_KEY,
                    },
                },
            ],
        });

        relayer = await impersonateAccount(relayerAddress, true);
        deployer = await impersonateAccount("0xb07d2d6a03f2d4878dc1680f8581e871dae47494", true);

        sidechain = config.getSidechain(deployer.signer);
        owner = await impersonateAccount(await sidechain.l1Coordinator.owner(), true);

        ({ bridgeDelegateReceiverHelper } = await deployBridgeDelegateReceiverHelper(hre, relayer.signer));

        ({ bridgeDelegateReceiver } = await deploySimpleBridgeReceiver(hre, sidechain, 110, relayer.signer));

        console.log("bridgeDelegateReceiverHelper:", bridgeDelegateReceiverHelper.address);
    });

    it("set owner of receiver", async () => {
        await bridgeDelegateReceiver.transferOwnership(bridgeDelegateReceiverHelper.address);
        expect(await bridgeDelegateReceiver.owner()).eq(bridgeDelegateReceiverHelper.address);
    });

    it("set delegate receiver for chain: 110", async () => {
        await sidechain.l1Coordinator.connect(owner.signer).setBridgeDelegate(110, bridgeDelegateReceiver.address);
    });

    it("settle some fee debt owner of receiver", async () => {
        await getBal(bridgeDelegateReceiver.address, "100");
        await bridgeDelegateReceiverHelper.settleFeeDebt(bridgeDelegateReceiver.address, "10");
    });

    it("settle some fee debt owner for receivers", async () => {
        await getBal(bridgeDelegateReceiver.address, "100");
        await bridgeDelegateReceiverHelper.settleMultipleFeeDebt([bridgeDelegateReceiver.address], ["10"]);
    });

    it("transfer ownership of a fee delegate", async () => {
        await bridgeDelegateReceiverHelper.transferReceiverOwnership(bridgeDelegateReceiver.address, owner.address);
        expect(await bridgeDelegateReceiver.owner()).eq(owner.address);
    });

    it("should revert when functions not called by owner", async () => {
        await expect(
            bridgeDelegateReceiverHelper
                .connect(owner.signer)
                .transferReceiverOwnership(bridgeDelegateReceiver.address, owner.address),
        ).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(
            bridgeDelegateReceiverHelper
                .connect(owner.signer)
                .settleMultipleFeeDebt([bridgeDelegateReceiver.address], ["10"]),
        ).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(
            bridgeDelegateReceiverHelper.connect(owner.signer).settleFeeDebt(bridgeDelegateReceiver.address, "10"),
        ).to.be.revertedWith("Ownable: caller is not the owner");
    });
});
