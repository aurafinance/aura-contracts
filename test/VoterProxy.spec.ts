import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import {
    Booster,
    CurveVoterProxy,
    MockVoteStorage,
    MockVoteStorage__factory,
    MockERC20,
    MockERC20__factory,
    ExtraRewardsDistributor,
    AuraLocker,
    AuraToken,
} from "../types/generated";
import { Signer } from "ethers";
import { hashMessage } from "@ethersproject/hash";
import { version } from "@snapshot-labs/snapshot.js/src/constants.json";
import { deployContract } from "../tasks/utils";
import { increaseTime } from "../test-utils/time";
import { simpleToExactAmount } from "../test-utils/math";
import { ZERO_ADDRESS } from "../test-utils/constants";
import { impersonateAccount } from "../test-utils/fork";

const eip1271MagicValue = "0x1626ba7e";

const data = {
    version,
    timestamp: (Date.now() / 1e3).toFixed(),
    space: "balancer.eth",
    type: "single-choice",
    payload: {
        proposal: "0x21ea31e896ec5b5a49a3653e51e787ee834aaf953263144ab936ed756f36609f",
        choice: 1,
        metadata: JSON.stringify({}),
    },
};

const msg = JSON.stringify(data);
const hash = hashMessage(msg);
const invalidHash = hashMessage(JSON.stringify({ ...data, version: "faux" }));

describe("VoterProxy", () => {
    let accounts: Signer[];
    let voterProxy: CurveVoterProxy;
    let booster: Booster;
    let extraRewardsDistributor: ExtraRewardsDistributor;
    let mocks: DeployMocksResult;
    let auraLocker: AuraLocker;
    let cvx: AuraToken;

    let deployer: Signer;
    let daoMultisig: Signer;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];

        mocks = await deployMocks(deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        daoMultisig = await ethers.getSigner(multisigs.daoMultisig);
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
        const contracts = await deployPhase4(deployer, phase3, mocks.addresses);

        voterProxy = contracts.voterProxy;
        booster = contracts.booster;
        extraRewardsDistributor = contracts.extraRewardsDistributor;
        auraLocker = contracts.cvxLocker;
        cvx = contracts.cvx;

        const operatorAccount = await impersonateAccount(contracts.booster.address);
        await contracts.cvx
            .connect(operatorAccount.signer)
            .mint(operatorAccount.address, simpleToExactAmount(100000, 18));
        await contracts.cvx
            .connect(operatorAccount.signer)
            .transfer(await deployer.getAddress(), simpleToExactAmount(1000));
    });

    describe("validates vote hash from Snapshot Hub", async () => {
        it("with a valid hash", async () => {
            const sig = await deployer.signMessage(msg);
            await booster.connect(daoMultisig).setVote(hash, true);
            const isValid = await voterProxy.isValidSignature(hash, sig);
            expect(isValid).to.equal(eip1271MagicValue);
        });

        it("with an invalid hash", async () => {
            const sig = await deployer.signMessage(msg);
            await booster.connect(daoMultisig).setVote(hash, true);
            const isValid = await voterProxy.isValidSignature(invalidHash, sig);
            expect(isValid).to.equal("0xffffffff");
        });
    });

    describe("generate message hash from vote", () => {
        let mockVoteStorage: MockVoteStorage;

        before(async () => {
            mockVoteStorage = await deployContract<MockVoteStorage>(
                new MockVoteStorage__factory(deployer),
                "MockVoteStorage",
                [],
                {},
                false,
            );
        });

        it("generates a valid hash", async () => {
            const tx = await mockVoteStorage.setProposal(
                data.payload.choice,
                data.timestamp,
                data.version,
                data.payload.proposal,
                data.space,
                data.type,
            );

            await tx.wait();
            const hashResult = await mockVoteStorage.hash(data.payload.proposal);

            expect(hash).to.equal(hashResult);
        });
    });

    describe("when not authorised", () => {
        it("can not call release", async () => {
            const eoa = accounts[5];
            const tx = voterProxy.connect(eoa).release();
            await expect(tx).to.revertedWith("!auth");
        });

        it("can not call migrate", async () => {
            const eoa = accounts[5];
            const eoaAddress = await eoa.getAddress();
            const tx = voterProxy.connect(eoa).migrate(eoaAddress);
            await expect(tx).to.revertedWith("!auth");
        });

        it("can not call setRewardDeposit", async () => {
            const eoa = accounts[5];
            const eoaAddress = await eoa.getAddress();
            const tx = voterProxy.connect(eoa).setRewardDeposit(await deployer.getAddress(), eoaAddress);
            await expect(tx).to.revertedWith("!auth");
        });
        it("can not call withdraw", async () => {
            const eoa = accounts[5];
            const tx = voterProxy.connect(eoa)["withdraw(address)"](ZERO_ADDRESS);
            await expect(tx).to.revertedWith("!auth");
        });
    });

    describe("when withdrawing tokens", () => {
        it("can not withdraw protected tokens", async () => {
            let tx = voterProxy["withdraw(address)"](mocks.crv.address);
            await expect(tx).to.revertedWith("protected");
            tx = voterProxy["withdraw(address)"](mocks.crvBpt.address);
            await expect(tx).to.revertedWith("protected");
        });

        it("can withdraw unprotected tokens", async () => {
            const deployerAddress = await deployer.getAddress();
            const randomToken = await deployContract<MockERC20>(
                new MockERC20__factory(deployer),
                "RandomToken",
                ["randomToken", "randomToken", 18, deployerAddress, 10000000],
                {},
                false,
            );

            const balance = await randomToken.balanceOf(deployerAddress);
            await randomToken.transfer(voterProxy.address, balance);

            const cvxAmount = simpleToExactAmount(10);

            await cvx.approve(auraLocker.address, cvxAmount);
            await auraLocker.lock(deployerAddress, cvxAmount);
            await increaseTime(86400 * 7);

            await voterProxy["withdraw(address)"](randomToken.address);
            const rewardDepositBalance = await randomToken.balanceOf(extraRewardsDistributor.address);
            expect(balance).eq(rewardDepositBalance);
        });
    });

    describe("setting rewardDeposit", () => {
        it("allows owner to set reward deposit and withdrawer", async () => {
            const eoa = accounts[6];
            const eoa7 = accounts[7];
            const eoaAddress = await eoa.getAddress();
            const eoaAddress7 = await eoa7.getAddress();
            await voterProxy.connect(daoMultisig).setRewardDeposit(eoaAddress, eoaAddress7);
            expect(await voterProxy.withdrawer()).eq(eoaAddress);
            expect(await voterProxy.rewardDeposit()).eq(eoaAddress7);
        });
    });
});
