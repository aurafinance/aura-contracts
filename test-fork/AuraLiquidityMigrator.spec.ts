/* eslint-disable @typescript-eslint/no-unused-vars */
import { simpleToExactAmount } from "../test-utils/math";
import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import {
    MockBalInvestor,
    MockBalInvestor__factory,
    ERC20__factory,
    ERC20,
    AuraLiquidityMigrator,
    AuraLiquidityMigrator__factory,
} from "../types/generated";
import { deployContract } from "../tasks/utils";
import { impersonateAccount, fullScale, impersonate } from "../test-utils";
import { Signer } from "ethers";
import { Account } from "types";

const debug = false;

const uniV3LPAddress = "0xff052381092420b7f24cc97fded9c0c17b2cbbb9";
const uniV2LPAddress = "0xff052381092420b7f24cc97fded9c0c17b2cbbb9";
const sushiLPAddress = "0xa67ec8737021a7e91e883a3277384e6018bb5776";
const keeperAddress = "0xcc247cde79624801169475c9ba1f716db3959b8f";
const BALANCER_POOL_FACTORY = "0x8E9aa87E45e92bad84D5F8DD1bff34Fb92637dE9";
const UNISWAP_V3_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const BALANCER_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

const BAL_POOL_WBTC_ETH = "0xa6f548df93de924d73be7d25dc02554c6bd66db5";
const SUSHI_POOL_WBTC_ETH = "0xceff51756c56ceffca006cd410b03ffc46dd3a58";
const UNIV2_POOL_WBTC_ETH = "0xceff51756c56ceffca006cd410b03ffc46dd3a58";
const UNIV3_POOL_WBTC_ETH = "0xceff51756c56ceffca006cd410b03ffc46dd3a58";
const wbtcAddress = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
const wethAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

describe("AuraLiquidityMigrator", () => {
    let uniV3LP: Account;
    let uniV2LP: Account;
    let sushiLP: Account;
    let signer: Signer;
    let sushiLPWbtcWethToken: ERC20;
    let balLPWbtcWethToken: ERC20;

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

        uniV3LP = await impersonateAccount(uniV3LPAddress);
        uniV2LP = await impersonateAccount(uniV2LPAddress);
        sushiLP = await impersonateAccount(sushiLPAddress);
        signer = await impersonate(keeperAddress);

        const constructorArguments = [BALANCER_POOL_FACTORY, UNISWAP_V3_POSITION_MANAGER, BALANCER_VAULT];
        auraLiquidityMigrator = await deployContract<AuraLiquidityMigrator>(
            hre,
            new AuraLiquidityMigrator__factory(signer),
            "AuraLiquidityMigrator",
            constructorArguments,
            {},
            debug,
        );

        sushiLPWbtcWethToken = ERC20__factory.connect(SUSHI_POOL_WBTC_ETH, signer);
        balLPWbtcWethToken = ERC20__factory.connect(BAL_POOL_WBTC_ETH, signer);
    });

    describe("Migrate Sushi Position", () => {
        // it("migrates and creates a new pool", () => {
        // });
        it("migrates and creates and join to an existing pool", async () => {
            const sushiPositionBefore = await sushiLPWbtcWethToken.balanceOf(sushiLP.address);
            console.log(
                "🚀 ~ file: AuraLiquidityMigrator.spec.ts ~ line 78 ~ it ~ sushiPositionBefore",
                sushiPositionBefore.toString(),
            );
            const balPositionBefore = await balLPWbtcWethToken.balanceOf(sushiLP.address);
            console.log(
                "🚀 ~ file: AuraLiquidityMigrator.spec.ts ~ line 80 ~ it ~ balPositionBefore",
                balPositionBefore.toString(),
            );

            await sushiLPWbtcWethToken
                .connect(sushiLP.signer)
                .approve(auraLiquidityMigrator.address, ethers.constants.MaxUint256);

            await auraLiquidityMigrator
                .connect(sushiLP.signer)
                .migrateUniswapV2PositionAndJoinPool(
                    SUSHI_POOL_WBTC_ETH,
                    [wbtcAddress, wethAddress],
                    [simpleToExactAmount(5, 17), simpleToExactAmount(5, 17)],
                    sushiLP.address,
                    0,
                    BAL_POOL_WBTC_ETH,
                );
            const sushiPositionAfter = await sushiLPWbtcWethToken.balanceOf(sushiLP.address);
            console.log(
                "🚀 ~ file: AuraLiquidityMigrator.spec.ts ~ line 91 ~ it ~ sushiPositionAfter",
                sushiPositionAfter.toString(),
            );
            const balPositionAfter = await balLPWbtcWethToken.balanceOf(sushiLP.address);
            console.log(
                "🚀 ~ file: AuraLiquidityMigrator.spec.ts ~ line 93 ~ it ~ balPositionAfter",
                balPositionAfter.toString(),
            );
        });
    });
});
