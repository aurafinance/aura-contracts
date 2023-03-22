import hre, { network } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { BigNumberish, ethers } from "ethers";
import { parseEther } from "ethers/lib/utils";

import { Account, IERC20, IERC20__factory, VeBalGrant, VeBalGrant__factory } from "../../../types";
import { Phase2Deployed, Phase4Deployed, Phase6Deployed } from "../../../scripts/deploySystem";
import { impersonateAccount, increaseTime } from "../../../test-utils";
import { ZERO_ADDRESS, ZERO, ONE_WEEK } from "../../../test-utils/constants";
import { deployVeBalGrant } from "../../../scripts/deployVeBalGrant";
import { BaseRewardPool__factory } from "../../../types/generated";
import { config } from "../../../tasks/deploy/mainnet-config";

// Constants
const DEBUG = false;
const FORK_BLOCK = 16880000;
const DEPLOYER = "0xA28ea848801da877E1844F954FF388e857d405e5";

describe("VeBalGrant", () => {
    let veBalGrant: VeBalGrant;
    let dao: Account;
    let deployer: Account;
    let depositor: Account;
    let phase2: Phase2Deployed;
    let phase4: Phase4Deployed;
    let phase6: Phase6Deployed;
    let balToken: IERC20;
    let balancer: Signer;
    let balancerAddress: string;
    let project: Signer;
    let projectAddress: string;

    /* -------------------------------------------------------------------------
     * Helper functions
     * ----------------------------------------------------------------------- */

    async function getBal(to: string, amount: BigNumberish) {
        const balWhaleAddr = "0x740a4AEEfb44484853AA96aB12545FC0290805F3";
        const balWhale = await impersonateAccount(balWhaleAddr);
        await IERC20__factory.connect(config.addresses.token, balWhale.signer).transfer(to, amount);
    }

    /* -------------------------------------------------------------------------
     * Before
     * ----------------------------------------------------------------------- */

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: FORK_BLOCK,
                    },
                },
            ],
        });

        const accounts = await hre.ethers.getSigners();

        balancer = accounts[1];
        balancerAddress = await balancer.getAddress();

        project = accounts[2];
        projectAddress = await project.getAddress();

        deployer = await impersonateAccount(DEPLOYER, true);
        depositor = await impersonateAccount(await accounts[0].getAddress(), true);
        dao = await impersonateAccount(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(dao.signer);
        phase4 = await config.getPhase4(dao.signer);
        phase6 = await config.getPhase6(dao.signer);
        balToken = IERC20__factory.connect(config.addresses.token, dao.signer);
    });

    /* -------------------------------------------------------------------------
     * Tests
     * ----------------------------------------------------------------------- */

    it("Deploy VeBalEscrow", async () => {
        //Deploy
        const result = await deployVeBalGrant(hre, deployer.signer, balancerAddress, projectAddress, DEBUG);
        veBalGrant = result.veBalGrant;
    });
});
