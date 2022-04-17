import hre, { ethers } from "hardhat";
import { expect } from "chai";
import {
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    DistroList,
    SystemDeployed,
} from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { AuraToken, ConvexMasterChef } from "../types/generated";
import { Signer } from "ethers";
import { simpleToExactAmount, BN } from "../test-utils/math";
import { ZERO_ADDRESS } from "../test-utils/constants";
import { impersonateAccount } from "../test-utils/fork";
import { assertBNClose } from "../test-utils/assertions";

interface PoolInfo {
    lpToken: string;
    allocPoint: BN;
    lastRewardBlock: BN;
    accCvxPerShare: BN;
    rewarder: string;
}
const blocksInDay = BN.from(7000);
const numberOfBlocksIn4Years = blocksInDay.mul(365).mul(4); // 4 years

describe("ConvexMasterChef", () => {
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let cvx: AuraToken;
    let chef: ConvexMasterChef;

    let deployer: Signer;
    let daoMultisig: Signer;
    let distro: DistroList;
    let contracts: SystemDeployed;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];

        mocks = await deployMocks(deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        daoMultisig = await ethers.getSigner(multisigs.daoMultisig);
        distro = getMockDistro();

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

        cvx = contracts.cvx;
        chef = contracts.chef;

        const operatorAccount = await impersonateAccount(contracts.booster.address);
        await contracts.cvx
            .connect(operatorAccount.signer)
            .mint(operatorAccount.address, simpleToExactAmount(100000, 18));
        await contracts.cvx
            .connect(operatorAccount.signer)
            .transfer(await deployer.getAddress(), simpleToExactAmount(1000));
    });

    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            const currentBlock = await ethers.provider.getBlockNumber();
            const expectedStartBlock = BN.from(currentBlock).add(blocksInDay.mul(7)); // 7 days from now
            const startBlock = await chef.startBlock();
            const chefCvx = distro.lpIncentives;
            const rewardPerBlock = chefCvx.div(numberOfBlocksIn4Years);

            expect(await chef.cvx(), "cvx").to.eq(cvx.address);
            expect(await chef.rewardPerBlock(), "rewardPerBlock").to.eq(rewardPerBlock);
            //  Bonus multiplier is not used in chef, so it could be removed.
            expect(await chef.BONUS_MULTIPLIER(), "BONUS_MULTIPLIER").to.eq(2);
            assertBNClose(startBlock, expectedStartBlock, 20);
            expect(await chef.endBlock(), "endBlock").to.eq(startBlock.add(numberOfBlocksIn4Years));
        });
        it("validates deployment values", async () => {
            const poolInfo: PoolInfo = await chef.poolInfo(0);
            // only 100 cvxCrvBpt are added at deployment
            expect(await chef.totalAllocPoint(), "totalAllocPoint").to.eq(1000);
            // expect owner to be deployer
            expect(await chef.owner(), "owner").to.eq(await daoMultisig.getAddress());
            expect(await chef.poolLength(), "poolLength").to.eq(1);
            expect(poolInfo.accCvxPerShare, "userInfo accCvxPerShare").to.eq(0);
            expect(poolInfo.allocPoint, "userInfo allocPoint").to.eq(1000);
            expect(poolInfo.lpToken, "userInfo lpToken").to.eq(contracts.cvxCrvBpt.address);
            expect(poolInfo.rewarder, "userInfo rewarder").to.eq(ZERO_ADDRESS);
        });
    });
    describe("getMultiplier", async () => {
        let startBlock: BN;
        let endBlock: BN;
        before(async () => {
            startBlock = await chef.startBlock();
            endBlock = await chef.endBlock();
        });
        it("when _from block and _to block smaller than endblock", async () => {
            const from = startBlock.add(BN.from(100));
            const to = endBlock.sub(BN.from(100));
            expect(await chef.getMultiplier(from, to), "multiplier not clamped").to.eq(to.sub(from));
        });
        it("when _from block is smaller than start block and _to block is smaller than end block ", async () => {
            const from = startBlock.sub(BN.from(100));
            const to = endBlock.sub(BN.from(100));
            expect(await chef.getMultiplier(from, to), "multiplier not clamped").to.eq(to.sub(from));
        });
        it("when _to block is greater than end block", async () => {
            const clampedMultiplier = await chef.getMultiplier(startBlock, endBlock);
            expect(await chef.getMultiplier(startBlock, endBlock.add(BN.from(100))), "multiplier").to.eq(
                clampedMultiplier,
            );
        });
        it("when _from and _to block are greater than end block", async () => {
            expect(
                await chef.getMultiplier(endBlock.add(BN.from(1)), endBlock.add(BN.from(100))),
                "zero multiplier",
            ).to.eq(0);
        });
    });
});
