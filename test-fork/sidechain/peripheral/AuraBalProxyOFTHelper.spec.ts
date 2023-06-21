import hre, { network } from "hardhat";
import { expect } from "chai";
import { deployAuraBalProxyOFTHelper } from "../../../scripts/deploySidechain";
import { Account } from "types/common";

import { AuraBalVaultDeployed, config } from "../../../tasks/deploy/mainnet-config";
import { impersonateAccount, ZERO_ADDRESS, increaseTime, ONE_WEEK } from "../../../test-utils";
import { simpleToExactAmount } from "../../../test-utils/math";
import { AuraBalProxyOFTHelper } from "../../../types/generated";

const ALCHEMY_API_KEY = process.env.NODE_URL;
const relayerAddress = "0xfc3f4e28d914da71447d94829c48b1248c7c0b46";
const nativeFee = simpleToExactAmount(1);

describe("AuraBalProxyOFTHelper", () => {
    let deployer: Account;
    let harvester: Account;
    let relayer: Account;
    let owner;
    let sidechain;
    let compounder: AuraBalVaultDeployed;
    let auraBalProxyOFTHelper: AuraBalProxyOFTHelper;
    let aura: string;
    let auraBal: string;

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
        harvester = await impersonateAccount("0xcC247CDe79624801169475C9Ba1f716dB3959B8f");

        aura = (await config.getPhase2(deployer.signer)).cvx.address;
        auraBal = (await config.getPhase2(deployer.signer)).cvxCrv.address;

        sidechain = config.getSidechain(deployer.signer);
        compounder = await config.getAuraBalVault?.(harvester.signer);

        owner = await impersonateAccount(await sidechain.auraBalProxyOFT.owner(), true);

        ({ auraBalProxyOFTHelper } = await deployAuraBalProxyOFTHelper(hre, relayer.signer, sidechain));

        console.log("🚀 ~ auraBalProxyOFTHelper:", auraBalProxyOFTHelper.address);
    });

    it("set authorised harvesters", async () => {
        await sidechain.auraBalProxyOFT
            .connect(owner.signer)
            .updateAuthorizedHarvesters(auraBalProxyOFTHelper.address, true);
        await sidechain.auraBalProxyOFT.connect(owner.signer).updateAuthorizedHarvesters(owner.address, true);
    });

    it("harvest", async () => {
        await auraBalProxyOFTHelper.callHarvestAndProcessClaimable(
            [1],
            1,
            [aura, auraBal],
            [110, 110],
            [ZERO_ADDRESS, ZERO_ADDRESS],
            { value: nativeFee },
        );
    });

    it("processClaimable", async () => {
        await increaseTime(ONE_WEEK);
        await compounder.vault.connect(harvester.signer)["harvest(uint256)"](1);
        await sidechain.auraBalProxyOFT.connect(owner.signer).harvest([1], 1);
        await auraBalProxyOFTHelper.processClaimable([aura, auraBal], [110, 110], [ZERO_ADDRESS, ZERO_ADDRESS], {
            value: nativeFee,
        });
    });

    it("should revert when not called by owner", async () => {
        await expect(
            auraBalProxyOFTHelper
                .connect(harvester.signer)
                .processClaimable([aura, auraBal], [110, 110], [ZERO_ADDRESS, ZERO_ADDRESS], { value: nativeFee }),
        ).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(
            auraBalProxyOFTHelper
                .connect(harvester.signer)
                .callHarvestAndProcessClaimable([1], 1, [aura, auraBal], [110, 110], [ZERO_ADDRESS, ZERO_ADDRESS], {
                    value: nativeFee,
                }),
        ).to.be.revertedWith("Ownable: caller is not the owner");
    });
});
