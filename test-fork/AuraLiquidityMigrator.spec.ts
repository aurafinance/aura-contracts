import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import { ERC20__factory, ERC20, AuraLiquidityMigrator, AuraLiquidityMigrator__factory } from "../types/generated";
import { deployContract } from "../tasks/utils";
import { impersonateAccount, impersonate, ZERO_ADDRESS, getTimestamp, ONE_HOUR, BN } from "../test-utils";
import { Signer } from "ethers";
import { Account } from "types";
import { config } from "../tasks/deploy/mainnet-config";
import { AssetHelpers } from "@balancer-labs/balancer-js";

const debug = false;

const sushiLPWbtcWethHolderAddress = "0xa67ec8737021a7e91e883a3277384e6018bb5776";
const keeperAddress = "0xcc247cde79624801169475c9ba1f716db3959b8f";
const balWbtcWethLPTokenAddress = "0xa6f548df93de924d73be7d25dc02554c6bd66db5";
const sushiWbtcWethLPTokenAddress = "0xceff51756c56ceffca006cd410b03ffc46dd3a58";
const uniV2WbtcWethLPTokenAddress = "0xbb2b8038a1640196fbe3e38816f3e67cba72d940";
const auraWbtcWethRewardPoolAddress = "0xbdadc814dec8f76832f43a44073be8354398e9c6";
const wethAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const wbtcAddress = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const feiAddress = "0x956f47f50a910163d8bf957cf5846d573e7f87ca";
const tribeAddress = "0xc7283b66eb1eb5fb86327f08e1b5816b0720212b";
const ohmAddress = "0x64aa3364f17a4d01c6f1751fd97c2bd3d7e7f1d5";
const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";

const balHelper = new AssetHelpers(wethAddress);

