import { expect } from "chai";
import { network, ethers } from "hardhat";
import { BigNumberish, Signer } from "ethers";

import {
    MockERC20,
    BaseRewardPool,
    SiphonGauge__factory,
    SiphonGauge,
    SiphonDepositor,
    SiphonDepositor__factory,
    SiphonToken,
    SiphonToken__factory,
    BaseRewardPool__factory,
    RAura__factory,
    RAura,
    VoterProxy__factory,
    MockERC20__factory,
    RewardFactory__factory,
    TokenFactory__factory,
    ProxyFactory__factory,
    StashFactoryV2__factory,
    ExtraRewardStashV3__factory,
    MockCurveVoteEscrow__factory,
    MockCurveVoteEscrow,
    SmartWalletChecker__factory,
    IERC20__factory,
    IERC20,
    SiphonReceiver,
    SiphonReceiver__factory,
    Booster__factory,
    Booster,
    LZEndpointMock,
    LZEndpointMock__factory,
} from "../types/generated";
import { Account } from "../types";
import { formatUnits } from "ethers/lib/utils";
import { config } from "../tasks/deploy/mainnet-config";
import { SystemDeployed } from "../scripts/deploySystem";
import { impersonate, impersonateAccount, increaseTime, ONE_WEEK, simpleToExactAmount } from "../test-utils";

