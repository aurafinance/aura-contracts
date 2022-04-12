import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4, SystemDeployed } from "../scripts/deploySystem";
import { deployMocks, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { AuraLocker, MockERC20, MockERC20__factory, ExtraRewardsDistributor } from "../types/generated";
import { impersonateAccount } from "../test-utils/fork";
import { ONE_WEEK } from "../test-utils/constants";
import { increaseTime, getTimestamp } from "../test-utils/time";
import { simpleToExactAmount, BN } from "../test-utils/math";
import { Account } from "types";

describe("ExtraRewardsDistributor", () => {
    let accounts: Signer[];
    let operatorAccount: Account;

    let distributor: ExtraRewardsDistributor;
    let contracts: SystemDeployed;
    let mockErc20: MockERC20;
    let mockErc20X: MockERC20;

    let auraLocker: AuraLocker;

    let deployer: Signer;

    let alice: Signer;
    let aliceAddress: string;

    let bob: Signer;
    let bobAddress: string;

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        const mocks = await deployMocks(deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(deployer, mocks.addresses);
        const phase2 = await deployPhase2(
            hre,
            deployer,
            phase1,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );
        const phase3 = await deployPhase3(hre, deployer, phase2, multisigs, mocks.addresses);
        await phase3.poolManager.setProtectPool(false);
        contracts = await deployPhase4(deployer, phase3, mocks.addresses);

        alice = accounts[1];
        aliceAddress = await alice.getAddress();
        bob = accounts[2];
        bobAddress = await bob.getAddress();

        distributor = contracts.extraRewardsDistributor.connect(alice);
        auraLocker = contracts.cvxLocker.connect(alice);

        operatorAccount = await impersonateAccount(contracts.booster.address);
        await contracts.cvx
            .connect(operatorAccount.signer)
            .mint(operatorAccount.address, simpleToExactAmount(100000, 18));
        await contracts.cvx.connect(operatorAccount.signer).transfer(aliceAddress, simpleToExactAmount(200));
        await contracts.cvx.connect(alice).approve(auraLocker.address, simpleToExactAmount(200));
        await auraLocker.lock(aliceAddress, simpleToExactAmount(1));

        mockErc20 = await new MockERC20__factory(alice).deploy("MockERC20", "mk20", 18, aliceAddress, 1000);
        await mockErc20.connect(alice).transfer(bobAddress, simpleToExactAmount(200));
        mockErc20X = await new MockERC20__factory(alice).deploy("MockERC20 X", "MKTX", 18, aliceAddress, 1000);
    });
    const getRewardEpochs = async (token: string): Promise<Array<{ index: number; epoch: BN }>> => {
        const epochs = [];
        try {
            for (let i = 0; i < 128; i++) {
                const epoch = await distributor.rewardEpochs(token, i);
                epochs.push({ index: i, epoch });
            }
        } catch (error) {
            // do nothing
        }
        return epochs;
    };
    const getRewardData = async (
        token: string,
        rewardEpochs: Array<{ index: number; epoch: BN }>,
    ): Promise<Array<BN>> => {
        const epochs = [];
        try {
            rewardEpochs.forEach(async re => {
                const rewardData = await distributor.rewardData(token, re.epoch);
                epochs.push(rewardData);
            });
        } catch (error) {
            // do nothing
        }
        return epochs;
    };

    async function getSnapshot(token: string, account: string, epoch: number): Promise<void> {
        console.log("==================>getSnapshot", account, epoch);
        const rewardEpochs = await getRewardEpochs(token);
        const rewardData = await getRewardData(token, rewardEpochs);
        // const rewardData = await distributor.rewardData(token,epoch);
        // const rewardEpochs = await distributor.rewardEpochs(token,epoch);
        const userClaims = await distributor.userClaims(token, account);

        console.log("userClaims     ", epoch, userClaims.toString());
        console.log("rewardEpochs   ", epoch, rewardEpochs.length);
        console.log("rewardData     ", epoch, rewardData.length);
    }
    async function verifyAddRewards(sender: Signer, fundAmount: BN, epoch: number) {
        await mockErc20.connect(sender).approve(distributor.address, fundAmount);
        const senderBalanceBefore = await mockErc20.balanceOf(await sender.getAddress());
        const distributorBalanceBefore = await mockErc20.balanceOf(distributor.address);
        await getSnapshot(mockErc20.address, await sender.getAddress(), 10 * epoch);
        await expect(distributor.connect(sender).addReward(mockErc20.address, fundAmount))
            .to.emit(distributor, "RewardAdded")
            .withArgs(mockErc20.address, epoch, fundAmount);

        expect(await mockErc20.balanceOf(distributor.address), "distributor balance").to.eq(
            distributorBalanceBefore.add(fundAmount),
        );
        expect(await mockErc20.balanceOf(await sender.getAddress()), "sender balance").to.eq(
            senderBalanceBefore.sub(fundAmount),
        );
        await getSnapshot(mockErc20.address, await sender.getAddress(), 10 * epoch + 1);
    }

    describe("error allows to claim multiple times the same epoch reward", async () => {
        it("adds multiple rewards in multiple epoch", async () => {
            const fundAmount = simpleToExactAmount(1);
            let epoch = 0;
            for (let i = 0; i < 32; i++) {
                await increaseTime(ONE_WEEK);
                epoch = (await auraLocker.findEpochId(await getTimestamp())).toNumber();
                await auraLocker.lock(aliceAddress, simpleToExactAmount(1));
                if (i < 5) {
                    await verifyAddRewards(alice, fundAmount, epoch);
                }
            }
        });
        it("adds multiple rewards in multiple epoch", async () => {
            // This scenario is found when token epochs is smaller than aura-locker epochs
            //  Then user claims the latest token epoch reward.
            //
            // _allClaimableRewards
            //               5 >   (5-1 = 4) :  5  = 4
            // epochIndex = epochIndex > (tokenEpochs - 1) ? (tokenEpochs - 1) : epochIndex;

            const epoch = 4;
            let tx = await distributor
                .connect(alice)
                ["getReward(address,address,uint256)"](aliceAddress, mockErc20.address, epoch);
            await expect(tx).to.emit(distributor, "RewardPaid");
            const userClaims = await distributor.userClaims(mockErc20.address, aliceAddress);
            const rewardEpochsCount = await distributor.rewardEpochsCount(mockErc20.address);
            console.log("userClaims ", userClaims.toString(), "rewardEpochsCount ", rewardEpochsCount.toString());

            tx = await distributor
                .connect(alice)
                ["getReward(address,address,uint256)"](aliceAddress, mockErc20.address, epoch);
            await expect(tx).not.to.emit(distributor, "RewardPaid");
        });
    });
});
