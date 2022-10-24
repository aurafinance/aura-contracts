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

import { BN, DEAD_ADDRESS, simpleToExactAmount, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { impersonateAccount } from "../../test-utils/fork";
import { Account } from "types";
const ERROR_ONLY_OWNER = "Ownable: caller is not the owner";

describe("L2Coordinator", () => {
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
            expect(await l2Coordinator.name(), "name").to.eq(mocks.namingConfig.cvxName);
            expect(await l2Coordinator.symbol(), "symbol").to.eq(mocks.namingConfig.cvxSymbol);

            expect(await l2Coordinator.booster(), "booster").to.eq(crossChainL2.booster.address);
            expect(await l2Coordinator.mintRate(), "mintRate").to.eq(ZERO);
            expect(await l2Coordinator.totalRewards(), "totalRewards").to.eq(ZERO);
            expect(await l2Coordinator.canonicalChainId(), "canonicalChainId").to.eq(L1_CHAIN_ID);
            expect(await l2Coordinator.crv(), "crv").to.eq(mocks.crv.address);
            expect(await l2Coordinator.bridgeDelegate(), "bridgeDelegate").to.eq(ZERO_ADDRESS);
        });
    });
    describe("fails if", () => {
        it("flush caller is not the owner", async () => {
            await expect(l2Coordinator.connect(alice).flush(ZERO)).to.be.revertedWith(ERROR_ONLY_OWNER);
        });
        it("flush when bridgeDelegate is not set", async () => {
            const bridgeDelegate = await l2Coordinator.bridgeDelegate();
            expect(bridgeDelegate, "bridgeDelegate").to.be.eq(ZERO_ADDRESS);

            await expect(l2Coordinator.flush(ZERO)).to.be.revertedWith("bridgeDelegate invalid");
        });
        it("flush more thant the total rewards", async () => {
            await l2Coordinator.setBridgeDelegate(DEAD_ADDRESS);
            const totalRewards = await l2Coordinator.totalRewards();
            await expect(l2Coordinator.flush(totalRewards.add(simpleToExactAmount(1)))).to.be.revertedWith(
                "amount>totalRewards",
            );
        });
        it("setBooster caller is not the owner", async () => {
            await expect(l2Coordinator.connect(alice).setBooster(ZERO_ADDRESS)).to.be.revertedWith(ERROR_ONLY_OWNER);
        });
        it("setBridgeDelegate caller is not the owner", async () => {
            await expect(l2Coordinator.connect(alice).setBridgeDelegate(ZERO_ADDRESS)).to.be.revertedWith(
                ERROR_ONLY_OWNER,
            );
        });
        it("mint caller is not the booster", async () => {
            await expect(l2Coordinator.connect(alice).mint(ZERO_ADDRESS, ZERO)).to.be.revertedWith("!booster");
        });
        it("queueNewRewards caller is not the booster", async () => {
            await expect(l2Coordinator.connect(alice).queueNewRewards(ZERO)).to.be.revertedWith("!booster");
        });
    });
    describe("owner", async () => {
        it("set booster", async () => {
            const oldBooster = await l2Coordinator.booster();
            const tx = await l2Coordinator.setBooster(DEAD_ADDRESS);
            await expect(tx)
                .to.emit(l2Coordinator, "UpdateBooster")
                .withArgs(await deployer.getAddress(), DEAD_ADDRESS);
            expect(await l2Coordinator.booster()).to.be.eq(DEAD_ADDRESS);

            await l2Coordinator.setBooster(oldBooster);
        });
        it("set bridgeDelegate", async () => {
            const oldBridgeDelegate = await l2Coordinator.bridgeDelegate();
            const tx = await l2Coordinator.setBridgeDelegate(DEAD_ADDRESS);
            await expect(tx).to.emit(l2Coordinator, "UpdateBridgeDelegate").withArgs(DEAD_ADDRESS);
            expect(await l2Coordinator.bridgeDelegate()).to.be.eq(DEAD_ADDRESS);

            await l2Coordinator.setBridgeDelegate(oldBridgeDelegate);
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
