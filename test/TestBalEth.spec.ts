import { ethers } from "hardhat";
import { expect } from "chai";
import { TestEthBal, TestEthBal__factory, ERC20__factory, ERC20 } from "../types/generated";
import { deployContract } from "../tasks/utils";
import { fullScale } from "../test-utils";
import { Signer } from "ethers";
import { deployMocks } from "../scripts/deployMocks";

const debug = false;

describe("TestBalEth", () => {
    let testEthBal: TestEthBal;
    let balToken: ERC20;
    let signer: Signer;

    const amount = ethers.utils.parseEther("100");

    before(async () => {
        const accounts = await ethers.getSigners();

        signer = accounts[0];
        const mocks = await deployMocks(signer, debug);

        const poolId = "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014";
        const vault = mocks.balanceVault.address;
        const weth = mocks.weth.address;
        const bal = mocks.bal.address;

        balToken = ERC20__factory.connect(bal, signer);

        testEthBal = await deployContract<TestEthBal>(
            new TestEthBal__factory(signer),
            "testEthBal",
            [vault, bal, weth, poolId, "9950"],
            {},
            debug,
        );
    });

    describe("join BAL:ETH 80/20 pool with BAL", () => {
        it("transfer BAL to contract", async () => {
            const tx = await balToken.transfer(testEthBal.address, amount);
            await tx.wait();

            const balanceAfter = await balToken.balanceOf(testEthBal.address);
            expect(balanceAfter).eq(amount);
        });

        it("add BAL to pool", async () => {
            const bptAddress = await testEthBal.BALANCER_POOL_TOKEN();
            const bpt = ERC20__factory.connect(bptAddress, signer);

            const bptBalanceBefore = await bpt.balanceOf(testEthBal.address);

            let tx = await testEthBal.approveToken();
            await tx.wait();

            tx = await testEthBal.addBalToPool();
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
