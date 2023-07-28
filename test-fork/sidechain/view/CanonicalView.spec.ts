import hre, { network } from "hardhat";
import { deployCanonicalView } from "../../../scripts/deploySidechain";

import { config } from "../../../tasks/deploy/mainnet-config";
import { impersonateAccount } from "../../../test-utils";
import { Account, CanonicalView } from "../../../types";

describe("Sidechain", () => {
    let deployer: Account;
    let canonicalView: CanonicalView;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.ETHEREUM_NODE_URL,
                    },
                },
            ],
        });

        deployer = await impersonateAccount(config.multisigs.daoMultisig, true);

        const ext = config.addresses;
        const phase2 = await config.getPhase2(deployer.signer);
        const vault = await config.getAuraBalVault(deployer.signer);
        const canonical = await config.getSidechain(deployer.signer);

        const viewDeployment = await deployCanonicalView(hre, deployer.signer, ext, phase2, vault, canonical);
        canonicalView = viewDeployment.canonicalView;
    });

    /* ---------------------------------------------------------------------
     * View Testing
     * --------------------------------------------------------------------- */

    describe("Can Call View Functions", () => {
        const sidechainId = 110;
        it("Get L1 Coordinator Data", async () => {
            const data = await canonicalView.getL1CoordData();
            console.log(data);
        });
        it("Get L1 Coordinator Data for one chain", async () => {
            const data = await canonicalView.getL1CoordSidechainData(sidechainId);
            console.log(data);
        });
        it("Get getAuraProxyOftData", async () => {
            const data = await canonicalView.getAuraProxyOftData();
            console.log(data);
        });
        it("Get getAuraProxyOftData", async () => {
            const data = await canonicalView.getAuraProxyOftData();
            console.log(data);
        });
        it("Get getAuraBalProxySidechainData", async () => {
            const data = await canonicalView.getAuraBalProxySidechainData(sidechainId);
            console.log(data);
        });
        it("Get getCanonicalData", async () => {
            const data = await canonicalView.getCanonicalData([sidechainId]);
            console.log(data);
        });
    });
});
