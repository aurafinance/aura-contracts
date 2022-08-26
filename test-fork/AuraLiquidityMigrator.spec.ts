import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import { ERC20__factory, ERC20, AuraLiquidityMigrator, AuraLiquidityMigrator__factory } from "../types/generated";
import { deployContract } from "../tasks/utils";
import { impersonateAccount, impersonate } from "../test-utils";
import { Signer } from "ethers";
import { Account } from "types";

const debug = false;

const sushiLPWbtcWethHolderAddress = "0xa67ec8737021a7e91e883a3277384e6018bb5776";
const keeperAddress = "0xcc247cde79624801169475c9ba1f716db3959b8f";
const BALANCER_POOL_FACTORY = "0x8E9aa87E45e92bad84D5F8DD1bff34Fb92637dE9";
const BALANCER_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

const balWbtcWethLPTokenAddress = "0xa6f548df93de924d73be7d25dc02554c6bd66db5";
const sushiWbtcWethLPTokenAddress = "0xceff51756c56ceffca006cd410b03ffc46dd3a58";
const uniV2WbtcWethLPTokenAddress = "0xbb2b8038a1640196fbe3e38816f3e67cba72d940";
const auraWbtcWethRewardPoolAddress = "0xbdadc814dec8f76832f43a44073be8354398e9c6";
const wbtcAddress = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
const wethAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const DELEGATE_OWNER = "0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B";

