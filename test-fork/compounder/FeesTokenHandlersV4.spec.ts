import { expect } from "chai";
import { network } from "hardhat";

import { Phase6Deployed, Phase8Deployed } from "../../scripts/deploySystem";
import { AuraBalVaultDeployed, config } from "../../tasks/deploy/mainnet-config";
import { BN, impersonateAccount, increaseTime } from "../../test-utils";
import { ONE_WEEK, ZERO_ADDRESS } from "../../test-utils/constants";
import {
    Account,
    BalancerSwapsHandler,
    ERC20,
    ERC20__factory,
    ForwarderHandler,
    ForwarderHandler__factory,
} from "../../types";

const FORK_BLOCK = 18033877;

describe("FeeToken (USDC) Handler V4", () => {
    let dao: Account;
    let deployer: Account;
    let phase6: Phase6Deployed;
    let phase8: Phase8Deployed;
    let feeTokenHandler: BalancerSwapsHandler;
    let oldFeeToken: ERC20;
    let forwarderHandler: ForwarderHandler;
    let compounder: AuraBalVaultDeployed;
    let newFeeTokenAddress: string;
    let oldFeeTokenAddress: string;
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
        phase8 = await config.getPhase8(dao.signer);

        compounder = await config.getAuraBalVault?.(dao.signer);

        newFeeTokenAddress = config.addresses.feeToken;
        oldFeeTokenAddress = "0xfeBb0bbf162E64fb9D0dfe186E517d84C395f016";

        oldFeeToken = ERC20__factory.connect(oldFeeTokenAddress, dao.signer);
    });

    /* -------------------------------------------------------------------------
     * Tests
     * ----------------------------------------------------------------------- */

    describe("Deployment", () => {
        // vault extra rewards
        // feeToken claim
        it("Handlers", async () => {
            ({ feeTokenHandler } = await config.getAuraBalVault(dao.signer));
            forwarderHandler = ForwarderHandler__factory.connect(
                "0x7663FD322021D5b1f36dBf0c97D34cfa039fCCA1",
                deployer.signer,
            );
        });
    });

    describe("Config", () => {
        it("Handler has correct values - USDC", async () => {
            expect(await feeTokenHandler.strategy()).eq(compounder.strategy.address);
            expect(await feeTokenHandler.WETH_TOKEN()).eq(config.addresses.weth);
            expect(await feeTokenHandler.token()).eq(newFeeTokenAddress);
            expect(await feeTokenHandler.balVault()).eq(config.addresses.balancerVault);
        });
        it("Handler has correct values - BBAUSD", async () => {
            expect(await forwarderHandler.token()).eq(oldFeeTokenAddress);
        });
    });

    describe("Multisig Prepare Compounder", () => {
        it("Update old token and handler", async () => {
            expect(await compounder.strategy.rewardHandlers(oldFeeTokenAddress)).eq(ZERO_ADDRESS);
            await compounder.strategy.updateRewardToken(oldFeeTokenAddress, forwarderHandler.address);
            expect(await compounder.strategy.rewardHandlers(oldFeeTokenAddress)).eq(forwarderHandler.address);
        });
        it("Add new handler", async () => {
            await compounder.strategy.addRewardToken(newFeeTokenAddress, feeTokenHandler.address);
            expect(await compounder.strategy.rewardHandlers(newFeeTokenAddress)).eq(feeTokenHandler.address);
        });
        it("Add new fee token to the booster", async () => {
            await phase8.boosterOwnerSecondary.setFeeInfo(newFeeTokenAddress, config.addresses.feeDistribution);
            const usdcFeeToken = await phase6.booster.feeTokens(newFeeTokenAddress);
            const bbusdFeeToken = await phase6.booster.feeTokens(oldFeeTokenAddress);
            expect(usdcFeeToken.active, "New Fee token active").to.be.eq(true);
            expect(usdcFeeToken.distro, "Fee token distributor").to.be.eq(bbusdFeeToken.distro);
            expect(usdcFeeToken.rewards, "New Fee token active").to.not.be.eq(bbusdFeeToken.rewards);
        });
    });

    describe("Normal Vault Operations", () => {
        let oldFeeTokenBobBalanceBefore: BN;
        before("before", async () => {
            oldFeeTokenBobBalanceBefore = await oldFeeToken.balanceOf(await forwarderHandler.owner());
        });
        it("wait some time and earmark fees - usdc", async () => {
            await increaseTime(ONE_WEEK);
            await phase6.feeCollector.claimFees([newFeeTokenAddress], 4);
            // await phase6.booster.earmarkFees(newFeeTokenAddress);
        });
        it("wait some time and earmark fees - bbausd", async () => {
            await increaseTime(ONE_WEEK);
            await phase6.booster.earmarkFees(oldFeeTokenAddress);
        });

        it("harvest", async () => {
            const keeperAddress = "0xcc247cde79624801169475c9ba1f716db3959b8f";
            const harvester = await impersonateAccount(keeperAddress);

            const stakedBalanceBefore = await phase6.cvxCrvRewards.balanceOf(compounder.strategy.address);
            const totalUnderlyingBefore = await compounder.vault.totalUnderlying();

            await compounder.vault.connect(harvester.signer)["harvest(uint256)"](0);

            const stakedBalanceAfter = await phase6.cvxCrvRewards.balanceOf(compounder.strategy.address);
            const totalUnderlyingAfter = await compounder.vault.totalUnderlying();

            expect(totalUnderlyingAfter).gt(totalUnderlyingBefore);
            expect(stakedBalanceAfter).gt(stakedBalanceBefore);
        });
        it("forwarded bbausd to address", async () => {
            // eoa will unwrap bbausd and manually send it back to the strategy
            const oldFeeTokenBobBalanceAfter = await oldFeeToken.balanceOf(await forwarderHandler.owner());
            expect(oldFeeTokenBobBalanceAfter, "FeeToken sent").gt(oldFeeTokenBobBalanceBefore);
        });
    });
});