interface PoolData {
    balancerFactory: number; // WEIGHTED = 0 , STABLE = 1
    name: string;
    symbol: string;
    tokens: Array<string>;
    swapFeePercentage: number;
    oracleEnabled?: boolean;
    amplificationParameter?: number;
    minOut: number;
}
describe("AuraLiquidityMigrator", () => {
    let sushiWbtcWethLPHolder: Account;
    let sushiOhmDaiLPHolder: Account;
    let uniV2FeiTribeLPHolder: Account;
    let uniV2WbtcWethLPHolder: Account;
    let signer: Signer;
    let sushiWbtcWethLPToken: ERC20;
    let balWbtcWethLPToken: ERC20;
    let uniV2FeiTribeLPToken: ERC20;
    let uniV2WbtcWethLPToken: ERC20;
    let sushiOhmDaiLPToken: ERC20;

    let auraLiquidityMigrator: AuraLiquidityMigrator;

    async function setup() {
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
        sushiOhmDaiLPHolder = await impersonateAccount("0x9a315bdf513367c0377fb36545857d12e85813ef");
        uniV2FeiTribeLPHolder = await impersonateAccount("0x2ef97e5ce736bf81703c4f5c7d5273238b8688eb");
        uniV2WbtcWethLPHolder = await impersonateAccount("0xe8e5f5c4eb430c517c5f266ef9d18994321f1521");
        signer = await impersonate(keeperAddress);

        const { addresses } = config;
        const { weightedPool2Tokens, stablePool } = addresses.balancerPoolFactories;

        const constructorArguments = [
            weightedPool2Tokens,
            stablePool,
            addresses.balancerVault,
            addresses.balancerGaugeFactory,
            addresses.uniswapRouter,
            addresses.sushiswapRouter,
            addresses.balancerPoolOwner,
        ];
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
        uniV2FeiTribeLPToken = ERC20__factory.connect("0x9928e4046d7c6513326ccea028cd3e7a91c7590a", signer);
        uniV2WbtcWethLPToken = ERC20__factory.connect(uniV2WbtcWethLPTokenAddress, signer);
        sushiOhmDaiLPToken = ERC20__factory.connect("0x055475920a8c93cffb64d039a8205f7acc7722d3", signer);
    }

    beforeEach(async () => {
        await setup();
    });

    const expectMigrateUniswapV2AndJoinPool = async (
        account: Account,
        source: number,
        tokens: Array<string>,
        fromLPToken: ERC20,
        toLPToken: ERC20,
        rewardPool: ERC20,
    ) => {
        const isRewardPool = rewardPool.address !== ZERO_ADDRESS;

        const fromLPPositionBefore = await fromLPToken.balanceOf(account.address);
        const toLPPositionBefore = await toLPToken.balanceOf(account.address);
        const rewardPoolBalanceBefore = isRewardPool ? await rewardPool.balanceOf(account.address) : BN.from(0);

        expect(fromLPPositionBefore, "from position").to.gt(0);
        const amountsMin = [1, 1];
        const deadline = (await getTimestamp()).add(ONE_HOUR);
        const [tokensSorted, amountsMinSorted] = balHelper.sortTokens(tokens, amountsMin);
        const amountMinOut = 1;

        await fromLPToken.connect(account.signer).approve(auraLiquidityMigrator.address, ethers.constants.MaxUint256);

        await auraLiquidityMigrator.connect(account.signer).migrateUniswapV2AndJoinPool({
            source,
            fromLpToken: fromLPToken.address,
            liquidity: fromLPPositionBefore,
            tokens: tokensSorted,
            amountsMin: amountsMinSorted as BN[],
            deadline: deadline,
            pool: toLPToken.address,
            rewardPool: rewardPool.address,
            amountMinOut: amountMinOut,
        });

        // after joining to the pool the balance is staked on aura therefore the following expectations
        const fromLPPositionAfter = await fromLPToken.balanceOf(account.address);
        const toLPPositionAfter = await toLPToken.balanceOf(account.address);

        expect(fromLPPositionAfter, "from position").to.eq(0);

        if (isRewardPool) {
            const rewardPoolBalanceAfter = await rewardPool.balanceOf(account.address);
            expect(rewardPoolBalanceAfter, "reward pool balance increases").to.gt(rewardPoolBalanceBefore);
            expect(toLPPositionAfter, "balancer position does not change").to.eq(toLPPositionBefore);
        } else {
            expect(toLPPositionAfter, "balancer position increases change").to.gt(toLPPositionBefore);
        }
    };
    const expectMigrateUniswapV2AndCreatePool = async (
        account: Account,
        source: number,
        fromLPToken: ERC20,
        poolData: PoolData,
    ) => {
        const fromLPPositionBefore = await fromLPToken.balanceOf(account.address);

        expect(fromLPPositionBefore, "from position").to.gt(0);

        await fromLPToken.connect(account.signer).approve(auraLiquidityMigrator.address, ethers.constants.MaxUint256);
        const amountsMin = [1, 1];
        const deadline = (await getTimestamp()).add(ONE_HOUR);
        const [tokensSorted, amountsMinSorted] = balHelper.sortTokens(poolData.tokens, amountsMin);
        const tx = await auraLiquidityMigrator.connect(account.signer).migrateUniswapV2AndCreatePool({
            balancerFactory: poolData.balancerFactory,
            name: poolData.name,
            symbol: poolData.symbol,
            source,
            fromLpToken: fromLPToken.address,
            liquidity: fromLPPositionBefore,
            tokens: tokensSorted,
            amountsMin: amountsMinSorted as BN[],
            deadline: deadline,
            swapFeePercentage: poolData.swapFeePercentage,
            oracleEnabled: poolData.oracleEnabled,
            amplificationParameter: poolData.amplificationParameter,
        });

        const receipt = await tx.wait();
        const event = receipt.events.find(e => e.event === "PoolCreated");
        expect(event.args.pool).to.not.be.undefined;
        const poolAddress = event.args.pool;
        const gaugeAddress = event.args.gauge;

        const toLPToken = ERC20__factory.connect(poolAddress, account.signer);
        const fromLPPositionAfter = await fromLPToken.balanceOf(account.address);
        const toLPPositionAfter = await toLPToken.balanceOf(account.address);

        expect(fromLPPositionAfter, "from position").to.eq(0);
        expect(toLPPositionAfter, "balancer position").to.gt(0);
        expect(gaugeAddress, "balancer gauge").to.not.eq(ZERO_ADDRESS);
        return poolAddress;
    };
    describe("Migrate Sushi Position", () => {
        const source = 1; // sushi = 1
        it("migrates and creates a new pool - weighted", async () => {
            await expectMigrateUniswapV2AndCreatePool(sushiOhmDaiLPHolder, source, sushiOhmDaiLPToken, {
                balancerFactory: 0,
                name: "50ohm-50dai",
                symbol: "50ohm-50dai",
                tokens: [ohmAddress, daiAddress],
                swapFeePercentage: 3000000000000000, // 0.3%
                amplificationParameter: 0,
                oracleEnabled: true,
                minOut: 1,
            });
        });
        it("migrates and creates a new pool - stable", async () => {
            await expectMigrateUniswapV2AndCreatePool(sushiOhmDaiLPHolder, source, sushiOhmDaiLPToken, {
                balancerFactory: 1,
                name: "50ohm-50dai",
                symbol: "50ohm-50dai",
                tokens: [ohmAddress, daiAddress],
                swapFeePercentage: 3000000000000000, // 0.3%
                amplificationParameter: 25,
                minOut: 1,
            });
        });
        it("migrates join to an existing pool", async () => {
            const auraRewardPool = ERC20__factory.connect(auraWbtcWethRewardPoolAddress, signer);

            await expectMigrateUniswapV2AndJoinPool(
                sushiWbtcWethLPHolder,
                source,
                [wethAddress, wbtcAddress],
                sushiWbtcWethLPToken,
                balWbtcWethLPToken,
                auraRewardPool,
            );
        });
        it("migrates join to an existing pool without rewards", async () => {
            const auraRewardPool = ERC20__factory.connect(ZERO_ADDRESS, signer);

            await expectMigrateUniswapV2AndJoinPool(
                sushiWbtcWethLPHolder,
                source,
                [wethAddress, wbtcAddress],
                sushiWbtcWethLPToken,
                balWbtcWethLPToken,
                auraRewardPool,
            );
        });
    });
    describe("Migrate UniswapV2 Position", () => {
        const source = 0; // sushi = 1

        it("migrates and creates a new pool - weighted", async () => {
            await expectMigrateUniswapV2AndCreatePool(uniV2FeiTribeLPHolder, source, uniV2FeiTribeLPToken, {
                balancerFactory: 0,
                name: "50fei-50tribe",
                symbol: "50fei-50tribe",
                tokens: [feiAddress, tribeAddress],
                swapFeePercentage: 3000000000000000,
                oracleEnabled: true,
                amplificationParameter: 0,
                minOut: 1,
            });
        });
        it("migrates and creates a new pool - stable", async () => {
            await expectMigrateUniswapV2AndCreatePool(uniV2FeiTribeLPHolder, source, uniV2FeiTribeLPToken, {
                balancerFactory: 1,
                name: "50fei-50tribe",
                symbol: "50fei-50tribe",
                tokens: [feiAddress, tribeAddress],
                swapFeePercentage: 3000000000000000,
                amplificationParameter: 25,
                minOut: 1,
            });
        });
        it("migrates join to an existing pool", async () => {
            const auraRewardPool = ERC20__factory.connect(auraWbtcWethRewardPoolAddress, signer);

            await expectMigrateUniswapV2AndJoinPool(
                uniV2WbtcWethLPHolder,
                source,
                [wethAddress, wbtcAddress],
                uniV2WbtcWethLPToken,
                balWbtcWethLPToken,
                auraRewardPool,
            );
        });
        it("migrates join to an existing pool without rewards", async () => {
            const auraRewardPool = ERC20__factory.connect(ZERO_ADDRESS, signer);

            await expectMigrateUniswapV2AndJoinPool(
                uniV2WbtcWethLPHolder,
                source,
                [wethAddress, wbtcAddress],
                uniV2WbtcWethLPToken,
                balWbtcWethLPToken,
                auraRewardPool,
            );
        });
    });
});
