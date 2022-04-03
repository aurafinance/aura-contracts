import { assertBNClose } from "./../test-utils/assertions";
import hre, { ethers } from "hardhat";
import { Signer } from "ethers";
import { expect } from "chai";
import { MerkleTree } from "merkletreejs";
import { deployPhase1, deployPhase2, Phase2Deployed } from "../scripts/deploySystem";
import { deployMocks, getMockDistro, getMockMultisigs } from "../scripts/deployMocks";
import { AuraLocker, ERC20, AuraMerkleDrop__factory, AuraMerkleDrop } from "../types/generated";
import { ONE_WEEK } from "../test-utils/constants";
import { getTimestamp, increaseTime } from "../test-utils/time";
import { BN, simpleToExactAmount } from "../test-utils/math";
import { impersonateAccount } from "../test-utils/fork";
import { createTreeWithAccounts, getAccountBalanceProof } from "../test-utils/merkle";

describe("AuraMerkleDrop", () => {
    let accounts: Signer[];

    let contracts: Phase2Deployed;
    let aura: ERC20;
    let auraLocker: AuraLocker;
    let merkleDrop: AuraMerkleDrop;

    let deployTime: BN;

    let deployer: Signer;
    let deployerAddress: string;

    let admin: Signer;
    let adminAddress: string;

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
        contracts = await deployPhase2(hre, deployer, phase1, distro, multisigs, mocks.namingConfig, mocks.addresses);

        deployerAddress = await deployer.getAddress();

        admin = accounts[1];
        adminAddress = await admin.getAddress();

        alice = accounts[2];
        aliceAddress = await alice.getAddress();

        bob = accounts[3];
        bobAddress = await bob.getAddress();

        aura = contracts.cvx.connect(deployer) as ERC20;
        auraLocker = contracts.cvxLocker.connect(deployer);

        const operatorAccount = await impersonateAccount(contracts.booster.address);
        await contracts.cvx
            .connect(operatorAccount.signer)
            .mint(operatorAccount.address, simpleToExactAmount(100000, 18));
        await contracts.cvx.connect(operatorAccount.signer).transfer(deployerAddress, simpleToExactAmount(1000));

        deployTime = await getTimestamp();
    });

    // TODO
    describe("deployed MerkleDrops", () => {
        it("has correct config");
    });

    describe("basic MerkleDrop interactions", () => {
        let tree: MerkleTree;
        before(async () => {
            const amount = simpleToExactAmount(100);
            tree = createTreeWithAccounts({
                [aliceAddress]: amount,
                [bobAddress]: amount,
            });
            merkleDrop = await new AuraMerkleDrop__factory(deployer).deploy(
                adminAddress,
                tree.getHexRoot(),
                aura.address,
                auraLocker.address,
                contracts.penaltyForwarder.address,
                ONE_WEEK,
                ONE_WEEK.mul(16),
            );
            await aura.transfer(merkleDrop.address, simpleToExactAmount(200));
        });
        // TODO
        it("initial configuration is correct", async () => {
            expect(await merkleDrop.aura()).eq(aura.address);
            assertBNClose(await merkleDrop.startTime(), deployTime.add(ONE_WEEK), 5);
            assertBNClose(await merkleDrop.expiryTime(), deployTime.add(ONE_WEEK.mul(17)), 5);
        });
        // TODO
        it("allows claiming", async () => {
            await increaseTime(ONE_WEEK);
            await merkleDrop
                .connect(alice)
                .claim(
                    getAccountBalanceProof(tree, aliceAddress, simpleToExactAmount(100)),
                    simpleToExactAmount(100),
                    true,
                );
        });
    });
});
