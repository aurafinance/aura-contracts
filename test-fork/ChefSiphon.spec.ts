import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import {
    ConvexMasterChef,
    ConvexMasterChef__factory,
    ERC20__factory,
    SiphonToken,
    SiphonToken__factory,
} from "../types/generated";
import { advanceBlock, impersonateAccount } from "../test-utils";
import { BigNumberish, Signer } from "ethers";
import { deployContract } from "../tasks/utils";

const debug = false;

const masterChefAdress = "0x1ab80F7Fb46B25b7e0B2cfAC23Fc88AC37aaf4e9";
const chefAdminAddress = "0x5fea4413e3cc5cf3a29a49db41ac0c24850417a0";
const muleAddress = "0x3000d9B2c0E6B9F97f30ABE379eaAa8A85A04afC";

describe("ChefSiphon", () => {
    let chefAdmin: Signer;
    let mule: Signer;
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

        await impersonateAccount(muleAddress);
        mule = await ethers.getSigner(muleAddress);

        masterChef = ConvexMasterChef__factory.connect(masterChefAdress, chefAdmin);
    });

    describe("divert chef rewards", () => {
        let siphonToken: SiphonToken;
        let pid: BigNumberish;

        it("deploy chef siphon token", async () => {
            const mintAmount = 1;
            const factory = new SiphonToken__factory(mule);
            siphonToken = await deployContract<SiphonToken>(
                hre,
                factory,
                "SiphonToken",
                [muleAddress, mintAmount],
                {},
                debug,
            );
            const balance = await siphonToken.balanceOf(muleAddress);
            expect(balance).eq(mintAmount);
        });
        it("add siphon token to chef", async () => {
            const totalAllocPoint = await masterChef.totalAllocPoint();
            const rewarder = "0x0000000000000000000000000000000000000000";
            pid = await masterChef.poolLength();
            await masterChef.add(totalAllocPoint, siphonToken.address, rewarder);
            expect(await masterChef.isAddedPool(siphonToken.address)).eq(true);
        });
        it("deposit tokens", async () => {
            const balance = await siphonToken.balanceOf(muleAddress);
            await siphonToken.approve(masterChef.address, balance);
            await masterChef.connect(mule).deposit(pid, balance);
        });
        it("claim rewards", async () => {
            const rewardTokenAddress = await masterChef.cvx();
            const rewardToken = ERC20__factory.connect(rewardTokenAddress, mule);
            const balanceBefore = await rewardToken.balanceOf(muleAddress);
            await advanceBlock();
            await masterChef.claim(pid, muleAddress);
            const balanceAfter = await rewardToken.balanceOf(muleAddress);
            expect(balanceAfter).gt(balanceBefore);
        });
    });
});
