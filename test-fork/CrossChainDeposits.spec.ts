import { increaseTime } from "./../test-utils/time";
import { network, ethers } from "hardhat";
import { expect } from "chai";
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
    VoterProxy,
    VoterProxy__factory,
    BoosterLite__factory,
    BoosterLite,
    MockERC20__factory,
    RewardFactory__factory,
    RewardFactory,
    TokenFactory__factory,
    TokenFactory,
    ProxyFactory__factory,
    StashFactoryV2__factory,
    ExtraRewardStashV3__factory,
    ProxyFactory,
    ExtraRewardStashV3,
    StashFactoryV2,
    MockCurveVoteEscrow__factory,
    MockCurveVoteEscrow,
    SmartWalletChecker__factory,
    IERC20__factory,
    IERC20,
    RAuraDepositor,
    RAuraDepositor__factory,
} from "../types/generated";
import { BigNumberish, Signer } from "ethers";
import { waitForTx } from "../tasks/utils";
import { SystemDeployed } from "../scripts/deploySystem";
import { config } from "../tasks/deploy/mainnet-config";
import { impersonate, impersonateAccount, simpleToExactAmount, ONE_WEEK } from "../test-utils";
import { formatUnits } from "ethers/lib/utils";
import { Account } from "types";

const debug = true;

