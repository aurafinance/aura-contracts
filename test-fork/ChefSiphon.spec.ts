import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import {
    ConvexMasterChef,
    ConvexMasterChef__factory,
    ERC20__factory,
    SiphonToken,
    SiphonToken__factory,
    ChefForwarder,
    ChefForwarder__factory,
    MasterChefRewardHook,
    MasterChefRewardHook__factory,
    BoosterOwner__factory,
    Booster__factory,
    ExtraRewardStashV3__factory,
} from "../types/generated";
import { advanceBlock, impersonateAccount } from "../test-utils";
import { Signer } from "ethers";
import { deployContract } from "../tasks/utils";

const debug = false;

const auraToken = "0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF";
const masterChefAdress = "0x1ab80F7Fb46B25b7e0B2cfAC23Fc88AC37aaf4e9";
const chefAdminAddress = "0x5fea4413e3cc5cf3a29a49db41ac0c24850417a0";
const briberAddress = "0x3000d9B2c0E6B9F97f30ABE379eaAa8A85A04afC";
const stashAddress = "0xF801a238a1Accc7A63b429E8c343B198d51fbbb9";
const boosterOwnerAddress = "0xFa838Af70314135159b309bf27f1DbF1F954eC34";
const boosterAddress = "0x7818A1DA7BD1E64c199029E86Ba244a9798eEE10";
const zeroAddress = "0x0000000000000000000000000000000000000000";
const auraBalPid = 19;

describe("ChefSiphon", () => {
    let chefAdmin: Signer;
    let briber: Signer;
    let masterChef: ConvexMasterChef;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15135072,
                    },
                },
            ],
        });

        await impersonateAccount(chefAdminAddress);
        chefAdmin = await ethers.getSigner(chefAdminAddress);

        await impersonateAccount(briberAddress);
        briber = await ethers.getSigner(briberAddress);

        masterChef = ConvexMasterChef__factory.connect(masterChefAdress, chefAdmin);
    });

    describe("divert chef rewards", () => {
        const mintAmount = 1;

        let siphonTokens: SiphonToken[] = [];
        let masterChefRewardHook: MasterChefRewardHook;
        let chefForwarder: ChefForwarder;

        it("deploy ChefForwarder", async () => {
            chefForwarder = await deployContract<ChefForwarder>(
                hre,
                new ChefForwarder__factory(chefAdmin),
                "ChefForwarder",
                [masterChefAdress],
            );
            await chefForwarder.setBriber(briberAddress);
        });
        it("deploy MasterChefRewardHook", async () => {
            masterChefRewardHook = await deployContract<MasterChefRewardHook>(
                hre,
                new MasterChefRewardHook__factory(chefAdmin),
                "MasterChefRewardHook",
                [stashAddress, masterChefAdress, auraToken],
            );
        });
        it("deploy chef siphon tokens", async () => {
            for (const rewardHandler of [chefForwarder, masterChefRewardHook]) {
                const factory = new SiphonToken__factory(chefAdmin);
                const token = await deployContract<SiphonToken>(
                    hre,
                    factory,
                    "SiphonTokenBribes",
                    [rewardHandler.address, mintAmount],
                    {},
                    debug,
                );
                const balance = await token.balanceOf(rewardHandler.address);
                expect(balance).eq(mintAmount);
                siphonTokens.push(token);
            }
        });
        it("stop rewards for pid:0", async () => {
            await masterChef.set(0, 0, zeroAddress, false);
        });
        it("add siphon token to chef", async () => {
            const poolAllocPoint = "1000";
            const rewarder = zeroAddress;
            const rewardHandlers = [chefForwarder, masterChefRewardHook];

            for (let i = 0; i < siphonTokens.length; i++) {
                const pid = await masterChef.poolLength();
                await rewardHandlers[i].setPid(pid);
                await masterChef.add(poolAllocPoint, siphonTokens[i].address, rewarder);
                expect(await masterChef.isAddedPool(siphonTokens[i].address)).eq(true);
            }
        });
        it("deposit tokens", async () => {
            await chefForwarder.deposit(siphonTokens[0].address);
            await masterChefRewardHook.deposit(siphonTokens[1].address);
        });
        it("claim rewards for ChefForwarder", async () => {
            const rewardTokenAddress = await masterChef.cvx();
            const rewardToken = ERC20__factory.connect(rewardTokenAddress, briber);

            const balanceBefore = await rewardToken.balanceOf(briberAddress);

            await advanceBlock();

            await chefForwarder.connect(briber).claim(rewardTokenAddress);
            const balanceAfter = await rewardToken.balanceOf(briberAddress);

            expect(balanceAfter).gt(balanceBefore);
        });
        it("set extra rewards on stash", async () => {
            const boosterOwner = BoosterOwner__factory.connect(boosterOwnerAddress, chefAdmin);
            const admin = await boosterOwner.owner();
            await impersonateAccount(admin);
            const adminSigner = await ethers.getSigner(admin);
            await boosterOwner.connect(adminSigner).setStashExtraReward(stashAddress, auraToken);
            await boosterOwner.connect(adminSigner).setStashRewardHook(stashAddress, masterChefRewardHook.address);

            const stash = ExtraRewardStashV3__factory.connect(stashAddress, chefAdmin);
            expect(await stash.rewardHook()).eq(masterChefRewardHook.address);
        });
        it("claim rewards via earmarkRewards for MasterChefRewardHook", async () => {
            const rewardTokenAddress = await masterChef.cvx();
            const rewardToken = ERC20__factory.connect(rewardTokenAddress, chefAdmin);
            const booster = Booster__factory.connect(boosterAddress, chefAdmin);
            const poolInfo = await booster.poolInfo(auraBalPid);
            expect(poolInfo.stash).eq(stashAddress);
            const stash = ExtraRewardStashV3__factory.connect(stashAddress, chefAdmin);
            const tokenInfo = await stash.tokenInfo(rewardTokenAddress);

            const balanceBefore = await rewardToken.balanceOf(tokenInfo.rewardAddress);
            await advanceBlock();
            await booster.earmarkRewards(auraBalPid);
            const balanceAfter = await rewardToken.balanceOf(tokenInfo.rewardAddress);
            expect(balanceAfter).gt(balanceBefore);
        });
    });
});
