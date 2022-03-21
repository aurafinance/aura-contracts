import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { Booster, CurveVoterProxy, MockVoteStorage, MockVoteStorage__factory } from "../types/generated";
import { Signer } from "ethers";
import { hashMessage } from "@ethersproject/hash";
import { version } from "@snapshot-labs/snapshot.js/src/constants.json";
import { deployContract } from "../tasks/utils";

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
    let mocks: DeployMocksResult;

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
        const phase3 = await deployPhase3(deployer, phase2, mocks.addresses);
        const contracts = await deployPhase4(deployer, phase3, mocks.addresses);

        voterProxy = contracts.voterProxy;
        booster = contracts.booster;
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
    });
});
