import { expect } from "chai";
import hre, { network, ethers } from "hardhat";
import { BigNumberish, Signer } from "ethers";

import {
    MockERC20,
    BaseRewardPool,
    SiphonGauge,
    SiphonDepositor,
    SiphonToken,
    BaseRewardPool__factory,
    RAura,
    MockERC20__factory,
    MockCurveVoteEscrow__factory,
    MockCurveVoteEscrow,
    SmartWalletChecker__factory,
    IERC20__factory,
    IERC20,
    L2Coordinator,
    BoosterLite,
    LZEndpointMock,
    LZEndpointMock__factory,
    PoolManagerV3,
} from "../types/generated";
import { Account } from "../types";
import { formatUnits } from "ethers/lib/utils";
import { config } from "../tasks/deploy/mainnet-config";
import { SystemDeployed } from "../scripts/deploySystem";
import { deployCrossChainL1, deployCrossChainL2, setUpCrossChainL2 } from "../scripts/deployCrossChain";
import { impersonate, impersonateAccount, increaseTime, ONE_WEEK, simpleToExactAmount } from "../test-utils";

const debug = false;

describe("Cross Chain Deposits", () => {
    const DST_CHAIN_ID = 123;

    let deployer: Signer;
    let deployerAddress: string;
    let lpWhale: Account;

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
    let l2Coordinator: L2Coordinator;
    let L2_booster: BoosterLite;
    let L2_rCvx: RAura;

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

        await getCrv(deployerAddress, simpleToExactAmount(5000));
        crvToken = MockERC20__factory.connect(config.addresses.token, deployer);

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

            const crossChainL1 = await deployCrossChainL1(
                {
                    siphondepositor: { pid },
                    rAura: { symbol: "rAURA" },
                    booster: contracts.booster.address,
                    cvxLocker: contracts.cvxLocker.address,
                    token: crvToken.address,
                    cvx: contracts.cvx.address,
                    lzEndpoint: lzEndpoint.address,
                    dstChainId: DST_CHAIN_ID,
                    penalty: 0,
                },
                deployer,
                hre,
                debug,
                0,
            );

            siphonToken = crossChainL1.siphonToken;
            siphonGauge = crossChainL1.siphonGauge;
            L1_rCvx = crossChainL1.rAura;
            siphonDepositor = crossChainL1.siphonDepositor;
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
        it("[L1] transfer ownership of rCVX to siphonDepositor", async () => {
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

    describe("deploy L2 BoosterLite/VoterProxy", () => {
        let veToken: MockCurveVoteEscrow;
        let lpToken: IERC20;
        let crvRewards: BaseRewardPool;
        let depositToken: IERC20;
        let L2_poolManager: PoolManagerV3;

        before(async () => {
            // deploy mocks
            const smartWalletChecker = await new SmartWalletChecker__factory(deployer).deploy();

            veToken = await new MockCurveVoteEscrow__factory(deployer).deploy(
                smartWalletChecker.address,
                config.addresses.tokenBpt,
            );

            const crossChainL2 = await deployCrossChainL2(
                {
                    siphonDepositor: siphonDepositor.address,
                    rAura: { symbol: "rAURA" },
                    lzEndpoint: lzEndpoint.address,
                    dstChainId: DST_CHAIN_ID,
                    minter: config.addresses.minter,
                    token: crvToken.address,
                    tokenBpt: config.addresses.tokenBpt,
                    votingEscrow: veToken.address,
                    gaugeController: config.addresses.gaugeController,
                    cvx: contracts.cvx.address,
                    voteOwnership: ethers.constants.AddressZero,
                    voteParameter: ethers.constants.AddressZero,
                    naming: {
                        tokenFactoryNamePostfix: config.naming.tokenFactoryNamePostfix,
                        cvxSymbol: config.naming.cvxSymbol,
                    },
                },
                deployer,
                hre,
                debug,
                0,
            );

            L2_rCvx = crossChainL2.rAura;
            l2Coordinator = crossChainL2.l2Coordinator;
            L2_booster = crossChainL2.booster;
            L2_poolManager = crossChainL2.poolManager;

            await setUpCrossChainL2({ l2Coordinator, siphonDepositor });
        });
        it("[L2] add a pool", async () => {
            const gaugeAddress = "0x34f33CDaED8ba0E1CEECE80e5f4a73bcf234cfac";
            // const lpTokenAddress = "0x06Df3b2bbB68adc8B0e302443692037ED9f91b42";

            await L2_poolManager["addPool(address)"](gaugeAddress);
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
        const incentivesPaidOnL2 = simpleToExactAmount(10);

        it("[L1] setup lzEndpoint mock", async () => {
            await lzEndpoint.setDestLzEndpoint(siphonDepositor.address, lzEndpoint.address);
            await lzEndpoint.setDestLzEndpoint(l2Coordinator.address, lzEndpoint.address);
        });
        it("[LZ] siphon CVX", async () => {
            // Siphon amount is the amount of incentives paid on L2
            // We will have to prefarm some amount of rAURA to kickstart
            // the reward pool for initial depositors. But finally siphon
            // will just be called from the L2 L2Coordinator.
            const rCvxBalBefore = await L2_rCvx.balanceOf(l2Coordinator.address);
            const crvBalBefore = await crvToken.balanceOf(siphonDepositor.address);
            console.log("Incentives paid on L2:", formatUnits(incentivesPaidOnL2));
            await siphonDepositor.siphon(incentivesPaidOnL2);
            const rCvxBalAfter = await L2_rCvx.balanceOf(l2Coordinator.address);
            const crvBalAfter = await crvToken.balanceOf(siphonDepositor.address);

            const rCvxBal = rCvxBalAfter.sub(rCvxBalBefore);
            console.log("rCVX balance of l2Coordinator:", formatUnits(rCvxBal));
            expect(rCvxBal).gt(0);

            const crvBal = crvBalAfter.sub(crvBalBefore);
            console.log("CRV balance of l2Coordinator:", formatUnits(crvBal));
        });
        it("[L1] claim CVX and CRV rewards", async () => {
            await increaseTime(ONE_WEEK);

            const crvBalBefore = await crvToken.balanceOf(siphonDepositor.address);
            const cvxBalBefore = await contracts.cvx.balanceOf(siphonDepositor.address);
            await siphonDepositor.getReward();
            const crvBalAfter = await crvToken.balanceOf(siphonDepositor.address);
            const cvxBalAfter = await contracts.cvx.balanceOf(siphonDepositor.address);

            const cvxBal = cvxBalAfter.sub(cvxBalBefore);
            const crvBal = crvBalAfter.sub(crvBalBefore);

            console.log("CVX balance:", formatUnits(cvxBal));
            console.log("CRV balance:", formatUnits(crvBal));

            // Calculate the expected amount of CRV we should receive
            // as rewards based on the amount of incentives paid
            const expectedCrvBalance = incentivesPaidOnL2
                .mul(await contracts.booster.FEE_DENOMINATOR())
                .div(
                    (await contracts.booster.lockIncentive())
                        .add(await contracts.booster.stakerIncentive())
                        .add(await contracts.booster.earmarkIncentive())
                        .add(await contracts.booster.platformFee()),
                )
                .sub(incentivesPaidOnL2);
            console.log("Expected CRV from incentives:", formatUnits(expectedCrvBalance));
            expect(Math.round(Number(expectedCrvBalance.div(1e9).toString()))).eq(
                Math.round(Number(crvBal.div(1e9).toString())),
            );
        });
    });

    describe("Claim rAura rewards and convert to L1 Aura", () => {
        it("[L2] claim rAURA rewards", async () => {
            // Transfer BAL rewards to the booster
            const balWhale = await impersonateAccount("0x5a52e96bacdabb82fd05763e25335261b270efcb");
            const bal = MockERC20__factory.connect(config.addresses.token, balWhale.signer);
            await bal.transfer(L2_booster.address, simpleToExactAmount(1));

            // Earmark booster rewards
            await L2_booster.earmarkRewards(0);
            await increaseTime(ONE_WEEK);

            const pool = await L2_booster.poolInfo(0);
            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);

            const balBefore = await L2_rCvx.balanceOf(lpWhale.address);
            await crvRewards.connect(lpWhale.signer)["getReward()"]();
            const balAfter = await L2_rCvx.balanceOf(lpWhale.address);
            const rCvxBal = balAfter.sub(balBefore);
            expect(rCvxBal).gt(0);

            console.log("rCVX balance:", formatUnits(rCvxBal));
        });
        it("[LZ] convert rAURA to AURA", async () => {
            const amountIn = simpleToExactAmount(10);
            const amountOut = await siphonDepositor.getAmountOut(amountIn);
            console.log("rCVX Amount In:", formatUnits(amountIn));
            console.log("CVX Amount out:", formatUnits(amountOut));

            const L2rAuraTotalSupplyBefore = await L2_rCvx.totalSupply();
            console.log("L2rCVX total supply:", formatUnits(L2rAuraTotalSupplyBefore));
            const cvxBalBefore = await contracts.cvx.balanceOf(lpWhale.address);

            await L2_rCvx.approve(siphonDepositor.address, ethers.constants.MaxUint256);
            await l2Coordinator.connect(lpWhale.signer).convert(amountIn, false);

            const L2rAuraTotalSupplyAfter = await L2_rCvx.totalSupply();
            console.log("L2rCVX total supply:", formatUnits(L2rAuraTotalSupplyAfter));
            const cvxBalAfter = await contracts.cvx.balanceOf(lpWhale.address);

            expect(L2rAuraTotalSupplyBefore.sub(L2rAuraTotalSupplyAfter)).eq(amountIn);

            const cvxBal = cvxBalAfter.sub(cvxBalBefore);
            expect(cvxBal).eq(amountOut);
            console.log("CVX rewards:", formatUnits(cvxBal));
        });
    });
});
