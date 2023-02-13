import { expect } from "chai";
import { BigNumber, BigNumberish, ethers } from "ethers";
import hre, { network } from "hardhat";
import { formatEther, parseEther } from "ethers/lib/utils";

import { deployContract } from "../tasks/utils";
import { config } from "../tasks/deploy/mainnet-config";
import { impersonate, impersonateAccount } from "../test-utils/fork";
import { Phase2Deployed } from "../scripts/deploySystem";
import {
    Account,
    MockERC20__factory,
    AuraBalBoostedRewardPool,
    AuraBalBoostedRewardPool__factory,
    VirtualBalanceRewardPool,
    VirtualBalanceRewardPool__factory,
    IBalancerVault__factory,
    IBalancerHelpers__factory,
    IBalancerHelpers,
    IERC20,
    IERC20__factory,
} from "../types";
import { BN, simpleToExactAmount } from "../test-utils";
import {
    BatchSwapStepStruct,
    FundManagementStruct,
    IBalancerVault,
    JoinPoolRequestStruct,
} from "types/generated/IBalancerVault";
import { WeightedPoolEncoder } from "@balancer-labs/balancer-js";

const DEBUG = false;
const FORK_BLOCK = 16370000;
const SLIPPAGE_OUTPUT_BPS = 9950;
const SLIPPAGE_OUTPUT_SWAP = 9900;
const SLIPPAGE_OUTPUT_SCALE = 10000;

const DEPLOYER = "0xa28ea848801da877e1844f954ff388e857d405e5";

const RETH = "0xae78736Cd615f374D3085123A210448E74Fc6393";
const WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const BAL = "0xba100000625a3754423978a60c9317c58a424e3d";
const BPT_BALWETH = "0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56";
const AURABAL = "0x616e8BfA43F920657B3497DBf40D6b1A02D4608d";

const BAL_WETH_POOL_ID = "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014";
const BPT_AURABAL_POOL_ID = "0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd000200000000000000000249";

const BBUSD_RETH_POOL_ID = "0x334c96d792e4b26b841d28f53235281cec1be1f200020000000000000000038a";
const RETH_WETH_POOL_ID = "0x1e19cf2d73a72ef1332c882f20534b6519be0276000200000000000000000112";

const BBUSD_WSTETH_POOL_ID = "0x25accb7943fd73dda5e23ba6329085a3c24bfb6a000200000000000000000387";
const WSTETH_WETH_POOL_ID = "0x32296969ef14eb0c6d29669c550d4a0449130230000200000000000000000080";

// ----------HARVEST UTILITY FUNCTIONS ------------ //
const applySlippage = (amount: BigNumber, slippage: BigNumberish): BigNumber =>
    amount.mul(slippage).div(SLIPPAGE_OUTPUT_SCALE);
const applySwapSlippage = (amount: BigNumber): BigNumber => applySlippage(amount, SLIPPAGE_OUTPUT_SWAP);

function encodeFeeTokenRethWethPath() {
    const poolIds = [BBUSD_RETH_POOL_ID, RETH_WETH_POOL_ID];
    const assetIns = [config.addresses.feeToken, RETH];
    const bbusdToWethPath = ethers.utils.defaultAbiCoder.encode(["bytes32[]", "address[]"], [poolIds, assetIns]);
    return bbusdToWethPath;
}
function encodeFeeTokenWstethWethPath() {
    const poolIds = [BBUSD_WSTETH_POOL_ID, WSTETH_WETH_POOL_ID];
    const assetIns = [config.addresses.feeToken, WSTETH];
    const bbusdToWethPath = ethers.utils.defaultAbiCoder.encode(["bytes32[]", "address[]"], [poolIds, assetIns]);
    return bbusdToWethPath;
}

