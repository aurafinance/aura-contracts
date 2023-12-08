import { expect } from "chai";
import hre, { network } from "hardhat";

import { Phase6Deployed } from "../../scripts/deploySystem";
import { deployFeeTokenHandlerV4 } from "../../scripts/deployVault";
import { AuraBalVaultDeployed, config } from "../../tasks/deploy/mainnet-config";
import { anyValue, impersonateAccount } from "../../test-utils";
import { Account, BalancerSwapsHandler, ERC20, ERC20__factory } from "../../types";

const FORK_BLOCK = 18718390;

describe("FeeToken (USDC) Handler V4", () => {
    let dao: Account;
    let deployer: Account;
    let phase6: Phase6Deployed;
    let feeTokenHandler: BalancerSwapsHandler;
    let feeToken: ERC20;
    let wethToken: ERC20;
    let compounder: AuraBalVaultDeployed;
    let feeTokenAddress: string;
    let deployerAddress: string;

    /* -------------------------------------------------------------------------
     * Before
     * ----------------------------------------------------------------------- */

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: FORK_BLOCK,
                    },
                },
            ],
        });

        deployerAddress = "0x30019eB135532bDdF2Da17659101cc000C73c8e4";
        dao = await impersonateAccount(config.multisigs.daoMultisig);
        deployer = await impersonateAccount(deployerAddress);

        phase6 = await config.getPhase6(dao.signer);
        compounder = await config.getAuraBalVault?.(dao.signer);
        feeTokenAddress = config.addresses.feeToken;

        feeToken = ERC20__factory.connect(feeTokenAddress, dao.signer);
        wethToken = ERC20__factory.connect("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", dao.signer);
    });

    /* -------------------------------------------------------------------------
     * Tests
     * ----------------------------------------------------------------------- */

    describe("Deployment", () => {
        it("Handlers", async () => {
            ({ feeTokenHandler } = await deployFeeTokenHandlerV4(config, hre, deployer.signer, false, 0));
        });
    });

    describe("Config", () => {
        it("Handler has correct values - USDC", async () => {
            expect(await feeTokenHandler.strategy()).eq(compounder.strategy.address);
            expect(await feeTokenHandler.WETH_TOKEN()).eq(config.addresses.weth);
            expect(await feeTokenHandler.token()).eq(feeTokenAddress);
            expect(await feeTokenHandler.balVault()).eq(config.addresses.balancerVault);
        });
    });

    describe("Multisig Prepare Compounder", () => {
        it("Update fee token handler", async () => {
            await compounder.strategy.updateRewardToken(feeTokenAddress, feeTokenHandler.address);
            expect(await compounder.strategy.rewardHandlers(feeTokenAddress)).eq(feeTokenHandler.address);
        });
    });

    describe("Normal Vault Operations", () => {
        it("harvest", async () => {
            const keeperAddress = "0xcc247cde79624801169475c9ba1f716db3959b8f";
            const harvester = await impersonateAccount(keeperAddress);

            const stakedBalanceBefore = await phase6.cvxCrvRewards.balanceOf(compounder.strategy.address);
            const totalUnderlyingBefore = await compounder.vault.totalUnderlying();

            // Test
            const tx = await compounder.vault.connect(harvester.signer)["harvest(uint256)"](0);

            const stakedBalanceAfter = await phase6.cvxCrvRewards.balanceOf(compounder.strategy.address);
            const totalUnderlyingAfter = await compounder.vault.totalUnderlying();

            expect(totalUnderlyingAfter).gt(totalUnderlyingBefore);
            expect(stakedBalanceAfter).gt(stakedBalanceBefore);
            // Verify USDC was sold with the new strategy
            const usdcVirtualPoolAddress = "0x27921a5CC29B11176817bbF5D6bAD83830f71555";
            const balancerVaultAddress = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
            // USDC from virtual pool => strategy => feeTokenHandler => vault
            // WETH vault => feeTokenHandler => strategy

            await expect(tx)
                .to.emit(feeToken, "Transfer")
                .withArgs(usdcVirtualPoolAddress, compounder.strategy.address, anyValue);
            await expect(tx)
                .to.emit(feeToken, "Transfer")
                .withArgs(compounder.strategy.address, feeTokenHandler.address, anyValue);
            await expect(tx)
                .to.emit(feeToken, "Transfer")
                .withArgs(feeTokenHandler.address, balancerVaultAddress, anyValue);
            await expect(tx)
                .to.emit(wethToken, "Transfer")
                .withArgs(balancerVaultAddress, feeTokenHandler.address, anyValue);
            await expect(tx)
                .to.emit(wethToken, "Transfer")
                .withArgs(feeTokenHandler.address, compounder.strategy.address, anyValue);
        });
    });
});
