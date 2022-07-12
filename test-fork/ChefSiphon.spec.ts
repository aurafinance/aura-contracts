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
} from "../types/generated";
import { advanceBlock, impersonateAccount } from "../test-utils";
import { BigNumberish, Signer } from "ethers";
import { deployContract } from "../tasks/utils";

const debug = false;

const auraToken = "0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF";
const masterChefAdress = "0x1ab80F7Fb46B25b7e0B2cfAC23Fc88AC37aaf4e9";
const chefAdminAddress = "0x5fea4413e3cc5cf3a29a49db41ac0c24850417a0";
const briberAddress = "0x3000d9B2c0E6B9F97f30ABE379eaAa8A85A04afC";
const stashAddress = "there is no pool yet";

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
                        blockNumber: 15100000,
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

        let pids: BigNumberish[] = [];
        let siphonTokens: SiphonToken[] = [];
        let masterChefRewardHook: MasterChefRewardHook;
        let chefForwarder: ChefForwarder;

        const rewardHandlers = [masterChefRewardHook, chefForwarder];

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
            for (const rewardHandler of rewardHandlers) {
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
        it("add siphon token to chef", async () => {
            const totalAllocPoint = await masterChef.totalAllocPoint();
            const poolAllocPoint = totalAllocPoint.div(2);
            const rewarder = "0x0000000000000000000000000000000000000000";
            for (let i = 0; i < siphonTokens.length; i++) {
                const pid = await masterChef.poolLength();
                pids.push(pid);
                await masterChef.add(poolAllocPoint, siphonTokens[i].address, rewarder);
                expect(await masterChef.isAddedPool(siphonTokens[i].address)).eq(true);
            }
        });
        it("deposit tokens", async () => {
            for (let i = 0; i < siphonTokens.length; i++) {
                await rewardHandlers[i].deposit(siphonTokens[i].address);
            }
        });
        it("claim rewards for ChefForwarder", async () => {
            const rewardTokenAddress = await masterChef.cvx();
            const rewardToken = ERC20__factory.connect(rewardTokenAddress, briber);
            const balanceBefore = await rewardToken.balanceOf(chefForwarder.address);
            await advanceBlock();
            await chefForwarder.connect(briber).claim(rewardTokenAddress);
            const balanceAfter = await rewardToken.balanceOf(chefForwarder.address);
            expect(balanceAfter).gt(balanceBefore);
        });
        xit("claim rewards for MasterChefRewardHook", async () => {
            // TODO:
        });
    });
});
