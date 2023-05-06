import { expect } from "chai";
import { Signer } from "ethers";
import { solidityKeccak256 } from "ethers/lib/utils";
import hre, { ethers } from "hardhat";
import { deployContract } from "../../tasks/utils";
import { DEAD_ADDRESS, impersonateAccount, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { ERRORS, OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../../test/shared/Ownable.behaviour";
import { Account } from "../../types";
import { Create2Factory, Create2Factory__factory, MockAuraMath__factory } from "../../types/generated";

const debug = false;

describe("Create2Factory", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    // Testing contract
    let create2Factory: Create2Factory;

    /* -- Declare shared functions -- */
    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        alice = await impersonateAccount(await accounts[1].getAddress());
        // Deploy test contract.
        create2Factory = await deployContract<Create2Factory>(
            hre,
            new Create2Factory__factory(deployer.signer),
            "Create2Factory",
            [],
            {},
            debug,
        );
    };
    before("init contract", async () => {
        await setup();
    });

    describe("behaviors", async () => {
        describe("should behave like Ownable ", async () => {
            const ctx: Partial<OwnableBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.owner = deployer;
                    ctx.anotherAccount = alice;
                    ctx.ownable = create2Factory;
                    return ctx as OwnableBehaviourContext;
                };
            });
            shouldBehaveLikeOwnable(() => ctx as OwnableBehaviourContext);
        });
    });
    describe("constructor", async () => {
        before(async () => {
            await setup();
        });
        it("should properly store valid arguments", async () => {
            expect(await create2Factory.owner(), "owner").to.eq(deployer.address);
            expect(await create2Factory.deployer(ZERO_ADDRESS), "deployer").to.eq(false);
        });
    });

    describe("enable an address to deploy", async () => {
        it("updateDeployer to enable it", async () => {
            expect(await create2Factory.deployer(deployer.address), "deployer not enabled").to.be.eq(false);
            await create2Factory.updateDeployer(deployer.address, true);
            expect(await create2Factory.deployer(deployer.address), "deployer enabled").to.be.eq(true);
        });
        it("fails if caller is not the owner", async () => {
            await expect(
                create2Factory.connect(alice.signer).updateDeployer(DEAD_ADDRESS, false),
                "!onlyOwner",
            ).to.be.revertedWith(ERRORS.ONLY_OWNER);
        });
    });

    describe("deploy", async () => {
        it("contract without callbacks", async () => {
            const amount = ZERO;
            const salt = solidityKeccak256(["string"], ["test"]);
            const bytecode = new MockAuraMath__factory().bytecode;
            const bytecodeHash = solidityKeccak256(["bytes"], [bytecode]);

            const callbacks = [];
            const deployedAddress = await create2Factory.computeAddress(salt, bytecodeHash);
            const tx = create2Factory.deploy(amount, salt, bytecode, callbacks);
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(create2Factory, "Deployed").withArgs(salt, deployedAddress);
        });
        it("fails bytecode is wrong", async () => {
            const amount = ZERO;
            const salt = solidityKeccak256(["string"], ["test"]);
            const bytecode = new MockAuraMath__factory().bytecode;
            const bytecodeHash = solidityKeccak256(["bytes"], [bytecode]);
            const callbacks = [];

            await expect(
                create2Factory.deploy(amount, salt, bytecodeHash, callbacks),
                "fails due to wrong bytecode",
            ).to.be.revertedWith("Create2: Failed on deploy");
        });
        it("fails if deployer is not whitelisted", async () => {
            const salt = solidityKeccak256(["string"], ["test"]);

            await create2Factory.updateDeployer(alice.address, false);

            await expect(
                create2Factory.connect(alice.signer).deploy(0, salt, "0x", []),
                "fails due to !deployer",
            ).to.be.revertedWith("!deployer");
        });
    });
});
