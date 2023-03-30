import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import { AuraBalVault, AuraBalStaker } from "../../types/generated";
import { impersonateAccount, simpleToExactAmount, ZERO } from "../../test-utils";
import {
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    Phase2Deployed,
    Phase4Deployed,
    Phase6Deployed,
} from "../../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import { deployVault } from "../../scripts/deployVault";
import { deployAuraBalStaker } from "../../scripts/deployPeripheral";

const debug = false;

describe("AuraBalStaker", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let phase2: Phase2Deployed;
    let phase4: Phase4Deployed;
    let daoSigner: Signer;
    let deployer: Signer;
    let deployerAddress: string;
    let alice: Signer;
    let aliceAddress: string;

    // Testing contract
    let vault: AuraBalVault;
    // Testing contract
    let auraBalStaker: AuraBalStaker;
    /* -- Declare shared functions -- */

    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        deployerAddress = await deployer.getAddress();
        daoSigner = accounts[6];
        alice = accounts[1];
        aliceAddress = await alice.getAddress();
        mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], daoSigner);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        phase2 = await deployPhase2(hre, deployer, phase1, distro, multisigs, mocks.namingConfig, mocks.addresses);
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.connect(accounts[6]).setProtectPool(false);
        phase4 = await deployPhase4(hre, deployer, phase3, mocks.addresses);

        // Deploy test contract.
        ({ vault } = await deployVault(
            {
                addresses: mocks.addresses,
                multisigs,
                getPhase2: async (__: Signer) => phase2,
                getPhase6: async (__: Signer) => {
                    const phase6: Partial<Phase6Deployed> = {};
                    phase6.cvxCrvRewards = phase4.cvxCrvRewards;
                    return phase6 as Phase6Deployed;
                },
            },
            hre,
            deployer,
            false,
        ));
        auraBalStaker = await deployAuraBalStaker(hre, deployer, vault, phase2.cvxCrv, debug);

        // Send crvCvx to account, so it can make deposits
        const crvDepositorAccount = await impersonateAccount(phase2.crvDepositor.address);
        const cvxCrvConnected = phase2.cvxCrv.connect(crvDepositorAccount.signer);
        await cvxCrvConnected.mint(deployerAddress, simpleToExactAmount(simpleToExactAmount(1000000)));
    };

    before("init contract", async () => {
        await setup();
    });

    it("should properly store valid arguments", async () => {
        expect(await auraBalStaker.vault(), "vault").to.eq(vault.address);
        expect(await auraBalStaker.auraBal(), "auraBal").to.eq(phase2.cvxCrv.address);
    });
    it("has correct approvals", async () => {
        expect(await phase2.cvxCrv.allowance(auraBalStaker.address, vault.address), "allowance").to.be.eq(
            ethers.constants.MaxUint256,
        );
    });
    it("stakeFor user a given amount", async () => {
        const vaultReceiverBalanceBefore = await vault.balanceOf(aliceAddress);
        const crvCvxSenderBalanceBefore = await phase2.cvxCrv.balanceOf(deployerAddress);
        const amount = simpleToExactAmount(10);

        await phase2.cvxCrv.approve(auraBalStaker.address, amount);

        expect(vaultReceiverBalanceBefore, "expect zero balance").to.be.eq(ZERO);
        const tx = await auraBalStaker.stakeFor(aliceAddress, amount);
        await expect(tx).to.emit(vault, "Deposit");
        const vaultReceiverBalanceAfter = await vault.balanceOf(aliceAddress);
        const crvCvxSenderBalanceAfter = await phase2.cvxCrv.balanceOf(deployerAddress);
        const crvCvxStakerBalanceAfter = await phase2.cvxCrv.balanceOf(auraBalStaker.address);

        expect(vaultReceiverBalanceAfter, "receiver balance").to.be.eq(vaultReceiverBalanceBefore.add(amount));
        expect(crvCvxSenderBalanceAfter, "sender balance").to.be.eq(crvCvxSenderBalanceBefore.sub(amount));
        expect(crvCvxStakerBalanceAfter, "staker balance").to.be.eq(ZERO);
    });
});
