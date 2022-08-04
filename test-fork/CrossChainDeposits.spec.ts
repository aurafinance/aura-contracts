import { BaseRewardPool4626__factory } from "./../types/generated/factories/BaseRewardPool4626__factory";
import { increaseTime } from "./../test-utils/time";
import { MockERC20 } from "./../types/generated/MockERC20";
import { network } from "hardhat";
import { expect } from "chai";
import {
    DummyGauge__factory,
    DummyGauge,
    MockERC20__factory,
    SiphonToken,
    SiphonToken__factory,
} from "../types/generated";
import { impersonate, impersonateAccount, simpleToExactAmount, ONE_DAY, ZERO_KEY, BN, ONE_WEEK } from "../test-utils";
import { Signer } from "ethers";
import { waitForTx } from "../tasks/utils";
import { SystemDeployed } from "../scripts/deploySystem";
import { config } from "../tasks/deploy/mainnet-config";

const debug = true;

describe("Full Deployment", () => {
    let deployer: Signer;
    let deployerAddress: string;
    let phase4: SystemDeployed;
    let dummyGauge: DummyGauge;
    let dummyToken: SiphonToken;
    let crvToken: MockERC20;
    let pid: BN;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15271655,
                    },
                },
            ],
        });
        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        deployer = await impersonate(deployerAddress);
        phase4 = await config.getPhase4(deployer);

        dummyToken = await new SiphonToken__factory(deployer).deploy(deployerAddress, simpleToExactAmount(1));
        dummyGauge = await new DummyGauge__factory(deployer).deploy(dummyToken.address);

        await getCrv(deployerAddress, simpleToExactAmount(5000));
        crvToken = await MockERC20__factory.connect(config.addresses.token, deployer);

        pid = await phase4.booster.poolLength();
    });

    const getCrv = async (recipient: string, amount = simpleToExactAmount(250)) => {
        await getEth(config.addresses.balancerVault);

        const tokenWhaleSigner = await impersonateAccount(config.addresses.balancerVault);
        const crv = MockERC20__factory.connect(config.addresses.token, tokenWhaleSigner.signer);
        const tx = await crv.transfer(recipient, amount);
        await waitForTx(tx, debug);
    };

    const getEth = async (recipient: string) => {
        const ethWhale = await impersonate(config.addresses.weth);
        await ethWhale.sendTransaction({
            to: recipient,
            value: simpleToExactAmount(1),
        });
    };

    it("adds the gauge", async () => {
        const admin = await impersonate(config.multisigs.daoMultisig);

        await phase4.poolManager.connect(admin).forceAddPool(dummyToken.address, dummyGauge.address, 3);

        await crvToken.transfer(phase4.booster.address, simpleToExactAmount(5000));

        const poolInfo = await phase4.booster.poolInfo(pid);

        const balanceBefore = await crvToken.balanceOf(poolInfo.crvRewards);
        await phase4.booster.earmarkRewards(pid);
        const balanceAfter = await crvToken.balanceOf(poolInfo.crvRewards);

        expect(balanceAfter.sub(balanceBefore)).eq(simpleToExactAmount(5000).mul(805).div(1000));
    });
    it("allows deposits and claiming", async () => {
        await dummyToken.approve(phase4.booster.address, simpleToExactAmount(1));
        await phase4.booster.deposit(pid, simpleToExactAmount(1), true);

        await increaseTime(ONE_WEEK);

        const poolInfo = await phase4.booster.poolInfo(pid);

        const crvBefore = await crvToken.balanceOf(deployerAddress);
        const cvxBefore = await phase4.cvx.balanceOf(deployerAddress);
        await BaseRewardPool4626__factory.connect(poolInfo.crvRewards, deployer)["getReward()"]();
        const crvAfter = await crvToken.balanceOf(deployerAddress);
        const cvxAfter = await phase4.cvx.balanceOf(deployerAddress);

        expect(crvAfter.sub(crvBefore)).gt(simpleToExactAmount(5000).mul(800).div(1000));
        expect(cvxAfter.sub(cvxBefore)).gt(0);
    });
});
