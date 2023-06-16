import hre, { network } from "hardhat";
import { expect } from "chai";
import { Account, BalancerSwapsHandler } from "../../types";
import { Phase6Deployed } from "../../scripts/deploySystem";
import { impersonateAccount, increaseTime } from "../../test-utils";
import { ZERO_ADDRESS, ONE_WEEK } from "../../test-utils/constants";
import { AuraBalVaultDeployed, config } from "../../tasks/deploy/mainnet-config";
import { deployBBUSDHandlerV3 } from "../../scripts/deployVault";

const FORK_BLOCK = 17491445;

describe("BB-A-USD Handler V3", () => {
    let dao: Account;
    let phase6: Phase6Deployed;
    let handler: BalancerSwapsHandler;
    let compounder: AuraBalVaultDeployed;
    let newFeeToken: string;
    let oldFeeToken: string;

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

        dao = await impersonateAccount(config.multisigs.daoMultisig);
        phase6 = await config.getPhase6(dao.signer);

        handler = (await deployBBUSDHandlerV3(config, hre, dao.signer))["bbusdHandler"];
        compounder = await config.getAuraBalVault?.(dao.signer);

        newFeeToken = "0xfebb0bbf162e64fb9d0dfe186e517d84c395f016";
        oldFeeToken = "0xA13a9247ea42D743238089903570127DdA72fE44";
    });

    /* -------------------------------------------------------------------------
     * Tests
     * ----------------------------------------------------------------------- */

    describe("Config", () => {
        it("Handler has correct values", async () => {
            expect(await handler.strategy()).eq(compounder.strategy.address);
            expect(await handler.WETH_TOKEN()).eq(config.addresses.weth);
            expect(await handler.token()).eq(config.addresses.feeToken);
            expect(await handler.balVault()).eq(config.addresses.balancerVault);
        });
    });

    describe("Prepare Compounder", () => {
        it("retire old token and handler", async () => {
            await compounder.strategy.addRewardToken(oldFeeToken, ZERO_ADDRESS);
            expect(await compounder.strategy.rewardHandlers(oldFeeToken)).eq(ZERO_ADDRESS);
        });
        it("Add new handler", async () => {
            await compounder.strategy.addRewardToken(config.addresses.feeToken, handler.address);
            expect(await compounder.strategy.rewardHandlers(config.addresses.feeToken)).eq(handler.address);
        });
    });

    describe("Normal Vault Operations", () => {
        it("wait some time and earmark fees", async () => {
            for (let i = 0; i < 2; i++) {
                await increaseTime(ONE_WEEK);
                await phase6.booster.earmarkFees(newFeeToken);
            }
        });
        it("harvest", async () => {
            const harvester = await impersonateAccount("0xcC247CDe79624801169475C9Ba1f716dB3959B8f");

            const stakedBalanceBefore = await phase6.cvxCrvRewards.balanceOf(compounder.strategy.address);
            const totalUnderlyingBefore = await compounder.vault.totalUnderlying();

            await compounder.vault.connect(harvester.signer)["harvest(uint256)"](0);

            const stakedBalanceAfter = await phase6.cvxCrvRewards.balanceOf(compounder.strategy.address);
            const totalUnderlyingAfter = await compounder.vault.totalUnderlying();

            expect(totalUnderlyingAfter).gt(totalUnderlyingBefore);
            expect(stakedBalanceAfter).gt(stakedBalanceBefore);
        });
    });
});
