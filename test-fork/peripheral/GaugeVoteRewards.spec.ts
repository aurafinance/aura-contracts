import { expect } from "chai";
import hre from "hardhat";
import { CanonicalPhase1Deployed, CanonicalPhase2Deployed } from "../../scripts/deploySidechain";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { config } from "../../tasks/deploy/mainnet-config";
import { getSigner } from "../../tasks/utils";
import { setupLocalDeployment } from "../../test-fork/sidechain/setupLocalDeployment";
import { simpleToExactAmount, impersonateAccount } from "../../test-utils";
import { Account } from "../../types";
import { ChildGaugeVoteRewards__factory } from "../../types/generated/factories/ChildGaugeVoteRewards__factory";
import { GaugeVoteRewards__factory } from "../../types/generated/factories/GaugeVoteRewards__factory";
import { StashRewardDistro__factory } from "../../types/generated/factories/StashRewardDistro__factory";
import { ChildGaugeVoteRewards } from "../../types/generated/ChildGaugeVoteRewards";
import { GaugeVoteRewards } from "../../types/generated/GaugeVoteRewards";
import { StashRewardDistro } from "../../types/generated/StashRewardDistro";
import { TestSuiteDeployment } from "../../test-fork/sidechain/setupForkDeployments";

const L1_CHAIN_ID = 101;
const L2_CHAIN_ID = 110;

describe("GaugeVoteRewards", () => {
    let deployer: Account;
    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    let sidechain: CanonicalPhase1Deployed & CanonicalPhase2Deployed;
    let ctx: TestSuiteDeployment;

    let gaugeVoteRewards: GaugeVoteRewards;
    let childGaugeVoteRewards: ChildGaugeVoteRewards;
    let stashRewardDistro: StashRewardDistro;

    before(async () => {
        deployer = await impersonateAccount(await (await getSigner(hre)).getAddress());

        phase2 = await config.getPhase2(deployer.signer);
        phase6 = await config.getPhase6(deployer.signer);
        sidechain = config.getSidechain(deployer.signer);

        ctx = await setupLocalDeployment(hre, config, deployer, L1_CHAIN_ID, L2_CHAIN_ID);

        stashRewardDistro = await new StashRewardDistro__factory(deployer.signer).deploy(phase6.booster.address);

        childGaugeVoteRewards = await new ChildGaugeVoteRewards__factory(deployer.signer).deploy(
            phase2.cvx.address,
            sidechain.auraProxyOFT.address,
            phase6.booster.address,
            stashRewardDistro.address,
        );

        gaugeVoteRewards = await new GaugeVoteRewards__factory(deployer.signer).deploy(
            phase2.cvx.address,
            sidechain.auraProxyOFT.address,
            phase6.booster.address,
            stashRewardDistro.address,
            L1_CHAIN_ID,
            ctx.l1LzEndpoint.address,
        );

        await ctx.l1LzEndpoint.setDestLzEndpoint(childGaugeVoteRewards.address, ctx.l2LzEndpoint.address);
    });

    describe("config", () => {
        it("GaugeVoteRewards has correct config", async () => {
            expect(await gaugeVoteRewards.aura()).eq(phase2.cvx.address);
            expect(await gaugeVoteRewards.auraOFT()).eq(sidechain.auraProxyOFT.address);
            expect(await gaugeVoteRewards.booster()).eq(phase6.booster.address);
            expect(await gaugeVoteRewards.stashRewardDistro()).eq(stashRewardDistro.address);
            expect(await gaugeVoteRewards.lzChainId()).eq(L1_CHAIN_ID);
            expect(await gaugeVoteRewards.lzEndpoint()).eq(ctx.l1LzEndpoint.address);
        });
        it("ChildGaugeVoteRewards has correct config", async () => {
            expect(await childGaugeVoteRewards.aura()).eq(phase2.cvx.address);
            expect(await childGaugeVoteRewards.auraOFT()).eq(sidechain.auraProxyOFT.address);
            expect(await childGaugeVoteRewards.booster()).eq(phase6.booster.address);
            expect(await childGaugeVoteRewards.stashRewardDistro()).eq(stashRewardDistro.address);
        });
    });

    describe("protected functions", () => {
        it("cannot call protected functions as non owner", async () => {
            const errorMsg = "Ownable: caller is not the owner";
            const signer = (await hre.ethers.getSigners()).pop();

            const g = gaugeVoteRewards.connect(signer);
            await expect(g.setDistributor(deployer.address)).to.be.revertedWith(errorMsg);
            await expect(g.setRewardPerEpoch(0)).to.be.revertedWith(errorMsg);
            await expect(g.voteGaugeWeight([], [])).to.be.revertedWith(errorMsg);

            const c = childGaugeVoteRewards.connect(signer);
            await expect(c.setDistributor(deployer.address)).to.be.revertedWith(errorMsg);
        });
    });

    describe("setup", () => {
        it("can add pool ID to gauge mapping", async () => {
            const nGauges = 10;
            await gaugeVoteRewards.setPoolIds(
                Array(nGauges)
                    .fill(0)
                    .map(i => i),
            );
            for (let i = 0; i < nGauges; i++) {
                const poolInfo = await phase6.booster.poolInfo(i);
                expect(await gaugeVoteRewards.getPoolId(poolInfo.gauge)).eq(i);
            }
        });
        it("can add dst chain ID mapping");
        it("can set reward per epoch", async () => {
            const amount = simpleToExactAmount(10000);
            await gaugeVoteRewards.setRewardPerEpoch(amount);
            expect(await gaugeVoteRewards.rewardPerEpoch()).eq(amount);
        });
        it("can set child gauge vote rewards addresses", async () => {
            await gaugeVoteRewards.setChildGaugeVoteRewards([L2_CHAIN_ID], [childGaugeVoteRewards.address]);
            expect(await gaugeVoteRewards.getChildGaugeVoteRewards(L2_CHAIN_ID)).eq(childGaugeVoteRewards.address);
        });
    });

    describe("voting", () => {
        it("can vote for underlying gauges");
    });

    describe("process rewards mainnet", () => {
        it("can process rewards");
        it("rewards are queued over 2 periods");
    });

    describe("process sidechain rewards", () => {
        it("can process sidechain rewards");
        it("rewards are queued over 2 periods");
    });
});
