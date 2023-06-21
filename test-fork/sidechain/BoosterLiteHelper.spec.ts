import hre, { network } from "hardhat";
import { deployBoosterLiteHelper } from "../../scripts/deploySidechain";
import { Account } from "types/common";

import { config } from "../../tasks/deploy/arbitrum-config";
import { impersonateAccount, ZERO_ADDRESS } from "../../test-utils";
import { simpleToExactAmount } from "../../test-utils/math";
import { BoosterLiteHelper, Create2Factory__factory } from "../../types/generated";

const ALCHEMY_API_KEY = process.env.NODE_URL;
const relayerAddress = "0xfc3f4e28d914da71447d94829c48b1248c7c0b46";
describe("BoosterLiteHelper", () => {
    let deployer: Account;
    let relayer: Account;
    let boosterHelper: BoosterLiteHelper;
    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: ALCHEMY_API_KEY,
                        blockNumber: 103380000,
                    },
                },
            ],
        });

        console.log("🚀 ~ file: BoosterLiteHelper.spec.ts:28 ~ before ~ hre.network.name:", hre.network.name);

        relayer = await impersonateAccount(relayerAddress, true);
        deployer = await impersonateAccount("0xb07d2d6a03f2d4878dc1680f8581e871dae47494", true);
        const create2Factory = Create2Factory__factory.connect(config.extConfig.create2Factory, deployer.signer);
        await create2Factory.updateDeployer(relayerAddress, true);

        ({ boosterHelper } = await deployBoosterLiteHelper(
            hre,
            relayer.signer,
            config.extConfig,
            config.getSidechain(deployer.signer),
        ));
        console.log("🚀 ~ file: BoosterLiteHelper.spec.ts:37 ~ before ~ boosterHelper:", boosterHelper.address);
    });

    it("earmarkRewards", async () => {
        const nativeFee = simpleToExactAmount(1);
        const tx = await boosterHelper
            .connect(relayer.signer)
            .earmarkRewards([0, 1, 2, 3, 4, 5, 6, 7], ZERO_ADDRESS, { value: nativeFee });
        tx.hash;
        console.log("🚀 ~ file: BoosterLiteHelper.spec.ts:42 ~ it ~ tx.hash:", tx.hash);
    });
});
