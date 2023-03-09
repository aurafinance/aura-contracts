import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import { AuraBalStrategy, AuraBalVault, FeeForwarder, AuraBalVault__factory } from "../../types/generated";
import { increaseTime, impersonateAccount, simpleToExactAmount, ONE_WEEK, ZERO, ZERO_ADDRESS } from "../../test-utils";
import {
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    MultisigConfig,
    Phase2Deployed,
    Phase4Deployed,
    Phase6Deployed,
} from "../../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import { deployFeeForwarder, deployVault } from "../../scripts/deployVault";

const debug = false;

describe("FeeForwarder", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let phase2: Phase2Deployed;
    let phase4: Phase4Deployed;
    let daoSigner: Signer;
    let deployer: Signer;
    let deployerAddress: string;
    let multisigs: MultisigConfig;
    let strategy: AuraBalStrategy;
    let vault: AuraBalVault;

    // Testing contract
    let feeForwarder: FeeForwarder;

    /* -- Declare shared functions -- */

    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();
        daoSigner = accounts[6];
        mocks = await deployMocks(hre, deployer);
        multisigs = await getMockMultisigs(accounts[4], accounts[5], daoSigner);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        phase2 = await deployPhase2(hre, deployer, phase1, distro, multisigs, mocks.namingConfig, mocks.addresses);
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.connect(accounts[6]).setProtectPool(false);
        phase4 = await deployPhase4(hre, deployer, phase3, mocks.addresses);
        const config = {
            addresses: mocks.addresses,
            multisigs,
            getPhase2: async (__: Signer) => phase2,
            getPhase6: async (__: Signer) => {
                const phase6: Partial<Phase6Deployed> = {};
                phase6.cvxCrvRewards = phase4.cvxCrvRewards;
                return phase6 as Phase6Deployed;
            },
        };
        // Deploy test contract.
        const result = await deployVault(config, hre, deployer, debug);
        const resultF = await deployFeeForwarder(config, hre, deployer, debug);

        vault = result.vault;
        strategy = result.strategy;
        feeForwarder = resultF.feeForwarder;

        // Send crvCvx to account, so it can make deposits
        const crvDepositorAccount = await impersonateAccount(phase2.crvDepositor.address);
        const cvxCrvConnected = phase2.cvxCrv.connect(crvDepositorAccount.signer);
        await cvxCrvConnected.mint(deployerAddress, simpleToExactAmount(simpleToExactAmount(1000000)));

        // Send some aura to mocked strategy to simulate harvest
        await increaseTime(ONE_WEEK.mul(156));
        await phase4.minter.connect(daoSigner).mint(deployerAddress, simpleToExactAmount(1000000));
    };

    before("init contract", async () => {
        await setup();
    });
    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            expect(await feeForwarder.owner(), "owner").to.be.eq(multisigs.daoMultisig);
        });
    });

    describe("forward", async () => {
        it("should send assets to a vaults strategy", async () => {
            const amount = simpleToExactAmount(100);
            await phase2.cvxCrv.transfer(feeForwarder.address, amount);
            const feeForwarderBalanceBefore = await phase2.cvxCrv.balanceOf(feeForwarder.address);
            const strategyBalanceBefore = await phase2.cvxCrv.balanceOf(strategy.address);
            const tx = await feeForwarder.connect(daoSigner).forward(vault.address, phase2.cvxCrv.address, amount);
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(feeForwarder, "Forwarded").withArgs(vault.address, phase2.cvxCrv.address, amount);

            const feeForwarderBalanceAfter = await phase2.cvxCrv.balanceOf(feeForwarder.address);
            const strategyBalanceAfter = await phase2.cvxCrv.balanceOf(strategy.address);
            expect(feeForwarderBalanceAfter, "feeForwarder Balance").to.be.eq(feeForwarderBalanceBefore.sub(amount));
            expect(strategyBalanceAfter, "strategy Balance").to.be.eq(strategyBalanceBefore.add(amount));
        });
        it("fails if vault does not have a strategy", async () => {
            const mockVault = await new AuraBalVault__factory(deployer).deploy(mocks.crv.address);
            await expect(
                feeForwarder.connect(daoSigner).forward(mockVault.address, ZERO_ADDRESS, ZERO),
                "fails due to strategy",
            ).to.be.revertedWith("!strategy");
        });
        it("fails if strategy is not connected to the vault", async () => {
            const mockVault = await new AuraBalVault__factory(deployer).deploy(mocks.crv.address);
            await mockVault.setStrategy(strategy.address);
            expect(strategy.vault(), "vault ").to.not.be.eq(mockVault.address);
            await expect(
                feeForwarder.connect(daoSigner).forward(mockVault.address, ZERO_ADDRESS, ZERO),
                "fails due to vault",
            ).to.be.revertedWith("!vault");
        });
        it("fails if caller is not the owner", async () => {
            await expect(
                feeForwarder.connect(deployer).forward(ZERO_ADDRESS, ZERO_ADDRESS, ZERO),
                "fails due to owner",
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });
});
