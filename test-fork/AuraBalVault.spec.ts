import hre, { network } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";
import { parseEther } from "ethers/lib/utils";

import {
    AuraBalVault,
    IBalancerHelpers,
    IBalancerVault,
    IERC20,
    MockERC20__factory,
    Account,
    AuraBalStrategy,
    IBalancerVault__factory,
    IBalancerHelpers__factory,
    IERC20__factory,
    AuraBalVault__factory,
    AuraBalStrategy__factory,
    BBUSDHandlerv2,
    BBUSDHandlerv2__factory,
    VirtualShareRewardPool,
    VirtualShareRewardPool__factory,
} from "../types";
import { deployContract } from "../tasks/utils";
import { config } from "../tasks/deploy/mainnet-config";
import { simpleToExactAmount } from "../test-utils/math";
import { Phase2Deployed } from "../scripts/deploySystem";
import { impersonate, impersonateAccount } from "../test-utils";
import { ZERO_ADDRESS, DEAD_ADDRESS } from "../test-utils/constants";

const DEBUG = false;
const FORK_BLOCK = 16370000;
const SLIPPAGE_OUTPUT_BPS = 9950;
const SLIPPAGE_OUTPUT_SWAP = 9900;
const SLIPPAGE_OUTPUT_SCALE = 10000;

const DEPLOYER = "0xa28ea848801da877e1844f954ff388e857d405e5";

const RETH = "0xae78736Cd615f374D3085123A210448E74Fc6393";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const BAL = "0xba100000625a3754423978a60c9317c58a424e3d";
const BPT_BALWETH = "0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56";
const AURABAL = "0x616e8BfA43F920657B3497DBf40D6b1A02D4608d";

const BAL_WETH_POOL_ID = "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014";
const BPT_AURABAL_POOL_ID = "0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd000200000000000000000249";

const BBUSD_RETH_POOL_ID = "0x334c96d792e4b26b841d28f53235281cec1be1f200020000000000000000038a";
const RETH_WETH_POOL_ID = "0x1e19cf2d73a72ef1332c882f20534b6519be0276000200000000000000000112";

async function impersonateAndTransfer(tokenAddress: string, from: string, to: string, amount: BigNumberish) {
    const tokenWhaleSigner = await impersonateAccount(from);
    const token = MockERC20__factory.connect(tokenAddress, tokenWhaleSigner.signer);
    await token.transfer(to, amount);
}

