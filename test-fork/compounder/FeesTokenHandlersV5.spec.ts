import { expect } from "chai";
import hre, { network } from "hardhat";

import { Phase6Deployed } from "../../scripts/deploySystem";
import { deployFeeTokenHandlerV5 } from "../../scripts/deployVault";
import { AuraBalVaultDeployed, config } from "../../tasks/deploy/mainnet-config";
import { anyValue, BN, impersonateAccount } from "../../test-utils";
import { Account, ERC20, ERC20__factory, UniswapRouterHandler } from "../../types";

const BLOCK_BEFORE: number = 19859570;
const BLOCK_AFTER: number = 19882305;
const BLOCK_TEST: number = BLOCK_AFTER;

describe("FeeToken (USDC) Handler V5", () => {
    let dao: Account;
    let deployer: Account;
    let phase6: Phase6Deployed;
    let feeTokenHandler: UniswapRouterHandler;
    let feeToken: ERC20;
    let wethToken: ERC20;
    let compounder: AuraBalVaultDeployed;
    let feeTokenAddress: string;
    let deployerAddress: string;
    const keeperAddress = config.multisigs.defender.auraBalProxyOFTHarvestor;
    const usdcVirtualPoolAddress = "0x27921a5CC29B11176817bbF5D6bAD83830f71555";
    const usdcUniswapV3PoolAddress = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
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
                        blockNumber: BLOCK_TEST,
                    },
                },
            ],
        });
        hre.tracer.enabled = false;
        deployerAddress = "0x30019eB135532bDdF2Da17659101cc000C73c8e4";
        dao = await impersonateAccount(config.multisigs.daoMultisig);
        deployer = await impersonateAccount(deployerAddress);

        phase6 = await config.getPhase6(dao.signer);
        compounder = await config.getAuraBalVault?.(dao.signer);
        feeTokenAddress = config.addresses.feeToken;

        feeToken = ERC20__factory.connect(feeTokenAddress, dao.signer);
        wethToken = ERC20__factory.connect(config.addresses.weth, dao.signer);
    });

    /* -------------------------------------------------------------------------
     * Tests
     * ----------------------------------------------------------------------- */

    describe("Deployment", () => {
        it("Handlers", async () => {
            if (BLOCK_TEST === BLOCK_BEFORE) {
                ({ feeTokenHandler } = await deployFeeTokenHandlerV5(config, hre, deployer.signer, false, 0));
            } else {
                // eslint-disable-next-line no-unsafe-optional-chaining
                feeTokenHandler = (await config.getAuraBalVault?.(dao.signer)).feeTokenHandler as UniswapRouterHandler;
            }
        });
    });

    describe("Config", () => {
        it("Handler has correct values - USDC", async () => {
            expect(await feeTokenHandler.strategy()).eq(compounder.strategy.address);
            expect(await feeTokenHandler.WETH_TOKEN()).eq(config.addresses.weth);
            expect(await feeTokenHandler.token()).eq(feeTokenAddress);
            expect(await feeTokenHandler.uniswapV3Router()).eq(config.addresses.uniswapV3Router);
        });
    });

    describe("Multisig Prepare Compounder", () => {
        it("Update fee token handler", async () => {
            await compounder.strategy.updateRewardToken(feeTokenAddress, feeTokenHandler.address);
            await feeTokenHandler.setApprovals();
            expect(await compounder.strategy.rewardHandlers(feeTokenAddress)).eq(feeTokenHandler.address);
        });
    });

    describe("Normal Vault Operations", () => {
        // Tx as a reference https://etherscan.io/tx/0xefcfc48520518443dc34d5c066f77d1ca425d579841e6488076ebe04b7a73759
        it("harvest", async () => {
            const harvester = await impersonateAccount(keeperAddress);

            const stakedBalanceBefore = await phase6.cvxCrvRewards.balanceOf(compounder.strategy.address);
            const totalUnderlyingBefore = await compounder.vault.totalUnderlying();
            // With new pool it is  18.38 vs 15.93  saving 2.45 ETH !!
            const minWeth = BN.from("15936613716516739913");

            // Test

            const tx = await compounder.vault.connect(harvester.signer)["harvest(uint256)"](0);

            const stakedBalanceAfter = await phase6.cvxCrvRewards.balanceOf(compounder.strategy.address);
            const totalUnderlyingAfter = await compounder.vault.totalUnderlying();

            expect(totalUnderlyingAfter).gt(totalUnderlyingBefore);
            expect(stakedBalanceAfter).gt(stakedBalanceBefore);
            // Verify USDC was sold with the new strategy
            // USDC from virtual pool => strategy => feeTokenHandler => vault
            // WETH vault => feeTokenHandler => strategy

            await expect(tx, "usdcVirtualPool transfer to strategy")
                .to.emit(feeToken, "Transfer")
                .withArgs(usdcVirtualPoolAddress, compounder.strategy.address, anyValue);
            await expect(tx, "strategy transfer to feeTokenHandler")
                .to.emit(feeToken, "Transfer")
                .withArgs(compounder.strategy.address, feeTokenHandler.address, anyValue);
            await expect(tx, "feeTokenHandler transfer to v3 pool")
                .to.emit(feeToken, "Transfer")
                .withArgs(feeTokenHandler.address, usdcUniswapV3PoolAddress, anyValue);
            await expect(tx, "v3 pool transfer to feeTokenHandler")
                .to.emit(wethToken, "Transfer")
                .withArgs(usdcUniswapV3PoolAddress, feeTokenHandler.address, anyValue);

            await expect(tx, "feeTokenHandler transfer to strategy")
                .to.emit(wethToken, "Transfer")
                .withArgs(feeTokenHandler.address, compounder.strategy.address, args => {
                    // Enfoce to get more WETH that previous handler
                    return (args as BN).gt(minWeth);
                });
        });
    });
});
