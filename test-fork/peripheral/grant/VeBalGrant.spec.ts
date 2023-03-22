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
    let hiddenHandAddress: string;

    /* -------------------------------------------------------------------------
     * Helper functions
     * ----------------------------------------------------------------------- */

    async function getBal(to: string, amount: BigNumberish) {
        const balWhaleAddr = "0x740a4AEEfb44484853AA96aB12545FC0290805F3";
        const balWhale = await impersonateAccount(balWhaleAddr);
        await IERC20__factory.connect(config.addresses.token, balWhale.signer).transfer(to, amount);
    }

    async function getWeth(to: string, amount: BigNumberish) {
        const wethWhale = await impersonateAccount(config.addresses.wethWhale);
        const weth = IERC20__factory.connect(config.addresses.weth, wethWhale.signer);
        await IERC20__factory.connect(config.addresses.token, wethWhale.signer).transfer(to, amount);
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
        hiddenHandAddress = "0x7Cdf753b45AB0729bcFe33DC12401E55d28308A9";

        getBal(balancerAddress, parseEther("50000"));
    });

    /* -------------------------------------------------------------------------
     * Tests
     * ----------------------------------------------------------------------- */

    it("Deploy VeBalEscrow", async () => {
        //Deploy
        const result = await deployVeBalGrant(hre, deployer.signer, projectAddress, balancerAddress, DEBUG);
        veBalGrant = result.veBalGrant;
    });

    it("initial configuration is correct", async () => {
        expect(await veBalGrant.WETH()).to.be.eq(config.addresses.weth);
        expect(await veBalGrant.BAL()).to.be.eq(config.addresses.token);
        expect(await veBalGrant.BAL_ETH_BPT()).to.be.eq(config.addresses.tokenBpt);
        expect(await veBalGrant.votingEscrow()).to.be.eq(config.addresses.votingEscrow);
        expect(await veBalGrant.gaugeController()).to.be.eq(config.addresses.gaugeController);
        expect(await veBalGrant.balMinter()).to.be.eq(config.addresses.minter);
        expect(await veBalGrant.veBalGauge()).to.be.eq(config.addresses.feeDistribution);
        expect(await veBalGrant.project()).to.be.eq(projectAddress);
        expect(await veBalGrant.balancer()).to.be.eq(balancerAddress);
        expect(await veBalGrant.hiddenHand()).to.be.eq(hiddenHandAddress);
        expect(await veBalGrant.BALANCER_VAULT()).to.be.eq(config.addresses.balancerVault);
        expect(await veBalGrant.BAL_ETH_POOL_ID()).to.be.eq(config.addresses.balancerPoolId);
        expect(await veBalGrant.active()).to.be.eq(false);
    });

    it("balancer may fund the grant", async () => {
        const grantAmount = parseEther("50000");
        await balToken.connect(balancer).approve(veBalGrant.address, grantAmount);
        await veBalGrant.connect(balancer).fundGrant(grantAmount);

        expect(await balToken.balanceOf(veBalGrant.address)).to.be.eq(grantAmount);
        expect(await veBalGrant.active()).to.be.eq(true);
    });
});
