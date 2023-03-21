import { ethers } from "hardhat";
import { expect } from "chai";
import {
    Account,
    MockERC20__factory,
    MockERC20,
    VirtualBalanceRewardPool__factory,
    VirtualBalanceRewardPool,
} from "../../types";
import { simpleToExactAmount, impersonate, getTimestamp } from "../../test-utils";

describe("VirtualBalanceRewardPool", () => {
    let deployer: Account;
    let virtualRewardPool: VirtualBalanceRewardPool;
    let token: MockERC20;

    before(async () => {
        const accounts = await ethers.getSigners();
        deployer = {
            signer: accounts[0],
            address: await accounts[0].getAddress(),
        };

        token = await new MockERC20__factory(deployer.signer).deploy("token", "token", 18, deployer.address, 0);

        virtualRewardPool = await new VirtualBalanceRewardPool__factory(deployer.signer).deploy(
            token.address,
            token.address,
            deployer.address,
        );
    });

    it("queue rewards", async () => {
        expect(await virtualRewardPool.currentRewards()).eq(0);

        const amount = simpleToExactAmount(10);
        await token.mint(amount);
        await token.transfer(virtualRewardPool.address, amount);
        await virtualRewardPool.queueNewRewards(amount);
        expect(await virtualRewardPool.currentRewards()).eq(amount);

        const epoch = (await getTimestamp()).div(await virtualRewardPool.duration());
        expect(await virtualRewardPool.epochRewards(epoch)).eq(amount);
    });

    it("update rewards", async () => {
        const amount = simpleToExactAmount(10);
        const account = (await ethers.getSigners())[0];
        const addr = await account.getAddress();

        await token.connect(account).mint(amount);
        const tokenSigner = await impersonate(token.address, true);
        const userRewardPerTokenPaidBefore = await virtualRewardPool.userRewardPerTokenPaid(addr);
        await virtualRewardPool.connect(tokenSigner).stake(addr, amount);
        const userRewardPerTokenPaidAfter = await virtualRewardPool.userRewardPerTokenPaid(addr);
        expect(userRewardPerTokenPaidAfter).gt(userRewardPerTokenPaidBefore);
    });

    it("cannot queue max rewards", async () => {
        const epoch = (await getTimestamp()).div(await virtualRewardPool.duration());
        const rewardsBefore = await virtualRewardPool.epochRewards(epoch);
        const amount = ethers.constants.MaxUint256.sub(await token.totalSupply());
        await token.mint(amount);
        await token.transfer(virtualRewardPool.address, amount);
        await virtualRewardPool.queueNewRewards(amount);
        const rewardsAfter = await virtualRewardPool.epochRewards(epoch);
        expect(rewardsAfter.sub(rewardsBefore)).eq(amount);
    });
});