describe("AuraBalVault", () => {
    let vault: AuraBalVault;
    let strategy: AuraBalStrategy;
    let bbusd: BBUSDHandlerv2;
    let auraRewards: VirtualShareRewardPool;

    let dao: Account;
    let deployer: Account;
    let phase2: Phase2Deployed;
    let bVault: IBalancerVault;
    let balancerHelpers: IBalancerHelpers;
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

    async function getBal(to: string, amount: BigNumberish) {
        await getEth(config.addresses.balancerVault);
        const tokenWhaleSigner = await impersonateAccount(config.addresses.balancerVault);
        const crv = MockERC20__factory.connect(config.addresses.token, tokenWhaleSigner.signer);
        await crv.transfer(to, amount);
    }

    async function getAura(to: string, amount: BigNumberish) {
        const whaleAddress = "0xc9Cea7A3984CefD7a8D2A0405999CB62e8d206DC";
        await impersonateAndTransfer(phase2.cvx.address, whaleAddress, to, amount);
    }

    async function getBBaUSD(to: string, amount: BigNumberish) {
        const whaleAddress = "0xe649B71783d5008d10a96b6871e3840a398d4F06";
        await impersonateAndTransfer(config.addresses.feeToken, whaleAddress, to, amount);
    }

    // Force a reward harvest by transferring BAL, BBaUSD and Aura tokens directly
    // to the reward contract the contract will then swap it for
    // auraBAL and queue it for rewards
    async function forceHarvestRewards(amount = parseEther("10")) {
        await getBal(strategy.address, amount);
        await getBBaUSD(strategy.address, amount);
        await getAura(strategy.address, amount);
        const crv = MockERC20__factory.connect(config.addresses.token, dao.signer);
        const feeToken = MockERC20__factory.connect(config.addresses.feeToken, dao.signer);

        expect(await crv.balanceOf(strategy.address), " crv balance").to.be.gt(0);
        expect(await feeToken.balanceOf(strategy.address), " feeToken balance").to.be.gt(0);
        expect(await phase2.cvx.balanceOf(strategy.address), " cvx balance").to.be.gt(0);

        await vault.connect(dao.signer)["harvest(uint256)"](0);

        expect(await crv.balanceOf(strategy.address), " crv balance").to.be.eq(0);
        expect(await feeToken.balanceOf(strategy.address), " feeToken balance").to.be.eq(0);
        expect(await phase2.cvx.balanceOf(strategy.address), " cvx balance").to.be.eq(0);
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

        deployer = await impersonateAccount(DEPLOYER, true);
        dao = await impersonateAccount(config.multisigs.daoMultisig);
        phase2 = await config.getPhase2(dao.signer);

        bVault = IBalancerVault__factory.connect(config.addresses.balancerVault, dao.signer);
        balancerHelpers = IBalancerHelpers__factory.connect(config.addresses.balancerHelpers, dao.signer);
        wethToken = IERC20__factory.connect(WETH, dao.signer);
        balToken = IERC20__factory.connect(config.addresses.token, dao.signer);
        balWethBptToken = IERC20__factory.connect("0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56", dao.signer);

        await getAuraBal(deployer.address, parseEther("100"));
    });

    /* -------------------------------------------------------------------------
     * Tests
     * ----------------------------------------------------------------------- */

    describe("deploy", () => {
        it("deploy vault", async () => {
            vault = await deployContract<AuraBalVault>(
                hre,
                new AuraBalVault__factory(deployer.signer),
                "AuraBalVault",
                [phase2.cvxCrv.address],
                {},
                DEBUG,
            );
        });
        it("deploy strategy", async () => {
            strategy = await deployContract<AuraBalStrategy>(
                hre,
                new AuraBalStrategy__factory(deployer.signer),
                "AuraBalStrategy",
                [vault.address],
                {},
                DEBUG,
            );
        });
        it("deploy bb-a-usd handler", async () => {
            bbusd = await deployContract<BBUSDHandlerv2>(
                hre,
                new BBUSDHandlerv2__factory(deployer.signer),
                "BBUSDHandlerv2",
                [config.addresses.feeToken, strategy.address],
                {},
                DEBUG,
            );
        });
        it("deploy AURA virtual share pool", async () => {
            auraRewards = await deployContract<VirtualShareRewardPool>(
                hre,
                new VirtualShareRewardPool__factory(deployer.signer),
                "VirtualShareRewardPool",
                [vault.address, phase2.cvx.address, strategy.address],
                {},
                DEBUG,
            );
        });
    });

    describe("configure", () => {
        it("set strategy", async () => {
            expect(await vault.strategy()).eq(ZERO_ADDRESS);
            await vault.setStrategy(strategy.address);
            expect(await vault.strategy()).eq(strategy.address);
            await expect(vault.setStrategy(DEAD_ADDRESS)).to.be.revertedWith("Strategy already set");
        });
        it("add reward tokens to strategy", async () => {
            expect(await strategy.totalRewardTokens()).eq(0);
            await strategy.addRewardToken(config.addresses.feeToken, bbusd.address);
            expect(await strategy.totalRewardTokens()).eq(1);
            expect(await strategy.rewardTokens(0)).eq(config.addresses.feeToken);
            expect(await strategy.rewardHandlers(config.addresses.feeToken)).eq(bbusd.address);
        });
        it("add AURA as extra reward", async () => {
            expect(await vault.extraRewardsLength()).eq(0);
            await vault.addExtraReward(auraRewards.address);
            expect(await vault.extraRewardsLength()).eq(1);
            expect(await vault.extraRewards(0)).eq(auraRewards.address);
        });
        it("set approvals", async () => {
            await strategy.setApprovals();
        });
    });

    describe("check configurations", () => {
        it("check vault is configured correctly");
        it("check auraBAL strategy is configured correctly", async () => {
            expect(await strategy.balVault()).eq(bVault.address);
            expect(await strategy.WETH_TOKEN()).eq(wethToken.address);
            expect(await strategy.BAL_TOKEN()).eq(balToken.address);
            expect(await strategy.BAL_ETH_POOL_TOKEN()).eq(balWethBptToken.address);
        });
        it("check bbusd handler is configured correctly");
        it("check AURA virtual share pool is configured correctly");
    });
});