describe("Cross Chain", () => {
    describe("Deposits", () => {
        let deployer: Signer;
        let deployerAddress: string;
        let contracts: SystemDeployed;
        let siphonGauge: SiphonGauge;
        let siphonToken: SiphonToken;
        let siphonDepositor: SiphonDepositor;
        let crvToken: MockERC20;
        let pid: BigNumberish;
        let crvRewards: BaseRewardPool;
        let totalIncentiveAmount: BigNumberish;
        let rCvx: RAura;

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

            await getCrv(deployerAddress, simpleToExactAmount(5000));
            crvToken = MockERC20__factory.connect(config.addresses.token, deployer);

            siphonToken = await new SiphonToken__factory(deployer).deploy(deployerAddress, simpleToExactAmount(1));
            siphonGauge = await new SiphonGauge__factory(deployer).deploy(siphonToken.address);
            rCvx = await new RAura__factory(deployer).deploy("rAURA", "rAURA");

            pid = await contracts.booster.poolLength();
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
            const length = await contracts.booster.poolLength();
            await contracts.poolManager.connect(admin).forceAddPool(siphonToken.address, siphonGauge.address, 3);

            expect(length).eq(pid);

            const pool = await contracts.booster.poolInfo(pid);

            // save pool rewards
            crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);

            expect(pool.gauge).eq(siphonGauge.address);
            expect(pool.lptoken).eq(siphonToken.address);
        });
        it("deploy the siphonDepositor", async () => {
            const penalty = 0;
            siphonDepositor = await new SiphonDepositor__factory(deployer).deploy(
                siphonToken.address,
                crvToken.address,
                contracts.booster.address,
                contracts.cvx.address,
                rCvx.address,
                contracts.cvxLocker.address,
                pid,
                penalty,
            );
            // send it the siphon token
            await siphonToken.transfer(siphonDepositor.address, simpleToExactAmount(1));
        });
        it("transfer ownership of rCVX to siphonDepositor", async () => {
            await rCvx.transferOwnership(siphonDepositor.address);
            const newOwner = await rCvx.owner();
            expect(newOwner).eq(siphonDepositor.address);
        });
        it("deposit LP tokens into the pool", async () => {
            const bal = await siphonToken.balanceOf(siphonDepositor.address);
            await siphonDepositor.deposit();
            const rewardBal = await crvRewards.balanceOf(siphonDepositor.address);
            expect(rewardBal).eq(bal);
        });
        it("fund the siphonDepositor with BAL", async () => {
            const balance = await crvToken.balanceOf(config.multisigs.treasuryMultisig);
            console.log("Treasury CRV balance:", formatUnits(balance));

            const treasury = await impersonateAccount(config.multisigs.treasuryMultisig);
            await crvToken.connect(treasury.signer).transfer(siphonDepositor.address, balance);

            const siphonBalance = await crvToken.balanceOf(siphonDepositor.address);
            console.log("SiphonDepositor CRV balance:", formatUnits(siphonBalance));
            expect(siphonBalance).eq(balance);
        });
        it("siphon CVX", async () => {
            const FEE_DENOMINATOR = await contracts.booster.FEE_DENOMINATOR();
            const earmarkIncentive = await contracts.booster.earmarkIncentive();
            const stakerIncentive = await contracts.booster.stakerIncentive();
            const lockIncentive = await contracts.booster.lockIncentive();

            // Siphon amount is the amount of incentives paid on L2
            const incentivesPaidOnL2 = simpleToExactAmount(10);
            const siphonAmount = incentivesPaidOnL2.mul(10000).div(2500);

            const earmarkIncentiveAmount = siphonAmount.mul(earmarkIncentive).div(FEE_DENOMINATOR);
            const stakerIncentiveAmount = siphonAmount.mul(stakerIncentive).div(FEE_DENOMINATOR);
            const lockIncentiveAmount = siphonAmount.mul(lockIncentive).div(FEE_DENOMINATOR);
            totalIncentiveAmount = earmarkIncentiveAmount.add(stakerIncentiveAmount).add(lockIncentiveAmount);

            await siphonDepositor.siphon(incentivesPaidOnL2);

            const rewardBalance = await crvToken.balanceOf(crvRewards.address);
            expect(rewardBalance).eq(siphonAmount.sub(totalIncentiveAmount));

            const rCvxBalance = await rCvx.balanceOf(siphonDepositor.address);
            expect(rCvxBalance).eq(siphonAmount);
        });
        it("claim CVX and CRV into siphonDepositor", async () => {
            await increaseTime(ONE_WEEK);

            const crvBalBefore = await crvToken.balanceOf(siphonDepositor.address);
            const cvxBalBefore = await contracts.cvx.balanceOf(siphonDepositor.address);

            await siphonDepositor.getReward();

            const crvBalAfter = await crvToken.balanceOf(siphonDepositor.address);
            const cvxBalAfter = await contracts.cvx.balanceOf(siphonDepositor.address);

            const cvxBal = cvxBalAfter.sub(cvxBalBefore);
            const crvBal = crvBalAfter.sub(crvBalBefore);
            const farmedTotal = await contracts.cvx.balanceOf(siphonDepositor.address);

            console.log("CVX balance:", formatUnits(cvxBal));
            console.log("farmedTotal:", formatUnits(farmedTotal));
            expect(farmedTotal).eq(cvxBal);

            console.log("CRV balance:", formatUnits(crvBal));
            console.log("CRV debt:", formatUnits(totalIncentiveAmount));
        });
        it('send rCVX to the "bridge"', async () => {
            const amount = simpleToExactAmount(10);
            const balBefore = await rCvx.balanceOf(deployerAddress);
            await siphonDepositor.transferTokens(rCvx.address, deployerAddress, amount);
            const balAfter = await rCvx.balanceOf(deployerAddress);
            expect(balAfter.sub(balBefore)).eq(amount);
        });
        it("convert rAURA to AURA", async () => {
            const amountIn = simpleToExactAmount(10);
            const amountOut = await siphonDepositor.getAmountOut(amountIn);
            console.log("rCVX Amount In:", formatUnits(amountIn));
            console.log("CVX Amount out:", formatUnits(amountOut));

            const rCvxTotalBefore = await rCvx.totalSupply();
            await rCvx.approve(siphonDepositor.address, ethers.constants.MaxUint256);
            await siphonDepositor.convert(amountIn, false);
            const rCvxTotalAfter = await rCvx.totalSupply();

            const cvxBal = await contracts.cvx.balanceOf(deployerAddress);

            expect(rCvxTotalBefore.sub(rCvxTotalAfter)).eq(amountIn);
            expect(cvxBal).eq(amountOut);
        });
    });

    describe("L2 Booster/VoterProxy", () => {
        // TODO:
        const treasury = "0x0000000000000000000000000000000000000001";

        let deployer: Signer;
        let deployerAddress: string;
        let lpWhale: Account;

        let voterProxy: VoterProxy;
        let rAuraDepositor: RAuraDepositor;
        let booster: BoosterLite;
        let rewardFactory: RewardFactory;
        let tokenFactory: TokenFactory;
        let proxyFactory: ProxyFactory;
        let stashFactory: StashFactoryV2;
        let stash: ExtraRewardStashV3;
        let veToken: MockCurveVoteEscrow;
        let lpToken: IERC20;
        let crvRewards: BaseRewardPool;
        let depositToken: IERC20;
        let rAura: MockERC20;

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

            const signers = await ethers.getSigners();
            deployer = signers[0];
            deployerAddress = await deployer.getAddress();

            const lpWhaleAddress = "0xf346592803eb47cb8d8fa9f90b0ef17a82f877e0";
            lpWhale = await impersonateAccount(lpWhaleAddress);
        });

        describe("deployment", () => {
            it("deploy mocks", async () => {
                const smartWalletChecker = await new SmartWalletChecker__factory(deployer).deploy();

                veToken = await new MockCurveVoteEscrow__factory(deployer).deploy(
                    smartWalletChecker.address,
                    config.addresses.tokenBpt,
                );
            });
            it("deploy L2 rAURA", async () => {
                rAura = await new MockERC20__factory(deployer).deploy(
                    "name",
                    "symbol",
                    18,
                    deployerAddress,
                    simpleToExactAmount(1_000_000),
                );
                rAuraDepositor = await new RAuraDepositor__factory(deployer).deploy();
            });
            it("deploy voter proxy", async () => {
                voterProxy = await new VoterProxy__factory(deployer).deploy(
                    config.addresses.minter,
                    rAura.address,
                    config.addresses.tokenBpt,
                    veToken.address,
                    config.addresses.gaugeController,
                );
            });
            it("deploy booster", async () => {
                booster = await new BoosterLite__factory(deployer).deploy(
                    voterProxy.address,
                    rAuraDepositor.address,
                    config.addresses.token,
                    ethers.constants.AddressZero,
                    ethers.constants.AddressZero,
                );
            });
            it("deploy factories", async () => {
                // RewardFactory
                rewardFactory = await new RewardFactory__factory(deployer).deploy(
                    booster.address,
                    config.addresses.token,
                );
                // TokenFactory
                tokenFactory = await new TokenFactory__factory(deployer).deploy(booster.address, "postFix", "rAURA");
                // ProxyFactory
                proxyFactory = await new ProxyFactory__factory(deployer).deploy();
                // StashFactory
                stashFactory = await new StashFactoryV2__factory(deployer).deploy(
                    booster.address,
                    rewardFactory.address,
                    proxyFactory.address,
                );
                // StashV3
                stash = await new ExtraRewardStashV3__factory(deployer).deploy(config.addresses.token);
            });
            it("setup", async () => {
                await voterProxy.setOperator(booster.address);
                await booster.setPoolManager(deployerAddress);
                await booster.setFactories(rewardFactory.address, stashFactory.address, tokenFactory.address);
                await booster.setFees(550, 1100, 50, 0);
                await booster.setOwner(deployerAddress);
                await booster.setRewardContracts(treasury, treasury);
                await stashFactory.setImplementation(
                    ethers.constants.AddressZero,
                    ethers.constants.AddressZero,
                    stash.address,
                );
            });
            it("add a pool", async () => {
                const gaugeAddress = "0x34f33CDaED8ba0E1CEECE80e5f4a73bcf234cfac";
                const lpTokenAddress = "0x06Df3b2bbB68adc8B0e302443692037ED9f91b42";

                await booster.addPool(lpTokenAddress, gaugeAddress, 3);
                const info = await booster.poolInfo(0);

                lpToken = IERC20__factory.connect(info.lptoken, lpWhale.signer);
                crvRewards = BaseRewardPool__factory.connect(info.crvRewards, lpWhale.signer);
                depositToken = IERC20__factory.connect(info.token, lpWhale.signer);
            });
            it("depsit lp tokens", async () => {
                const amount = await lpToken.balanceOf(lpWhale.address);
                expect(amount).gt(0);
                await lpToken.approve(booster.address, amount);

                await booster.connect(lpWhale.signer).deposit(0, amount, true);

                const depositTokenBalance = await crvRewards.balanceOf(lpWhale.address);
                expect(depositTokenBalance).eq(amount);
            });
            it("claim rewards", async () => {
                const balWhale = await impersonateAccount("0x5a52e96bacdabb82fd05763e25335261b270efcb");
                const bal = MockERC20__factory.connect(config.addresses.token, balWhale.signer);

                await bal.transfer(booster.address, simpleToExactAmount(100));
                await booster.earmarkRewards(0);
                // const balBefore = await contracts.cvx.balanceOf(lpWhale.address);
                // await crvRewards["getReward()"]();
                // const balAfter = await contracts.cvx.balanceOf(lpWhale.address);
                // expect(balAfter).gt(balBefore);
            });
            it("widthdraw lp tokens", async () => {
                const amount = await crvRewards.balanceOf(lpWhale.address);
                await crvRewards.withdraw(amount, true);
                await depositToken.approve(booster.address, amount);

                await booster.connect(lpWhale.signer).withdraw(0, amount);

                const lpTokenBalance = await lpToken.balanceOf(lpWhale.address);
                expect(lpTokenBalance).eq(amount);
            });
        });
    });
});