async function getBbaUsdToWethAmount(bVault: IBalancerVault, amount: BigNumberish, sender: string): Promise<BigNumber> {
    const swaps: BatchSwapStepStruct[] = [
        {
            poolId: BBUSD_RETH_POOL_ID,
            assetInIndex: 0, // bbusd Index
            assetOutIndex: 1, // reth Index
            amount: amount,
            userData: ethers.utils.defaultAbiCoder.encode(["uint256"], [0]),
        },
        {
            poolId: RETH_WETH_POOL_ID,
            assetInIndex: 1, // reth Index
            assetOutIndex: 2, // weth Index
            amount: 0,
            userData: ethers.utils.defaultAbiCoder.encode(["uint256"], [0]),
        },
    ];
    const assets: string[] = [config.addresses.feeToken, RETH, WETH];
    const funds: FundManagementStruct = {
        sender,
        fromInternalBalance: false,
        recipient: sender,
        toInternalBalance: false,
    };
    const query = await bVault.callStatic.queryBatchSwap(
        0, //kind: GIVEN_IN
        swaps,
        assets,
        funds,
    );
    return query.slice(-1)[0].abs();
}
async function getBptToAuraBalAmount(bVault: IBalancerVault, amount: BigNumberish, sender: string): Promise<BigNumber> {
    const swaps: BatchSwapStepStruct[] = [
        {
            poolId: BPT_AURABAL_POOL_ID,
            assetInIndex: 0, // BPT Index
            assetOutIndex: 1, // auraBAL Index
            amount: amount,
            userData: ethers.utils.defaultAbiCoder.encode(["uint256"], [0]),
        },
    ];
    const assets: string[] = [BPT_BALWETH, AURABAL];
    const funds: FundManagementStruct = {
        sender,
        fromInternalBalance: false,
        recipient: sender,
        toInternalBalance: false,
    };
    const query = await bVault.callStatic.queryBatchSwap(
        0, //kind: GIVEN_IN
        swaps,
        assets,
        funds,
    );

    return query.slice(-1)[0].abs();
}
async function getBalWethJoinBptAmount(balancerHelpers: IBalancerHelpers, maxAmountsIn: BN[], sender: string) {
    // Use a minimumBPT of 1 because we need to call queryJoin with amounts in to get the BPT amount out
    const userData = WeightedPoolEncoder.joinExactTokensInForBPTOut(maxAmountsIn, 1);
    const joinPoolRequest: JoinPoolRequestStruct = {
        assets: [BAL, WETH],
        maxAmountsIn,
        userData,
        fromInternalBalance: false,
    };
    const poolId = BAL_WETH_POOL_ID;

    const [bptOut] = await balancerHelpers.callStatic.queryJoin(poolId, sender, sender, joinPoolRequest);
    return bptOut;
}