interface PoolData {
    name: string;
    symbol: string;
    underlyingTokens: Array<string>;
    swapFeePercentage: number;
    owner: string;
    minOut: number;
}
describe("AuraLiquidityMigrator", () => {
    let sushiWbtcWethLPHolder: Account;
    let signer: Signer;
    let sushiWbtcWethLPToken: ERC20;
    let balWbtcWethLPToken: ERC20;

    let auraLiquidityMigrator: AuraLiquidityMigrator;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15400000,
                    },
                },
            ],
        });

        sushiWbtcWethLPHolder = await impersonateAccount(sushiLPWbtcWethHolderAddress);
        signer = await impersonate(keeperAddress);

        const constructorArguments = [BALANCER_POOL_FACTORY, BALANCER_VAULT];
        auraLiquidityMigrator = await deployContract<AuraLiquidityMigrator>(
            hre,
            new AuraLiquidityMigrator__factory(signer),
            "AuraLiquidityMigrator",
            constructorArguments,
            {},
            debug,
        );

        sushiWbtcWethLPToken = ERC20__factory.connect(sushiWbtcWethLPTokenAddress, signer);
        balWbtcWethLPToken = ERC20__factory.connect(balWbtcWethLPTokenAddress, signer);
    });

    const expectMigrateUniswapV2AndJoinPool = async (
        account: Account,
        fromLPToken: ERC20,
        toLPToken: ERC20,
        rewardPool: ERC20,
        underlyingTokens: Array<string>,
    ) => {
        const fromLPPositionBefore = await fromLPToken.balanceOf(account.address);
        const toLPPositionBefore = await toLPToken.balanceOf(account.address);
        const rewardPoolBalanceBefore = await rewardPool.balanceOf(account.address);

        expect(fromLPPositionBefore, "from position").to.gt(0);

        await fromLPToken.connect(account.signer).approve(auraLiquidityMigrator.address, ethers.constants.MaxUint256);

        await auraLiquidityMigrator
            .connect(account.signer)
            .migrateUniswapV2AndJoinPool(
                fromLPToken.address,
                account.address,
                underlyingTokens,
                0,
                toLPToken.address,
                rewardPool.address,
            );

        // after joining to the pool the balance is staked on aura therefore the following expectations
        const fromLPPositionAfter = await fromLPToken.balanceOf(account.address);
        const toLPPositionAfter = await toLPToken.balanceOf(account.address);
        const rewardPoolBalanceAfter = await rewardPool.balanceOf(account.address);

        expect(fromLPPositionAfter, "from position").to.eq(0);
        expect(toLPPositionAfter, "balancer position does not change").to.eq(toLPPositionBefore);
        expect(rewardPoolBalanceAfter, "reward pool balance increases").to.gt(rewardPoolBalanceBefore);
    };
    const expectMigrateUniswapV2AndCreatePool = async (account: Account, fromLPToken: ERC20, poolData: PoolData) => {
        const fromLPPositionBefore = await fromLPToken.balanceOf(account.address);
        expect(fromLPPositionBefore, "from position").to.gt(0);

        await fromLPToken.connect(account.signer).approve(auraLiquidityMigrator.address, ethers.constants.MaxUint256);

        const tx = await auraLiquidityMigrator
            .connect(account.signer)
            .migrateUniswapV2AndCreatePool(
                fromLPToken.address,
                account.address,
                poolData.name,
                poolData.symbol,
                poolData.underlyingTokens,
                poolData.swapFeePercentage,
                poolData.owner,
                poolData.minOut,
            );

        const receipt = await (await tx).wait();
        const event = receipt.events.find(e => e.event === "PoolCreated");
        expect(event.args.pool).to.not.be.undefined;
        const poolAddress = event.args.pool;

        const toLPToken = ERC20__factory.connect(poolAddress, account.signer);
        const fromLPPositionAfter = await fromLPToken.balanceOf(account.address);
        const toLPPositionAfter = await toLPToken.balanceOf(account.address);

        expect(fromLPPositionAfter, "from position").to.eq(0);
        expect(toLPPositionAfter, "balancer position").to.gt(0);
        return poolAddress;
    };
    describe("Migrate Sushi Position", () => {
        it("migrates and creates a new pool", async () => {
            const sushiOhmDaiLPToken = ERC20__factory.connect("0x055475920a8c93cffb64d039a8205f7acc7722d3", signer);
            const ohmAddress = "0x64aa3364f17a4d01c6f1751fd97c2bd3d7e7f1d5";
            const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
            const sushiOhmDaiLPHolder: Account = await impersonateAccount("0x9a315bdf513367c0377fb36545857d12e85813ef");

            await expectMigrateUniswapV2AndCreatePool(sushiOhmDaiLPHolder, sushiOhmDaiLPToken, {
                name: "50ohm-50dai",
                symbol: "50ohm-50dai",
                underlyingTokens: [ohmAddress, daiAddress],
                swapFeePercentage: 3000000000000000, // 0.3%
                owner: DELEGATE_OWNER,
                minOut: 0,
            });
        });
        it("migrates join to an existing pool", async () => {
            const auraRewardPool = ERC20__factory.connect(auraWbtcWethRewardPoolAddress, signer);

            await expectMigrateUniswapV2AndJoinPool(
                sushiWbtcWethLPHolder,
                sushiWbtcWethLPToken,
                balWbtcWethLPToken,
                auraRewardPool,
                [wbtcAddress, wethAddress],
            );
        });
    });
    describe("Migrate UniswapV2 Position", () => {
        it("migrates and creates a new pool", async () => {
            const uniV2FeiTribeLPToken = ERC20__factory.connect("0x9928e4046d7c6513326ccea028cd3e7a91c7590a", signer);
            const feiAddress = "0x956f47f50a910163d8bf957cf5846d573e7f87ca";
            const tribeAddress = "0xc7283b66eb1eb5fb86327f08e1b5816b0720212b";
            const uniV2FeiTribeLPHolder: Account = await impersonateAccount(
                "0x2ef97e5ce736bf81703c4f5c7d5273238b8688eb",
            );

            await expectMigrateUniswapV2AndCreatePool(uniV2FeiTribeLPHolder, uniV2FeiTribeLPToken, {
                name: "50wise-50tribe",
                symbol: "50wise-50tribe",
                underlyingTokens: [feiAddress, tribeAddress],
                swapFeePercentage: 3000000000000000, // 0.3%
                owner: DELEGATE_OWNER,
                minOut: 0,
            });
        });
        it("migrates join to an existing pool", async () => {
            const uniV2WbtcWethLPToken = ERC20__factory.connect(uniV2WbtcWethLPTokenAddress, signer);
            const uniV2WbtcWethLPHolder: Account = await impersonateAccount(
                "0xe8e5f5c4eb430c517c5f266ef9d18994321f1521",
            );
            const auraRewardPool = ERC20__factory.connect(auraWbtcWethRewardPoolAddress, signer);

            await expectMigrateUniswapV2AndJoinPool(
                uniV2WbtcWethLPHolder,
                uniV2WbtcWethLPToken,
                balWbtcWethLPToken,
                auraRewardPool,
                [wbtcAddress, wethAddress],
            );
        });
    });
});
