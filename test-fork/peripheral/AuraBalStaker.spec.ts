import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";

import {
    Account,
    AuraBalVault,
    AuraBalStaker,
    ERC20__factory,
    ERC20,
    CvxCrvToken,
    CvxCrvToken__factory,
} from "../../types";
import { deployAuraBalStaker } from "../../scripts/deployPeripheral";
import { config } from "../../tasks/deploy/mainnet-config";
import { assertBNClosePercent, impersonateAccount } from "../../test-utils";
import { Phase2Deployed } from "../../scripts/deploySystem";

const FORK_BLOCK_NUMBER = 16939866;

describe("AuraBalStaker", () => {
    let acc: Account;
    let phase2: Phase2Deployed;
    let vault: AuraBalVault;
    let staker: AuraBalStaker;
    let auraBal: CvxCrvToken;
    let crvBpt: ERC20;

    const amount = ethers.utils.parseEther("10");

    const getBalEthBpt = async (to: string, amount: BigNumberish) => {
        const s = await impersonateAccount(config.addresses.balancerVault, true);
        await crvBpt.connect(s.signer).transfer(to, amount);
    };

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: FORK_BLOCK_NUMBER,
                    },
                },
            ],
        });

        const signers = await ethers.getSigners();
        acc = await impersonateAccount(await signers[0].getAddress(), true);
        phase2 = await config.getPhase2(acc.signer);
        const vaultPhase = await config.getAuraBalVault(acc.signer);
        vault = vaultPhase.vault;
        auraBal = CvxCrvToken__factory.connect(phase2.cvxCrv.address, acc.signer);
        crvBpt = ERC20__factory.connect(config.addresses.tokenBpt, acc.signer);
    });

    it("Deploy AuraBalStaker", async () => {
        staker = await deployAuraBalStaker(hre, acc.signer, vault, auraBal);
        expect(await staker.vault()).eq(vault.address);
        expect(await staker.auraBal()).eq(auraBal.address);
        expect(await auraBal.allowance(staker.address, vault.address)).eq(ethers.constants.MaxUint256);
    });

    it("Deposit into the vault via the AuraBalStaker", async () => {
        await getBalEthBpt(acc.address, amount);
        const totalSupplyBefore = await auraBal.totalSupply();
        const totalUnderlyingBefore = await vault.totalUnderlying();
        const userSharesBefore = await vault.balanceOf(acc.address);
        const userUnderlyingBefore = await vault.balanceOfUnderlying(acc.address);

        await crvBpt.approve(phase2.crvDepositor.address, ethers.constants.MaxUint256);
        await phase2.crvDepositor["deposit(uint256,bool,address)"](amount, true, staker.address);

        const totalSupplyAfter = await auraBal.totalSupply();
        const totalUnderlyingAfter = await vault.totalUnderlying();
        const userSharesAfter = await vault.balanceOf(acc.address);
        const userUnderlyingAfter = await vault.balanceOfUnderlying(acc.address);

        expect(totalSupplyAfter.sub(totalSupplyBefore)).eq(amount);
        expect(totalUnderlyingAfter.sub(totalUnderlyingBefore)).eq(amount);
        expect(userSharesAfter).gt(userSharesBefore);
        assertBNClosePercent(userUnderlyingAfter.sub(userUnderlyingBefore), amount, "0.001");
        expect(await auraBal.balanceOf(staker.address)).eq(0);
    });
});
