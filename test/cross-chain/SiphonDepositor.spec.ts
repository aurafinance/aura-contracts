import hre, { ethers } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { expect } from "chai";
import {
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    SystemDeployed,
    MultisigConfig,
} from "../../scripts/deploySystem";

import {
    CrossChainL1Deployment,
    CrossChainL2Deployment,
    deployCrossChainL1,
    deployCrossChainL2,
} from "../../scripts/deployCrossChain";

import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    MockERC20__factory,
    MockERC20,
    SiphonGauge,
    SiphonDepositor,
    SiphonToken,
    L2Coordinator,
    BoosterLite,
    LZEndpointMock,
    LZEndpointMock__factory,
    PoolManagerLite,
    DummyBridge,
    DummyBridge__factory,
    MockCurveGauge__factory,
    BaseRewardPool,
    BaseRewardPool__factory,
    IERC20,
    IERC20__factory,
} from "../../types/generated";

import { increaseTime, ONE_WEEK, simpleToExactAmount, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { impersonateAccount } from "../../test-utils/fork";
import { Account } from "types";
import { formatUnits } from "ethers/lib/utils";

// event Deposit(address sender, uint256 amount);

// event Siphon(address sender, uint256 dstChainId, address toAddress, uint256 amount);

// event Lock(address from, uint16 dstChainId, uint256 amount);

// event UpdateBridgeDelegate(uint16 srcChainId, address bridgeDelegate);

// event RepayDebt(address sender, uint16 srcChainId, uint256 amount);
//     event SetUseCustomAdapterParams(bool _useCustomAdapterParams);

describe("SiphonDepositor", () => {
    const L1_CHAIN_ID = 111;
    const L2_CHAIN_ID = 222;
    const debug = false;

    let accounts: Signer[];
    let contracts: SystemDeployed;
    let mocks: DeployMocksResult;
    let deployer: Signer;
    let alice: Signer;
    let aliceAddress: string;
    let treasury: Account;
    let multisigs: MultisigConfig;

    //     CrossChain L1 contracts
    let crossChainL1: CrossChainL1Deployment;
    let crossChainL2: CrossChainL2Deployment;
    let pid: BigNumberish;
    let siphonGauge: SiphonGauge;
    let siphonToken: SiphonToken;
    let siphonDepositor: SiphonDepositor;
    // Bridge contract
    let l1LzEndpoint: LZEndpointMock;
    let l2LzEndpoint: LZEndpointMock;

    // L2 contracts
    const L2_pid = 0;
    let l2Coordinator: L2Coordinator;
    let L2_booster: BoosterLite;
    let L2_poolManager: PoolManagerLite;
    let lpToken: IERC20;
    let crvRewards: BaseRewardPool;
    // let depositToken: IERC20;
    let dummyBridge: DummyBridge;

    /* -- Declare shared functions -- */

    const setup = async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        alice = accounts[1];
        aliceAddress = await alice.getAddress();

        ({ mocks, multisigs, contracts } = await deployFullSystem(deployer, accounts));

        const protocolDAO = await impersonateAccount(multisigs.daoMultisig);
        treasury = await impersonateAccount(multisigs.treasuryMultisig);
        pid = await contracts.booster.poolLength();

        // Deploy cross chain
        // - Mocks
        l1LzEndpoint = await new LZEndpointMock__factory(deployer).deploy(L1_CHAIN_ID);
        l2LzEndpoint = await new LZEndpointMock__factory(deployer).deploy(L2_CHAIN_ID);
        const L2_gauge = await new MockCurveGauge__factory(deployer).deploy(
            "L2_TestGauge_0",
            "l2-tkn-0-gauge",
            mocks.lptoken.address,
            [],
        );

        // Deploy cross chain  L2
        crossChainL2 = await deployCrossChainL2(
            {
                canonicalChainId: L1_CHAIN_ID,
                lzEndpoint: l2LzEndpoint.address,
                minter: contracts.minter.address,
                token: mocks.crv.address,
                tokenBpt: mocks.crvBpt.address,
                votingEscrow: mocks.votingEscrow.address,
                gaugeController: mocks.addresses.gaugeController,
                cvx: contracts.cvx.address,
                voteOwnership: ethers.constants.AddressZero,
                voteParameter: ethers.constants.AddressZero,
                naming: {
                    tokenFactoryNamePostfix: mocks.namingConfig.tokenFactoryNamePostfix,
                    cvxSymbol: mocks.namingConfig.cvxSymbol,
                    cvxName: mocks.namingConfig.cvxName,
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

        // [L2] add a pool
        await L2_poolManager["addPool(address)"](L2_gauge.address);
        let info = await L2_booster.poolInfo(L2_pid);
        lpToken = IERC20__factory.connect(info.lptoken, deployer);

        // [L2] deposit lp tokens
        await lpToken.connect(deployer).transfer(aliceAddress, simpleToExactAmount(1000000));
        const amount = await lpToken.balanceOf(aliceAddress);
        await lpToken.connect(alice).approve(L2_booster.address, amount);
        await L2_booster.connect(alice).deposit(L2_pid, amount, true);

        // Deploy cross chain  L1
        crossChainL1 = await deployCrossChainL1(
            {
                l2Coordinators: [{ chainId: L2_CHAIN_ID, address: l2Coordinator.address }],
                siphonDepositor: { pid },
                booster: contracts.booster.address,
                cvxLocker: contracts.cvxLocker.address,
                token: mocks.crv.address,
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

        // [LZ] deploy dummy bridge
        dummyBridge = await new DummyBridge__factory(deployer).deploy(
            siphonDepositor.address,
            mocks.crv.address,
            L1_CHAIN_ID,
        );
        await l2Coordinator.setBridgeDelegate(dummyBridge.address);
        await siphonDepositor.setBridgeDelegate(L2_CHAIN_ID, dummyBridge.address);

        // [LZ] set up trusted remotes
        await siphonDepositor.setTrustedRemote(L2_CHAIN_ID, l2Coordinator.address);
        await l2Coordinator.setTrustedRemote(L1_CHAIN_ID, siphonDepositor.address);

        await l2LzEndpoint.setDestLzEndpoint(siphonDepositor.address, l1LzEndpoint.address);
        await l1LzEndpoint.setDestLzEndpoint(l2Coordinator.address, l2LzEndpoint.address);

        // [L1] adds the gauge
        await contracts.poolManager
            .connect(protocolDAO.signer)
            .forceAddPool(siphonToken.address, siphonGauge.address, pid);

        info = await contracts.booster.poolInfo(pid);
        lpToken = IERC20__factory.connect(info.lptoken, deployer);
        crvRewards = BaseRewardPool__factory.connect(info.crvRewards, deployer);
        // depositToken = IERC20__factory.connect(info.token, deployer);

        // Approvals and balances for testing

        await siphonToken.approve(siphonDepositor.address, ethers.constants.MaxInt256);
        await mocks.crv.connect(deployer).transfer(treasury.address, simpleToExactAmount(1000000));
    };

    before("setup", async () => {
        await setup();
    });
    describe("verify deployment", async () => {
        it("should properly store valid arguments", async () => {
            expect(await siphonDepositor.lpToken(), "lpToken").to.eq(crossChainL1.siphonToken.address);
            expect(await siphonDepositor.pid(), "pid").to.eq(pid);
            expect(await siphonDepositor.booster(), "booster").to.eq(contracts.booster.address);
            expect(await siphonDepositor.auraLocker(), "auraLocker").to.eq(contracts.cvxLocker.address);
            expect(await siphonDepositor.crv(), "crv").to.eq(mocks.crv.address);
            expect(await siphonDepositor.cvx(), "cvx").to.eq(contracts.cvx.address);
            expect(await siphonDepositor.l2Coordinators(0), "l2Coordinator").to.eq(l2Coordinator.address);
            // map
            // expect(await siphonDepositor.debts(CHAIN_ID), "debts").to.eq(0);
            expect(await siphonDepositor.bridgeDelegates(L2_CHAIN_ID), "bridgeDelegates").to.eq(dummyBridge.address);
        });
        it("OFTCore store valid arguments", async () => {
            expect(await siphonDepositor.NO_EXTRA_GAS(), "NO_EXTRA_GAS").to.eq(0);
            expect(await siphonDepositor.FUNCTION_TYPE_SEND(), "FUNCTION_TYPE_SEND").to.eq(1);
            expect(await siphonDepositor.useCustomAdapterParams(), "useCustomAdapterParams").to.eq(false);
        });
        it("LzApp store valid arguments", async () => {
            expect(await siphonDepositor.lzEndpoint(), "lzEndpoint").to.eq(l2LzEndpoint.address);
            // map
            expect((await siphonDepositor.trustedRemoteLookup(L2_CHAIN_ID)).toLowerCase(), "trustedRemoteLookup").to.eq(
                l2Coordinator.address.toLowerCase(),
            );
            // expect(await siphonDepositor.minDstGasLookup(CHAIN_ID), "minDstGasLookup").to.eq(simpleToExactAmount(375));
        });
        it("validates approvals for lpToken", async () => {
            const boosterAllowance = await siphonToken.allowance(siphonDepositor.address, contracts.booster.address);
            expect(boosterAllowance, "lptoken allowance").to.be.eq(ethers.constants.MaxUint256);
        });
    });

    context("full flow", async () => {
        describe("[L1] funding", () => {
            it("deposits siphon tokens into the booster", async () => {
                // Given
                const owner = await siphonDepositor.owner();
                const siphonTokenBalance = await siphonToken.balanceOf(siphonDepositor.address);
                const pid = await siphonDepositor.pid();

                expect(await siphonToken.balanceOf(siphonDepositor.address), "lpToken balance").to.be.gt(0);

                // When siphon depositor deposits
                const tx = await siphonDepositor.deposit();
                await expect(tx).to.emit(siphonDepositor, "Deposit").withArgs(owner, siphonTokenBalance);

                // Then the booster deposits and stakes
                await expect(tx)
                    .emit(contracts.booster, "Deposited")
                    .withArgs(siphonDepositor.address, pid, siphonTokenBalance);
                await expect(tx).emit(crvRewards, "Staked").withArgs(siphonDepositor.address, siphonTokenBalance);

                expect(await siphonToken.balanceOf(siphonDepositor.address), "lpToken balance").to.be.eq(0);
                expect(await crvRewards.balanceOf(siphonDepositor.address), "reward balance").eq(siphonTokenBalance);
            });
            it("fund the siphonDepositor with crv", async () => {
                const balance = await mocks.crv.balanceOf(multisigs.treasuryMultisig);

                expect(balance, "crv balance").to.be.gt(0);

                await mocks.crv.connect(treasury.signer).transfer(siphonDepositor.address, balance);

                const siphonBalance = await mocks.crv.balanceOf(siphonDepositor.address);
                expect(siphonBalance, "siphon depositor balance").eq(balance);
            });
        });
        describe("Siphon CVX to L2", () => {
            const farmAmount = simpleToExactAmount(100);
            it("LZ] siphon CVX via @farm", async () => {
                const crvBalBefore = await mocks.crv.balanceOf(siphonDepositor.address);
                const incentives = farmAmount
                    .mul(await contracts.booster.earmarkIncentive())
                    .div(await contracts.booster.FEE_DENOMINATOR());
                expect(crvBalBefore, "Farming CRV amount").to.be.gt(0);

                await siphonDepositor.farm(farmAmount);
                const crvBalAfter = await mocks.crv.balanceOf(siphonDepositor.address);
                const expectedCrvBal = crvBalBefore.add(incentives).sub(farmAmount);
                expect(
                    Math.round(Number(expectedCrvBal.div("1000000000000000000").toString())),
                    "siphon depositor balance after farm",
                ).eq(Math.round(Number(crvBalAfter.div("1000000000000000000").toString())));
            });
            it("[L1] claim CVX and CRV @getReward", async () => {
                await increaseTime(ONE_WEEK);

                const crvBalBefore = await mocks.crv.balanceOf(siphonDepositor.address);
                const cvxBalBefore = await contracts.cvx.balanceOf(siphonDepositor.address);
                const tx = await siphonDepositor.getReward();
                await expect(tx).to.emit(crvRewards, "RewardPaid");
                const crvBalAfter = await mocks.crv.balanceOf(siphonDepositor.address);
                const cvxBalAfter = await contracts.cvx.balanceOf(siphonDepositor.address);

                const cvxBal = cvxBalAfter.sub(cvxBalBefore);
                const crvBal = crvBalAfter.sub(crvBalBefore);
                expect(cvxBal, "CVX balance").to.be.gt(0);
                expect(crvBal, "CRV balance").to.be.gt(0);

                const incentives = farmAmount
                    .mul(
                        (await contracts.booster.lockIncentive())
                            .add(await contracts.booster.stakerIncentive())
                            .add(await contracts.booster.earmarkIncentive())
                            .add(await contracts.booster.platformFee()),
                    )
                    .div(await contracts.booster.FEE_DENOMINATOR());

                const expectedCrvBal = farmAmount.sub(incentives);

                expect(
                    Math.round(Number(expectedCrvBal.div("1000000000000000000").toString())),
                    "siphon depositor balance after getReward",
                ).eq(Math.round(Number(crvBal.div("1000000000000000000").toString())));
            });
        });
        describe("Claim Aura rewards and convert to L1 Aura", () => {
            // it("[LZ] claim AURA rewards", async () => {
            //     // Transfer crv rewards to the l2 booster
            //     await mocks.crv.connect(deployer).transfer(L2_booster.address, simpleToExactAmount(1));

            //     // Earmark booster rewards
            //     await L2_booster.earmarkRewards(L2_pid);
            //     await increaseTime(ONE_WEEK);

            //     const pool = await L2_booster.poolInfo(L2_pid);
            //     const crvRewards = BaseRewardPool__factory.connect(pool.crvRewards, deployer);

            //     const balBefore = await l2Coordinator.balanceOf(aliceAddress);
            //     await crvRewards.connect(alice)["getReward()"]();
            //     const balAfter = await l2Coordinator.balanceOf(aliceAddress);
            //     const cvxBal = balAfter.sub(balBefore);
            //     expect(cvxBal).gt(0);

            //     console.log("CVX balance:", formatUnits(cvxBal));

            //     const debt = await siphonDepositor.debts(CHAIN_ID);
            //     console.log("CRV debt:", formatUnits(debt));
            //     expect(debt).gt(0);
            // });

            it("bridge back to the L1", async () => {
                // TODO 'LzApp: destination chain is not a trusted source'
                const l2balBefore = await l2Coordinator.balanceOf(aliceAddress);
                const sendAmount = l2balBefore.mul(100).div(1000);
                const toAddress = "0x0000000000000000000000000000000000000020";
                await l2Coordinator
                    .connect(alice)
                    .sendFrom(aliceAddress, L1_CHAIN_ID, toAddress, sendAmount, aliceAddress, ZERO_ADDRESS, []);
                const l1bal = await contracts.cvx.balanceOf(toAddress);
                expect(l1bal).eq(sendAmount);

                const l2balAfter = await l2Coordinator.balanceOf(aliceAddress);
                expect(l2balBefore.sub(l2balAfter)).eq(sendAmount);
            });
            it("[LZ] lock back to the L1", async () => {
                // TODO 'LzApp: destination chain is not a trusted source'

                const l2balBefore = await l2Coordinator.balanceOf(aliceAddress);
                const lockAmount = l2balBefore.mul(100).div(1000);
                await l2Coordinator.connect(alice).lock(lockAmount);
                expect(await l2Coordinator.balanceOf(aliceAddress)).eq(l2balBefore.sub(lockAmount));

                const lock = await contracts.cvxLocker.userLocks(aliceAddress, 0);
                expect(lock.amount).eq(lockAmount);

                const l2balAfter = await l2Coordinator.balanceOf(aliceAddress);
                expect(l2balBefore.sub(l2balAfter)).eq(lockAmount);
            });
            it("[LZ] retry failed lock back to the L1", async () => {
                const l2balBefore = await l2Coordinator.balanceOf(aliceAddress);
                const lockAmount = l2balBefore.mul(100).div(1000);
                const lockBefore = await contracts.cvxLocker.userLocks(aliceAddress, 0);

                // Force the transaction to fail by changing the code stored at cvxLocker
                // and then reset it afterwards so we can process the retry
                const code = await hre.network.provider.send("eth_getCode", [contracts.cvxLocker.address]);
                await hre.network.provider.send("hardhat_setCode", [
                    contracts.cvxLocker.address,
                    MockERC20__factory.bytecode,
                ]);
                const tx = await l2Coordinator.connect(alice).lock(lockAmount);
                await hre.network.provider.send("hardhat_setCode", [contracts.cvxLocker.address, code]);

                const resp = await tx.wait();
                const event = resp.events.find(event => event.event === "MessageFailed");

                await siphonDepositor.retryMessage(
                    event.args._srcChainId,
                    event.args._srcAddress,
                    event.args._nonce,
                    event.args._payload,
                );

                expect(await l2Coordinator.balanceOf(aliceAddress)).eq(l2balBefore.sub(lockAmount));

                const lockAfter = await contracts.cvxLocker.userLocks(aliceAddress, 0);
                expect(lockAfter.amount.sub(lockBefore.amount)).eq(lockAmount);

                const l2balAfter = await l2Coordinator.balanceOf(aliceAddress);
                expect(l2balBefore.sub(l2balAfter)).eq(lockAmount);
            });
        });
        describe("Bridge BAL to L1 to repay debt", () => {
            // Dummy bridge to bridge the BAL back to the L1
            // contract. SiphonDepositor will receive the BAL and settle
            // the debt for that l2
            // it("Bridge BAL to L1 to repay debt", async () => {
            //     const debtBefore = await siphonDepositor.debts(CHAIN_ID);
            //     console.log("Debt before:", formatUnits(debtBefore));
            //     const crvBalBefore = await mocks.crv.balanceOf(l2Coordinator.address);
            //     console.log("CRV balance:", formatUnits(crvBalBefore));
            //     await l2Coordinator.flush();
            //     await dummyBridge.repayDebt();
            //     const debtAfter = await siphonDepositor.debts(CHAIN_ID);
            //     console.log("Debt after:", formatUnits(debtAfter));
            //     expect(debtBefore.sub(debtAfter)).eq(crvBalBefore);
            // });
        });
    });
    describe("fails if", () => {
        it("deposit caller is not the owner", async () => {
            await expect(siphonDepositor.connect(alice).deposit()).to.be.revertedWith(
                "Ownable: caller is not the owner",
            );
        });
        it("farm caller is not the owner", async () => {
            await expect(siphonDepositor.connect(alice).farm(ZERO)).to.be.revertedWith(
                "Ownable: caller is not the owner",
            );
        });
        it("getReward caller is not the owner", async () => {
            await expect(siphonDepositor.connect(alice).getReward()).to.be.revertedWith(
                "Ownable: caller is not the owner",
            );
        });
        it("setBridgeDelegate caller is not the owner", async () => {
            await expect(siphonDepositor.connect(alice).setBridgeDelegate(ZERO, ZERO_ADDRESS)).to.be.revertedWith(
                "Ownable: caller is not the owner",
            );
        });
        it("setBridgeDelegate to wrong address", async () => {
            await expect(siphonDepositor.setBridgeDelegate(ZERO, ZERO_ADDRESS)).to.be.revertedWith("Invalid address");
        });
        // it("repayDebt caller is not bridgeDelegate", async () => {
        //     await expect(siphonDepositor.repayDebt(L1_CHAIN_ID, ZERO)).to.be.revertedWith("!bridgeDelegate")
        // });
        // xit("repayDebt caller is not bridgeDelegate", async () => {
        //     await expect(siphonDepositor.repayDebt(L1_CHAIN_ID, ZERO)).to.be.revertedWith("amount > debt")
        // });
        // // [L1] deposits Fails if deposits 0 "RewardPool : Cannot stake 0"
    });

    describe("@method farm", async () => {
        it("fails if caller is not the owner", async () => {
            //
        });
        it("farm cvx tokens from the booster", async () => {
            //
            // TODO - require(bal >= _amount, "!balance"); >
            // TODO - require(bal >= _amount, "!balance"); <
        });
    });
    describe("@method getReward", async () => {
        it("fails if caller is not the owner", async () => {
            //
        });
        it("gets rewards from the BaseRewardPool", async () => {
            //
        });
    });
    describe("@method setBridgeDelegate", async () => {
        it("fails if caller is not the owner", async () => {
            //
        });
        it("sets the bridge delegate for  a source chain id", async () => {
            //
        });
    });
    describe("@method repayDebt", async () => {
        it("fails if caller is not the owner", async () => {
            //
        });
        it("sets the bridge delegate for  a source chain id", async () => {
            //
        });
    });
    describe("OFTCore", async () => {
        describe("@method supportsInterface", async () => {
            it("....", async () => {
                //
            });
        });
        describe("@method estimateSendFee", async () => {
            it("....", async () => {
                //
            });
        });
        describe("@method sendFrom", async () => {
            it("....", async () => {
                //
            });
        });
        describe("@method setUseCustomAdapterParams", async () => {
            it("....", async () => {
                //
            });
        });
    });
    describe("NonblockingLzApp", async () => {
        describe("@method estimateSendFee", async () => {
            it("....", async () => {
                //
            });
        });
    });
    describe("LzApp", async () => {
        describe("@method nonblockingLzReceive", async () => {
            it("....", async () => {
                //
            });
        });
        describe("@method retryMessage", async () => {
            it("....", async () => {
                //
            });
        });
    });
});

async function deployFullSystem(deployer: Signer, accounts: Signer[]) {
    const mocks = await deployMocks(hre, deployer);
    const multisigs = await getMockMultisigs(accounts[1], accounts[2], accounts[3]);
    const distro = getMockDistro();
    const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
    const phase2 = await deployPhase2(hre, deployer, phase1, distro, multisigs, mocks.namingConfig, mocks.addresses);
    const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);

    const protocolDAO = await impersonateAccount(multisigs.daoMultisig);
    await phase3.poolManager.connect(protocolDAO.signer).setProtectPool(false);
    const contracts = await deployPhase4(hre, deployer, phase3, mocks.addresses);
    return { mocks, multisigs, contracts };
}
