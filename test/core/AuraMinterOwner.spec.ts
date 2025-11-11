import { expect } from "chai";
import { Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { deployMocks, DeployMocksResult, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import { deployPhase1, deployPhase2, Phase2Deployed } from "../../scripts/deploySystem";
import { ONE_WEEK, ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import { simpleToExactAmount } from "../../test-utils/math";
import { getTimestamp, increaseTime } from "../../test-utils/time";
import { AuraMinterOwner, AuraMinter, AuraToken } from "../../types/generated";
import { OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import { impersonateAccount } from "../../test-utils/fork";

describe("AuraMinterOwner", () => {
    let accounts: Signer[];
    let deployer: Signer;
    let alice: Signer;
    let bob: Signer;
    let dao: Signer;
    let aliceAddress: string;
    let bobAddress: string;
    let daoAddress: string;

    let mocks: DeployMocksResult;
    let contracts: Phase2Deployed;
    let auraMinterOwner: AuraMinterOwner;
    let auraMinter: AuraMinter;
    let auraToken: AuraToken;

    const EPOCH_CAP = simpleToExactAmount(3_000_000); // 3M AURA
    const EPOCH_DURATION = ONE_WEEK.mul(52); // 52 weeks

    let idSnapShot: number;

    const setup = async () => {
        if (idSnapShot) {
            await hre.ethers.provider.send("evm_revert", [idSnapShot]);
            idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
            return;
        }
        accounts = await ethers.getSigners();

        deployer = accounts[0];
        alice = accounts[1];
        bob = accounts[2];
        dao = accounts[3];

        aliceAddress = await alice.getAddress();
        bobAddress = await bob.getAddress();
        daoAddress = await dao.getAddress();

        // Deploy the system
        mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[0], accounts[0], dao);
        const distroList = getMockDistro();

        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        const phase2 = await deployPhase2(
            hre,
            deployer,
            phase1,
            distroList,
            multisigs,
            mocks.namingConfig,
            mocks.addresses,
        );

        contracts = {
            ...mocks,
            ...phase1,
            ...phase2,
        };

        auraMinter = contracts.minter;
        auraToken = contracts.cvx;

        // Deploy AuraMinterOwner
        const AuraMinterOwnerFactory = await ethers.getContractFactory("AuraMinterOwner");
        auraMinterOwner = await AuraMinterOwnerFactory.deploy(auraMinter.address, daoAddress);
        await auraMinterOwner.deployed();

        // Update minter owner
        await contracts.minter.connect(dao).transferOwnership(auraMinterOwner.address);
        idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);
    };

    after(async () => {
        await hre.ethers.provider.send("evm_revert", [idSnapShot]);
    });

    describe("behaviors", async () => {
        describe("should behave like Ownable ", async () => {
            const ctx: Partial<OwnableBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.owner = await impersonateAccount(daoAddress);
                    ctx.anotherAccount = await impersonateAccount(aliceAddress);
                    ctx.ownable = auraMinterOwner;
                    return ctx as OwnableBehaviourContext;
                };
            });
            shouldBehaveLikeOwnable(() => ctx as OwnableBehaviourContext);
        });
    });
    describe("Deployment", () => {
        before(async () => {
            await setup();
        });
        it("should set correct initial state", async () => {
            expect(await auraMinterOwner.auraMinter()).to.equal(auraMinter.address);
            expect(await auraMinterOwner.owner()).to.equal(daoAddress);
            expect(await auraMinterOwner.totalMinted()).to.equal(0);
            expect(await auraMinterOwner.EPOCH_CAP()).to.equal(EPOCH_CAP);
            expect(await auraMinterOwner.EPOCH_DURATION()).to.equal(EPOCH_DURATION);
        });

        it("should have correct constants", async () => {
            expect(await auraMinterOwner.EPOCH_CAP()).to.equal(simpleToExactAmount(3_000_000));
            expect(await auraMinterOwner.EPOCH_DURATION()).to.equal(ONE_WEEK.mul(52));
        });
    });

    describe("getCurrentEpoch", () => {
        it("should return correct epoch before inflation protection expires", async () => {
            // Before inflation protection expires, epoch calculation is based on future time
            const currentTime = await getTimestamp();
            const inflationProtectionTime = await auraMinter.inflationProtectionTime();
            const epoch = await auraMinterOwner.getCurrentEpoch();
            expect(currentTime.lt(inflationProtectionTime), "Current time is before inflation protection").to.be.true;
            expect(epoch, "epoch").to.be.eq(0);
        });

        it("should return epoch 1 right after inflation protection expires", async () => {
            // Fast forward to just after inflation protection expires
            const inflationProtectionTime = await auraMinter.inflationProtectionTime();
            await increaseTime(inflationProtectionTime.sub(await getTimestamp()).add(1));

            const epoch = await auraMinterOwner.getCurrentEpoch();
            expect(epoch).to.equal(1);
        });

        it("should return epoch 2 after one year", async () => {
            const inflationProtectionTime = await auraMinter.inflationProtectionTime();
            await increaseTime(
                inflationProtectionTime
                    .sub(await getTimestamp())
                    .add(EPOCH_DURATION)
                    .add(1),
            );

            const epoch = await auraMinterOwner.getCurrentEpoch();
            expect(epoch).to.equal(2);
        });

        it("should return epoch 3 after two years", async () => {
            const inflationProtectionTime = await auraMinter.inflationProtectionTime();
            await increaseTime(
                inflationProtectionTime
                    .sub(await getTimestamp())
                    .add(EPOCH_DURATION.mul(2))
                    .add(1),
            );

            const epoch = await auraMinterOwner.getCurrentEpoch();
            expect(epoch).to.equal(3);
        });
    });

    describe("getMintable", () => {
        before(async () => {
            await setup();
        });
        beforeEach(async () => {
            // Reset to just after inflation protection expires
            const inflationProtectionTime = await auraMinter.inflationProtectionTime();
            const currentTime = await getTimestamp();
            if (currentTime.lt(inflationProtectionTime)) {
                await increaseTime(inflationProtectionTime.sub(currentTime).add(1));
            }
        });

        it("should return full epoch cap when nothing minted", async () => {
            const mintable = await auraMinterOwner.getMintable();
            const totalMinted = await auraMinterOwner.totalMinted();

            expect(mintable, "mintable").to.equal(EPOCH_CAP);
            expect(totalMinted, "totalMinted").to.equal(0);
        });

        it("should return reduced amount after partial minting", async () => {
            const mintAmount = simpleToExactAmount(1_000_000); // 1M AURA
            const aliceBalanceBefore = await contracts.cvx.balanceOf(aliceAddress);

            // Mint some tokens
            await auraMinterOwner.connect(dao).mint(aliceAddress, mintAmount);

            const aliceBalanceAfter = await contracts.cvx.balanceOf(aliceAddress);
            expect(aliceBalanceAfter.sub(aliceBalanceBefore), "minted amount").to.equal(mintAmount);

            const mintable = await auraMinterOwner.getMintable();
            expect(mintable, "mintable").to.equal(EPOCH_CAP.sub(mintAmount));
        });

        it("should return 0 when epoch cap is reached", async () => {
            // Mint the full epoch cap
            const epoch = await auraMinterOwner.getCurrentEpoch();
            const totalMintedBefore = await auraMinterOwner.totalMinted();
            const mintableBefore = await auraMinterOwner.getMintable();

            const maxMintable = EPOCH_CAP.sub(totalMintedBefore);
            expect(epoch, "epoch").to.equal(1);
            expect(mintableBefore, "mintableBefore").to.gt(ZERO);
            expect(maxMintable, "maxMintable").to.gt(ZERO);
            const aliceBalanceBefore = await contracts.cvx.balanceOf(aliceAddress);

            await auraMinterOwner.connect(dao).mint(aliceAddress, maxMintable);

            const aliceBalanceAfter = await contracts.cvx.balanceOf(aliceAddress);
            expect(aliceBalanceAfter.sub(aliceBalanceBefore), "minted amount").to.equal(maxMintable);

            expect(await auraMinterOwner.getMintable(), "mintable").to.equal(0);
            expect(await auraMinterOwner.totalMinted(), "totalMinted").to.equal(EPOCH_CAP.mul(epoch));
        });

        it("should return correct amount in epoch 2", async () => {
            // Move to epoch 2
            await increaseTime(EPOCH_DURATION);

            const mintable = await auraMinterOwner.getMintable();
            expect(mintable).to.equal(EPOCH_CAP); // 3M available per epoch (no carryover)
        });

        it("should return epoch cap in future epochs (no total cap)", async () => {
            // Move to epoch 4 (no total cap limit anymore)
            await increaseTime(EPOCH_DURATION.mul(3));

            // Should be able to mint full epoch cap regardless of how many epochs have passed
            const mintable = await auraMinterOwner.getMintable();
            expect(mintable, "mintable").to.equal(EPOCH_CAP);
        });

        it("should handle partial minting across epochs correctly", async () => {
            // Try to mint more than epoch cap (should fail)
            const mintAmount = simpleToExactAmount(3_100_000);
            expect(mintAmount).to.be.gt(EPOCH_CAP);

            // Should not be able to mint more than epoch cap
            await expect(auraMinterOwner.connect(dao).mint(aliceAddress, mintAmount)).to.be.revertedWith(
                "Exceeds epoch cap",
            );

            // Mint 2M in epoch 1 instead
            await auraMinterOwner.connect(dao).mint(aliceAddress, simpleToExactAmount(2_000_000));

            // Move to epoch 2
            await increaseTime(EPOCH_DURATION);

            // Should be able to mint full 3M in epoch 2 (no carryover)
            const mintable = await auraMinterOwner.getMintable();
            expect(mintable).to.equal(EPOCH_CAP); // Full epoch cap available
        });
    });

    describe("mint", () => {
        before(async () => {
            await setup();
        });
        beforeEach(async () => {
            // Reset to just after inflation protection expires
            const inflationProtectionTime = await auraMinter.inflationProtectionTime();
            const currentTime = await getTimestamp();
            if (currentTime.lt(inflationProtectionTime)) {
                await increaseTime(inflationProtectionTime.sub(currentTime).add(1));
            }
        });

        describe("Access Control", () => {
            it("should only allow owner to mint", async () => {
                await expect(
                    auraMinterOwner.connect(alice).mint(aliceAddress, simpleToExactAmount(1000)),
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should allow owner to mint", async () => {
                const mintAmount = simpleToExactAmount(1000);

                await expect(auraMinterOwner.connect(dao).mint(aliceAddress, mintAmount)).to.not.be.reverted;
            });
        });

        describe("Input Validation", () => {
            it("should revert with zero address recipient", async () => {
                await expect(
                    auraMinterOwner.connect(dao).mint(ZERO_ADDRESS, simpleToExactAmount(1000)),
                ).to.be.revertedWith("Invalid recipient");
            });

            it("should revert with zero amount", async () => {
                await expect(auraMinterOwner.connect(dao).mint(aliceAddress, 0)).to.be.revertedWith("Zero amount");
            });
        });

        describe("Inflation Protection", () => {
            it("should revert when inflation protection is still active", async () => {
                // Reset to before inflation protection expires
                await hre.ethers.provider.send("evm_revert", [idSnapShot]);
                idSnapShot = await hre.ethers.provider.send("evm_snapshot", []);

                // Redeploy with fresh state
                const AuraMinterOwnerFactory = await ethers.getContractFactory("AuraMinterOwner");
                const testAuraMinterOwner = await AuraMinterOwnerFactory.deploy(auraMinter.address, daoAddress);

                await expect(
                    testAuraMinterOwner.connect(dao).mint(aliceAddress, simpleToExactAmount(1000)),
                ).to.be.revertedWith("Inflation protection active");
            });
        });

        describe("Epoch Cap Enforcement", () => {
            beforeEach(async () => {
                await setup();
                // Reset to just after inflation protection expires
                const inflationProtectionTime = await auraMinter.inflationProtectionTime();
                const currentTime = await getTimestamp();
                await increaseTime(inflationProtectionTime.sub(currentTime).add(1));
            });

            it("should allow minting up to epoch cap", async () => {
                await expect(auraMinterOwner.connect(dao).mint(aliceAddress, EPOCH_CAP)).to.not.be.reverted;

                expect(await auraMinterOwner.totalMinted()).to.equal(EPOCH_CAP);
            });

            it("should revert when exceeding epoch cap", async () => {
                await expect(auraMinterOwner.connect(dao).mint(aliceAddress, EPOCH_CAP.add(1))).to.be.revertedWith(
                    "Exceeds epoch cap",
                );
            });

            it("should allow additional minting in next epoch", async () => {
                // Mint full amount in epoch 1
                await auraMinterOwner.connect(dao).mint(aliceAddress, EPOCH_CAP);

                // Move to epoch 2
                await increaseTime(EPOCH_DURATION);

                // Should be able to mint more
                await expect(auraMinterOwner.connect(dao).mint(bobAddress, EPOCH_CAP)).to.not.be.reverted;

                expect(await auraMinterOwner.totalMinted()).to.equal(EPOCH_CAP.mul(2));
            });
        });

        describe("Total Cap Enforcement", () => {
            beforeEach(async () => {
                await setup();
                // Reset to just after inflation protection expires
                const inflationProtectionTime = await auraMinter.inflationProtectionTime();
                const currentTime = await getTimestamp();
                await increaseTime(inflationProtectionTime.sub(currentTime).add(1));
            });
            it("should allow unlimited epochs with 3M per epoch", async () => {
                // Mint in epoch 1
                await auraMinterOwner.connect(dao).mint(aliceAddress, EPOCH_CAP);

                // Move to epoch 2
                await increaseTime(EPOCH_DURATION);
                await auraMinterOwner.connect(dao).mint(aliceAddress, EPOCH_CAP);
                await expect(auraMinterOwner.connect(dao).mint(aliceAddress, 1)).to.be.revertedWith(
                    "Exceeds epoch cap",
                );

                // Move to epoch 3
                await increaseTime(EPOCH_DURATION);
                await auraMinterOwner.connect(dao).mint(aliceAddress, EPOCH_CAP);
                await expect(auraMinterOwner.connect(dao).mint(aliceAddress, 1)).to.be.revertedWith(
                    "Exceeds epoch cap",
                );

                expect(await auraMinterOwner.totalMinted()).to.equal(EPOCH_CAP.mul(3));

                // Move to epoch 4 - should still allow minting (no total cap)
                await increaseTime(EPOCH_DURATION);
                await auraMinterOwner.connect(dao).mint(aliceAddress, EPOCH_CAP);
                expect(await auraMinterOwner.totalMinted()).to.equal(EPOCH_CAP.mul(4));
            });
        });

        describe("State Updates", () => {
            before(async () => {
                await setup();
                // Reset to just after inflation protection expires
                const inflationProtectionTime = await auraMinter.inflationProtectionTime();
                const currentTime = await getTimestamp();
                await increaseTime(inflationProtectionTime.sub(currentTime).add(1));
            });
            it("should update totalMinted correctly", async () => {
                const mintAmount = simpleToExactAmount(1_000_000);

                expect(await auraMinterOwner.totalMinted()).to.equal(0);

                await auraMinterOwner.connect(dao).mint(aliceAddress, mintAmount);

                expect(await auraMinterOwner.totalMinted()).to.equal(mintAmount);
            });

            it("should accumulate totalMinted across multiple mints", async () => {
                const totalMintedBefore = await auraMinterOwner.totalMinted();
                const mintAmount1 = simpleToExactAmount(1_000_000);
                const mintAmount2 = simpleToExactAmount(500_000);

                await auraMinterOwner.connect(dao).mint(aliceAddress, mintAmount1);
                await auraMinterOwner.connect(dao).mint(bobAddress, mintAmount2);

                const totalMintedAfter = await auraMinterOwner.totalMinted();

                expect(totalMintedAfter.sub(totalMintedBefore)).to.equal(mintAmount1.add(mintAmount2));
            });
        });

        describe("Token Minting Integration", () => {
            before(async () => {
                await setup();
                // Reset to just after inflation protection expires
                const inflationProtectionTime = await auraMinter.inflationProtectionTime();
                const currentTime = await getTimestamp();
                await increaseTime(inflationProtectionTime.sub(currentTime).add(1));
            });
            it("should actually mint tokens to recipient", async () => {
                const mintAmount = simpleToExactAmount(1_000_000);
                const balanceBefore = await auraToken.balanceOf(aliceAddress);

                await auraMinterOwner.connect(dao).mint(aliceAddress, mintAmount);

                const balanceAfter = await auraToken.balanceOf(aliceAddress);
                expect(balanceAfter.sub(balanceBefore)).to.equal(mintAmount);
            });

            it("should call auraMinter.mint with correct parameters", async () => {
                const mintAmount = simpleToExactAmount(1_000_000);

                // Check that the mint function was called by verifying token balance change
                const balanceBefore = await auraToken.balanceOf(aliceAddress);

                await auraMinterOwner.connect(dao).mint(aliceAddress, mintAmount);

                const balanceAfter = await auraToken.balanceOf(aliceAddress);
                expect(balanceAfter.sub(balanceBefore)).to.equal(mintAmount);
            });
        });

        describe("Events", () => {
            it("should emit AuraMinted event", async () => {
                const mintAmount = simpleToExactAmount(300_000);
                const currentEpoch = await auraMinterOwner.getCurrentEpoch();

                await expect(auraMinterOwner.connect(dao).mint(aliceAddress, mintAmount))
                    .to.emit(auraMinterOwner, "AuraMinted")
                    .withArgs(aliceAddress, mintAmount, currentEpoch);
            });

            it("should emit correct AuraMinted in event", async () => {
                const mintAmount1 = simpleToExactAmount(100_000);
                const mintAmount2 = simpleToExactAmount(500_000);
                const currentEpoch = await auraMinterOwner.getCurrentEpoch();

                // First mint
                await auraMinterOwner.connect(dao).mint(aliceAddress, mintAmount1);

                // Second mint should show cumulative total
                await expect(auraMinterOwner.connect(dao).mint(bobAddress, mintAmount2))
                    .to.emit(auraMinterOwner, "AuraMinted")
                    .withArgs(bobAddress, mintAmount2, currentEpoch);
            });
        });
    });

    describe("Edge Cases and Complex Scenarios", () => {
        beforeEach(async () => {
            await setup();
            // Reset to just after inflation protection expires
            const inflationProtectionTime = await auraMinter.inflationProtectionTime();
            const currentTime = await getTimestamp();
            await increaseTime(inflationProtectionTime.sub(currentTime).add(1));
        });

        it("should handle minting exactly at epoch boundaries", async () => {
            // Mint in epoch 1
            await auraMinterOwner.connect(dao).mint(aliceAddress, simpleToExactAmount(2_000_000));

            // Move to exactly epoch 2 boundary
            await increaseTime(EPOCH_DURATION);

            // Should be in epoch 2 now
            expect(await auraMinterOwner.getCurrentEpoch()).to.equal(2);

            // Should be able to mint more
            await auraMinterOwner.connect(dao).mint(aliceAddress, simpleToExactAmount(1_000_000));

            expect(await auraMinterOwner.totalMinted()).to.equal(simpleToExactAmount(3_000_000));
        });

        it("should handle partial epoch consumption correctly", async () => {
            // Mint 1.5M in epoch 1
            await auraMinterOwner.connect(dao).mint(aliceAddress, simpleToExactAmount(1_500_000));

            // Move to epoch 2
            await increaseTime(EPOCH_DURATION);

            // Should be able to mint full 3M in epoch 2 (no carryover)
            const mintable = await auraMinterOwner.getMintable();
            expect(mintable).to.equal(EPOCH_CAP);

            await auraMinterOwner.connect(dao).mint(aliceAddress, EPOCH_CAP);
            expect(await auraMinterOwner.totalMinted()).to.equal(simpleToExactAmount(1_500_000).add(EPOCH_CAP));
        });

        it("should handle the transition from epoch 3 to 4 correctly", async () => {
            // Fill epochs 1, 2, and 3
            await auraMinterOwner.connect(dao).mint(aliceAddress, EPOCH_CAP); // Epoch 1

            await increaseTime(EPOCH_DURATION);
            await auraMinterOwner.connect(dao).mint(aliceAddress, EPOCH_CAP); // Epoch 2

            await increaseTime(EPOCH_DURATION);
            await auraMinterOwner.connect(dao).mint(aliceAddress, EPOCH_CAP); // Epoch 3

            // Move to epoch 4
            await increaseTime(EPOCH_DURATION);

            // Should be able to mint full epoch cap in epoch 4 (no total cap)
            const mintable = await auraMinterOwner.getMintable();
            expect(mintable).to.equal(EPOCH_CAP);

            await auraMinterOwner.connect(dao).mint(aliceAddress, EPOCH_CAP);
            expect(await auraMinterOwner.totalMinted()).to.equal(EPOCH_CAP.mul(4));
        });

        it("should handle multiple small mints across epochs", async () => {
            const smallMint = simpleToExactAmount(100_000); // 100K AURA

            // Make 30 small mints in epoch 1 (3M total)
            for (let i = 0; i < 30; i++) {
                await auraMinterOwner.connect(dao).mint(aliceAddress, smallMint);
            }

            expect(await auraMinterOwner.totalMinted()).to.equal(EPOCH_CAP);

            // Move to epoch 2
            await increaseTime(EPOCH_DURATION);

            // Should be able to make more small mints
            await auraMinterOwner.connect(dao).mint(aliceAddress, smallMint);
            expect(await auraMinterOwner.totalMinted()).to.equal(EPOCH_CAP.add(smallMint));
        });

        it("should handle time travel scenarios correctly", async () => {
            // Record initial state
            const initialEpoch = await auraMinterOwner.getCurrentEpoch();
            expect(initialEpoch).to.equal(1);

            // Travel far into the future (epoch 10)
            await increaseTime(EPOCH_DURATION.mul(9));

            const futureEpoch = await auraMinterOwner.getCurrentEpoch();
            expect(futureEpoch).to.equal(10);

            // Mintable should be 3M for current epoch (per-epoch limit, no carryover)
            const mintable = await auraMinterOwner.getMintable();
            expect(mintable).to.equal(EPOCH_CAP);
        });
    });
});
