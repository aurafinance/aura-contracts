import { expect } from "chai";
import { Signer } from "ethers";
import hre, { network } from "hardhat";
import { deployHHChefClaimBriberModule } from "../../scripts/deployPeripheral";
import { Phase3Deployed } from "../../scripts/deploySystem";
import { config } from "../../tasks/deploy/mainnet-config";
import { impersonate } from "../../test-utils";
import { ChefForwarder__factory, HHChefClaimBriberModule, ISafe, ISafe__factory } from "../../types";

describe("HHChefClaimBriberModule", () => {
    let incentivesMultisig: Signer;
    let deployer: Signer;
    let deployerAddress: string;
    let contracts: Phase3Deployed;
    let hhChefClaimBriberModule: HHChefClaimBriberModule;
    let safe: ISafe;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 21336316, //21335583,
                    },
                },
            ],
        });
        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        deployer = await impersonate(deployerAddress, true);
        incentivesMultisig = await impersonate(config.multisigs.incentivesMultisig, true);
        contracts = await config.getPhase4(deployer);

        safe = ISafe__factory.connect(config.multisigs.incentivesMultisig, incentivesMultisig);
    });
    describe("setup", async () => {
        it("deploys module", async () => {
            ({ hhChefClaimBriberModule } = await deployHHChefClaimBriberModule(hre, deployer, config.multisigs, {
                cvx: contracts.cvx,
                chefForwarder: ChefForwarder__factory.connect("0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9", deployer),
            }));

            expect(await hhChefClaimBriberModule.owner(), "owner").to.be.eq(config.multisigs.incentivesMultisig);
            expect(await hhChefClaimBriberModule.safeWallet(), "safeWallet").to.be.eq(
                config.multisigs.incentivesMultisig,
            );
            expect(await hhChefClaimBriberModule.cvx(), "safeWallet").to.be.eq(contracts.cvx.address);
        });

        it("configures the module", async () => {
            expect(await safe.isModuleEnabled(hhChefClaimBriberModule.address), "isEnabled").to.be.eq(false);
            await safe.enableModule(hhChefClaimBriberModule.address);
            expect(await safe.isModuleEnabled(hhChefClaimBriberModule.address), "isEnabled").to.be.eq(true);
        });
    });
    describe("claimFromChef", async () => {
        it("fails if keeper is not the caller", async () => {
            const authorizedKeepers = await hhChefClaimBriberModule.authorizedKeepers(await deployer.getAddress());
            expect(authorizedKeepers, "authorizedKeepers").to.be.eq(false);
            await expect(hhChefClaimBriberModule.connect(deployer).claimFromChef()).to.be.revertedWith("!keeper");
        });
        it("only keeper can execute task", async () => {
            const initialBalance = await contracts.cvx.balanceOf(config.multisigs.incentivesMultisig);
            const authorizedKeepers = await hhChefClaimBriberModule.authorizedKeepers(
                config.multisigs.defender.keeperMulticall3,
            );
            expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
            const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);

            await hhChefClaimBriberModule.connect(keeper).claimFromChef();

            const finalBalance = await contracts.cvx.balanceOf(config.multisigs.incentivesMultisig);
            const moduleBalance = await contracts.cvx.balanceOf(hhChefClaimBriberModule.address);
            expect(finalBalance.sub(initialBalance), "cvx balance increased").to.be.gt(0);
            expect(moduleBalance, "module cvx balance").to.be.eq(0);
        });
    });
    describe("depositBribes", async () => {
        it("fails if keeper is not the caller", async () => {
            const authorizedKeepers = await hhChefClaimBriberModule.authorizedKeepers(await deployer.getAddress());
            expect(authorizedKeepers, "authorizedKeepers").to.be.eq(false);
            await expect(hhChefClaimBriberModule.connect(deployer).depositBribes([])).to.be.revertedWith("!keeper");
        });
        it("only keeper can execute task", async () => {
            const authorizedKeepers = await hhChefClaimBriberModule.authorizedKeepers(
                config.multisigs.defender.keeperMulticall3,
            );
            expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
            const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
            const initialBalance = await contracts.cvx.balanceOf(config.multisigs.incentivesMultisig);
            const rewardPerEpoch = await hhChefClaimBriberModule.rewardPerEpoch();

            const bribes = [
                // aura/eth veBAL  hash: 0xb355f196c7ab330d85a3a392623204f81c8f2d668baaeda4e78f87c9f50bef04 amount: 23460.0 maxTokensPerVote: 0.17
                {
                    market: "0x45Bc37b18E73A42A4a826357a8348cDC042cCBBc",
                    proposal: "0xb355f196c7ab330d85a3a392623204f81c8f2d668baaeda4e78f87c9f50bef04",
                    maxTokenPerVote: "170000000000000000",
                    amount: "23460000000000000000000",
                    periods: "2",
                },
                //  auraBAL  veBAL  hash: 0xa2b574c32fbe12ce1e12ebb850253595ef7087671c213241076b924614822a20 amount: 32059.0 maxTokensPerVote: 0.17
                {
                    market: "0x45Bc37b18E73A42A4a826357a8348cDC042cCBBc",
                    proposal: "0xa2b574c32fbe12ce1e12ebb850253595ef7087671c213241076b924614822a20",
                    maxTokenPerVote: "170000000000000000",
                    amount: "32059000000000000000000",
                    periods: "2",
                },
                // a-55/45 auraBAL/wstETH vlAURA hash: 0xffb8d412a5a5581f13e52cab6dee6cd2b5ce26a932d1f8f843e02f2223b5a8f4 amount: 6497.0 maxTokensPerVote: 0.0
                {
                    market: "0xcbf242f20d183b4116c22dd5e441b9ae15b0d35a",
                    proposal: "0xffb8d412a5a5581f13e52cab6dee6cd2b5ce26a932d1f8f843e02f2223b5a8f4",
                    maxTokenPerVote: "170000000000000000",
                    amount: "6497000000000000000000",
                    periods: "1",
                },
            ];

            await hhChefClaimBriberModule.connect(keeper).depositBribes(bribes);

            const finalBalance = await contracts.cvx.balanceOf(config.multisigs.incentivesMultisig);
            const moduleBalance = await contracts.cvx.balanceOf(hhChefClaimBriberModule.address);
            expect(finalBalance.sub(initialBalance), "cvx balance increased").to.be.lte(rewardPerEpoch);
            expect(moduleBalance, "module cvx balance").to.be.eq(0);
        });
    });
});
