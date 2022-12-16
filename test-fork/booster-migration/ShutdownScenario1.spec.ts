import { expect } from "chai";
import hre, { network } from "hardhat";
import { formatEther } from "ethers/lib/utils";

import { deployContract } from "../../tasks/utils";
import { Phase2Deployed } from "scripts/deploySystem";
import { config } from "../../tasks/deploy/mainnet-config";
import { impersonateAccount, ZERO } from "../../test-utils";
import {
    Account,
    Booster__factory,
    Booster,
    BaseRewardPool__factory,
    ERC20__factory,
    TempBooster__factory,
    TempBooster,
} from "../../types";

const debug = false;
const waitForBlocks = 0;

/**
 * @dev Shuts down the system, sets operator to fresh contract, then allows withdrawals.
 *      After this, or at any time, deploys the new booster and switches again.
 */
describe("System shutdown", () => {
    let protocolDao: Account;
    let phase2: Phase2Deployed;

    let tempBooster: TempBooster;
    let boosterV2: Booster;

    let wethAuraDepositor: Account;
    const wethAuraPid = 20;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15984533,
                    },
                },
            ],
        });

        protocolDao = await impersonateAccount(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(protocolDao.signer);

        wethAuraDepositor = await impersonateAccount("0x905c1cA2ac32eE0799E4Aa31927f1166A93F3b17");
    });

    describe("performing system shutdown", () => {
        it("deploys Temp Booster", async () => {
            tempBooster = await deployContract<TempBooster>(
                hre,
                new TempBooster__factory(protocolDao.signer),
                "TempBooster",
                [],
                {},
                debug,
                waitForBlocks,
            );
        });
        it("deploy Booster V2", async () => {
            boosterV2 = await deployContract<Booster>(
                hre,
                new Booster__factory(protocolDao.signer),
                "Booster",
                [
                    phase2.voterProxy.address,
                    phase2.cvx.address,
                    config.addresses.token,
                    config.addresses.voteOwnership,
                    config.addresses.voteParameter,
                ],
                {},
                debug,
                waitForBlocks,
            );
        });
        it("shutdown pools", async () => {
            const poolLength = await phase2.booster.poolLength();
            await Promise.all(
                Array(poolLength.toNumber())
                    .fill(null)
                    .map(async (_, i) => {
                        const poolInfo = await phase2.booster.poolInfo(i);
                        if (!poolInfo.shutdown) {
                            console.log("Shutting down pool ID:", i);
                            await phase2.poolManager.shutdownPool(i);
                        }
                    }),
            );
        });
        it("shutdown system", async () => {
            await phase2.poolManagerSecondaryProxy.shutdownSystem();
            await phase2.boosterOwner.shutdownSystem();
            expect(await phase2.booster.isShutdown()).eq(true);
        });
        it("update voterproxy operator", async () => {
            await phase2.voterProxy.setOperator(tempBooster.address);
            expect(await phase2.voterProxy.operator()).eq(tempBooster.address);
            await phase2.cvx.updateOperator();
            expect(await phase2.cvx.operator()).eq(tempBooster.address);
        });
    });

    describe("old booster still allows user actions", () => {
        it("Can withdraw LP tokens", async () => {
            const poolInfo = await phase2.booster.poolInfo(wethAuraPid);
            const lpToken = ERC20__factory.connect(poolInfo.lptoken, wethAuraDepositor.signer);
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, wethAuraDepositor.signer);

            const tokenBalance = await crvRewards.balanceOf(wethAuraDepositor.address);

            const balBefore = await lpToken.balanceOf(wethAuraDepositor.address);
            await crvRewards.connect(wethAuraDepositor.signer).withdrawAllAndUnwrap(false);
            const balAfter = await lpToken.balanceOf(wethAuraDepositor.address);

            const balance = balAfter.sub(balBefore);
            console.log("LP tokens transfered:", formatEther(balance));
            expect(balance).gt(ZERO);
            expect(balance).eq(tokenBalance);
        });
        it("can no longer claim AURA rewards", async () => {
            const poolInfo = await phase2.booster.poolInfo(wethAuraPid);
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, wethAuraDepositor.signer);
            const earned = await crvRewards.earned(wethAuraDepositor.address);
            console.log("AURA earned:", formatEther(earned));

            const auraBefore = await phase2.cvx.balanceOf(wethAuraDepositor.address);
            await crvRewards["getReward()"]();
            const auraAfter = await phase2.cvx.balanceOf(wethAuraDepositor.address);

            const auraMinted = auraAfter.sub(auraBefore);
            console.log("AURA minted:", formatEther(auraMinted));
            expect(auraMinted).eq(ZERO);
        });
    });

    describe("performing migration to v2", () => {
        it("update Aura operator", async () => {
            await phase2.voterProxy.setOperator(boosterV2.address);
            expect(await phase2.voterProxy.operator()).eq(boosterV2.address);
            await phase2.cvx.updateOperator();
            expect(await phase2.cvx.operator()).eq(boosterV2.address);
        });
    });
});
