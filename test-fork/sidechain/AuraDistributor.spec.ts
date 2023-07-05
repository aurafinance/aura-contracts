import { expect } from "chai";
import hre, { ethers } from "hardhat";

import { config } from "../../tasks/deploy/mainnet-config";
import { impersonateAccount, simpleToExactAmount, ZERO_ADDRESS } from "../../test-utils";
import { Account, AuraDistributor, ERC20, ERC20__factory } from "../../types";
import { CanonicalPhase1Deployed, CanonicalPhase2Deployed, deployAuraDistributor } from "../../scripts/deploySidechain";

describe("AuraDistributor", () => {
    let dao: Account;
    let deployer: Account;
    let account: Account;

    let balToken: ERC20;
    let auraDistributor: AuraDistributor;
    let canonical: CanonicalPhase1Deployed & CanonicalPhase2Deployed;

    const runBefore = async () => {
        await hre.network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 17598234,
                    },
                },
            ],
        });

        await impersonateAccount(config.multisigs.daoMultisig);
        const signers = await ethers.getSigners();
        dao = await impersonateAccount(config.multisigs.daoMultisig, true);
        deployer = await impersonateAccount(await signers[0].getAddress());
        account = await impersonateAccount(await signers[1].getAddress());

        canonical = config.getSidechain(deployer.signer);

        const result = await deployAuraDistributor(config.addresses, config.multisigs, canonical, hre, deployer.signer);
        auraDistributor = result.auraDistributor;

        balToken = ERC20__factory.connect(config.addresses.token, deployer.signer);

        const balWhale = await impersonateAccount(config.addresses.balancerVault, true);
        await balToken.connect(balWhale.signer).transfer(auraDistributor.address, simpleToExactAmount(1000));

        await canonical.l1Coordinator.connect(dao.signer).setDistributor(auraDistributor.address, true);
        await auraDistributor.connect(dao.signer).setDistributor(deployer.address);
    };

    describe("basic", () => {
        before(runBefore);

        it("has the correct config", async () => {
            expect(await auraDistributor.balToken()).eq(config.addresses.token);
            expect(await auraDistributor.l1Coordinator()).eq(canonical.l1Coordinator.address);
            expect(await auraDistributor.treasury()).eq(config.multisigs.treasuryMultisig);
        });

        it("protected functions", async () => {
            const ad = auraDistributor.connect(account.signer);
            const errorMsg = "Ownable: caller is not the owner";
            // Not owner
            await expect(ad.withdrawEthBalance()).to.be.revertedWith(errorMsg);
            await expect(ad.withdrawERC20(balToken.address, simpleToExactAmount(1))).to.be.revertedWith(errorMsg);
            await expect(ad.setDistributor(deployer.address)).to.be.revertedWith(errorMsg);
            // Not distributor
            await expect(ad.distributeAura([], [], [], [], [])).to.be.revertedWith("!distributor");
        });

        it("set distributor", async () => {
            let distributor = await auraDistributor.distributor();
            expect(distributor).not.eq(account.address);
            await auraDistributor.connect(dao.signer).setDistributor(account.address);
            distributor = await auraDistributor.distributor();
            expect(distributor).eq(account.address);
        });

        it("withdraw ERC20", async () => {
            const balance = async (a: string) => balToken.balanceOf(a);

            const adBalanceBefore = await balance(auraDistributor.address);
            const treasuryBalanceBefore = await balance(config.multisigs.treasuryMultisig);

            const amount = simpleToExactAmount(10);
            await auraDistributor.connect(dao.signer).withdrawERC20(balToken.address, amount);

            const adBalanceAfter = await balance(auraDistributor.address);
            const treasuryBalanceAfter = await balance(config.multisigs.treasuryMultisig);

            expect(adBalanceBefore.sub(adBalanceAfter)).eq(amount);
            expect(treasuryBalanceAfter.sub(treasuryBalanceBefore)).eq(amount);
        });

        it("withdraw ETH", async () => {
            const amount = simpleToExactAmount(1);
            await deployer.signer.sendTransaction({ to: auraDistributor.address, value: amount });

            const ethBalance = (a: string) => ethers.provider.getBalance(a);
            const ethBalanceBefore = await ethBalance(auraDistributor.address);
            const treasuryEthBalanceBefore = await ethBalance(config.multisigs.treasuryMultisig);
            expect(ethBalanceBefore).gte(amount);

            await auraDistributor.connect(dao.signer).withdrawEthBalance();

            const ethBalanceAfter = await ethBalance(auraDistributor.address);
            const treasuryEthBalanceAfter = await ethBalance(config.multisigs.treasuryMultisig);
            expect(treasuryEthBalanceAfter.sub(treasuryEthBalanceBefore)).eq(amount);
            expect(ethBalanceAfter).eq(0);
        });
    });

    describe("distributeAura()", () => {
        beforeEach(runBefore);

        const runDistributeAura = async () => {
            const distributedFeeDebtOf = () => canonical.l1Coordinator.distributedFeeDebtOf(110);
            const balBalance = () => balToken.balanceOf(auraDistributor.address);

            const distributedFeeDebtBefore = await distributedFeeDebtOf();
            const balBalanceBefore = await balBalance();

            await auraDistributor.distributeAura(
                [110],
                [ZERO_ADDRESS],
                [ZERO_ADDRESS],
                [[]],
                [simpleToExactAmount(0.1)],
                { value: simpleToExactAmount(0.1) },
            );

            const distributedFeeDebtAfter = await distributedFeeDebtOf();
            const balBalanceAfter = await balBalance();

            const distributed = distributedFeeDebtAfter.sub(distributedFeeDebtBefore);
            const balBalanceDelta = balBalanceBefore.sub(balBalanceAfter);

            return { distributed, balBalanceDelta };
        };

        it("L1Coordinator has enough BAL", async () => {
            const { distributed, balBalanceDelta } = await runDistributeAura();

            expect(balBalanceDelta).eq(0);
            expect(distributed).gt(0);
        });

        it("L1Coordinator needs more BAL", async () => {
            const balBalance = () => balToken.balanceOf(l1Coordinator.address);

            const l1Coordinator = await impersonateAccount(canonical.l1Coordinator.address, true);
            const balance = await balBalance();
            await balToken.connect(l1Coordinator.signer).transfer(deployer.address, balance);
            expect(await balBalance()).eq(0);

            const { distributed, balBalanceDelta } = await runDistributeAura();

            expect(balBalanceDelta).eq(distributed);
            expect(distributed).gt(0);
        });

        it("Cannot be called with wrong argument length", async () => {
            await expect(
                auraDistributor.distributeAura([], [ZERO_ADDRESS], [ZERO_ADDRESS], [[]], [simpleToExactAmount(0.1)], {
                    value: simpleToExactAmount(0.1),
                }),
            ).to.be.revertedWith("!length");

            await expect(
                auraDistributor.distributeAura([110], [], [ZERO_ADDRESS], [[]], [simpleToExactAmount(0.1)], {
                    value: simpleToExactAmount(0.1),
                }),
            ).to.be.revertedWith("!length");

            await expect(
                auraDistributor.distributeAura([110], [ZERO_ADDRESS], [], [[]], [simpleToExactAmount(0.1)], {
                    value: simpleToExactAmount(0.1),
                }),
            ).to.be.revertedWith("!length");

            await expect(
                auraDistributor.distributeAura([110], [ZERO_ADDRESS], [ZERO_ADDRESS], [], [simpleToExactAmount(0.1)], {
                    value: simpleToExactAmount(0.1),
                }),
            ).to.be.revertedWith("!length");

            await expect(
                auraDistributor.distributeAura([110], [ZERO_ADDRESS], [ZERO_ADDRESS], [[]], [], {
                    value: simpleToExactAmount(0.1),
                }),
            ).to.be.revertedWith("!length");
        });
    });
});
