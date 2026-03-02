import { expect } from "chai";
import { Signer } from "ethers";
import hre, { network } from "hardhat";
import { deployChefForwarderClaimerModule } from "../../scripts/deployPeripheral";
import { Phase3Deployed } from "../../scripts/deploySystem";
import { config } from "../../tasks/deploy/mainnet-config";
import { impersonate } from "../../test-utils";
import { ChefForwarder__factory, ChefForwarderClaimerModule, ISafe, ISafe__factory } from "../../types";

describe("ChefForwarderClaimerModule", () => {
    let incentivesMultisig: Signer;
    let deployer: Signer;
    let deployerAddress: string;
    let contracts: Phase3Deployed;
    let chefForwarderClaimerModule: ChefForwarderClaimerModule;
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
            ({ chefForwarderClaimerModule } = await deployChefForwarderClaimerModule(hre, deployer, config.multisigs, {
                cvx: contracts.cvx,
                chefForwarder: ChefForwarder__factory.connect("0x57d23f0f101cBd25A05Fc56Fd07dE32bCBb622e9", deployer),
            }));

            expect(await chefForwarderClaimerModule.owner(), "owner").to.be.eq(config.multisigs.incentivesMultisig);
            expect(await chefForwarderClaimerModule.safeWallet(), "safeWallet").to.be.eq(
                config.multisigs.incentivesMultisig,
            );
            expect(await chefForwarderClaimerModule.cvx(), "safeWallet").to.be.eq(contracts.cvx.address);
        });

        it("configures the module", async () => {
            expect(await safe.isModuleEnabled(chefForwarderClaimerModule.address), "isEnabled").to.be.eq(false);
            await safe.enableModule(chefForwarderClaimerModule.address);
            expect(await safe.isModuleEnabled(chefForwarderClaimerModule.address), "isEnabled").to.be.eq(true);
        });
    });

    describe("claimFromChef", async () => {
        it("fails if keeper is not the caller", async () => {
            const authorizedKeepers = await chefForwarderClaimerModule.authorizedKeepers(await deployer.getAddress());
            expect(authorizedKeepers, "authorizedKeepers").to.be.eq(false);
            await expect(chefForwarderClaimerModule.connect(deployer).claimFromChef()).to.be.revertedWith("!keeper");
        });

        it("only keeper can execute task", async () => {
            const initialBalance = await contracts.cvx.balanceOf(config.multisigs.incentivesMultisig);
            const authorizedKeepers = await chefForwarderClaimerModule.authorizedKeepers(
                config.multisigs.defender.keeperMulticall3,
            );
            expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
            const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);

            const tx = await chefForwarderClaimerModule.connect(keeper).claimFromChef();

            const finalBalance = await contracts.cvx.balanceOf(config.multisigs.incentivesMultisig);
            const moduleBalance = await contracts.cvx.balanceOf(chefForwarderClaimerModule.address);
            const cvxClaimed = finalBalance.sub(initialBalance);
            expect(cvxClaimed, "cvx balance increased").to.be.gt(0);
            expect(moduleBalance, "module cvx balance").to.be.eq(0);
            await expect(tx).to.emit(chefForwarderClaimerModule, "CvxClaimed").withArgs(cvxClaimed);
        });
    });
});
