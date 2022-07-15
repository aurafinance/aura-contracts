import hre, { ethers, network } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import {
    ConvexMasterChef,
    SiphonToken,
    SiphonToken__factory,
    ChefForwarder,
    ChefForwarder__factory,
    MasterChefRewardHook,
    MasterChefRewardHook__factory,
    ExtraRewardStashV3__factory,
    AuraToken,
    BoosterOwner,
    Booster,
} from "../types/generated";
import { advanceBlock, impersonateAccount } from "../test-utils";
import { deployContract } from "../tasks/utils";
import { parseUnits } from "ethers/lib/utils";
import { config } from "../tasks/deploy/mainnet-config";
import { Phase2Deployed } from "scripts/deploySystem";

const debug = false;

const protocolMultisig = "0x5fea4413e3cc5cf3a29a49db41ac0c24850417a0";
const eoaAddress = "0x3000d9B2c0E6B9F97f30ABE379eaAa8A85A04afC";
const stashAddress = "0xF801a238a1Accc7A63b429E8c343B198d51fbbb9";
const zeroAddress = "0x0000000000000000000000000000000000000000";
const auraBalPid = 19;

describe("ChefSiphon", () => {
    let protocolDao: Signer;
    let eoa: Signer;
    let phase2: Phase2Deployed;

    let masterChef: ConvexMasterChef;
    let auraToken: AuraToken;
    let boosterOwner: BoosterOwner;
    let booster: Booster;

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

        await impersonateAccount(protocolMultisig);
        protocolDao = await ethers.getSigner(protocolMultisig);

        await impersonateAccount(eoaAddress);
        eoa = await ethers.getSigner(eoaAddress);

        phase2 = await config.getPhase2(protocolDao);
        masterChef = phase2.chef;
        auraToken = phase2.cvx;
        boosterOwner = phase2.boosterOwner;
        booster = phase2.booster;
    });

    describe("divert chef rewards", () => {
        let masterChefRewardHook: MasterChefRewardHook;
        let masterChefRewardHookSiphonToken: SiphonToken;

        let chefForwarder: ChefForwarder;
        let chefForwarderSiphonToken: SiphonToken;

        // -------------------------------------------------------------------
        // EOA will perform these actions
        // -------------------------------------------------------------------

        const mintAmount = parseUnits("1");

        it("deploy ChefForwarder", async () => {
            chefForwarder = await deployContract<ChefForwarder>(hre, new ChefForwarder__factory(eoa), "ChefForwarder", [
                masterChef.address,
            ]);
            await chefForwarder.setBriber(eoaAddress);
        });
        it("deploy siphon tokens for chefForwarder", async () => {
            chefForwarderSiphonToken = await deployContract<SiphonToken>(
                hre,
                new SiphonToken__factory(eoa),
                "SiphonTokenBribes",
                [chefForwarder.address, mintAmount],
                {},
                debug,
            );
            const balance = await chefForwarderSiphonToken.balanceOf(chefForwarder.address);
            expect(balance).eq(mintAmount);
        });
        it("deploy MasterChefRewardHook", async () => {
            masterChefRewardHook = await deployContract<MasterChefRewardHook>(
                hre,
                new MasterChefRewardHook__factory(eoa),
                "MasterChefRewardHook",
                [stashAddress, masterChef.address, auraToken.address],
            );
        });
        it("deploy siphon tokens for masterChefRewardHook", async () => {
            masterChefRewardHookSiphonToken = await deployContract<SiphonToken>(
                hre,
                new SiphonToken__factory(eoa),
                "SiphonTokenBribes",
                [masterChefRewardHook.address, mintAmount],
                {},
                debug,
            );
            const balance = await masterChefRewardHookSiphonToken.balanceOf(masterChefRewardHook.address);
            expect(balance).eq(mintAmount);
        });
        it("transfer ownership of reward contracts to protocolMultisig", async () => {
            await masterChefRewardHook.transferOwnership(protocolMultisig);
            await chefForwarder.transferOwnership(protocolMultisig);

            masterChefRewardHook = masterChefRewardHook.connect(protocolDao);
            chefForwarder = chefForwarder.connect(protocolDao);
        });

        // -------------------------------------------------------------------
        // Protocol DAO will perform these actions
        // -------------------------------------------------------------------
        const poolAllocPoint = "1000";
        const rewarder = zeroAddress;

        it("add siphon token for masterChefRewardHook", async () => {
            const pid = await masterChef.poolLength();
            await masterChefRewardHook.setPid(pid);
            await masterChef.add(poolAllocPoint, masterChefRewardHookSiphonToken.address, rewarder);
            expect(await masterChef.isAddedPool(masterChefRewardHookSiphonToken.address)).eq(true);
        });
        it("add siphon token for chefForwarder", async () => {
            const pid = await masterChef.poolLength();
            await chefForwarder.setPid(pid);
            await masterChef.add(poolAllocPoint, chefForwarderSiphonToken.address, rewarder);
            expect(await masterChef.isAddedPool(chefForwarderSiphonToken.address)).eq(true);
        });
        it("set rewards for pid 0 and 1 to 0", async () => {
            await masterChef.set(0, 0, zeroAddress, false);
            await masterChef.set(1, 0, zeroAddress, false);
        });
        it("deposit tokens for chefForwarder and masterChefRewardHook", async () => {
            await chefForwarder.deposit(chefForwarderSiphonToken.address);
            await masterChefRewardHook.deposit(masterChefRewardHookSiphonToken.address);
        });
        it("set stash reward hook to masterChefRewardHook", async () => {
            await boosterOwner.setStashExtraReward(stashAddress, auraToken.address);
            await boosterOwner.setStashRewardHook(stashAddress, masterChefRewardHook.address);

            const stash = ExtraRewardStashV3__factory.connect(stashAddress, protocolDao);
            expect(await stash.rewardHook()).eq(masterChefRewardHook.address);
        });

        // Test claiming works
        it("claim rewards for ChefForwarder", async () => {
            const balanceBefore = await auraToken.balanceOf(eoaAddress);
            await advanceBlock();

            await chefForwarder.connect(eoa).claim(auraToken.address);
            const balanceAfter = await auraToken.balanceOf(eoaAddress);
            expect(balanceAfter).gt(balanceBefore);
        });
        it("claim rewards via earmarkRewards for MasterChefRewardHook", async () => {
            const poolInfo = await booster.poolInfo(auraBalPid);
            expect(poolInfo.stash).eq(stashAddress);

            const stash = ExtraRewardStashV3__factory.connect(stashAddress, protocolDao);
            const tokenInfo = await stash.tokenInfo(auraToken.address);

            const balanceBefore = await auraToken.balanceOf(tokenInfo.rewardAddress);
            await advanceBlock();
            await booster.earmarkRewards(auraBalPid);
            const balanceAfter = await auraToken.balanceOf(tokenInfo.rewardAddress);

            expect(balanceAfter).gt(balanceBefore);
        });
    });
});
