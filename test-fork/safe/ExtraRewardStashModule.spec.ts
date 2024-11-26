import { expect } from "chai";
import { Signer } from "ethers";
import hre, { network } from "hardhat";
import { deployExtraRewardStashModule } from "../../scripts/deployPeripheral";
import { Phase2Deployed, Phase8Deployed } from "../../scripts/deploySystem";
import { config } from "../../tasks/deploy/mainnet-config";
import { impersonate, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { ExtraRewardStashModule, ExtraRewardStashV3__factory, ISafe, ISafe__factory } from "../../types";

const debug = false;
describe("ExtraRewardStashModule", () => {
    let daoMultisig: Signer;
    let deployer: Signer;
    let deployerAddress: string;
    let contracts: Phase2Deployed & Phase8Deployed;
    let extraRewardStashModule: ExtraRewardStashModule;
    let safe: ISafe;
    const GHO_ADDRESS = "0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f";

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 21271390,
                    },
                },
            ],
        });

        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";

        deployer = await impersonate(deployerAddress, true);
        daoMultisig = await impersonate(config.multisigs.daoMultisig, true);
        const phase6 = await config.getPhase6(deployer);
        contracts = { ...(await config.getPhase2(deployer)), ...(await config.getPhase8(deployer)) };
        contracts.booster = await phase6.booster;

        safe = ISafe__factory.connect(config.multisigs.daoMultisig, daoMultisig);
    });

    it("deploys module", async () => {
        ({ extraRewardStashModule } = await deployExtraRewardStashModule(
            hre,
            deployer,
            config.multisigs,
            { boosterOwnerSecondary: contracts.boosterOwnerSecondary },
            [contracts.cvx.address],
            debug,
        ));

        expect(await extraRewardStashModule.owner(), "owner").to.be.eq(config.multisigs.daoMultisig);
        expect(await extraRewardStashModule.safeWallet(), "safeWallet").to.be.eq(config.multisigs.daoMultisig);
        expect(await extraRewardStashModule.booster(), "booster").to.be.eq(contracts.booster.address);
        expect(await extraRewardStashModule.boosterOwner(), "boosterOwner").to.be.eq(
            contracts.boosterOwnerSecondary.address,
        );
        expect(await extraRewardStashModule.authorizedTokens(contracts.cvx.address), "authorizedTokens-cvx").to.be.eq(
            true,
        );
    });

    it("configures the module", async () => {
        expect(await safe.isModuleEnabled(extraRewardStashModule.address), "isEnabled").to.be.eq(false);
        await safe.enableModule(extraRewardStashModule.address);
        expect(await safe.isModuleEnabled(extraRewardStashModule.address), "isEnabled").to.be.eq(true);
    });
    it("fails if keeper is not the caller", async () => {
        const authorizedKeepers = await extraRewardStashModule.authorizedKeepers(await deployer.getAddress());
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(false);
        await expect(
            extraRewardStashModule.connect(deployer).setStashExtraReward(ZERO, ZERO_ADDRESS),
        ).to.be.revertedWith("!keeper");
    });
    it("only owner can authorized tokens  ", async () => {
        expect(await extraRewardStashModule.authorizedTokens(GHO_ADDRESS), "authorizedTokens-GHO").to.be.eq(false);
        await extraRewardStashModule.connect(daoMultisig).updateAuthorizedTokens(GHO_ADDRESS, true);
        expect(await extraRewardStashModule.authorizedTokens(GHO_ADDRESS), "authorizedTokens-GHO").to.be.eq(true);
    });

    it("only keeper can setStashExtraReward ", async () => {
        const pid = 235;
        const tokenAddress = GHO_ADDRESS;

        // Given that the keeper is authorized
        const authorizedKeepers = await extraRewardStashModule.authorizedKeepers(
            config.multisigs.defender.keeperMulticall3,
        );
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
        const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);

        // And the pool exists
        const poolInfo = await contracts.booster.poolInfo(pid);

        const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer);
        const tokenCountBefore = await stash.tokenCount();
        const tokenInfo = await stash.tokenInfo(tokenAddress);

        // The token is not yet set as extra reward
        expect(tokenInfo.rewardAddress, "extraReward").to.be.eq(ZERO_ADDRESS);

        await extraRewardStashModule.connect(keeper).setStashExtraReward(pid, tokenAddress);

        // Validate it was set
        const tokenInfoAfter = await stash.tokenInfo(tokenAddress);
        const tokenCountAfter = await stash.tokenCount();

        expect(tokenCountBefore, "tokenCountAfter").to.be.eq(tokenCountAfter.sub(1));
        expect(tokenInfoAfter.token, "extraReward").to.be.eq(tokenAddress);
    });
});