describe("Cross Chain Deposits", () => {
    let deployer: Signer;
    let deployerAddress: string;
    let lpWhale: Account;

    // let totalIncentiveAmount: BigNumberish;

    // Bridge contract
    let lzEndpoint: LZEndpointMock;

    // L1 contracts
    let siphonGauge: SiphonGauge;
    let siphonToken: SiphonToken;
    let siphonDepositor: SiphonDepositor;

    let contracts: SystemDeployed;
    let crvToken: MockERC20;
    let L1_rCvx: RAura;

    // L2 contracts
    let siphonReceiver: SiphonReceiver;
    let L2_booster: Booster;
    let L2_rAura: RAura;

    const getCrv = async (recipient: string, amount = simpleToExactAmount(250)) => {
        await getEth(config.addresses.balancerVault);

        const tokenWhaleSigner = await impersonateAccount(config.addresses.balancerVault);
        const crv = MockERC20__factory.connect(config.addresses.token, tokenWhaleSigner.signer);
        await crv.transfer(recipient, amount);
    };

    const getEth = async (recipient: string) => {
        const ethWhale = await impersonate(config.addresses.weth);
        await ethWhale.sendTransaction({
            to: recipient,
            value: simpleToExactAmount(1),
        });
    };

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

        contracts = await config.getPhase4(deployer);
        crvToken = MockERC20__factory.connect(config.addresses.token, deployer);
        siphonToken = await new SiphonToken__factory(deployer).deploy(deployerAddress, simpleToExactAmount(1));
        siphonGauge = await new SiphonGauge__factory(deployer).deploy(siphonToken.address);
        L1_rCvx = await new RAura__factory(deployer).deploy("rAURA", "rAURA");

        await getCrv(deployerAddress, simpleToExactAmount(5000));

        const lpWhaleAddress = "0xf346592803eb47cb8d8fa9f90b0ef17a82f877e0";
        lpWhale = await impersonateAccount(lpWhaleAddress);
    });

    describe("deploy mock LZ endpoint", () => {
        it("deploy", async () => {
            const CHAIN_ID = 123;
            lzEndpoint = await new LZEndpointMock__factory(deployer).deploy(CHAIN_ID);
        });
    });

    describe("Create siphon pool on L1", () => {
        let pid: BigNumberish;
        let crvRewards: BaseRewardPool;

        before(async () => {
            pid = await contracts.booster.poolLength();
        });

        it("[L1] adds the gauge", async () => {
            const admin = await impersonate(config.multisigs.daoMultisig);
            const length = await contracts.booster.poolLength();
            await contracts.poolManager.connect(admin).forceAddPool(siphonToken.address, siphonGauge.address, 3);

            expect(length).eq(pid);

            const pool = await contracts.booster.poolInfo(pid);

            // save pool rewards
            crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);

            expect(pool.gauge).eq(siphonGauge.address);
            expect(pool.lptoken).eq(siphonToken.address);
        });
        it("[L1] deploy the siphonDepositor", async () => {
            const penalty = 0;
            siphonDepositor = await new SiphonDepositor__factory(deployer).deploy(
                siphonToken.address,
                crvToken.address,
                contracts.booster.address,
                contracts.cvx.address,
                L1_rCvx.address,
                contracts.cvxLocker.address,
                lzEndpoint.address,
                pid,
                penalty,
            );
            // send it the siphon token
            await siphonToken.transfer(siphonDepositor.address, simpleToExactAmount(1));
        });
        it("[L1] transfer ownership of rCVX to siphonDepositor", async () => {
            await L1_rCvx.transferOwnership(siphonDepositor.address);
            const newOwner = await L1_rCvx.owner();
            expect(newOwner).eq(siphonDepositor.address);
        });
        it("[L1] deposit LP tokens into the pool", async () => {
            const bal = await siphonToken.balanceOf(siphonDepositor.address);
            await siphonDepositor.deposit();
            const rewardBal = await crvRewards.balanceOf(siphonDepositor.address);
            expect(rewardBal).eq(bal);
        });
        it("[L1] fund the siphonDepositor with BAL", async () => {
            const balance = await crvToken.balanceOf(config.multisigs.treasuryMultisig);
            console.log("Treasury CRV balance:", formatUnits(balance));

            const treasury = await impersonateAccount(config.multisigs.treasuryMultisig);
            await crvToken.connect(treasury.signer).transfer(siphonDepositor.address, balance);

            const siphonBalance = await crvToken.balanceOf(siphonDepositor.address);
            console.log("SiphonDepositor CRV balance:", formatUnits(siphonBalance));
            expect(siphonBalance).eq(balance);
        });
    });

    describe("deploy L2 Booster/VoterProxy", () => {
        let veToken: MockCurveVoteEscrow;
        let lpToken: IERC20;
        let crvRewards: BaseRewardPool;
        let depositToken: IERC20;

        it("[L2] deploy mocks", async () => {
            const smartWalletChecker = await new SmartWalletChecker__factory(deployer).deploy();

            veToken = await new MockCurveVoteEscrow__factory(deployer).deploy(
                smartWalletChecker.address,
                config.addresses.tokenBpt,
            );
        });
        it("[L2] deploy rAURA", async () => {
            L2_rAura = await new RAura__factory(deployer).deploy("rAURA", "rAURA");
            siphonReceiver = await new SiphonReceiver__factory(deployer).deploy(
                lzEndpoint.address,
                siphonDepositor.address,
                L2_rAura.address,
            );
            await siphonDepositor.setL2SiphonReceiver(siphonReceiver.address);
            await L2_rAura.transferOwnership(siphonReceiver.address);
        });
        it("[L2] deploy booster and voter proxy", async () => {
            const voterProxy = await new VoterProxy__factory(deployer).deploy(
                config.addresses.minter,
                config.addresses.token,
                config.addresses.tokenBpt,
                veToken.address,
                config.addresses.gaugeController,
            );

            L2_booster = await new Booster__factory(deployer).deploy(
                voterProxy.address,
                siphonReceiver.address,
                config.addresses.token,
                ethers.constants.AddressZero,
                ethers.constants.AddressZero,
            );
            // Setup
            await voterProxy.setOperator(L2_booster.address);
            await L2_booster.setPoolManager(deployerAddress);
            await L2_booster.setFees(550, 1100, 50, 0);
            await L2_booster.setOwner(deployerAddress);
            await L2_booster.setRewardContracts(siphonReceiver.address, siphonReceiver.address);
            await siphonReceiver.setBooster(L2_booster.address);
        });
        it("[L2] deploy factories", async () => {
            // RewardFactory
            const rewardFactory = await new RewardFactory__factory(deployer).deploy(
                L2_booster.address,
                config.addresses.token,
            );
            // TokenFactory
            const tokenFactory = await new TokenFactory__factory(deployer).deploy(
                L2_booster.address,
                "postFix",
                "rAURA",
            );
            // ProxyFactory
            const proxyFactory = await new ProxyFactory__factory(deployer).deploy();
            // StashFactory
            const stashFactory = await new StashFactoryV2__factory(deployer).deploy(
                L2_booster.address,
                rewardFactory.address,
                proxyFactory.address,
            );
            // StashV3
            const stash = await new ExtraRewardStashV3__factory(deployer).deploy(config.addresses.token);
            // Setup
            await L2_booster.setFactories(rewardFactory.address, stashFactory.address, tokenFactory.address);
            await stashFactory.setImplementation(
                ethers.constants.AddressZero,
                ethers.constants.AddressZero,
                stash.address,
            );
        });
        it("[L2] add a pool", async () => {
            const gaugeAddress = "0x34f33CDaED8ba0E1CEECE80e5f4a73bcf234cfac";
            const lpTokenAddress = "0x06Df3b2bbB68adc8B0e302443692037ED9f91b42";

            await L2_booster.addPool(lpTokenAddress, gaugeAddress, 3);
            const info = await L2_booster.poolInfo(0);

            lpToken = IERC20__factory.connect(info.lptoken, lpWhale.signer);
            crvRewards = BaseRewardPool__factory.connect(info.crvRewards, lpWhale.signer);
            depositToken = IERC20__factory.connect(info.token, lpWhale.signer);
        });
        it("[L2] depsit lp tokens", async () => {
            const amount = await lpToken.balanceOf(lpWhale.address);
            expect(amount).gt(0);
            await lpToken.approve(L2_booster.address, amount);

            await L2_booster.connect(lpWhale.signer).deposit(0, amount, true);

            const depositTokenBalance = await crvRewards.balanceOf(lpWhale.address);
            expect(depositTokenBalance).eq(amount);
        });
        it("[L2] widthdraw lp tokens", async () => {
            const amount = simpleToExactAmount(1);
            await crvRewards.withdraw(amount, true);
            await depositToken.approve(L2_booster.address, amount);

            await L2_booster.connect(lpWhale.signer).withdraw(0, amount);

            const lpTokenBalance = await lpToken.balanceOf(lpWhale.address);
            expect(lpTokenBalance).eq(amount);
        });
    });

    describe("Siphon rAURA to L2", () => {
        it("[L1] setup lzEndpoint mock", async () => {
            await lzEndpoint.setDestLzEndpoint(siphonDepositor.address, lzEndpoint.address);
            await lzEndpoint.setDestLzEndpoint(siphonReceiver.address, lzEndpoint.address);
        });
        it("[L1] siphon CVX", async () => {
            // Siphon amount is the amount of incentives paid on L2
            // We will have to prefarm some amount of rAURA to kickstart
            // the reward pool for initial depositors. But finally siphon
            // will just be called from the L2 SiphonReceiver.
            const balBefore = await L2_rAura.balanceOf(siphonReceiver.address);
            const incentivesPaidOnL2 = simpleToExactAmount(10);
            await siphonDepositor.siphon(incentivesPaidOnL2);
            const balAfter = await L2_rAura.balanceOf(siphonReceiver.address);
            expect(balAfter.sub(balBefore)).gt(0);
        });
        // it("[L1] claim CVX and CRV rewards", async () => {
        //     await increaseTime(ONE_WEEK);
        //     const crvBalBefore = await crvToken.balanceOf(siphonDepositor.address);
        //     const cvxBalBefore = await contracts.cvx.balanceOf(siphonDepositor.address);
        //     await siphonDepositor.getReward();
        //     const crvBalAfter = await crvToken.balanceOf(siphonDepositor.address);
        //     const cvxBalAfter = await contracts.cvx.balanceOf(siphonDepositor.address);
        //     const cvxBal = cvxBalAfter.sub(cvxBalBefore);
        //     const crvBal = crvBalAfter.sub(crvBalBefore);
        //     const farmedTotal = await contracts.cvx.balanceOf(siphonDepositor.address);
        //     console.log("CVX balance:", formatUnits(cvxBal));
        //     console.log("farmedTotal:", formatUnits(farmedTotal));
        //     expect(farmedTotal).eq(cvxBal);
        //     console.log("CRV balance:", formatUnits(crvBal));
        //     console.log("CRV debt:", formatUnits(totalIncentiveAmount));
        // });
        // it('[L2] send rCVX to the "bridge"', async () => {
        //     const amount = simpleToExactAmount(10);
        //     const balBefore = await L1_rCvx.balanceOf(deployerAddress);
        //     await siphonDepositor.transferTokens(L1_rCvx.address, deployerAddress, amount);
        //     const balAfter = await L1_rCvx.balanceOf(deployerAddress);
        //     expect(balAfter.sub(balBefore)).eq(amount);
        // });
    });

    describe("Claim rAura rewards and convert to L1 Aura", () => {
        it("claim rAURA rewards", async () => {
            // Transfer BAL rewards to the booster
            const balWhale = await impersonateAccount("0x5a52e96bacdabb82fd05763e25335261b270efcb");
            const bal = MockERC20__factory.connect(config.addresses.token, balWhale.signer);
            await bal.transfer(L2_booster.address, simpleToExactAmount(1));

            // Earmark booster rewards
            await L2_booster.earmarkRewards(0);
            await increaseTime(ONE_WEEK);

            const pool = await L2_booster.poolInfo(0);
            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);

            const balBefore = await L2_rAura.balanceOf(lpWhale.address);
            await crvRewards.connect(lpWhale.signer)["getReward()"]();
            const balAfter = await L2_rAura.balanceOf(lpWhale.address);
            expect(balAfter).gt(balBefore);
        });
        // it("convert rAURA to AURA", async () => {
        //     const amountIn = simpleToExactAmount(10);
        //     const amountOut = await siphonDepositor.getAmountOut(amountIn);
        //     console.log("rCVX Amount In:", formatUnits(amountIn));
        //     console.log("CVX Amount out:", formatUnits(amountOut));
        //     const L1RCvxTotalBefore = await L1_rCvx.totalSupply();
        //     await L1_rCvx.approve(siphonDepositor.address, ethers.constants.MaxUint256);
        //     await siphonDepositor.convert(amountIn, false);
        //     const L1RCvxTotalAfter = await L1_rCvx.totalSupply();
        //     const cvxBal = await contracts.cvx.balanceOf(deployerAddress);
        //     expect(L1RCvxTotalBefore.sub(L1RCvxTotalAfter)).eq(amountIn);
        //     expect(cvxBal).eq(amountOut);
        // });
    });
});
