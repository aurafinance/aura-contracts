import hre, { ethers } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4, SystemDeployed } from "../../scripts/deploySystem";

import {
    CrossChainL1Deployment,
    CrossChainL2Deployment,
    deployCrossChainL1,
    deployCrossChainL2,
} from "../../scripts/deployCrossChain";

import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    SiphonGauge,
    SiphonDepositor,
    SiphonToken,
    L2Coordinator,
    LZEndpointMock,
    LZEndpointMock__factory,
    PoolManagerLite,
    MockCurveGauge__factory,
    SiphonGauge__factory,
} from "../../types/generated";

import { BN, simpleToExactAmount, ZERO } from "../../test-utils";
import { impersonateAccount } from "../../test-utils/fork";
import { Account } from "types";

describe("SiphonGauge", () => {
    const L1_CHAIN_ID = 111;
    const L2_CHAIN_ID = 222;
    const debug = false;

    let accounts: Signer[];
    let contracts: SystemDeployed;
    let mocks: DeployMocksResult;
    let deployer: Signer;
    let alice: Signer;
    let aliceAddress: string;

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
    let l2Coordinator: L2Coordinator;
    let L2_poolManager: PoolManagerLite;
    // let lpToken: IERC20;
    let siphonDepositorAcc: Account;
    /* -- Declare shared functions -- */

    const setup = async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        alice = accounts[1];
        aliceAddress = await alice.getAddress();
        ({ mocks, contracts } = await deployFullSystem(deployer, accounts));

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
        L2_poolManager = crossChainL2.poolManager;

        // [L2] add a pool
        await L2_poolManager["addPool(address)"](L2_gauge.address);

        // Create siphon pool on L1
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

        // Approvals and balances for testing
        await siphonDepositor.setApprovals();
        siphonDepositorAcc = await impersonateAccount(siphonDepositor.address);
    };

    before("setup", async () => {
        await setup();
    });
    describe("verify deployment", async () => {
        it("should properly store valid arguments", async () => {
            expect(await siphonGauge.lp_token(), "lpToken").to.eq(siphonToken.address);
            expect(await siphonGauge.balanceOf(siphonDepositor.address), "gauge balance").to.eq(ZERO);
        });
    });
    context("full flow", async () => {
        let amount: BN;
        before("setup", async () => {
            amount = await siphonToken.balanceOf(siphonDepositor.address);
        });

        it("deposits LP tokens into the gauge", async () => {
            await siphonToken.connect(siphonDepositorAcc.signer).approve(siphonGauge.address, amount);

            await siphonGauge.connect(siphonDepositorAcc.signer).deposit(amount);
            expect(await siphonGauge.balanceOf(siphonDepositor.address), "gauge balance").to.be.equal(amount);
            expect(await siphonGauge.balanceOf(aliceAddress), "other accounts have zero balance").to.be.equal(ZERO);
        });
        it("claim_rewards from gauge does nothing", async () => {
            const aliceBalanceBefore = await siphonGauge.balanceOf(aliceAddress);
            const depositorBalanceBefore = await siphonGauge.balanceOf(siphonDepositor.address);

            const tx = await siphonGauge.connect(alice).claim_rewards();
            const receipt = tx.wait();
            expect((await receipt).events.length, "no events").to.eq(0);
            expect(await siphonGauge.balanceOf(siphonDepositor.address), "depositor balance").to.be.equal(
                depositorBalanceBefore,
            );
            expect(await siphonGauge.balanceOf(aliceAddress), "alice balance").to.be.equal(aliceBalanceBefore);
        });
        it("withdraw LP tokens from the gauge", async () => {
            const tokenBalance = await siphonToken.balanceOf(siphonDepositor.address);
            const gaugeBalance = await siphonGauge.balanceOf(siphonDepositor.address);

            await siphonGauge.connect(siphonDepositorAcc.signer).withdraw(amount);
            expect(await siphonGauge.balanceOf(siphonDepositor.address), "gauge balance").to.be.equal(
                gaugeBalance.sub(amount),
            );
            expect(await siphonToken.balanceOf(siphonDepositor.address), "siphonToken balance").to.be.equal(
                tokenBalance.add(amount),
            );
        });
    });
    context("fails", async () => {
        it("deposits gt than the balance", async () => {
            const amount = simpleToExactAmount(1000);
            await siphonToken.connect(siphonDepositorAcc.signer).approve(siphonGauge.address, amount);
            const aliceBalanceBefore = await siphonGauge.balanceOf(siphonDepositor.address);

            await expect(siphonGauge.connect(siphonDepositorAcc.signer).deposit(amount)).to.be.revertedWith(
                "ERC20: transfer amount exceeds balance",
            );
            expect(await siphonGauge.balanceOf(siphonDepositor.address), "alice balance should not change").to.be.equal(
                aliceBalanceBefore,
            );
        });
        it("withdraw gt than the balance", async () => {
            const balanceBefore = await siphonGauge.balanceOf(siphonDepositor.address);
            const amount = balanceBefore.add(simpleToExactAmount(100));
            await expect(siphonGauge.connect(siphonDepositorAcc.signer).withdraw(amount)).to.be.reverted;
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
