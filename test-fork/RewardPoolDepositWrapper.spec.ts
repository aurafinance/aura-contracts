import { BaseRewardPool4626__factory } from "./../types/generated/factories/BaseRewardPool4626__factory";
import hre, { ethers, network } from "hardhat";
import { ERC20, ERC20__factory, IVault__factory, MockERC20__factory } from "../types/generated";
import { impersonate, impersonateAccount, simpleToExactAmount } from "../test-utils";
import { Signer } from "ethers";
import { waitForTx } from "../tasks/utils";
import {
    deployPhase2,
    deployPhase3,
    deployPhase4,
    Phase1Deployed,
    Phase2Deployed,
    Phase3Deployed,
    SystemDeployed,
} from "../scripts/deploySystem";
import { config } from "../tasks/deploy/mainnet-config";
import { expect } from "chai";
import { JoinPoolRequestStruct } from "types/generated/IVault";

const debug = false;
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const usdcWhale = "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503";
const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

describe("RewardPoolDepositWrapper", () => {
    let deployer: Signer;
    let deployerAddress: string;

    let phase1: Phase1Deployed;
    let phase2: Phase2Deployed;
    let phase3: Phase3Deployed;
    let phase4: SystemDeployed;

    const stakerAddress = "0x0000000000000000000000000000000000000001";
    let staker: Signer;
    let usdc: ERC20;

    before(async () => {
        await sleep(30000); // 30 seconds to avoid max tx issues when doing full deployment

        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 14805422,
                    },
                },
            ],
        });

        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        await setupBalances();
        await sleep(30000); // 30 seconds to avoid max tx issues when doing full deployment

        deployer = await impersonate(deployerAddress);
        phase1 = await config.getPhase1(deployer);
        phase2 = await deployPhase2(
            hre,
            deployer,
            phase1,
            config.distroList,
            config.multisigs,
            config.naming,
            config.addresses,
            debug,
        );
        await getWeth(phase2.balLiquidityProvider.address, simpleToExactAmount(500));
        phase3 = await deployPhase3(hre, deployer, phase2, config.multisigs, config.addresses, debug);

        const daoMultisig = await impersonateAccount(config.multisigs.daoMultisig);
        const tx = await phase3.poolManager.connect(daoMultisig.signer).setProtectPool(false);
        await waitForTx(tx, debug);

        phase4 = await deployPhase4(hre, deployer, phase3, config.addresses, debug);

        staker = await impersonate(stakerAddress);

        usdc = ERC20__factory.connect(usdcAddress, staker);

        await getUSDC(stakerAddress, simpleToExactAmount(100, 6));
    });

    const getUSDC = async (recipient: string, amount = simpleToExactAmount(10)) => {
        const lpWhaleSigner = await impersonateAccount(usdcWhale);
        const lp = MockERC20__factory.connect(usdcAddress, lpWhaleSigner.signer);
        const tx = await lp.transfer(recipient, amount);
        await waitForTx(tx, debug);
    };

    const getCrvBpt = async (recipient: string, amount = simpleToExactAmount(250)) => {
        const tokenWhaleSigner = await impersonateAccount(config.addresses.tokenWhale);
        const crvBpt = MockERC20__factory.connect(config.addresses.tokenBpt, tokenWhaleSigner.signer);
        const tx = await crvBpt.transfer(recipient, amount);
        await waitForTx(tx, debug);
    };

    const getWeth = async (recipient: string, amount = simpleToExactAmount(100)) => {
        const wethWhaleSigner = await impersonateAccount(config.addresses.wethWhale);
        const weth = MockERC20__factory.connect(config.addresses.weth, wethWhaleSigner.signer);
        const tx = await weth.transfer(recipient, amount);
        await waitForTx(tx, debug);
    };

    const getEth = async (recipient: string) => {
        const ethWhale = await impersonate(config.addresses.weth);
        await ethWhale.sendTransaction({
            to: recipient,
            value: simpleToExactAmount(1),
        });
    };

    const setupBalances = async () => {
        // crvBPT for initialLock && cvxCrv/crvBPT pair
        await getCrvBpt(deployerAddress);
        // weth for LBP creation
        await getWeth(deployerAddress);

        await getEth(deployerAddress);
    };

    it("allow deposit into pool via Booster", async () => {
        const { rewardDepositWrapper } = phase4;
        const poolInfo = await phase4.booster.poolInfo(0);
        const crvRewards = await BaseRewardPool4626__factory.connect(poolInfo.crvRewards, staker);

        const vault = IVault__factory.connect(config.addresses.balancerVault, staker);
        const poolId = "0x06df3b2bbb68adc8b0e302443692037ed9f91b42000000000000000000000063";
        const poolTokens = (await vault.getPoolTokens(poolId)).tokens;

        const joinPoolRequest: JoinPoolRequestStruct = {
            assets: poolTokens,
            maxAmountsIn: [0, simpleToExactAmount(100, 6), 0],
            userData: ethers.utils.defaultAbiCoder.encode(
                ["uint256", "uint256[]", "uint256"],
                [1, [0, simpleToExactAmount(100, 6), 0], simpleToExactAmount(99.4)],
            ),
            fromInternalBalance: false,
        };

        const balBefore = await crvRewards.balanceOf(stakerAddress);

        let tx = await usdc.approve(rewardDepositWrapper.address, simpleToExactAmount(100, 6));
        await waitForTx(tx, debug);
        tx = await rewardDepositWrapper
            .connect(staker)
            .depositSingle(poolInfo.crvRewards, usdcAddress, simpleToExactAmount(100, 6), poolId, joinPoolRequest);
        await waitForTx(tx, debug);

        const balAfter = await crvRewards.balanceOf(stakerAddress);

        expect(balAfter.sub(balBefore)).gt(simpleToExactAmount(99.4));
    });
});
