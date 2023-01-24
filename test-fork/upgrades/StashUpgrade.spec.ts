import hre, { network } from "hardhat";
import { expect } from "chai";
import { BigNumberish, ethers, Signer } from "ethers";

import {
    Account,
    BaseRewardPool__factory,
    Booster,
    BoosterOwner,
    ExtraRewardStashV3__factory,
    MockERC20__factory,
    ERC20,
    ERC20__factory,
    BaseRewardPool,
    MockERC20,
    ExtraRewardStashV3,
    StashToken__factory,
    Booster__factory,
} from "../../types";
import { impersonateAccount } from "../../test-utils";
import { config } from "../../tasks/deploy/mainnet-config";
import { Phase6Deployed } from "../../scripts/deploySystem";
import { deployContract } from "../../tasks/utils";
import { ZERO_ADDRESS } from "../../test-utils";
import { PoolInfoStruct } from "types/generated/IBooster";

const lpWhaleAddress = "0xb1c26d7ab776c58e349dfb30f475e70087f86fd2";
const newGaugeAddress = "0x7C777eEA1dC264e71E567Fcc9B6DdaA9064Eff51";

describe("Extra Reward Stash Upgrade", () => {
    let protocolDao: Account;
    let deployer: Signer;
    let phase6: Phase6Deployed;

    let booster: Booster;
    let boosterOwner: BoosterOwner;
    let lpWhale: Account;

    let newStashPoolPid: BigNumberish;
    let newPoolInfo: PoolInfoStruct;
    let lpToken: ERC20;
    let rewards: BaseRewardPool;
    let stash: ExtraRewardStashV3;
    let dummyToken: MockERC20;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 16177700,
                    },
                },
            ],
        });

        const signers = await hre.ethers.getSigners();
        deployer = signers[0];

        protocolDao = await impersonateAccount(config.multisigs.daoMultisig);
        phase6 = await config.getPhase6(protocolDao.signer);

        booster = phase6.booster;
        boosterOwner = phase6.boosterOwner;
        lpWhale = await impersonateAccount(lpWhaleAddress);
    });

    it("deploy new stash and set implementation", async () => {
        const newStashImpl = await deployContract(
            hre,
            new ExtraRewardStashV3__factory(deployer),
            "",
            [config.addresses.token],
            {},
            false,
        );

        expect(await phase6.factories.stashFactory.v3Implementation()).not.eq(newStashImpl.address);
        await boosterOwner.setStashFactoryImplementation(ZERO_ADDRESS, ZERO_ADDRESS, newStashImpl.address);
        expect(await phase6.factories.stashFactory.v3Implementation()).eq(newStashImpl.address);
    });
    it("Add new pool", async () => {
        newStashPoolPid = await booster.poolLength();
        await phase6.poolManager["addPool(address)"](newGaugeAddress);
        newPoolInfo = await booster.poolInfo(newStashPoolPid);

        expect(newPoolInfo.gauge).eq(newGaugeAddress);

        lpToken = ERC20__factory.connect(newPoolInfo.lptoken, deployer);
        expect(await lpToken.balanceOf(lpWhale.address)).gt(0);
        rewards = BaseRewardPool__factory.connect(newPoolInfo.crvRewards, deployer);
        stash = ExtraRewardStashV3__factory.connect(newPoolInfo.stash, deployer);
    });
    it("Add extra reward token", async () => {
        dummyToken = await new MockERC20__factory(deployer).deploy(
            "",
            "",
            18,
            await deployer.getAddress(),
            ethers.constants.MaxUint256,
        );
        await boosterOwner.setStashExtraReward(newPoolInfo.stash, dummyToken.address);
        const tokenInfo = await stash.tokenInfo(dummyToken.address);
        expect(await stash.tokenList(0)).eq(dummyToken.address);
        expect(tokenInfo.token).eq(dummyToken.address);
    });
    it("Deposit into the pool", async () => {
        const balance = await lpToken.balanceOf(lpWhale.address);
        const rewardBalBefore = await rewards.balanceOf(lpWhale.address);
        await lpToken.connect(lpWhale.signer).approve(booster.address, ethers.constants.MaxUint256);
        await booster.connect(lpWhale.signer).depositAll(newStashPoolPid, true);
        const rewardBalAfter = await rewards.balanceOf(lpWhale.address);
        expect(rewardBalAfter.sub(rewardBalBefore)).eq(balance);
    });
    it("add MaxUint256 reward token", async () => {
        const balance = await dummyToken.balanceOf(await deployer.getAddress());
        expect(balance).eq(ethers.constants.MaxUint256);
        await dummyToken.transfer(newPoolInfo.stash, balance);
        expect(await dummyToken.balanceOf(newPoolInfo.stash)).eq(balance);
        await expect(booster.earmarkRewards(newStashPoolPid)).to.be.revertedWith("totalSupply exceeded");
    });
    it("disable extra reward token", async () => {
        const info = await stash.tokenInfo(dummyToken.address);
        const stashToken = StashToken__factory.connect(info.stashToken, deployer);

        expect(await stashToken.isValid()).eq(true);

        // There is some bug with hardhat that causes this to revert if you try and
        // set isValid from BoosterOwner.execute. Something to do with too manage delegate
        // calls and then it looses track of msg.sender. So this is a workaround
        const operator = await stashToken.operator();
        const owner = await Booster__factory.connect(operator, deployer).owner();
        const acc = await impersonateAccount(owner);

        await stashToken.connect(acc.signer).setIsValid(false);
        expect(await stashToken.isValid()).eq(false);
        await booster.earmarkRewards(newStashPoolPid);
        // Earmark is now able to process
    });
    it("Withdraw from the pool", async () => {
        const balanceBefore = await lpToken.balanceOf(lpWhale.address);
        const expectedBalance = await rewards.balanceOf(lpWhale.address);
        await rewards.connect(lpWhale.signer).withdrawAllAndUnwrap(false);
        const balanceAfter = await lpToken.balanceOf(lpWhale.address);
        expect(balanceAfter.sub(balanceBefore)).eq(expectedBalance);
    });
});