async function impersonateAndTransfer(tokenAddress: string, from: string, to: string, amount: BigNumberish) {
    const tokenWhaleSigner = await impersonateAccount(from);
    const token = MockERC20__factory.connect(tokenAddress, tokenWhaleSigner.signer);
    await token.transfer(to, amount);
}
describe("AuraBalBoostedRewards", () => {
    let dao: Account;
    let deployer: Account;
    let phase2: Phase2Deployed;
    let rewards: AuraBalBoostedRewardPool;
    let auraRewards: VirtualBalanceRewardPool;
    let feeTokenRewards: VirtualBalanceRewardPool;
    let bVault: IBalancerVault;
    let balancerHelpers: IBalancerHelpers;
    let wethToken: IERC20;
    let balToken: IERC20;
    let balWethBptToken: IERC20;

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
    // ----------HARVEST UTILITY FUNCTIONS ------------ //

    async function calcHarvestMinAmounts(rewardAmounts: { bal: BigNumberish; feeToken: BigNumberish }) {
        const minAmountFeeTokenWeth = await getBbaUsdToWethAmount(bVault, rewardAmounts.feeToken, rewards.address);
        const minBptBalWethAmount = await getBalWethJoinBptAmount(
            balancerHelpers,
            [BN.from(rewardAmounts.bal), minAmountFeeTokenWeth],
            rewards.address,
        );
        const minAmountAuraBal = await getBptToAuraBalAmount(bVault, minBptBalWethAmount, rewards.address);

        const minAmountOuts = [
            0, // aura is extra reward but it does not need to be swapped.
            applySwapSlippage(minAmountFeeTokenWeth), // bbausd=>WETH
            applySwapSlippage(minAmountAuraBal), // 8020BALWETH-BPT => auraBAL
        ];
        return minAmountOuts;
    }

    // Force a reward harvest by transferring BAL, BBaUSD and Aura tokens directly
    // to the reward contract the contract will then swap it for
    // auraBAL and queue it for rewards
    async function forceHarvestRewards(amount = parseEther("10")) {
        await getBal(rewards.address, amount);
        await getBBaUSD(rewards.address, amount);
        await getAura(rewards.address, amount);
        const crv = MockERC20__factory.connect(config.addresses.token, dao.signer);
        const feeToken = MockERC20__factory.connect(config.addresses.feeToken, dao.signer);

        expect(await crv.balanceOf(rewards.address), " crv balance").to.be.gt(0);
        expect(await feeToken.balanceOf(rewards.address), " feeToken balance").to.be.gt(0);
        expect(await phase2.cvx.balanceOf(rewards.address), " cvx balance").to.be.gt(0);

        const minAmountOuts = await calcHarvestMinAmounts({ bal: amount, feeToken: amount });

        await rewards.connect(dao.signer).harvest(SLIPPAGE_OUTPUT_BPS, minAmountOuts);

        expect(await crv.balanceOf(rewards.address), " crv balance").to.be.eq(0);
        expect(await feeToken.balanceOf(rewards.address), " feeToken balance").to.be.eq(0);
        expect(await phase2.cvx.balanceOf(rewards.address), " cvx balance").to.be.eq(0);
    }

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

    describe("Deploy and configured", () => {
        it("Deploy AuraBalBoostedRewards", async () => {
            rewards = await deployContract<AuraBalBoostedRewardPool>(
                hre,
                new AuraBalBoostedRewardPool__factory(deployer.signer),
                "AuraBalBoostedRewardPool",
                [
                    // AuraBalBoostedRewardPool
                    dao.address,
                    phase2.cvxCrvRewards.address,
                    phase2.cvx.address,
                    config.addresses.balancerAuraBalPoolId,
                    // AuraBaseRewardPool
                    phase2.cvxCrv.address,
                    phase2.cvxCrv.address,
                    dao.address,
                    // BalInvestor
                    config.addresses.balancerVault,
                    config.addresses.token,
                    config.addresses.weth,
                    config.addresses.balancerPoolId,
                ],
                {},
                DEBUG,
            );
        });
        it("Deploy AURA virtual rewards", async () => {
            auraRewards = await deployContract<VirtualBalanceRewardPool>(
                hre,
                new VirtualBalanceRewardPool__factory(deployer.signer),
                "VirtualBalanceRewardPool - aura",
                [rewards.address, phase2.cvx.address, rewards.address],
                {},
                DEBUG,
            );
            feeTokenRewards = await deployContract<VirtualBalanceRewardPool>(
                hre,
                new VirtualBalanceRewardPool__factory(deployer.signer),
                "VirtualBalanceRewardPool - bbausd",
                [rewards.address, config.addresses.feeToken, rewards.address],
                {},
                DEBUG,
            );
        });
        it("Add AURA as extra rewards", async () => {
            await rewards.connect(dao.signer).addExtraReward(auraRewards.address);
            expect(await rewards.extraRewards(0), "aura as extra reward").to.be.eq(auraRewards.address);
        });
        it("Add FeeToken as extra reward", async () => {
            await rewards.connect(dao.signer).addExtraReward(feeTokenRewards.address);
            expect(await rewards.extraRewards(1), "fee Token as extra reward").to.be.eq(feeTokenRewards.address);
        });
        it("Add AuraBalBoostedRewards to Booster platform rewards", async () => {
            await phase2.booster.connect(dao.signer).setTreasury(rewards.address);
            expect(await phase2.booster.treasury()).eq(rewards.address);
        });

        it("Set approvals", async () => {
            await rewards.connect(dao.signer).setApprovals();
            expect(
                await wethToken.allowance(rewards.address, config.addresses.balancerVault),
                "WETH allowance",
            ).to.be.eq(ethers.constants.MaxUint256);
            expect(await balToken.allowance(rewards.address, config.addresses.balancerVault), "BAL allowance").to.be.eq(
                ethers.constants.MaxUint256,
            );
            expect(
                await phase2.cvxCrv.allowance(rewards.address, phase2.cvxCrvRewards.address),
                "auraBal allowance",
            ).to.be.eq(ethers.constants.MaxUint256);
            expect(
                await balWethBptToken.allowance(rewards.address, config.addresses.balancerVault),
                "BPT allowance",
            ).to.be.eq(ethers.constants.MaxUint256);

            // It should be able to setApprovals more than once, in case the allowance of a token goes to 0.
            await rewards.connect(dao.signer).setApprovals();
        });
        it("Set balancer paths", async () => {
            const tx = await rewards.setBalancerPath(config.addresses.feeToken, encodeFeeTokenRethWethPath());

            await expect(tx).to.emit(rewards, "SetBalancerPath").withArgs(config.addresses.feeToken);
        });
    });

    describe("Deposits", () => {
        it("Deposit increments user balance and total supply", async () => {
            const totalSupplyBefore = await rewards.totalSupply();
            const stakedBalanceBefore = await rewards.balanceOf(deployer.address);
            const underlyingStakedBalanceBefore = await phase2.cvxCrvRewards.balanceOf(rewards.address);

            const stakeAmount = simpleToExactAmount(10);
            await phase2.cvxCrv.connect(deployer.signer).approve(rewards.address, stakeAmount);
            await rewards.connect(deployer.signer).stake(stakeAmount);
            // TODO - @phijfry review AuraBaseRewardPool.sol#stake(), it iterate over all
            // TODO - extraRewards (aura,feeToken) with the same amount

            const stakedBalance = (await rewards.balanceOf(deployer.address)).sub(stakedBalanceBefore);

            console.log("Staked balance:", formatEther(stakedBalance));
            expect(stakedBalance).eq(stakeAmount);

            const totalSupply = (await rewards.totalSupply()).sub(totalSupplyBefore);
            console.log("Total supply:", formatEther(totalSupply));
            expect(totalSupply).eq(stakedBalance);

            const underlyingStakedBalance = (await phase2.cvxCrvRewards.balanceOf(rewards.address)).sub(
                underlyingStakedBalanceBefore,
            );
            expect(underlyingStakedBalance).eq(stakeAmount);
        });
    });

    describe("Harvest", () => {
        it("Harvest rewards and convert to auraBAL", async () => {
            const auraBalBalanceBefore = await phase2.cvxCrvRewards.balanceOf(rewards.address);
            await forceHarvestRewards();
            const auraBalBalanceAfter = await phase2.cvxCrvRewards.balanceOf(rewards.address);
            const auraBalBalance = auraBalBalanceAfter.sub(auraBalBalanceBefore);
            console.log("auraBAL balance:", formatEther(auraBalBalance));
            expect(auraBalBalance).gt(0);
        });
        it("Harvest rewards and convert to auraBAL with a different swap path", async () => {
            // Update to a new path
            const tx = await rewards.setBalancerPath(config.addresses.feeToken, encodeFeeTokenWstethWethPath());
            await expect(tx).to.emit(rewards, "SetBalancerPath").withArgs(config.addresses.feeToken);

            const auraBalBalanceBefore = await phase2.cvxCrvRewards.balanceOf(rewards.address);
            await forceHarvestRewards();
            const auraBalBalanceAfter = await phase2.cvxCrvRewards.balanceOf(rewards.address);
            const auraBalBalance = auraBalBalanceAfter.sub(auraBalBalanceBefore);
            console.log("auraBAL balance:", formatEther(auraBalBalance));
            expect(auraBalBalance).gt(0);
        });
    });

    describe("Claim rewards", () => {
        it("Get rewards for depositor");
    });

    describe("Withdraw", () => {
        it("Withdraw stake from pool");
    });
});
