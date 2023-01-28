import { simpleToExactAmount } from "../test-utils/math";
import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import {
    MockBalInvestor,
    MockBalInvestor__factory,
    ERC20__factory,
    ERC20,
    MockERC20__factory,
} from "../types/generated";
import { deployContract } from "../tasks/utils";
import { impersonateAccount, impersonate, fullScale, assertBNClose } from "../test-utils";
import { BigNumberish, Signer } from "ethers";
import { config } from "../tasks/deploy/mainnet-config";

const debug = false;
const ALCHEMY_API_KEY = process.env.NODE_URL;
const BALWhale = "0xff052381092420b7f24cc97fded9c0c17b2cbbb9";

describe("TestBalEth", () => {
    let testEthBal: MockBalInvestor;
    let balToken: ERC20;
    let wethToken: ERC20;
    let signer: Signer;

    const amount = ethers.utils.parseEther("100");

    const getWeth = async (recipient: string, amount: BigNumberish) => {
        const ethWhale = await impersonate(config.addresses.wethWhale);
        const token = MockERC20__factory.connect(config.addresses.weth, ethWhale);
        await token.transfer(recipient, amount);
    };

    const setup = async (blockNumber: number) => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: ALCHEMY_API_KEY,
                        blockNumber: blockNumber,
                    },
                },
            ],
        });

        await impersonateAccount(BALWhale);
        signer = await ethers.getSigner(BALWhale);

        await getWeth(BALWhale, simpleToExactAmount(1000));

        const poolId = "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014";
        const vault = "0xba12222222228d8ba445958a75a0704d566bf2c8";
        const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
        const bal = "0xba100000625a3754423978a60c9317c58a424e3D";

        balToken = ERC20__factory.connect(bal, signer);
        wethToken = ERC20__factory.connect(weth, signer);

        testEthBal = await deployContract<MockBalInvestor>(
            hre,
            new MockBalInvestor__factory(signer),
            "testEthBal",
            [vault, bal, weth, poolId],
            {},
            debug,
        );
    };

    before(async () => {
        await setup(14370000);
    });

    describe("join BAL:ETH 80/20 pool with BAL", () => {
        it("transfer BAL to contract", async () => {
            const tx = await balToken.approve(testEthBal.address, amount);
            await tx.wait();
        });
        it("add BAL to pool", async () => {
            const bptAddress = await testEthBal.BALANCER_POOL_TOKEN();
            const bpt = ERC20__factory.connect(bptAddress, signer);

            const bptBalanceBefore = await bpt.balanceOf(testEthBal.address);

            let tx = await testEthBal.approveToken();
            await tx.wait();

            const minOut = await testEthBal["getMinOut(uint256,uint256)"](amount, 9980);
            tx = await testEthBal.addBalToPool(amount.toString(), minOut);
            await tx.wait();

            const bptBalanceAfter = await bpt.balanceOf(testEthBal.address);
            const bptBalanceDelta = bptBalanceAfter.sub(bptBalanceBefore);

            const bptPrice = await testEthBal.getBptPrice();

            const bptBalValue = bptPrice.mul(bptBalanceDelta).div(fullScale);
            const minAmount = amount.mul("9950").div("10000");
            expect(bptBalValue).gt(minAmount);
        });

        it("fails if incorrect minOut passed", async () => {
            const tx = await balToken.approve(testEthBal.address, amount);
            await tx.wait();

            let minOut = await testEthBal["getMinOut(uint256,uint256)"](amount, 10005);

            await expect(testEthBal.addBalToPool(amount.toString(), minOut)).to.be.revertedWith("BAL#208");

            minOut = await testEthBal["getMinOut(uint256,uint256)"](amount, 9980);

            await testEthBal.addBalToPool(amount.toString(), minOut);
        });

        it("fails if slippage not met (large deposit)", async () => {
            const tx = await balToken.approve(testEthBal.address, simpleToExactAmount(1, 24));
            await tx.wait();

            const minOut = await testEthBal["getMinOut(uint256,uint256)"](simpleToExactAmount(1, 24), 9980);

            await expect(testEthBal.addBalToPool(simpleToExactAmount(1, 24), minOut)).to.be.revertedWith("BAL#208");
        });
    });
    describe("join BAL:ETH 80/20 pool with BAL and ETH", () => {
        // 100 BAL = 0.4 ETH
        const balAmount = ethers.utils.parseEther("100");
        const wethAmount = simpleToExactAmount(1, 17);

        it("approve transfer BAL and WETH to contract", async () => {
            await balToken.approve(testEthBal.address, balAmount);
            await wethToken.approve(testEthBal.address, wethAmount);
        });
        it("add BAL and WETH to pool", async () => {
            const bptAddress = await testEthBal.BALANCER_POOL_TOKEN();
            const bpt = ERC20__factory.connect(bptAddress, signer);

            const bptBalanceBefore = await bpt.balanceOf(testEthBal.address);

            let tx = await testEthBal.approveToken();

            const minOut = await testEthBal["getMinOut(uint256,uint256,uint256)"](balAmount, wethAmount, 9980);
            tx = await testEthBal.addBalAndWethToPool(balAmount, wethAmount, minOut);
            await tx.wait();

            const bptBalanceAfter = await bpt.balanceOf(testEthBal.address);
            const bptBalanceDelta = bptBalanceAfter.sub(bptBalanceBefore);

            const bptPrice = await testEthBal.getBptPrice();

            const bptBalValue = bptPrice.mul(bptBalanceDelta).div(fullScale);
            const minAmount = amount.mul("9950").div("10000");
            expect(bptBalValue).gt(minAmount);
        });
        it("fails if incorrect minOut passed", async () => {
            await balToken.approve(testEthBal.address, balAmount);
            await wethToken.approve(testEthBal.address, wethAmount);

            let minOut = await testEthBal["getMinOut(uint256,uint256,uint256)"](balAmount, wethAmount, 10005);

            await expect(testEthBal.addBalAndWethToPool(balAmount, wethAmount, minOut)).to.be.revertedWith("BAL#208");

            minOut = await testEthBal["getMinOut(uint256,uint256,uint256)"](balAmount, wethAmount, 9980);

            await testEthBal.addBalAndWethToPool(balAmount, wethAmount, minOut);
        });
        it("fails if slippage not met (large deposit)", async () => {
            const largeAmount = simpleToExactAmount(1, 24);
            await balToken.approve(testEthBal.address, largeAmount);
            await wethToken.approve(testEthBal.address, wethAmount);

            const minOut = await testEthBal["getMinOut(uint256,uint256,uint256)"](largeAmount, wethAmount, 9980);

            await expect(testEthBal.addBalAndWethToPool(largeAmount, wethAmount, minOut)).to.be.revertedWith("BAL#208");
        });
        describe("actual Tx tests", async () => {
            before(async () => {
                await setup(16492000);
            });
            const tests = [
                {
                    tx: "0xc2b3b5ec10d362960237f068e13693520303b3ce03be74f799d13eefaff6066f",
                    balAmount: simpleToExactAmount("58.852980191056353934"),
                    wethAmount: simpleToExactAmount("0.063412931637813554"),
                    expectedOut: simpleToExactAmount("29.360812625937656993"),
                },
                {
                    tx: "0x83f32315e52aa051217fbd8d7b4cd03b47634e41bdbacddaf46f9331683c8464",
                    balAmount: simpleToExactAmount("1.206668229860434648"),
                    wethAmount: simpleToExactAmount("0.00081"),
                    expectedOut: simpleToExactAmount("0.556234225941792865"),
                },
                {
                    tx: "0xd4e48f5dc349ad472894de1d7666dc83af59cdc0310036323184947de3a19ce1",
                    balAmount: simpleToExactAmount("355.335829634853910828"),
                    wethAmount: simpleToExactAmount("0.383755060078069976"),
                    expectedOut: simpleToExactAmount("177.354016092407642279"),
                },
            ];
            tests.forEach(test => {
                it("calculates minOut", async () => {
                    const minOut = await testEthBal["getMinOut(uint256,uint256,uint256)"](
                        test.balAmount,
                        test.wethAmount,
                        10000,
                    );
                    assertBNClose(minOut, test.expectedOut, simpleToExactAmount(7, 14));
                });
            });
        });
    });
});
