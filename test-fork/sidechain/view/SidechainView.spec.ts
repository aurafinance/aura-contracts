import hre, { network } from "hardhat";
import { deploySidechainView } from "../../../scripts/deploySidechain";

import { config } from "../../../tasks/deploy/gnosis-config";
import { impersonateAccount } from "../../../test-utils";
import { Account, SidechainView } from "../../../types";

describe("Sidechain", () => {
    let deployer: Account;
    let sidechainView: SidechainView;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.GNOSIS_NODE_URL,
                        blockNumber: 28498740,
                    },
                },
            ],
        });

        deployer = await impersonateAccount(config.multisigs.daoMultisig, true);
        const sidechainLzChainId = 101;

        const viewDeployment = await deploySidechainView(
            sidechainLzChainId,
            config.getSidechain(deployer.signer),
            hre,
            deployer.signer,
        );
        sidechainView = viewDeployment.sidechainView;
    });

    /* ---------------------------------------------------------------------
     * View Testing
     * --------------------------------------------------------------------- */

    describe("Can Call View Functions", () => {
        it("Get L2 Coordinator Data", async () => {
            const data = await sidechainView.getl2CoordinatorInformation();
            console.log(data);

            console.log(await sidechainView.auraBalStrategy());
        });
        it("Get AuraOft Data", async () => {
            const data = await sidechainView.getAuraOftData();
            console.log(data);
        });
        it("Get AuraBalOft Data", async () => {
            const data = await sidechainView.getAuraBalOftData();
            console.log(data);
        });
        it("Get SidechainData", async () => {
            const data = await sidechainView.getData();
            console.log(data);
        });
        it("Get SidechainData and balances", async () => {
            const data = await sidechainView.getDataAndBalances(deployer.address);
            console.log(data);
        });
    });
});
