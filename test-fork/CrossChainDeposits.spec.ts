import { expect } from "chai";
import hre, { network } from "hardhat";
import { BigNumberish, Signer } from "ethers";

import {
    MockERC20,
    BaseRewardPool,
    SiphonGauge,
    SiphonDepositor,
    SiphonToken,
    BaseRewardPool__factory,
    MockERC20__factory,
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

const nativeFee = simpleToExactAmount("0.1");
describe("Cross Chain Deposits", () => {
    const L1_CHAIN_ID = 111;
    const L2_CHAIN_ID = 222;

    let deployer: Signer;
    let deployerAddress: string;
    let lpWhale: Account;

    // Bridge contract
    let l1LzEndpoint: LZEndpointMock;
    let l2LzEndpoint: LZEndpointMock;

    // L1 contracts
    let siphonGauge: SiphonGauge;
    let siphonToken: SiphonToken;
    let siphonDepositor: SiphonDepositor;
    let dummyBridge: DummyBridge;

    let contracts: SystemDeployed;
    let crvToken: MockERC20;
    let crvRewards: BaseRewardPool;

    // L2 contracts
    let l2Coordinator: L2Coordinator;
    let L2_booster: BoosterLite;

    const getCvx = async (recipient: string, amount = simpleToExactAmount(250)) => {
        await getEth(config.multisigs.treasuryMultisig);

        const tokenWhaleSigner = await impersonateAccount(config.multisigs.treasuryMultisig);
        await contracts.cvx.connect(tokenWhaleSigner.signer).transfer(recipient, amount);
    };

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
            l1LzEndpoint = await new LZEndpointMock__factory(deployer).deploy(L1_CHAIN_ID);
            l2LzEndpoint = await new LZEndpointMock__factory(deployer).deploy(L2_CHAIN_ID);
        });
    });

    describe("deploy L2 BoosterLite/VoterProxy", () => {
        let lpToken: IERC20;
        let crvRewards: BaseRewardPool;
        let depositToken: IERC20;
        let L2_poolManager: PoolManagerLite;

        before(async () => {
            // deploy mocks
            const crossChainL2 = await deployCrossChainL2(
                {
                    canonicalChainId: L1_CHAIN_ID,
                    lzEndpoint: l2LzEndpoint.address,
                    minter: config.addresses.minter,
                    token: crvToken.address,
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
        it("[L2] deposit lp tokens", async () => {
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

        before(async () => {
            pid = await contracts.booster.poolLength();

            const crossChainL1 = await deployCrossChainL1(
                {
                    l2Coordinators: [{ chainId: L2_CHAIN_ID, address: l2Coordinator.address }],
                    siphonDepositor: { pid },
                    booster: contracts.booster.address,
                    cvxLocker: contracts.cvxLocker.address,
                    token: crvToken.address,
                    cvx: contracts.cvx.address,
                    lzEndpoint: l1LzEndpoint.address,
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
            await siphonDepositor.setTrustedRemote(
                L2_CHAIN_ID,
                hre.ethers.utils.solidityPack(["address", "address"], [l2Coordinator.address, siphonDepositor.address]),
            );
            await l2Coordinator.setTrustedRemote(
                L1_CHAIN_ID,
                hre.ethers.utils.solidityPack(["address", "address"], [siphonDepositor.address, l2Coordinator.address]),
            );

            await l2LzEndpoint.setDestLzEndpoint(siphonDepositor.address, l1LzEndpoint.address);
            await l1LzEndpoint.setDestLzEndpoint(l2Coordinator.address, l2LzEndpoint.address);
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

        it("[LZ] farm CVX", async () => {
            expect(await crvToken.balanceOf(contracts.booster.address)).eq(0);

            // Initially farm CVX from the Booster by depositing a farmAmount of
            // CRV tokens into the Booster while calling earmarkRewards to mint a
            // pro rata rate of CVX tokens and queue them for rewards
            const crvBalBefore = await crvToken.balanceOf(siphonDepositor.address);
            console.log("Farming CRV amount:", formatUnits(farmAmount));
            await siphonDepositor.farm(farmAmount);
            const crvBalAfter = await crvToken.balanceOf(siphonDepositor.address);
            expect(crvBalAfter).lt(crvBalBefore);
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

            // The CVX Bal we receive should be based on the pro rata rate
            // Given we know the amount of CRV that is received we can calculate
            // the expected amount of CVX we should have received with getAmountOut
            expect(cvxBal).eq(await siphonDepositor.getAmountOut(crvBal));

            const lockIncentive = farmAmount
                .mul(await contracts.booster.lockIncentive())
                .div(await contracts.booster.FEE_DENOMINATOR());
            const stakerIncentive = farmAmount
                .mul(await contracts.booster.stakerIncentive())
                .div(await contracts.booster.FEE_DENOMINATOR());
            const earmarkIncentive = farmAmount
                .mul(await contracts.booster.earmarkIncentive())
                .div(await contracts.booster.FEE_DENOMINATOR());
            const platformFee = farmAmount
                .mul(await contracts.booster.platformFee())
                .div(await contracts.booster.FEE_DENOMINATOR());

            const incentives = lockIncentive.add(stakerIncentive).add(earmarkIncentive).add(platformFee);
            // Some dust gets left in the BaseRewardPool when calculating the reward rate
            // It will get picked up next reward period but we just account for the difference
            // here when making the balance assertions
            const missingDust = await crvToken.balanceOf(crvRewards.address);

            const expectedCrvBal = farmAmount.sub(incentives).sub(missingDust);
            expect(expectedCrvBal).eq(crvBal);
        });
    });

    describe("Claim Aura rewards and convert to L1 Aura", () => {
        // Deploy a dummy bridge to bridge the BAL back to the L1
        // contract. SiphonDepositor will receive the BAL and settle
        // the debt for that l2
        it("Deploy dummy bridge", async () => {
            dummyBridge = await deployContract(hre, new DummyBridge__factory(deployer), "DummyBridge", [
                siphonDepositor.address,
                crvToken.address,
                L1_CHAIN_ID,
            ]);

            await l2Coordinator.setBridgeDelegate(dummyBridge.address);
            await siphonDepositor.setBridgeDelegate(L2_CHAIN_ID, dummyBridge.address);

            expect(await siphonDepositor.bridgeDelegates(L2_CHAIN_ID)).eq(dummyBridge.address);
            expect(await l2Coordinator.bridgeDelegate()).eq(dummyBridge.address);
        });
        it("Earmark rewards", async () => {
            // Transfer BAL rewards to the booster
            const crvWhale = await impersonateAccount("0x5a52e96bacdabb82fd05763e25335261b270efcb");
            await crvToken.connect(crvWhale.signer).transfer(L2_booster.address, simpleToExactAmount(1));

            // Earmark booster rewards
            await L2_booster.earmarkRewards(0);
            await increaseTime(ONE_WEEK);
        });
        it("Flush CRV incentives back to L1", async () => {
            const crvBalBefore = await crvToken.balanceOf(l2Coordinator.address);
            console.log("CRV balance (before):", formatUnits(crvBalBefore));

            const cvxBalBefore = await l2Coordinator.balanceOf(l2Coordinator.address);
            const totalRewards = await l2Coordinator.totalRewards();
            console.log("Total rewards:", formatUnits(totalRewards));

            // Flush sends the CRV back to L1 via the bridge delegate
            // In order to settle the incentives debt on L1
            await l2Coordinator.flush(totalRewards, [], { value: nativeFee });
            await siphonDepositor.siphon(L2_CHAIN_ID, [], { value: nativeFee });
            const cvxBalAfter = await l2Coordinator.balanceOf(l2Coordinator.address);

            // Calling flush triggers the L1 to send back the pro rata CVX
            // based on the actual amount of CRV that was earned derived from
            // the amount of incentives that were paid
            const cvxBal = cvxBalAfter.sub(cvxBalBefore);
            const expectedRewards = await siphonDepositor.getRewardsBasedOnIncentives(totalRewards);
            const expectedCvx = await siphonDepositor.getAmountOut(expectedRewards);
            expect(expectedCvx).eq(cvxBal);

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

            console.log("CVX balance:", formatUnits(cvxBal));
            expect(cvxBal).gt(0);
        });
    });

    describe("Bridge and Lock back to the L1", () => {
        it("bridge L2 -> L1", async () => {
            const l2balBefore = await l2Coordinator.balanceOf(lpWhale.address);
            const sendAmount = l2balBefore.mul(100).div(1000);
            const toAddress = "0x0000000000000000000000000000000000000020";
            await l2Coordinator
                .connect(lpWhale.signer)
                .sendFrom(lpWhale.address, L1_CHAIN_ID, toAddress, sendAmount, lpWhale.address, ZERO_ADDRESS, [], {
                    value: nativeFee,
                });
            const l1bal = await contracts.cvx.balanceOf(toAddress);
            expect(l1bal).eq(sendAmount);

            const l2balAfter = await l2Coordinator.balanceOf(lpWhale.address);
            expect(l2balBefore.sub(l2balAfter)).eq(sendAmount);
        });
        it("bridge L1 -> L2", async () => {
            await getCvx(lpWhale.address, simpleToExactAmount(10));
            const l1balBefore = await contracts.cvx.balanceOf(lpWhale.address);
            const l2balBefore = await l2Coordinator.balanceOf(lpWhale.address);
            const sendAmount = l1balBefore.mul(100).div(1000);
            await contracts.cvx.connect(lpWhale.signer).approve(siphonDepositor.address, sendAmount);
            await siphonDepositor
                .connect(lpWhale.signer)
                .sendFrom(
                    lpWhale.address,
                    L2_CHAIN_ID,
                    lpWhale.address,
                    sendAmount,
                    lpWhale.address,
                    ZERO_ADDRESS,
                    [],
                    {
                        value: nativeFee,
                    },
                );

            const l2balAfter = await l2Coordinator.balanceOf(lpWhale.address);
            expect(l2balAfter.sub(l2balBefore)).eq(sendAmount);

            const l1balAfter = await contracts.cvx.balanceOf(lpWhale.address);
            expect(l1balBefore.sub(l1balAfter)).eq(sendAmount);
        });
        it("[LZ] lock back to the L1", async () => {
            const l2balBefore = await l2Coordinator.balanceOf(lpWhale.address);
            const lockAmount = l2balBefore.mul(100).div(1000);
            expect(lockAmount).gt(0);
            await l2Coordinator
                .connect(lpWhale.signer)
                .lock(lockAmount, hre.ethers.utils.solidityPack(["uint16", "uint256"], [1, 500000]), {
                    value: nativeFee,
                });
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
            const tx = await l2Coordinator
                .connect(lpWhale.signer)
                .lock(lockAmount, hre.ethers.utils.solidityPack(["uint16", "uint256"], [1, 500000]), {
                    gasLimit: 30000000,
                    value: simpleToExactAmount("1"),
                });
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

    describe("Add a second L2 deployment to the siphonDepositor", () => {
        let secondL2Coordinator: L2Coordinator;
        let secondL2LzEndpoint: LZEndpointMock;
        let L22_booster: BoosterLite;
        let L22_poolManager: PoolManagerLite;

        const L22_CHAIN_ID = 444;

        before(async () => {
            secondL2LzEndpoint = await new LZEndpointMock__factory(deployer).deploy(L22_CHAIN_ID);

            const crossChainL2 = await deployCrossChainL2(
                {
                    canonicalChainId: L1_CHAIN_ID,
                    lzEndpoint: secondL2LzEndpoint.address,
                    minter: config.addresses.minter,
                    token: crvToken.address,
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

            secondL2Coordinator = crossChainL2.l2Coordinator;
            L22_booster = crossChainL2.booster;
            L22_poolManager = crossChainL2.poolManager;
        });

        it("deploy l2Coordinator", async () => {
            expect(!!secondL2Coordinator.address).to.be.true;
            await siphonDepositor.setL2Coordinator(L22_CHAIN_ID, secondL2Coordinator.address);
        });
        it("[LZ] set up trusted remotes", async () => {
            await siphonDepositor.setTrustedRemote(
                L22_CHAIN_ID,
                hre.ethers.utils.solidityPack(
                    ["address", "address"],
                    [secondL2Coordinator.address, siphonDepositor.address],
                ),
            );
            await secondL2Coordinator.setTrustedRemote(
                L1_CHAIN_ID,
                hre.ethers.utils.solidityPack(
                    ["address", "address"],
                    [siphonDepositor.address, secondL2Coordinator.address],
                ),
            );

            await secondL2LzEndpoint.setDestLzEndpoint(siphonDepositor.address, l1LzEndpoint.address);
            await l1LzEndpoint.setDestLzEndpoint(secondL2Coordinator.address, secondL2LzEndpoint.address);

            await secondL2Coordinator.setBridgeDelegate(dummyBridge.address);
            await siphonDepositor.setBridgeDelegate(L22_CHAIN_ID, dummyBridge.address);
        });
        it("Earmark rewards", async () => {
            const gaugeAddress = "0x34f33CDaED8ba0E1CEECE80e5f4a73bcf234cfac";
            await L22_poolManager["addPool(address)"](gaugeAddress);

            // Transfer BAL rewards to the booster
            const crvWhale = await impersonateAccount("0x5a52e96bacdabb82fd05763e25335261b270efcb");
            await crvToken.connect(crvWhale.signer).transfer(L22_booster.address, simpleToExactAmount(1));

            // Earmark booster rewards
            await L22_booster.earmarkRewards(0);
            await increaseTime(ONE_WEEK);

            // Flush rewards from L2 and recieve CVX from the L1
            const totalRewards = await secondL2Coordinator.totalRewards();
            const cvxBalBefore = await secondL2Coordinator.balanceOf(secondL2Coordinator.address);
            await secondL2Coordinator.flush(totalRewards, [], { value: simpleToExactAmount("1") });
            await siphonDepositor.siphon(L22_CHAIN_ID, [], { value: nativeFee });
            const cvxBalAfter = await secondL2Coordinator.balanceOf(secondL2Coordinator.address);
            const cvxBal = cvxBalAfter.sub(cvxBalBefore);

            const expectedRewards = await siphonDepositor.getRewardsBasedOnIncentives(totalRewards);
            const expectedCvx = await siphonDepositor.getAmountOut(expectedRewards);
            expect(expectedCvx).eq(cvxBal);
        });
    });
});
