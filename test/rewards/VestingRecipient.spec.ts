import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";

import {
    AuraLocker,
    AuraVestedEscrow,
    AuraVestedEscrow__factory,
    ERC20,
    VestingRecipient,
    VestingRecipient__factory,
} from "../../types/generated";
import { deployContract } from "../../tasks/utils";
import { impersonateAccount } from "../../test-utils/fork";
import { BN, simpleToExactAmount } from "../../test-utils/math";
import { ONE_WEEK, ZERO_ADDRESS } from "../../test-utils/constants";
import { getTimestamp, increaseTime, increaseTimeTo } from "../../test-utils/time";
import { deployPhase1, deployPhase2, Phase2Deployed } from "../../scripts/deploySystem";
import { deployMocks, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";

const debug = false;

describe("AuraVestedEscrow", () => {
    let accounts: Signer[];

    let contracts: Phase2Deployed;
    let aura: ERC20;
    let auraLocker: AuraLocker;
    let vestedEscrow: AuraVestedEscrow;

    let deployTime: BN;

    let deployer: Signer;
    let deployerAddress: string;

    let fundAdmin: Signer;
    let fundAdminAddress: string;

    let vestingRecipient: VestingRecipient;

    before(async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];

        const mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(hre, deployer, mocks.addresses, true, debug);
        contracts = await deployPhase2(
            hre,
            deployer,
            phase1,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
            debug,
        );

        deployerAddress = await deployer.getAddress();

        fundAdmin = accounts[1];
        fundAdminAddress = await fundAdmin.getAddress();

        const operatorAccount = await impersonateAccount(contracts.booster.address);
        await contracts.cvx
            .connect(operatorAccount.signer)
            .mint(operatorAccount.address, simpleToExactAmount(100000, 18));
        await contracts.cvx.connect(operatorAccount.signer).transfer(deployerAddress, simpleToExactAmount(1000));

        aura = contracts.cvx.connect(deployer) as ERC20;
        auraLocker = contracts.cvxLocker.connect(deployer);

        deployTime = await getTimestamp();
        vestedEscrow = await new AuraVestedEscrow__factory(deployer).deploy(
            aura.address,
            fundAdminAddress,
            auraLocker.address,
            deployTime.add(ONE_WEEK),
            deployTime.add(ONE_WEEK.mul(53)),
        );
    });

    it("deploy VestedRecipient", async () => {
        vestingRecipient = await deployContract<VestingRecipient>(
            hre,
            new VestingRecipient__factory(deployer),
            "VestedRecipient",
            [deployerAddress, vestedEscrow.address, auraLocker.address],
            {},
        );
    });
    it("has the correct config", async () => {
        expect(await vestingRecipient.owner()).eq(deployerAddress);
        expect(await vestingRecipient.vesting()).eq(vestedEscrow.address);
        expect(await vestingRecipient.auraLocker()).eq(auraLocker.address);
    });
    it("fund on vested escrow", async () => {
        const balBefore = await aura.balanceOf(vestedEscrow.address);
        await aura.approve(vestedEscrow.address, simpleToExactAmount(200));
        await vestedEscrow.fund([vestingRecipient.address], [simpleToExactAmount(200)]);
        const balAfter = await aura.balanceOf(vestedEscrow.address);
        expect(balAfter).eq(balBefore.add(simpleToExactAmount(200)));

        expect(await vestedEscrow.totalLocked(vestingRecipient.address)).eq(simpleToExactAmount(200));
    });
    it("owner protected functions", async () => {
        const notOwner = await impersonateAccount("0x0000000000000000000000000000000000000002");
        const vestingRecipientNotOwner = vestingRecipient.connect(notOwner.signer);
        await expect(vestingRecipientNotOwner.setOwner(ZERO_ADDRESS)).to.be.revertedWith("!owner");
        await expect(vestingRecipientNotOwner.claim(false)).to.be.revertedWith("!owner");
        await expect(vestingRecipientNotOwner.withdrawERC20(contracts.cvx.address, 1)).to.be.revertedWith("!owner");
        await expect(vestingRecipientNotOwner.lock(1)).to.be.revertedWith("!owner");
        await expect(vestingRecipientNotOwner.processExpiredLocks()).to.be.revertedWith("!owner");
        await expect(vestingRecipientNotOwner.delegate(ZERO_ADDRESS)).to.be.revertedWith("!owner");
        await expect(vestingRecipientNotOwner.execute(ZERO_ADDRESS, 0, [])).to.be.revertedWith("!owner");
    });
    it("update owner", async () => {
        const currentOwner = await vestingRecipient.owner();
        const newOwner = await impersonateAccount("0x0000000000000000000000000000000000000002", true);
        await vestingRecipient.setOwner(newOwner.address);
        expect(await vestingRecipient.owner()).eq(newOwner.address);
        await expect(vestingRecipient.setOwner(currentOwner)).to.be.revertedWith("!owner");
        await vestingRecipient.connect(newOwner.signer).setOwner(currentOwner);
    });
    it("cannot execute forbiden contracts", async () => {
        await expect(vestingRecipient.execute(auraLocker.address, 0, [])).to.be.revertedWith("to==auraLocker");
        await expect(vestingRecipient.execute(contracts.cvx.address, 0, [])).to.be.revertedWith("to==rewardToken");
    });
    it("claim rewards", async () => {
        await increaseTime(ONE_WEEK.mul(27));

        const available = await vestedEscrow.available(vestingRecipient.address);
        const balBefore = await contracts.cvx.balanceOf(vestingRecipient.address);
        await vestingRecipient.claim(false);
        const balAfter = await contracts.cvx.balanceOf(vestingRecipient.address);
        const claimed = balAfter.sub(balBefore);

        console.log("Claimed:", claimed);
        expect(claimed).gt(0);
        expect(claimed).gte(available);

        expect(await vestedEscrow.totalClaimed(vestingRecipient.address)).eq(claimed);
    });
    it("lock AURA", async () => {
        const balance = await contracts.cvx.balanceOf(vestingRecipient.address);
        const balBefore = await auraLocker.balances(vestingRecipient.address);
        expect(balBefore.locked).eq(0);

        await vestingRecipient.lock(balance);

        const balAfter = await auraLocker.balances(vestingRecipient.address);
        expect(balAfter.locked).eq(balance);
    });
    it("delegate", async () => {
        const currentDelegate = await auraLocker.delegates(vestingRecipient.address);
        expect(currentDelegate).eq(ZERO_ADDRESS);
        const newDelegate = "0x0000000000000000000000000000000000000002";
        await vestingRecipient.delegate(newDelegate);
        expect(await auraLocker.delegates(vestingRecipient.address)).eq(newDelegate);
    });
    it("relock AURA after being kicked", async () => {
        await increaseTime(ONE_WEEK.mul(20));
        await auraLocker.kickExpiredLocks(vestingRecipient.address);
        const balances = await auraLocker.balances(vestingRecipient.address);
        expect(balances.locked).eq(0);

        const lockAmount = simpleToExactAmount(10);
        await vestingRecipient.lock(lockAmount);
        const balances0 = await auraLocker.balances(vestingRecipient.address);
        expect(balances0.locked).eq(lockAmount);
    });
    it("withdraw rewards before unlock time", async () => {
        const ts = await getTimestamp();
        expect(await vestingRecipient.unlockTime()).gt(ts);

        const withdrawable = await vestingRecipient.withdrawable();
        const totalClaimed = await vestedEscrow.totalClaimed(vestingRecipient.address);
        expect(withdrawable).eq(totalClaimed.div(2));

        const withdrawAmount = simpleToExactAmount(1);
        expect(withdrawAmount).lt(withdrawable);

        const balBefore = await contracts.cvx.balanceOf(deployerAddress);
        await vestingRecipient.withdrawERC20(contracts.cvx.address, withdrawAmount);
        const balAfter = await contracts.cvx.balanceOf(deployerAddress);
        expect(balAfter.sub(balBefore)).eq(withdrawAmount);
    });
    it("withdraw rewards after unlock time", async () => {
        const unlockTime = await vestingRecipient.unlockTime();
        await increaseTimeTo(unlockTime);

        const balance = await contracts.cvx.balanceOf(vestingRecipient.address);
        const withdrawable = await vestingRecipient.withdrawable();
        expect(balance).gt(withdrawable);

        const balBefore = await contracts.cvx.balanceOf(deployerAddress);
        await vestingRecipient.withdrawERC20(contracts.cvx.address, balance);
        const balAfter = await contracts.cvx.balanceOf(deployerAddress);
        expect(balAfter.sub(balBefore)).eq(balance);
    });
});
