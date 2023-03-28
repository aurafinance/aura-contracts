import hre, { network } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { BigNumberish, ethers } from "ethers";
import { parseEther } from "ethers/lib/utils";

import { Account, IERC20, IERC20__factory, VeBalGrant, VeBalGrant__factory } from "../../../types";
import { impersonateAccount, increaseTime } from "../../../test-utils";
import { ZERO_ADDRESS, ONE_WEEK } from "../../../test-utils/constants";
import { deployVeBalGrant } from "../../../scripts/deployVeBalGrant";
import { config } from "../../../tasks/deploy/mainnet-config";

// Constants
const DEBUG = false;
const FORK_BLOCK = 16880000;
const DEPLOYER = "0xA28ea848801da877E1844F954FF388e857d405e5";

describe("VeBalGrant", () => {
    let veBalGrant: VeBalGrant;
    let dao: Account;
    let deployer: Account;
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

    async function getWeth(to: string, amount: BigNumberish) {
        const wethWhale = await impersonateAccount(config.addresses.wethWhale);
        await IERC20__factory.connect(config.addresses.weth, wethWhale.signer).transfer(to, amount);
    }

    async function getBpt(to: string, amount: BigNumberish) {
        const bptWhaleAddress = "0x24FAf482304Ed21F82c86ED5fEb0EA313231a808";
        const bptWhale = await impersonateAccount(bptWhaleAddress);
        await IERC20__factory.connect(config.addresses.tokenBpt, bptWhale.signer).transfer(to, amount);
    }

    async function allowContract(contract: string) {
        const smartContractCheckerAddress = "0x7869296Efd0a76872fEE62A058C8fBca5c1c826C";
        const balancerMultisig = "0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f";
        const msig = await impersonateAccount(balancerMultisig);
        const abi = ["function allowlistAddress(address contractAddress)"];

        const scChecker = new ethers.Contract(smartContractCheckerAddress, abi);
        await scChecker.connect(msig.signer).allowlistAddress(contract);
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
        dao = await impersonateAccount(config.multisigs.daoMultisig);
        balToken = IERC20__factory.connect(config.addresses.token, dao.signer);
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
        expect(await veBalGrant.project()).to.be.eq(projectAddress);
        expect(await veBalGrant.balancer()).to.be.eq(balancerAddress);
        expect(await veBalGrant.BALANCER_VAULT()).to.be.eq(config.addresses.balancerVault);
        expect(await veBalGrant.BAL_ETH_POOL_ID()).to.be.eq(config.addresses.balancerPoolId);
        expect(await veBalGrant.active()).to.be.eq(true);
    });

    it("approvals should be correct", async () => {
        expect(await balToken.allowance(veBalGrant.address, config.addresses.balancerVault)).gte(
            ethers.constants.MaxUint256,
        );

        const wethToken = await IERC20__factory.connect(config.addresses.weth, project);
        expect(await wethToken.allowance(veBalGrant.address, config.addresses.balancerVault)).gte(
            ethers.constants.MaxUint256,
        );
    });

    it("balancer can create initial lock", async () => {
        //fund the vebalgrant
        await getBal(veBalGrant.address, parseEther("50000"));
        await getWeth(veBalGrant.address, parseEther("45"));

        //allow the sc in the allowlist
        await allowContract(veBalGrant.address);

        const unlockTime = 1703721600; // Thursday, 28 December 2023 00:00:00
        const startVeBalance = await veBalGrant.veBalance();

        await veBalGrant.connect(balancer).createLock(unlockTime, "0");

        const endVeBalance = await veBalGrant.veBalance();
        expect(await veBalGrant.unlockTime()).to.be.eq(unlockTime);
        expect(endVeBalance).to.be.gt(startVeBalance);
    });

    it("project can increase lock length", async () => {
        const unlockTime = 1709769600; // Thursday, 7 March 2024 00:00:00
        const startVeBalance = await veBalGrant.veBalance();

        await veBalGrant.connect(project).increaseTime(unlockTime);

        const endVeBalance = await veBalGrant.veBalance();
        expect(await veBalGrant.unlockTime()).to.be.eq(unlockTime);
        expect(endVeBalance).to.be.gt(startVeBalance);
    });

    it("balancer are able to increase lock size", async () => {
        const bptToken = await IERC20__factory.connect(config.addresses.tokenBpt, project);
        const wethToken = await IERC20__factory.connect(config.addresses.weth, project);

        await getBal(veBalGrant.address, parseEther("100"));
        await getWeth(veBalGrant.address, parseEther("2"));
        await getBpt(veBalGrant.address, parseEther("1"));

        const startVeBalance = await veBalGrant.veBalance();

        await veBalGrant.connect(balancer).increaseLock("0");

        const endVeBalance = await veBalGrant.veBalance();
        expect(endVeBalance).to.be.gt(startVeBalance);

        const escrowWethBalance = await wethToken.balanceOf(veBalGrant.address);
        const escrowBalBalance = await balToken.balanceOf(veBalGrant.address);
        const escrowBPTBalance = await bptToken.balanceOf(veBalGrant.address);
        expect(escrowWethBalance).to.be.eq("0");
        expect(escrowBalBalance).to.be.eq("0");
        expect(escrowBPTBalance).to.be.eq("0");
        expect(endVeBalance).to.be.gt(startVeBalance);
    });

    it("can claim bal and lock it", async () => {
        await increaseTime(ONE_WEEK.mul("4"));

        const abi = ["function depositToken(address token, uint amount)", "function checkpointToken(address token)"];
        const dist = new ethers.Contract(config.addresses.feeDistribution, abi);

        await dist.connect(balancer).checkpointToken(balToken.address);
        await getBal(config.addresses.feeDistribution, parseEther("1000"));
        await dist.connect(balancer).checkpointToken(balToken.address);

        await increaseTime(ONE_WEEK.mul("4"));

        const startVeBalance = await veBalGrant.veBalance();

        await veBalGrant
            .connect(project)
            .claimFees(config.addresses.feeDistribution, config.addresses.token, ZERO_ADDRESS, "0");

        const endVeBalance = await veBalGrant.veBalance();
        const wethToken = await IERC20__factory.connect(config.addresses.weth, project);
        const bptToken = await IERC20__factory.connect(config.addresses.tokenBpt, project);
        const escrowWethBalance = await wethToken.balanceOf(veBalGrant.address);
        const escrowBalBalance = await balToken.balanceOf(veBalGrant.address);
        const escrowBPTBalance = await bptToken.balanceOf(veBalGrant.address);
        expect(escrowWethBalance).to.be.eq("0");
        expect(escrowBalBalance).to.be.eq("0");
        expect(escrowBPTBalance).to.be.eq("0");
        expect(endVeBalance).to.be.gt(startVeBalance);
    });

    it("project can call execute to call hidden hand and forward rewards", async () => {
        const hiddenHandBalancer = "0x7Cdf753b45AB0729bcFe33DC12401E55d28308A9";
        const abi = ["function setRewardForwarding(address to)"];
        const iface = new ethers.utils.Interface(abi);
        const data = iface.encodeFunctionData("setRewardForwarding", [balancerAddress]);

        await veBalGrant.connect(project).execute(hiddenHandBalancer, "0", data);
    });

    it("project can vote for a gauge", async () => {
        const gauge = config.addresses.gauges[0];

        await veBalGrant.connect(project).voteGaugeWeight(gauge, "100");
    });

    it("balancer are able to toggle the contract active state", async () => {
        await veBalGrant.connect(balancer).setActive(false);

        expect(await veBalGrant.active()).to.be.eq(false);
    });

    it("balancer can call execute to call hidden hand and forward rewards", async () => {
        const hiddenHandBalancer = "0x7Cdf753b45AB0729bcFe33DC12401E55d28308A9";
        const abi = ["function setRewardForwarding(address to)"];
        const iface = new ethers.utils.Interface(abi);
        const data = iface.encodeFunctionData("setRewardForwarding", [balancerAddress]);

        await veBalGrant.connect(balancer).execute(hiddenHandBalancer, "0", data);
    });

    it("balancer can vote for a gauge", async () => {
        await increaseTime(ONE_WEEK.mul("4"));
        const gauge = config.addresses.gauges[0];

        await veBalGrant.connect(balancer).voteGaugeWeight(gauge, "100");
    });

    it("can withdraw from ve when lock ends", async () => {
        await increaseTime(ONE_WEEK.mul("52"));
        const bptToken = await IERC20__factory.connect(config.addresses.tokenBpt, project);
        const escrowStartBPTBalance = await bptToken.balanceOf(veBalGrant.address);

        await veBalGrant.connect(balancer).release();

        const escrowEndBPTBalance = await bptToken.balanceOf(veBalGrant.address);
        expect(escrowEndBPTBalance).to.be.gt(escrowStartBPTBalance);
    });

    it("can redeem bpt to underlying tokens", async () => {
        const wethToken = await IERC20__factory.connect(config.addresses.weth, project);
        const bptToken = await IERC20__factory.connect(config.addresses.tokenBpt, project);
        const escrowStartWethBalance = await wethToken.balanceOf(veBalGrant.address);
        const escrowStartBalBalance = await balToken.balanceOf(veBalGrant.address);

        await veBalGrant.connect(balancer).redeem("0", "0");

        const escrowEndWethBalance = await wethToken.balanceOf(veBalGrant.address);
        const escrowEndBalBalance = await balToken.balanceOf(veBalGrant.address);
        const escrowEndBPTBalance = await bptToken.balanceOf(veBalGrant.address);

        expect(escrowEndWethBalance).to.be.gt(escrowStartWethBalance);
        expect(escrowEndBalBalance).to.be.gt(escrowStartBalBalance);
        expect(escrowEndBPTBalance).to.be.eq("0");
    });

    it("can withdraw underlying tokens to project and balancer", async () => {
        const wethToken = await IERC20__factory.connect(config.addresses.weth, project);
        const projectStartWethBalance = await wethToken.balanceOf(projectAddress);
        const balancerStartBalBalance = await balToken.balanceOf(balancerAddress);

        await veBalGrant.connect(balancer).withdrawBalances();

        const projectEndWethBalance = await wethToken.balanceOf(projectAddress);
        const balancerEndBalBalance = await balToken.balanceOf(balancerAddress);
        const escrowEndWethBalance = await wethToken.balanceOf(veBalGrant.address);
        const escrowEndBalBalance = await balToken.balanceOf(veBalGrant.address);

        expect(projectEndWethBalance).to.be.gt(projectStartWethBalance);
        expect(balancerEndBalBalance).to.be.gt(balancerStartBalBalance);
        expect(escrowEndWethBalance).to.be.eq("0");
        expect(escrowEndBalBalance).to.be.eq("0");
        expect(await veBalGrant.totalEthContributed()).to.be.eq("0");
    });
});
