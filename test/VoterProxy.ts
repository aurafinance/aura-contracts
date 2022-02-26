import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { deployPhase1, deployPhase2, deployPhase3, deployPhase4 } from "../scripts/deploySystem";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { CurveVoterProxy } from "../types/generated";
import { Signer } from "ethers";
import { hashMessage } from "@ethersproject/hash";
import { version } from "@snapshot-labs/snapshot.js/src/constants.json";

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
    let mocks: DeployMocksResult;

    let deployer: Signer;

    before(async () => {
        accounts = await ethers.getSigners();

        deployer = accounts[0];

        mocks = await deployMocks(deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], accounts[0]);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(deployer, mocks.addresses);
        const phase2 = await deployPhase2(deployer, phase1, multisigs, mocks.namingConfig);
        const phase3 = await deployPhase3(
            hre,
            deployer,
            phase2,
            distro,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );
        const contracts = await deployPhase4(deployer, phase3, mocks.addresses);

        voterProxy = contracts.voterProxy;
    });

    describe("validates vote hash from Snapshot Hub", async () => {
        it("with a valid hash", async () => {
            const sig = await deployer.signMessage(msg);
            await voterProxy.connect(deployer).setVote(hash);
            const isValid = await voterProxy.isValidSignature(hash, sig);
            expect(isValid).to.equal(eip1271MagicValue);
        });

        it("with an invalid hash", async () => {
            const sig = await deployer.signMessage(msg);
            await voterProxy.connect(deployer).setVote(hash);
            const isValid = await voterProxy.isValidSignature(invalidHash, sig);
            expect(isValid).to.equal("0xffffffff");
        });
    });
});
