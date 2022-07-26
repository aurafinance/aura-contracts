import { ethers, network } from "hardhat";
import { expect } from "chai";
import {
    Booster,
    BoosterOwner,
    ClaimFeesHelper,
    ClaimFeesHelper__factory,
    IERC20,
    IERC20__factory,
    IFeeDistributor,
    IFeeDistributor__factory,
    VoterProxy,
} from "../types/generated";
import { impersonateAccount, increaseTime, ONE_WEEK, simpleToExactAmount } from "../test-utils";
import { Signer } from "ethers";
import { config } from "../tasks/deploy/mainnet-config";
import { _TypedDataEncoder } from "ethers/lib/utils";

const newFeeDistro = "0xD3cf852898b21fc233251427c2DC93d3d604F3BB";
const balWhaleAddress = "0xcEacc82ddCdB00BFE19A9D3458db3e6b8aEF542B";

describe("FeeDistroUpdate", () => {
    let protocolDao: Signer;
    let boosterOwner: BoosterOwner;
    let distributor: IFeeDistributor;
    let voterProxy: VoterProxy;
    let bal: IERC20;
    let feeToken: IERC20;
    let booster: Booster;
    async function setup() {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15210600,
                    },
                },
            ],
        });

        await impersonateAccount(config.multisigs.daoMultisig);
        protocolDao = await ethers.getSigner(config.multisigs.daoMultisig);

        const phase2 = await config.getPhase2(protocolDao);
        boosterOwner = phase2.boosterOwner;
        voterProxy = phase2.voterProxy;
        booster = phase2.booster;

        distributor = IFeeDistributor__factory.connect(newFeeDistro, protocolDao);
        bal = IERC20__factory.connect(config.addresses.token, protocolDao);
        feeToken = IERC20__factory.connect(config.addresses.feeToken, protocolDao);
    }
    before(async () => {
        await setup();
    });

    describe("update fee distro", () => {
        it("deposit tokens into new feeDistro", async () => {
            await impersonateAccount(balWhaleAddress);
            await impersonateAccount(config.addresses.feeTokenWhale);

            const balWhale = await ethers.getSigner(balWhaleAddress);
            const feeWhale = await ethers.getSigner(config.addresses.feeTokenWhale);

            const amount = simpleToExactAmount(100);

            await bal.connect(balWhale).approve(distributor.address, amount);
            await feeToken.connect(feeWhale).approve(distributor.address, amount);

            await distributor.connect(balWhale).depositToken(config.addresses.token, amount);
            await distributor.connect(feeWhale).depositToken(config.addresses.feeToken, amount);
        });
        it("update fee distro contracts", async () => {
            await boosterOwner.setFeeInfo(config.addresses.token, distributor.address);
            await boosterOwner.setFeeInfo(config.addresses.feeToken, distributor.address);
        });
        it("fast forward 1 week", async () => {
            await increaseTime(ONE_WEEK);
        });
        it("only voter proxy can claim rewards", async () => {
            const resp = distributor.claimToken(voterProxy.address, config.addresses.token);
            await expect(resp).to.be.revertedWith("BAL#401");
        });
        it("claim rewards via earmarkRewards", async () => {
            const feeDistro = await booster.feeTokens(bal.address);
            const balanceBefore = await bal.balanceOf(feeDistro.rewards);
            let balanceAfter = await bal.balanceOf(feeDistro.rewards);
            while (balanceAfter.sub(balanceBefore).eq(0)) {
                await booster.earmarkFees(bal.address);
                balanceAfter = await bal.balanceOf(feeDistro.rewards);
            }
            expect(balanceAfter.sub(balanceBefore)).gt(0);
        });
    });
    describe("update fee distro via claimFeesHelper", () => {
        let claimFeesHelper: ClaimFeesHelper;
        before(async () => {
            await setup();
        });
        it("deploy claims fees helper", async () => {
            claimFeesHelper = await new ClaimFeesHelper__factory(protocolDao).deploy(
                booster.address,
                voterProxy.address,
                newFeeDistro,
            );
        });
        it("deposit tokens into new feeDistro", async () => {
            await impersonateAccount(balWhaleAddress);
            await impersonateAccount(config.addresses.feeTokenWhale);

            const balWhale = await ethers.getSigner(balWhaleAddress);
            const feeWhale = await ethers.getSigner(config.addresses.feeTokenWhale);

            const amount = simpleToExactAmount(100);

            await bal.connect(balWhale).approve(distributor.address, amount);
            await feeToken.connect(feeWhale).approve(distributor.address, amount);

            await distributor.connect(balWhale).depositToken(config.addresses.token, amount);
            await distributor.connect(feeWhale).depositToken(config.addresses.feeToken, amount);
        });
        it("update fee distro contracts", async () => {
            await boosterOwner.setFeeInfo(config.addresses.token, distributor.address);
            await boosterOwner.setFeeInfo(config.addresses.feeToken, distributor.address);
        });

        it("claim rewards via claimFeesHelper", async () => {
            await increaseTime(ONE_WEEK);
            // BAL, BB-A-USD
            const tokens = [config.addresses.token, config.addresses.feeToken];
            const checkpoints = 10;

            const balFeeDistro = await booster.feeTokens(bal.address);
            const bbusdFeeDistro = await booster.feeTokens(feeToken.address);

            const balBalanceBefore = await bal.balanceOf(balFeeDistro.rewards);
            const bbusdBalanceBefore = await feeToken.balanceOf(bbusdFeeDistro.rewards);
            // Claim fees
            await claimFeesHelper.claimFees(tokens, checkpoints);

            // Expect the balance to change as fees should have send to feeDistro.rewards
            const balBalanceAfter = await bal.balanceOf(balFeeDistro.rewards);
            const bbusdBalanceAfter = await feeToken.balanceOf(bbusdFeeDistro.rewards);

            expect(balBalanceAfter.sub(balBalanceBefore)).gt(0);
            expect(bbusdBalanceAfter.sub(bbusdBalanceBefore)).gt(0);
        });
    });
});
