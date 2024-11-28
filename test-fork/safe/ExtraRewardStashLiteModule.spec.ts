import { expect } from "chai";
import { Signer } from "ethers";
import hre, { network } from "hardhat";
import { deployExtraRewardStashLiteModule } from "../../scripts/deployPeripheral";
import { sidechainConfigs } from "../../tasks/deploy/sidechain-constants";
import { chainIds } from "../../tasks/utils";
import { advanceBlock, impersonate, ZERO, ZERO_ADDRESS } from "../../test-utils";
import {
    ExtraRewardStashLiteModule,
    ExtraRewardStashV3__factory,
    ISafe,
    ISafe__factory,
    SidechainConfig,
    SidechainPhaseDeployed,
} from "../../types";

const debug = false;
// This test is only for sidechains , currently it has been tested for arbitrum, if you want to test other sidechains, change the chainId , the block number and GHO_ADDRESS
describe("ExtraRewardStashLiteModule", () => {
    let daoMultisig: Signer;
    let deployer: Signer;
    let deployerAddress: string;
    let contracts: SidechainPhaseDeployed;
    let extraRewardStashModule: ExtraRewardStashLiteModule;
    let safe: ISafe;
    let config: SidechainConfig;
    const GHO_ADDRESS = "0x7dfF72693f6A4149b17e7C6314655f6A9F7c8B33";
    const chainId = chainIds.arbitrum;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 278518000,
                    },
                },
            ],
        });
        await advanceBlock(1);
        expect(process.env.NODE_URL.includes("arb"), "NODE_URL- test for base only").to.be.eq(true);

        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";

        deployer = await impersonate(deployerAddress, true);
        config = sidechainConfigs[chainId];
        contracts = sidechainConfigs[chainId].getSidechain(deployer);

        daoMultisig = await impersonate(config.multisigs.daoMultisig, true);
        safe = ISafe__factory.connect(config.multisigs.daoMultisig, daoMultisig);
    });

    it("deploys module", async () => {
        ({ extraRewardStashModule } = await deployExtraRewardStashLiteModule(
            hre,
            deployer,
            config.multisigs,
            { boosterOwnerLite: contracts.boosterOwner, keeperMulticall3: contracts.keeperMulticall3 },
            [contracts.auraOFT.address],
            debug,
        ));

        expect(await extraRewardStashModule.owner(), "owner").to.be.eq(config.multisigs.daoMultisig);
        expect(await extraRewardStashModule.safeWallet(), "safeWallet").to.be.eq(config.multisigs.daoMultisig);
        expect(await extraRewardStashModule.booster(), "booster").to.be.eq(contracts.booster.address);
        expect(await extraRewardStashModule.boosterOwner(), "boosterOwner").to.be.eq(contracts.boosterOwner.address);
        expect(
            await extraRewardStashModule.authorizedTokens(contracts.auraOFT.address),
            "authorizedTokens-cvx",
        ).to.be.eq(true);
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
        const pid = 9;
        const tokenAddress = GHO_ADDRESS;

        // Given that the keeper is authorized
        const authorizedKeepers = await extraRewardStashModule.authorizedKeepers(contracts.keeperMulticall3.address);
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
        const keeper = await impersonate(contracts.keeperMulticall3.address);

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
