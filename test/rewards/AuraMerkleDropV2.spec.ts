import { assertBNClose } from "../../test-utils/assertions";
import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { MerkleTree } from "merkletreejs";
import { deployPhase1, deployPhase2, DistroList, Phase2Deployed } from "../../scripts/deploySystem";
import { deployMocks, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import { AuraLocker, ERC20, AuraMerkleDropV2__factory, AuraMerkleDropV2 } from "../../types/generated";
import { ONE_WEEK, ZERO_ADDRESS } from "../../test-utils/constants";
import { getTimestamp, increaseTime } from "../../test-utils/time";
import { BN, simpleToExactAmount } from "../../test-utils/math";
import { impersonateAccount } from "../../test-utils/fork";
import { createTreeWithAccounts, getAccountBalanceProof } from "../../test-utils/merkle";

describe("AuraMerkleDropV2", () => {
    let accounts: Signer[];

    let contracts: Phase2Deployed;
    let aura: ERC20;
    let auraLocker: AuraLocker;
    let merkleDrop: AuraMerkleDropV2;

    let deployTime: BN;

    let deployer: Signer;
    let deployerAddress: string;

    let admin: Signer;
    let adminAddress: string;

    let alice: Signer;
    let aliceAddress: string;

    let bob: Signer;
    let bobAddress: string;

    let dave: Signer;
    let daveAddress: string;

    let distro: DistroList;

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];

        const mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        distro = getMockDistro();

        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        contracts = await deployPhase2(hre, deployer, phase1, distro, multisigs, mocks.namingConfig, mocks.addresses);

        deployerAddress = await deployer.getAddress();

        admin = accounts[1];
        adminAddress = await admin.getAddress();

        alice = accounts[2];
        aliceAddress = await alice.getAddress();

        bob = accounts[3];
        bobAddress = await bob.getAddress();

        dave = accounts[4];
        daveAddress = await dave.getAddress();

        aura = contracts.cvx.connect(deployer) as ERC20;
        auraLocker = contracts.cvxLocker.connect(deployer);

        const operatorAccount = await impersonateAccount(contracts.booster.address);
        await contracts.cvx
            .connect(operatorAccount.signer)
            .mint(operatorAccount.address, simpleToExactAmount(100000, 18));
        await contracts.cvx.connect(operatorAccount.signer).transfer(deployerAddress, simpleToExactAmount(1000));

        deployTime = await getTimestamp();
    });
    describe("constructor fails", async () => {
        let tree: MerkleTree;
        before(async () => {
            const amount = simpleToExactAmount(100);
            tree = createTreeWithAccounts({
                [aliceAddress]: amount,
                [bobAddress]: amount,
                [daveAddress]: amount,
            });
        });
        it("if the expire date is less than 2 weeks", async () => {
            await expect(
                new AuraMerkleDropV2__factory(deployer).deploy(
                    adminAddress,
                    tree.getHexRoot(),
                    aura.address,
                    auraLocker.address,
                    ONE_WEEK,
                    ONE_WEEK.mul(2),
                ),
            ).to.be.revertedWith("!expiry");
        });
        it("if zero address on any argument", async () => {
            await expect(
                new AuraMerkleDropV2__factory(deployer).deploy(
                    ZERO_ADDRESS,
                    tree.getHexRoot(),
                    aura.address,
                    auraLocker.address,
                    ONE_WEEK,
                    ONE_WEEK.mul(3),
                ),
                "Wrong _dao",
            ).to.be.revertedWith("!dao");
            await expect(
                new AuraMerkleDropV2__factory(deployer).deploy(
                    adminAddress,
                    tree.getHexRoot(),
                    ZERO_ADDRESS,
                    auraLocker.address,
                    ONE_WEEK,
                    ONE_WEEK.mul(3),
                ),
                "Wrong aura",
            ).to.be.revertedWith("!aura");
        });
    });
    describe("basic MerkleDrop interactions", () => {
        let tree: MerkleTree;
        let dropAmount: BN;
        before(async () => {
            dropAmount = simpleToExactAmount(300);
            const amount = simpleToExactAmount(100);
            tree = createTreeWithAccounts({
                [aliceAddress]: amount,
                [bobAddress]: amount,
                [daveAddress]: amount,
            });
            merkleDrop = await new AuraMerkleDropV2__factory(deployer).deploy(
                adminAddress,
                tree.getHexRoot(),
                aura.address,
                auraLocker.address,
                ONE_WEEK,
                ONE_WEEK.mul(16),
            );
            await aura.transfer(merkleDrop.address, dropAmount);
        });
        it("initial configuration is correct", async () => {
            expect(await merkleDrop.aura()).eq(aura.address);
            expect(await merkleDrop.dao(), "dao").to.eq(adminAddress);
            expect(await merkleDrop.merkleRoot(), "merkleRoot").to.eq(tree.getHexRoot());
            expect(await merkleDrop.aura(), "aura").to.eq(aura.address);
            expect(await merkleDrop.auraLocker(), "auraLocker").to.eq(auraLocker.address);
            assertBNClose(await merkleDrop.startTime(), deployTime.add(ONE_WEEK), 5);
            assertBNClose(await merkleDrop.expiryTime(), deployTime.add(ONE_WEEK.mul(17)), 5);
            expect(await aura.balanceOf(merkleDrop.address), "aura balance").to.eq(dropAmount);
        });
        it("allows claiming and locking ", async () => {
            await increaseTime(ONE_WEEK);
            const amount = simpleToExactAmount(100);
            const lock = true;
            const aliceAuraBalanceBefore = await aura.balanceOf(aliceAddress);
            const aliceBalanceBefore = await auraLocker.balances(aliceAddress);
            expect(await merkleDrop.hasClaimed(aliceAddress), "user  has not claimed").to.eq(false);
            const tx = merkleDrop
                .connect(alice)
                .claim(getAccountBalanceProof(tree, aliceAddress, amount), amount, lock, aliceAddress);
            await expect(tx).to.emit(merkleDrop, "Claimed").withArgs(aliceAddress, amount, lock);
            expect(await aura.balanceOf(aliceAddress), "alice aura balance").to.eq(aliceAuraBalanceBefore);
            expect((await auraLocker.balances(aliceAddress)).locked, "alice aura locked balance").to.eq(
                aliceBalanceBefore.locked.add(amount),
            );
            expect(await merkleDrop.hasClaimed(aliceAddress), "user claimed").to.eq(true);
        });
        it("allows claiming no lock", async () => {
            const amount = simpleToExactAmount(100);
            const lock = false;
            const userAuraBalanceBefore = await aura.balanceOf(bobAddress);
            const userBalanceBefore = await auraLocker.balances(bobAddress);
            expect(await merkleDrop.hasClaimed(bobAddress), "user  has not claimed").to.eq(false);
            // test
            const tx = merkleDrop
                .connect(bob)
                .claim(getAccountBalanceProof(tree, bobAddress, amount), amount, lock, bobAddress);
            await expect(tx).to.emit(merkleDrop, "Claimed").withArgs(bobAddress, amount, lock);
            expect(await aura.balanceOf(bobAddress), "user aura balance").to.eq(userAuraBalanceBefore.add(amount));
            expect((await auraLocker.balances(bobAddress)).locked, "user aura locked balance").to.eq(
                userBalanceBefore.locked,
            );
            expect(await merkleDrop.hasClaimed(bobAddress), "user claimed").to.eq(true);
        });
        it("allows claiming on behalf", async () => {
            const amount = simpleToExactAmount(100);
            const lock = false;
            const userAuraBalanceBefore = await aura.balanceOf(daveAddress);
            const userBalanceBefore = await auraLocker.balances(daveAddress);
            expect(await merkleDrop.hasClaimed(daveAddress), "user  has not claimed").to.eq(false);
            // test
            const failingTx = merkleDrop
                .connect(bob)
                .claim(getAccountBalanceProof(tree, daveAddress, amount), amount, true, daveAddress);
            await expect(failingTx).to.be.revertedWith("sender!=addr");
            const tx = merkleDrop
                .connect(bob)
                .claim(getAccountBalanceProof(tree, daveAddress, amount), amount, lock, daveAddress);
            await expect(tx).to.emit(merkleDrop, "Claimed").withArgs(daveAddress, amount, lock);
            expect(await aura.balanceOf(daveAddress), "user aura balance").to.eq(userAuraBalanceBefore.add(amount));
            expect((await auraLocker.balances(daveAddress)).locked, "user aura locked balance").to.eq(
                userBalanceBefore.locked,
            );
            expect(await merkleDrop.hasClaimed(daveAddress), "user claimed").to.eq(true);
        });
    });
    describe("edge MerkleDrop interactions", () => {
        let tree: MerkleTree;
        let dropAmount: BN;
        before(async () => {
            dropAmount = simpleToExactAmount(300);
            const amount = simpleToExactAmount(100);
            tree = createTreeWithAccounts({
                [aliceAddress]: amount,
                [bobAddress]: amount,
                [daveAddress]: amount,
            });
            merkleDrop = await new AuraMerkleDropV2__factory(deployer).deploy(
                adminAddress,
                ethers.constants.HashZero,
                aura.address,
                ZERO_ADDRESS,
                ONE_WEEK,
                ONE_WEEK.mul(16),
            );
            await aura.transfer(merkleDrop.address, dropAmount);
        });
        it("fails claiming drop without a root", async () => {
            const amount = simpleToExactAmount(100);
            const lock = false;
            await expect(
                merkleDrop
                    .connect(bob)
                    .claim(getAccountBalanceProof(tree, bobAddress, amount), amount, lock, bobAddress),
            ).to.be.revertedWith("!root");
        });
        it("fails claiming a drop that has not started", async () => {
            await merkleDrop.connect(admin).setRoot(tree.getHexRoot());

            const amount = simpleToExactAmount(100);
            const lock = false;
            await expect(
                merkleDrop
                    .connect(bob)
                    .claim(getAccountBalanceProof(tree, bobAddress, amount), amount, lock, bobAddress),
            ).to.be.revertedWith("!started");
        });
        it("fails claiming a drop when amount is zero", async () => {
            await increaseTime(ONE_WEEK);
            const amount = simpleToExactAmount(0);
            const lock = false;
            await expect(
                merkleDrop
                    .connect(bob)
                    .claim(getAccountBalanceProof(tree, bobAddress, amount), amount, lock, bobAddress),
            ).to.be.revertedWith("!amount");
        });
        it("fails claiming with an invalid proof", async () => {
            const amount = simpleToExactAmount(100);
            const lock = false;
            await expect(
                merkleDrop
                    .connect(alice)
                    .claim(getAccountBalanceProof(tree, bobAddress, amount), amount, lock, aliceAddress),
            ).to.be.revertedWith("invalid proof");
        });
        it("allows claiming no lock", async () => {
            const amount = simpleToExactAmount(100);
            const lock = false;
            const userAuraBalanceBefore = await aura.balanceOf(bobAddress);
            const userBalanceBefore = await auraLocker.balances(bobAddress);
            expect(await merkleDrop.hasClaimed(bobAddress), "user  has not claimed").to.eq(false);
            expect(await merkleDrop.auraLocker(), "auraLocker not set").to.eq(ZERO_ADDRESS);
            // test
            const tx = merkleDrop
                .connect(bob)
                .claim(getAccountBalanceProof(tree, bobAddress, amount), amount, lock, bobAddress);
            await expect(tx).to.emit(merkleDrop, "Claimed").withArgs(bobAddress, amount, lock);
            expect(await aura.balanceOf(bobAddress), "user aura balance").to.eq(userAuraBalanceBefore.add(amount));
            expect((await auraLocker.balances(bobAddress)).locked, "user aura locked balance").to.eq(
                userBalanceBefore.locked,
            );
            expect(await merkleDrop.hasClaimed(bobAddress), "user claimed").to.eq(true);
        });
        it("fails claiming drop more than once", async () => {
            const amount = simpleToExactAmount(100);
            const lock = false;
            expect(await merkleDrop.hasClaimed(bobAddress), "user has claimed").to.eq(true);

            await expect(
                merkleDrop
                    .connect(bob)
                    .claim(getAccountBalanceProof(tree, bobAddress, amount), amount, lock, bobAddress),
            ).to.be.revertedWith("already claimed");
        });
        it("fails claiming a drop that is expired", async () => {
            await increaseTime(ONE_WEEK.mul(17));
            const amount = simpleToExactAmount(100);
            const lock = false;
            await expect(
                merkleDrop
                    .connect(alice)
                    .claim(getAccountBalanceProof(tree, aliceAddress, amount), amount, lock, aliceAddress),
            ).to.be.revertedWith("!active");
        });
    });
    describe("admin", () => {
        let tree: MerkleTree;
        let dropAmount: BN;
        before(async () => {
            dropAmount = simpleToExactAmount(300);
            const amount = simpleToExactAmount(100);
            tree = createTreeWithAccounts({
                [aliceAddress]: amount,
                [bobAddress]: amount,
                [daveAddress]: amount,
            });
            merkleDrop = await new AuraMerkleDropV2__factory(deployer).deploy(
                adminAddress,
                tree.getHexRoot(),
                aura.address,
                auraLocker.address,
                ONE_WEEK,
                ONE_WEEK.mul(16),
            );
            await aura.transfer(merkleDrop.address, dropAmount);
        });
        it("sets a new dao ", async () => {
            const tx = await merkleDrop.connect(admin).setDao(bobAddress);
            // expect to emit event DaoSet
            await expect(tx).to.emit(merkleDrop, "DaoSet").withArgs(bobAddress);
            expect(await merkleDrop.dao()).to.eq(bobAddress);

            // revert to original admin dao
            await merkleDrop.connect(bob).setDao(adminAddress);
        });
        it("sets a new root if it was not previously set ", async () => {
            merkleDrop = await new AuraMerkleDropV2__factory(deployer).deploy(
                adminAddress,
                ethers.constants.HashZero,
                aura.address,
                auraLocker.address,
                ONE_WEEK,
                ONE_WEEK.mul(16),
            );
            const newRoot = tree.getHexRoot();
            const tx = await merkleDrop.connect(admin).setRoot(newRoot);
            // expect to emit event RootSet
            await expect(tx).to.emit(merkleDrop, "RootSet").withArgs(newRoot);
            expect(await merkleDrop.merkleRoot()).to.eq(newRoot);
        });
        it("rescue rewards", async () => {
            const tx = await merkleDrop.connect(admin).rescueReward();
            await expect(tx).to.emit(merkleDrop, "Rescued");
        });
        it("starts early the drop ", async () => {
            const timestamp = await getTimestamp();
            const tx = await merkleDrop.connect(admin).startEarly();
            // expect to emit event StartEarly
            await expect(tx).to.emit(merkleDrop, "StartedEarly");
            assertBNClose(await merkleDrop.startTime(), timestamp, 5);
        });
        it("fails to withdraw expired if the expire time has not been reached", async () => {
            await expect(merkleDrop.connect(admin).withdrawExpired()).to.be.revertedWith("!expired");
        });
        it("withdraw expired", async () => {
            // move forward to expiry time
            await increaseTime(ONE_WEEK.mul(17));
            // get aura balance before withdraw
            const dropBalance = await aura.balanceOf(merkleDrop.address);
            const daoBalance = await aura.balanceOf(adminAddress);
            const tx = await merkleDrop.connect(admin).withdrawExpired();
            await expect(tx).to.emit(merkleDrop, "ExpiredWithdrawn").withArgs(dropBalance);
            expect(await aura.balanceOf(merkleDrop.address)).to.eq(0);
            expect(await aura.balanceOf(adminAddress)).to.eq(daoBalance.add(dropBalance));
        });
        it("set a new locker", async () => {
            const tx = await merkleDrop.connect(admin).setLocker(bobAddress);
            await expect(tx).to.emit(merkleDrop, "LockerSet").withArgs(bobAddress);
            expect(await merkleDrop.auraLocker()).to.eq(bobAddress);
        });
        it("fails to rescue rewards one week after deployment", async () => {
            await expect(merkleDrop.connect(admin).rescueReward()).to.be.revertedWith("too late");
        });
        it("fails if admin is not the sender", async () => {
            await expect(merkleDrop.connect(bob).setDao(bobAddress)).to.be.revertedWith("!auth");
            await expect(merkleDrop.connect(bob).setRoot(ethers.constants.HashZero)).to.be.revertedWith("!auth");
            await expect(merkleDrop.connect(bob).startEarly()).to.be.revertedWith("!auth");
            await expect(merkleDrop.connect(bob).withdrawExpired()).to.be.revertedWith("!auth");
            await expect(merkleDrop.connect(bob).setLocker(bobAddress)).to.be.revertedWith("!auth");
            await expect(merkleDrop.connect(bob).rescueReward()).to.be.revertedWith("!auth");
        });
        it("fails to set a new root if it was previously set ", async () => {
            await expect(merkleDrop.connect(admin).setRoot(tree.getHexRoot())).to.be.revertedWith("already set");
        });
    });
});
