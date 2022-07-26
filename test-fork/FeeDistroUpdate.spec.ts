import { ethers, network } from "hardhat";
import { expect } from "chai";
import {
    Booster,
    BoosterOwner,
    IERC20,
    IERC20__factory,
    IFeeDistributor,
    IFeeDistributor__factory,
    VoterProxy,
} from "../types/generated";
import { impersonateAccount, increaseTime, ONE_DAY, ONE_WEEK, simpleToExactAmount } from "../test-utils";
import { Signer } from "ethers";
import { config } from "../tasks/deploy/mainnet-config";
import { _TypedDataEncoder } from "ethers/lib/utils";

const newFeeDistro = "0xD3cf852898b21fc233251427c2DC93d3d604F3BB";

describe("FeeDistroUpdate", () => {
    let protocolDao: Signer;
    let boosterOwner: BoosterOwner;
    let distributor: IFeeDistributor;
    let voterProxy: VoterProxy;
    let bal: IERC20;
    let feeToken: IERC20;
    let booster: Booster;

    before(async () => {
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
    });

    describe("update fee distro", () => {
        it("deposit tokens into new feeDistro", async () => {
            const balWhaleAddress = "0xcEacc82ddCdB00BFE19A9D3458db3e6b8aEF542B";

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
            await boosterOwner.setFeeInfo(config.addresses.token, newFeeDistro);
            await boosterOwner.setFeeInfo(config.addresses.feeToken, newFeeDistro);
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
});
