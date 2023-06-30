import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import {
    assertBNClosePercent,
    getTimestamp,
    impersonateAccount,
    simpleToExactAmount,
    increaseTimeTo,
} from "../../test-utils";
import { ONE_DAY } from "../../test-utils/constants";
import { Account, ERC20, MockERC20__factory, TokenDrip, TokenDrip__factory } from "../../types";

describe("TokenDrip", () => {
    let deployer: Account;
    let receiver: Account;

    let tokenDrip: TokenDrip;
    let mockToken: ERC20;

    let initialLastUpdated: BigNumber;
    const initialTarget = simpleToExactAmount(2_000);
    const initialRate = simpleToExactAmount(2_000).div(ONE_DAY.mul(30)); // 2,000 every 30 days

    before(async () => {
        const signers = await ethers.getSigners();
        deployer = await impersonateAccount(await signers[0].getAddress());
        receiver = await impersonateAccount(await signers[1].getAddress());

        initialLastUpdated = await getTimestamp();
        mockToken = await new MockERC20__factory(deployer.signer).deploy(
            "MOCK",
            "MOCK",
            18,
            deployer.address,
            1_000_000,
        );

        tokenDrip = await new TokenDrip__factory(deployer.signer).deploy(
            mockToken.address,
            receiver.address,
            initialTarget,
            initialRate,
        );

        await mockToken.transfer(tokenDrip.address, initialTarget);
    });

    describe("setup", () => {
        it("has the correct config", async () => {
            // Immutables
            expect(await tokenDrip.token()).eq(mockToken.address);
            expect(await tokenDrip.to()).eq(receiver.address);
            // Mutables
            expect(await tokenDrip.lastUpdated()).gte(initialLastUpdated);
            expect(await tokenDrip.current()).eq(0);
            expect(await tokenDrip.target()).eq(initialTarget);
            expect(await tokenDrip.rate()).eq(initialRate);
        });

        it("protected functions", async () => {
            const ownerErrorMsg = "Ownable: caller is not the owner";

            const contract = tokenDrip.connect(receiver.signer);
            await expect(contract.update(0, 0, 0, 0)).to.be.revertedWith(ownerErrorMsg);
            await expect(contract.cancel()).to.be.revertedWith(ownerErrorMsg);
            await expect(
                contract.withdrawERC20(mockToken.address, deployer.address, simpleToExactAmount(100)),
            ).to.be.revertedWith(ownerErrorMsg);
        });
    });

    describe("drip()", () => {
        const intervals = 30;

        for (let i = 0; i < intervals - 1; i++) {
            it(`day ${i + 1}`, async () => {
                const ts = await getTimestamp();
                await increaseTimeTo(ts.add(ONE_DAY));
                const balBefore = await mockToken.balanceOf(receiver.address);
                const currentBefore = await tokenDrip.current();

                await tokenDrip.drip();

                const balAfter = await mockToken.balanceOf(receiver.address);
                const currentAfter = await tokenDrip.current();

                const bal = balAfter.sub(balBefore);
                const current = currentAfter.sub(currentBefore);

                expect(current).eq(bal);
                assertBNClosePercent(bal, initialTarget.div(30), "0.01");
                assertBNClosePercent(currentAfter, initialTarget.div(30).mul(i + 1), "0.01");
            });
        }

        it("day 30 (last day)", async () => {
            const ts = await getTimestamp();
            await increaseTimeTo(ts.add(ONE_DAY));
            const balBefore = await mockToken.balanceOf(receiver.address);
            const currentBefore = await tokenDrip.current();

            await tokenDrip.drip();

            const balAfter = await mockToken.balanceOf(receiver.address);
            const currentAfter = await tokenDrip.current();

            const bal = balAfter.sub(balBefore);
            const current = currentAfter.sub(currentBefore);

            expect(current).eq(bal);
            expect(await tokenDrip.current()).eq(await tokenDrip.target());
            expect(await mockToken.balanceOf(tokenDrip.address)).eq(0);
        });
    });

    describe("withdrawERC20()", () => {
        it("can withdraw erc20 normally", async () => {
            const amount = simpleToExactAmount(10);
            await mockToken.transfer(tokenDrip.address, amount);
            const dripBalBefore = await mockToken.balanceOf(tokenDrip.address);
            expect(dripBalBefore).eq(amount);

            const balBefore = await mockToken.balanceOf(deployer.address);
            await tokenDrip.withdrawERC20(mockToken.address, deployer.address, amount);
            const balAfter = await mockToken.balanceOf(deployer.address);
            const dripBalAfter = await mockToken.balanceOf(tokenDrip.address);

            const bal = balAfter.sub(balBefore);
            const dripBal = dripBalBefore.sub(dripBalAfter);

            expect(bal).eq(amount);
            expect(dripBal).eq(amount);
        });
    });

    describe("cancel()", () => {
        it("can cancel normally", async () => {
            expect(await tokenDrip.current()).not.eq(0);
            expect(await tokenDrip.target()).not.eq(0);
            expect(await tokenDrip.lastUpdated()).not.eq(0);
            expect(await tokenDrip.rate()).not.eq(0);

            await tokenDrip.cancel();

            expect(await tokenDrip.current()).eq(0);
            expect(await tokenDrip.target()).eq(0);
            expect(await tokenDrip.lastUpdated()).eq(0);
            expect(await tokenDrip.rate()).eq(0);
        });
    });
});
