import hre, { network } from "hardhat";
import { expect } from "chai";
import { BigNumberish, ethers } from "ethers";
import { parseEther } from "ethers/lib/utils";

import {
    Account,
    IBalancerVault,
    MockERC20__factory,
    IBalancerVault__factory,
    IERC20,
    IERC20__factory,
    AuraClaimZapV2,
} from "../types";
import { simpleToExactAmount } from "../test-utils/math";
import { Phase2Deployed, Phase6Deployed } from "../scripts/deploySystem";
import { impersonate, impersonateAccount, increaseTime } from "../test-utils";
import { ZERO_ADDRESS, DEAD_ADDRESS, ONE_WEEK } from "../test-utils/constants";
import { deployAuraClaimZapV2 } from "../scripts/deployAuraClaimZapV2";
import { config } from "../tasks/deploy/mainnet-config";

// Constants
const DEBUG = false;
const FORK_BLOCK = 16370000;
const DEPOSIT_AMOUNT = simpleToExactAmount(10);
const DEPLOYER = "0xA28ea848801da877E1844F954FF388e857d405e5";

async function impersonateAndTransfer(tokenAddress: string, from: string, to: string, amount: BigNumberish) {
    const tokenWhaleSigner = await impersonateAccount(from);
    const token = MockERC20__factory.connect(tokenAddress, tokenWhaleSigner.signer);
    await token.transfer(to, amount);
}

describe("AuraClaimZapV2", () => {
    let claimZapV2: AuraClaimZapV2;

    let dao: Account;
    let deployer: Account;
    let depositor: Account;
    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    let bVault: IBalancerVault;
    let wethToken: IERC20;
    let balToken: IERC20;
    let balWethBptToken: IERC20;

    /* -------------------------------------------------------------------------
     * Helper functions
     * ----------------------------------------------------------------------- */

    async function getEth(recipient: string) {
        const ethWhale = await impersonate(config.addresses.weth);
        await ethWhale.sendTransaction({
            to: recipient,
            value: simpleToExactAmount(1),
        });
    }

    async function getAuraBal(to: string, amount: BigNumberish) {
        const auraBalWhaleAddr = "0xcaab2680d81df6b3e2ece585bb45cee97bf30cd7";
        const auraBalWhale = await impersonateAccount(auraBalWhaleAddr);
        await phase2.cvxCrv.connect(auraBalWhale.signer).transfer(to, amount);
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

        deployer = await impersonateAccount(DEPLOYER, true);
        depositor = await impersonateAccount(await accounts[0].getAddress(), true);
        dao = await impersonateAccount(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(dao.signer);
        phase6 = await config.getPhase6(dao.signer);

        bVault = IBalancerVault__factory.connect(config.addresses.balancerVault, dao.signer);
        wethToken = IERC20__factory.connect(config.addresses.weth, dao.signer);
        balToken = IERC20__factory.connect(config.addresses.token, dao.signer);
        balWethBptToken = IERC20__factory.connect(config.addresses.tokenBpt, dao.signer);

        await getAuraBal(deployer.address, parseEther("100"));
        await getAuraBal(depositor.address, parseEther("100"));
    });

    /* -------------------------------------------------------------------------
     * Tests
     * ----------------------------------------------------------------------- */

    it("deploy", async () => {
        const result = await deployAuraClaimZapV2(hre, deployer.signer, DEBUG);

        claimZapV2 = result.claimZapV2;
    });
});
