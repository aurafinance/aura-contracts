import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import { AssetHelpers, WeightedPoolEncoder } from "@balancer-labs/balancer-js";
import {
    ERC20__factory,
    ERC20,
    UniswapMigrator,
    UniswapMigrator__factory,
    IUniswapV2Pair,
    IUniswapV2Pair__factory,
    IBalancerHelpers,
    IBalancerHelpers__factory,
    IBalancerPool,
    IBalancerPool__factory,
} from "../../types/generated";
import { deployContract, waitForTx } from "../../tasks/utils";
import {
    impersonateAccount,
    impersonate,
    ZERO_ADDRESS,
    getTimestamp,
    ONE_HOUR,
    BN,
    simpleToExactAmount,
} from "../../test-utils";
import { Signer } from "ethers";
import { Account } from "types";
import { config } from "../../tasks/deploy/mainnet-config";
import { JoinPoolRequestStruct } from "../../types/generated/IBalancerVault";
import { getAddress } from "ethers/lib/utils";

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

enum MigratorSource {
    Uniswap,
    Sushiswap,
}

interface PoolData {
    name: string;
    symbol: string;
    tokens: Array<string>;
    swapFeePercentage: number;
    minOut: number;
}

describe("UniswapMigrator", () => {
    let sushiWbtcWethLPHolder: Account;
    let sushiOhmDaiLPHolder: Account;
    let uniV2FeiTribeLPHolder: Account;
    let uniV2WbtcWethLPHolder: Account;
    let signer: Signer;

    let sushiWbtcWethLPToken: IUniswapV2Pair;
    let uniV2FeiTribeLPToken: IUniswapV2Pair;
    let uniV2WbtcWethLPToken: IUniswapV2Pair;
    let sushiOhmDaiLPToken: IUniswapV2Pair;
    let balWbtcWethLPToken: IBalancerPool;
    let balancerHelpers: IBalancerHelpers;
    let uniswapMigrator: UniswapMigrator;

    async function setup() {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15530000,
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
        const { weightedPool } = addresses.balancerPoolFactories;

        const constructorArguments = [
            weightedPool,
            addresses.balancerVault,
            addresses.balancerGaugeFactory,
            addresses.uniswapRouter,
            addresses.sushiswapRouter,
            addresses.balancerPoolOwner,
        ];
        uniswapMigrator = await deployContract<UniswapMigrator>(
            hre,
            new UniswapMigrator__factory(signer),
            "UniswapMigrator",
            constructorArguments,
            {},
            debug,
        );

        uniV2FeiTribeLPToken = IUniswapV2Pair__factory.connect("0x9928e4046d7c6513326ccea028cd3e7a91c7590a", signer);
        uniV2WbtcWethLPToken = IUniswapV2Pair__factory.connect(uniV2WbtcWethLPTokenAddress, signer);

        sushiWbtcWethLPToken = IUniswapV2Pair__factory.connect(sushiWbtcWethLPTokenAddress, signer);
        sushiOhmDaiLPToken = IUniswapV2Pair__factory.connect("0x055475920a8c93cffb64d039a8205f7acc7722d3", signer);

        balWbtcWethLPToken = IBalancerPool__factory.connect(balWbtcWethLPTokenAddress, signer);

        balancerHelpers = IBalancerHelpers__factory.connect(addresses.balancerHelpers, signer);
    }

    beforeEach(async () => {
        await setup();
    });

    async function getAmountsMin(
        account: Account,
        tokens: string[],
        fromLPToken: IUniswapV2Pair,
        slippageBips: number,
    ) {
        const totalSupply = await fromLPToken.totalSupply();
        const balance = await fromLPToken.balanceOf(account.address);
        const reserves = (await fromLPToken.getReserves()).slice(0, 2);
        const token0 = await fromLPToken.token0();

        const amountsMin = reserves.map(reserve => {
            const share = balance.mul(simpleToExactAmount(1)).div(simpleToExactAmount(0.5));
            const amount = share.mul(reserve).div(totalSupply);
            return amount.sub(amount.mul(10_000 - slippageBips).div(10_000));
        });

        // Reorder amountsMin to tokens order
        return getAddress(token0) === getAddress(tokens[0]) ? amountsMin : amountsMin.reverse();
    }

    async function getAmountMinOut(
        pool: IBalancerPool,
        assets: string[],
        maxAmountsIn: BN[],
        sender: string,
        recipient: string,
    ) {
        // Use a minimumBPT of 1 because we need to call queryJoin with amounts in to get the BPT amount out
        const userData = WeightedPoolEncoder.joinExactTokensInForBPTOut(maxAmountsIn, 1);
        const joinPoolRequest: JoinPoolRequestStruct = {
            assets,
            maxAmountsIn,
            userData,
            fromInternalBalance: false,
        };
        const poolId = await pool.getPoolId();
        const [bptOut] = await balancerHelpers.callStatic.queryJoin(poolId, sender, recipient, joinPoolRequest);
        return bptOut;
    }

    async function expectMigrateUniswapV2AndJoinPool(
        account: Account,
        source: MigratorSource,
        tokens: string[],
        fromLPToken: IUniswapV2Pair,
        toLPToken: IBalancerPool,
        rewardPool: ERC20,
    ) {
        const isRewardPool = rewardPool.address !== ZERO_ADDRESS;

        const fromLPPositionBefore = await fromLPToken.balanceOf(account.address);
        const toLPPositionBefore = await toLPToken.balanceOf(account.address);
        const rewardPoolBalanceBefore = isRewardPool ? await rewardPool.balanceOf(account.address) : BN.from(0);

        expect(fromLPPositionBefore, "from position").to.gt(0);
        const amountsMin = await getAmountsMin(account, tokens, fromLPToken, 50);
        const deadline = (await getTimestamp()).add(ONE_HOUR);

        const [tokensSorted, amountsMinSorted] = balHelper.sortTokens(tokens, amountsMin) as [string[], BN[]];

        const amountMinOut = await getAmountMinOut(
            toLPToken,
            tokensSorted,
            amountsMinSorted,
            account.address,
            account.address,
        );

        await fromLPToken.connect(account.signer).approve(uniswapMigrator.address, ethers.constants.MaxUint256);

        await uniswapMigrator.connect(account.signer).migrateUniswapV2AndJoinPool({
            source,
            fromLpToken: fromLPToken.address,
            liquidity: fromLPPositionBefore,
            tokens: tokensSorted,
            amountsMin: amountsMinSorted,
            deadline,
            pool: toLPToken.address,
            rewardPool: rewardPool.address,
            amountMinOut,
        });

        // after joining to the pool the balance is staked on aura therefore the following expectations
        const fromLPPositionAfter = await fromLPToken.balanceOf(account.address);
        const toLPPositionAfter = await toLPToken.balanceOf(account.address);

        expect(fromLPPositionAfter, "from position").to.eq(0);

        if (isRewardPool) {
            const rewardPoolBalanceAfter = await rewardPool.balanceOf(account.address);
            expect(rewardPoolBalanceAfter, "reward pool balance increases").to.gt(rewardPoolBalanceBefore);
            expect(rewardPoolBalanceAfter, "reward pool balance is over min amount out").to.gte(amountMinOut);
            expect(toLPPositionAfter, "balancer position does not change").to.eq(toLPPositionBefore);
        } else {
            expect(toLPPositionAfter, "balancer position increases").to.gt(toLPPositionBefore);
            expect(toLPPositionAfter, "balancer position is over min amount out").to.gte(amountMinOut);
        }
    }

    async function expectMigrateUniswapV2AndCreatePool(
        account: Account,
        source: MigratorSource,
        fromLPToken: IUniswapV2Pair,
        poolData: PoolData,
    ) {
        const fromLPPositionBefore = await fromLPToken.balanceOf(account.address);

        expect(fromLPPositionBefore, "from position").to.gt(0);

        await fromLPToken.connect(account.signer).approve(uniswapMigrator.address, ethers.constants.MaxUint256);
        const amountsMin = await getAmountsMin(account, poolData.tokens, fromLPToken, 50);
        const deadline = (await getTimestamp()).add(ONE_HOUR);
        const [tokensSorted, amountsMinSorted] = balHelper.sortTokens(poolData.tokens, amountsMin) as [string[], BN[]];
        const rateProviders = [ZERO_ADDRESS, ZERO_ADDRESS];
        const tx = await uniswapMigrator.connect(account.signer).migrateUniswapV2AndCreatePool({
            name: poolData.name,
            symbol: poolData.symbol,
            source,
            fromLpToken: fromLPToken.address,
            liquidity: fromLPPositionBefore,
            tokens: tokensSorted,
            rateProviders,
            amountsMin: amountsMinSorted,
            deadline,
            swapFeePercentage: poolData.swapFeePercentage,
        });

        const receipt = await waitForTx(tx, debug);
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
    }

    describe("Migrate Sushi Position", () => {
        const source = MigratorSource.Sushiswap;
        it("migrates and creates a new pool - weighted", async () => {
            await expectMigrateUniswapV2AndCreatePool(sushiOhmDaiLPHolder, source, sushiOhmDaiLPToken, {
                name: "50OHM-50DAI",
                symbol: "50OHM-50DAI",
                tokens: [ohmAddress, daiAddress],
                swapFeePercentage: 3000000000000000, // 0.3%
                minOut: 1,
            });
        });
        it("migrates join to an existing pool - weighted", async () => {
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
        it("migrates join to an existing pool without rewards - weighted", async () => {
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
        const source = MigratorSource.Uniswap;

        it("migrates and creates a new pool - weighted", async () => {
            await expectMigrateUniswapV2AndCreatePool(uniV2FeiTribeLPHolder, source, uniV2FeiTribeLPToken, {
                name: "50FEI-50TRIBE",
                symbol: "50FEI-50TRIBE",
                tokens: [feiAddress, tribeAddress],
                swapFeePercentage: 3000000000000000,
                minOut: 1,
            });
        });
        it("migrates join to an existing pool - weighted", async () => {
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
