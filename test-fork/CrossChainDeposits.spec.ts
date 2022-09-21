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
    PoolManagerLite,
} from "../types/generated";
import { Account } from "../types";
import { formatUnits } from "ethers/lib/utils";
import { config } from "../tasks/deploy/mainnet-config";
import { SystemDeployed } from "../scripts/deploySystem";
import { deployCrossChainL1, deployCrossChainL2 } from "../scripts/deployCrossChain";
import {
    impersonate,
    impersonateAccount,
    increaseTime,
    ONE_WEEK,
    simpleToExactAmount,
    ZERO_ADDRESS,
} from "../test-utils";

const debug = false;

describe("Cross Chain Deposits", () => {
    const CHAIN_ID = 123;

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

    // L2 contracts
    let l2Coordinator: L2Coordinator;
    let L2_booster: BoosterLite;

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
            lzEndpoint = await new LZEndpointMock__factory(deployer).deploy(CHAIN_ID);
        });
    });

    describe("deploy L2 BoosterLite/VoterProxy", () => {
        let veToken: MockCurveVoteEscrow;
        let lpToken: IERC20;
        let crvRewards: BaseRewardPool;
        let depositToken: IERC20;
        let L2_poolManager: PoolManagerLite;

        before(async () => {
            // deploy mocks
            const smartWalletChecker = await new SmartWalletChecker__factory(deployer).deploy();

            veToken = await new MockCurveVoteEscrow__factory(deployer).deploy(
                smartWalletChecker.address,
                config.addresses.tokenBpt,
            );

            const crossChainL2 = await deployCrossChainL2(
                {
                    canonicalChainId: CHAIN_ID,
                    lzEndpoint: lzEndpoint.address,
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
                        cvxName: config.naming.cvxName,
                    },
                },
                deployer,
                hre,
                debug,
                0,
            );

            l2Coordinator = crossChainL2.l2Coordinator;
            L2_booster = crossChainL2.booster;
            L2_poolManager = crossChainL2.poolManager;
        });
        it("[L2] add a pool", async () => {
            const gaugeAddress = "0x34f33CDaED8ba0E1CEECE80e5f4a73bcf234cfac";
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

    describe("Create siphon pool on L1", () => {
        let pid: BigNumberish;
        let crvRewards: BaseRewardPool;

        before(async () => {
            pid = await contracts.booster.poolLength();

            const crossChainL1 = await deployCrossChainL1(
                {
                    l2Coordinator: l2Coordinator.address,
                    siphondepositor: { pid },
                    booster: contracts.booster.address,
                    cvxLocker: contracts.cvxLocker.address,
                    token: crvToken.address,
                    cvx: contracts.cvx.address,
                    lzEndpoint: lzEndpoint.address,
                },
                deployer,
                hre,
                debug,
                0,
            );

            siphonToken = crossChainL1.siphonToken;
            siphonGauge = crossChainL1.siphonGauge;
            siphonDepositor = crossChainL1.siphonDepositor;
        });

        it("[LZ] set up trusted remotes", async () => {
            await siphonDepositor.setTrustedRemote(CHAIN_ID, l2Coordinator.address);
            await l2Coordinator.setTrustedRemote(CHAIN_ID, siphonDepositor.address);

            await lzEndpoint.setDestLzEndpoint(siphonDepositor.address, lzEndpoint.address);
            await lzEndpoint.setDestLzEndpoint(l2Coordinator.address, lzEndpoint.address);
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

    describe("Siphon AURA to L2", () => {
        const farmAmount = simpleToExactAmount(100);

        it("[LZ] siphon CVX", async () => {
            // Siphon amount is the amount of incentives paid on L2
            // We will have to prefarm some amount of AURA to kickstart
            // the reward pool for initial depositors. But finally siphon
            // will just be called from the L2 L2Coordinator.
            const crvBalBefore = await crvToken.balanceOf(siphonDepositor.address);
            console.log("Farming CRV amount:", formatUnits(farmAmount));
            await siphonDepositor.farm(farmAmount);
            const crvBalAfter = await crvToken.balanceOf(siphonDepositor.address);

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

            const incentives = farmAmount
                .mul(
                    (await contracts.booster.lockIncentive())
                        .add(await contracts.booster.stakerIncentive())
                        .add(await contracts.booster.earmarkIncentive())
                        .add(await contracts.booster.platformFee()),
                )
                .div(await contracts.booster.FEE_DENOMINATOR());

            const expecteCrvBal = farmAmount.sub(incentives);

            expect(Math.round(Number(expecteCrvBal.div("1000000000000000000").toString()))).eq(
                Math.round(Number(crvBal.div("1000000000000000000").toString())),
            );
        });
    });

    describe("Claim Aura rewards and convert to L1 Aura", () => {
        it("[L2] claim AURA rewards", async () => {
            // Transfer BAL rewards to the booster
            const balWhale = await impersonateAccount("0x5a52e96bacdabb82fd05763e25335261b270efcb");
            const bal = MockERC20__factory.connect(config.addresses.token, balWhale.signer);
            await bal.transfer(L2_booster.address, simpleToExactAmount(1));

            // Earmark booster rewards
            await L2_booster.earmarkRewards(0);
            await increaseTime(ONE_WEEK);

            const pool = await L2_booster.poolInfo(0);
            const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);

            const balBefore = await l2Coordinator.balanceOf(lpWhale.address);
            await crvRewards.connect(lpWhale.signer)["getReward()"]();
            const balAfter = await l2Coordinator.balanceOf(lpWhale.address);
            const cvxBal = balAfter.sub(balBefore);
            expect(cvxBal).gt(0);

            console.log("CVX balance:", formatUnits(cvxBal));
        });
        it("bridge back to the L1", async () => {
            const l2balBefore = await l2Coordinator.balanceOf(lpWhale.address);
            const sendAmount = l2balBefore.mul(100).div(1000);
            const toAddress = "0x0000000000000000000000000000000000000020";
            await l2Coordinator
                .connect(lpWhale.signer)
                .sendFrom(lpWhale.address, CHAIN_ID, toAddress, sendAmount, lpWhale.address, ZERO_ADDRESS, []);
            const l1bal = await contracts.cvx.balanceOf(toAddress);
            expect(l1bal).eq(sendAmount);

            const l2balAfter = await l2Coordinator.balanceOf(lpWhale.address);
            expect(l2balBefore.sub(l2balAfter)).eq(sendAmount);
        });
        it("[LZ] lock back to the L1", async () => {
            const l2balBefore = await l2Coordinator.balanceOf(lpWhale.address);
            const lockAmount = l2balBefore.mul(100).div(1000);
            await l2Coordinator.connect(lpWhale.signer).lock(lockAmount);
            expect(await l2Coordinator.balanceOf(lpWhale.address)).eq(l2balBefore.sub(lockAmount));

            const lock = await contracts.cvxLocker.userLocks(lpWhale.address, 0);
            expect(lock.amount).eq(lockAmount);

            const l2balAfter = await l2Coordinator.balanceOf(lpWhale.address);
            expect(l2balBefore.sub(l2balAfter)).eq(lockAmount);
        });
    });
});
