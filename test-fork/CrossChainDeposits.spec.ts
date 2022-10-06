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
    DummyBridge,
    DummyBridge__factory,
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
import { deployContract } from "../tasks/utils";

const debug = false;
/**
 * How all this hangs together?
 *
 * 1.   Set up Siphon pools on the L1 Booster
 * 1.1. Create a pool with a fake gauge and fake lp token
 * 1.2. Deposit fake lp token from SiphonDepositor into pool
 * 1.3. Fund the siphon depositor with BAL tokens
 *
 * 2.   Pre farm AURA from the L1 and send it the the L2
 * 2.1  Call farm on SiphonDepositor. This sends BAL to the Booster and calls
 *      earmarkRewars to queue up a prorata rate of AURA
 * 2.2  After the reward period has passed call getRewards to return BAL - incentives
 *      and the prorata rate of AURA
 *
 * 3.   Claim AURA rewards on the L2
 * 3.1  Earmark rewards is called to queue AURA and BAL rewards
 * 3.2  The BAL incentives are sent to the L2 coordinator
 * 3.3  Flush is called on the L2 coordinator which triggers:
 *      - BAL rewards to be send to the bridge delegate and then trigger the bridge
 *        to send them back to L1
 *      - Siphon message sent back to the L1 to trigger AURA tokens to be sent back to
 *        The L2 to conver the new pending rewards there.
 *
 * 4.   User can Bridge/Lock back to the L1
 * 4.1  Calling lock on l2 coordinator locks your AURA on L1
 * 4.2  Calling sendFrom on l2 coordinator sends your AURA to L1
 */
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
                    siphonDepositor: { pid },
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
            await siphonDepositor.setApprovals();
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
            console.log("CRV balance of siphonDepositor:", formatUnits(crvBal));
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
        let dummyBridge: DummyBridge;
        // Deploy a dummy bridge to bridge the BAL back to the L1
        // contract. SiphonDepositor will receive the BAL and settle
        // the debt for that l2
        it("Deploy dummy bridge", async () => {
            dummyBridge = await deployContract(hre, new DummyBridge__factory(deployer), "DummyBridge", [
                siphonDepositor.address,
                crvToken.address,
                CHAIN_ID,
            ]);

            await l2Coordinator.setBridgeDelegate(dummyBridge.address);
            await siphonDepositor.setBridgeDelegate(CHAIN_ID, dummyBridge.address);
        });
        it("Earmark rewards", async () => {
            // Transfer BAL rewards to the booster
            const crvWhale = await impersonateAccount("0x5a52e96bacdabb82fd05763e25335261b270efcb");
            await crvToken.connect(crvWhale.signer).transfer(L2_booster.address, simpleToExactAmount(1));

            // Earmark booster rewards
            await L2_booster.earmarkRewards(0);
            await increaseTime(ONE_WEEK);
        });
        it("Bridge BAL to L1 to repay debt", async () => {
            // TODO: check L1 siphonDepositor now has CRV
            const crvBalBefore = await crvToken.balanceOf(l2Coordinator.address);
            console.log("CRV balance (before):", formatUnits(crvBalBefore));

            const totalRewards = await l2Coordinator.totalRewards();
            console.log("Total rewards:", formatUnits(totalRewards));
            await l2Coordinator.flush(totalRewards);

            const crvBalAfter = await crvToken.balanceOf(l2Coordinator.address);
            console.log("CRV balance (after):", formatUnits(crvBalBefore));

            expect(crvBalBefore.sub(crvBalAfter)).eq(totalRewards);
        });
        it("[LZ] claim AURA rewards", async () => {
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
        it("[LZ] retry failed lock back to the L1", async () => {
            const l2balBefore = await l2Coordinator.balanceOf(lpWhale.address);
            const lockAmount = l2balBefore.mul(100).div(1000);
            const lockBefore = await contracts.cvxLocker.userLocks(lpWhale.address, 0);

            // Force the transaction to fail by changing the code stored at cvxLocker
            // and then reset it afterwards so we can process the retry
            const code = await network.provider.send("eth_getCode", [contracts.cvxLocker.address]);
            await network.provider.send("hardhat_setCode", [contracts.cvxLocker.address, MockERC20__factory.bytecode]);
            const tx = await l2Coordinator.connect(lpWhale.signer).lock(lockAmount);
            await network.provider.send("hardhat_setCode", [contracts.cvxLocker.address, code]);

            const resp = await tx.wait();
            const event = resp.events.find(event => event.event === "MessageFailed");

            await siphonDepositor.retryMessage(
                event.args._srcChainId,
                event.args._srcAddress,
                event.args._nonce,
                event.args._payload,
            );

            expect(await l2Coordinator.balanceOf(lpWhale.address)).eq(l2balBefore.sub(lockAmount));

            const lockAfter = await contracts.cvxLocker.userLocks(lpWhale.address, 0);
            expect(lockAfter.amount.sub(lockBefore.amount)).eq(lockAmount);

            const l2balAfter = await l2Coordinator.balanceOf(lpWhale.address);
            expect(l2balBefore.sub(l2balAfter)).eq(lockAmount);
        });
    });
});
