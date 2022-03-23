import { ethers, network } from "hardhat";
import { expect } from "chai";
import { TestEthBal, TestEthBal__factory, ERC20__factory, ERC20 } from "../types/generated";
import { deployContract } from "../tasks/utils";
import { impersonateAccount, fullScale } from "../test-utils";
import { Signer } from "ethers";

const debug = false;

const ALCHEMY_API_KEY = process.env.NODE_URL;

const BALWhale = "0xff052381092420b7f24cc97fded9c0c17b2cbbb9";

describe("TestBalEth", () => {
    let testEthBal: TestEthBal;
    let balToken: ERC20;
    let signer: Signer;

    const amount = ethers.utils.parseEther("100");

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: ALCHEMY_API_KEY,
                        blockNumber: 14370000,
                    },
                },
            ],
        });

        await impersonateAccount(BALWhale);

        signer = await ethers.getSigner(BALWhale);

        const poolId = "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014";
        const vault = "0xba12222222228d8ba445958a75a0704d566bf2c8";
        const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
        const bal = "0xba100000625a3754423978a60c9317c58a424e3D";

        balToken = ERC20__factory.connect(bal, signer);

        testEthBal = await deployContract<TestEthBal>(
            new TestEthBal__factory(signer),
            "testEthBal",
            [vault, bal, weth, poolId],
            {},
            debug,
        );
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

            tx = await testEthBal.addBalToPool(amount.toString());
            await tx.wait();

            const bptBalanceAfter = await bpt.balanceOf(testEthBal.address);
            const bptBalanceDelta = bptBalanceAfter.sub(bptBalanceBefore);

            const bptPrice = await testEthBal.getBptPrice();

            const bptBalValue = bptPrice.mul(bptBalanceDelta).div(fullScale);
            const minAmount = amount.mul("9950").div("10000");
            expect(bptBalValue).gt(minAmount);
        });
    });
});
