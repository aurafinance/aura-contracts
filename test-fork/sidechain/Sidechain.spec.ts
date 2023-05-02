import { expect } from "chai";
import hre, { ethers, network } from "hardhat";
import { Signer } from "ethers";
import {
    deployCanonicalPhase,
    deploySidechainSystem,
    SidechainDeployed,
    CanonicalPhaseDeployed,
} from "../../scripts/deploySidechain";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { AuraBalVaultDeployed, config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import {
    impersonateAccount,
    ZERO_ADDRESS,
    ONE_WEEK,
    ONE_HOUR,
    simpleToExactAmount,
    ONE_DAY,
    ZERO_KEY,
} from "../../test-utils";
import {
    Account,
    AuraOFT,
    L2Coordinator,
    Create2Factory,
    Create2Factory__factory,
    ExtraRewardStashV3__factory,
    LZEndpointMock,
    LZEndpointMock__factory,
    ERC20__factory,
    MockERC20__factory,
    BaseRewardPool4626__factory,
    BaseRewardPool__factory,
} from "../../types";
import { sidechainNaming } from "../../tasks/deploy/sidechain-constants";
import { SidechainConfig } from "../../types/sidechain-types";
import { increaseTime } from "./../../test-utils/time";
import { deploySimpleBridgeDelegates, SimplyBridgeDelegateDeployed } from "../../scripts/deployBridgeDelegates";
describe("Sidechain", () => {
    const L1_CHAIN_ID = 111;
    const L2_CHAIN_ID = 222;
    let alice: Signer;
    let aliceAddress: string;
    let deployer: Account;
    let dao: Account;
    // phases
    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    let vaultDeployment: AuraBalVaultDeployed;
    let canonical: CanonicalPhaseDeployed;
    let bridgeDelegate: SimplyBridgeDelegateDeployed;
    // LayerZero endpoints
    let l1LzEndpoint: LZEndpointMock;
    let l2LzEndpoint: LZEndpointMock;
    let create2Factory: Create2Factory;
    let sidechain: SidechainDeployed;
    let l2Coordinator: L2Coordinator;
    let auraOFT: AuraOFT;
    let sidechainConfig: SidechainConfig;

    const ethBlockNumber: number = 17096880;

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    /*const getCrv = async (recipient: string, amount = simpleToExactAmount(250)) => {
        const tokenWhaleSigner = await impersonateAccount(mainnetConfig.addresses.balancerVault);
        const crv = MockERC20__factory.connect(mainnetConfig.addresses.token, tokenWhaleSigner.signer);
        await crv.transfer(recipient, amount);
    };*/

    const getBpt = async (recipient: string, amount = simpleToExactAmount(250)) => {
        const token = "0xcfca23ca9ca720b6e98e3eb9b6aa0ffc4a5c08b9";
        const whale = "0x7818A1DA7BD1E64c199029E86Ba244a9798eEE10";
        const tokenWhaleSigner = await impersonateAccount(whale);
        const tokenContract = MockERC20__factory.connect(token, tokenWhaleSigner.signer);
        await tokenContract.transfer(recipient, amount);
    };

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: ethBlockNumber,
                    },
                },
            ],
        });

        const accounts = await ethers.getSigners();
        alice = accounts[1];
        aliceAddress = await alice.getAddress();
        deployer = await impersonateAccount(await accounts[0].getAddress());
        dao = await impersonateAccount(mainnetConfig.multisigs.daoMultisig);
        phase2 = await mainnetConfig.getPhase2(deployer.signer);
        phase6 = await mainnetConfig.getPhase6(deployer.signer);
        vaultDeployment = await mainnetConfig.getAuraBalVault(deployer.signer);

        // deploy layerzero mocks
        l1LzEndpoint = await new LZEndpointMock__factory(deployer.signer).deploy(L1_CHAIN_ID);
        l2LzEndpoint = await new LZEndpointMock__factory(deployer.signer).deploy(L2_CHAIN_ID);

        // deploy Create2Factory
        create2Factory = await new Create2Factory__factory(deployer.signer).deploy();
        await create2Factory.updateDeployer(deployer.address, true);

        // setup sidechain config
        sidechainConfig = {
            chainId: 123,
            multisigs: { daoMultisig: dao.address, pauseGaurdian: dao.address },
            naming: { ...sidechainNaming },
            extConfig: {
                canonicalChainId: L1_CHAIN_ID,
                lzEndpoint: l2LzEndpoint.address,
                create2Factory: create2Factory.address,
                token: mainnetConfig.addresses.token,
                minter: mainnetConfig.addresses.minter,
            },
            bridging: {
                l1Receiver: "0x0000000000000000000000000000000000000000",
                l2Sender: "0x0000000000000000000000000000000000000000",
                nativeBridge: "0x0000000000000000000000000000000000000000",
            },
        };

        // deploy canonicalPhase
        const l1Addresses = { ...mainnetConfig.addresses, lzEndpoint: l1LzEndpoint.address };
        canonical = await deployCanonicalPhase(
            hre,
            deployer.signer,
            mainnetConfig.multisigs,
            l1Addresses,
            phase2,
            phase6,
            vaultDeployment,
        );

        // deploy sidechain
        sidechain = await deploySidechainSystem(
            hre,
            deployer.signer,
            sidechainConfig.naming,
            sidechainConfig.multisigs,
            sidechainConfig.extConfig,
        );

        l2Coordinator = sidechain.l2Coordinator;
        auraOFT = sidechain.auraOFT;

        bridgeDelegate = await deploySimpleBridgeDelegates(
            hre,
            mainnetConfig.addresses,
            canonical,
            L2_CHAIN_ID,
            deployer.signer,
        );

        phase6 = await mainnetConfig.getPhase6(deployer.signer);
    });

    describe("Check configs", () => {
        it("VotingProxy has correct config", async () => {
            const { extConfig } = sidechainConfig;

            expect(await sidechain.voterProxy.mintr()).eq(extConfig.minter);
            expect(await sidechain.voterProxy.crv()).eq(extConfig.token);
            expect(await sidechain.voterProxy.rewardDeposit()).eq(ZERO_ADDRESS);
            expect(await sidechain.voterProxy.withdrawer()).eq(ZERO_ADDRESS);
            expect(await sidechain.voterProxy.owner()).eq(dao.address);
            expect(await sidechain.voterProxy.operator()).eq(sidechain.booster.address);
        });
        it("AuraOFT has correct config", async () => {
            expect(await auraOFT.name()).eq(sidechainConfig.naming.auraOftName);
            expect(await auraOFT.symbol()).eq(sidechainConfig.naming.auraOftSymbol);
            expect(await auraOFT.lzEndpoint()).eq(sidechainConfig.extConfig.lzEndpoint);
            expect(await auraOFT.canonicalChainId()).eq(L1_CHAIN_ID);
        });
        it("L2Coordinator has correct config", async () => {
            expect(await l2Coordinator.canonicalChainId()).eq(L1_CHAIN_ID);
            expect(await l2Coordinator.booster()).eq(sidechain.booster.address);
            expect(await l2Coordinator.auraOFT()).eq(auraOFT.address);
            expect(await l2Coordinator.mintRate()).eq(0);
            expect(await l2Coordinator.lzEndpoint()).eq(sidechainConfig.extConfig.lzEndpoint);
        });
        it("BoosterLite has correct config", async () => {
            expect(await sidechain.booster.crv()).eq(sidechainConfig.extConfig.token);

            expect(await sidechain.booster.lockIncentive()).eq(550);
            expect(await sidechain.booster.stakerIncentive()).eq(1100);
            expect(await sidechain.booster.earmarkIncentive()).eq(50);
            expect(await sidechain.booster.platformFee()).eq(0);
            expect(await sidechain.booster.MaxFees()).eq(4000);
            expect(await sidechain.booster.FEE_DENOMINATOR()).eq(10000);

            expect(await sidechain.booster.owner()).eq(sidechain.boosterOwner.address);
            expect(await sidechain.booster.feeManager()).eq(dao.address);
            expect(await sidechain.booster.poolManager()).eq(sidechain.poolManager.address);
            expect(await sidechain.booster.staker()).eq(sidechain.voterProxy.address);
            expect(await sidechain.booster.minter()).eq(l2Coordinator.address);
            expect(await sidechain.booster.rewardFactory()).eq(sidechain.factories.rewardFactory.address);
            expect(await sidechain.booster.stashFactory()).eq(sidechain.factories.stashFactory.address);
            expect(await sidechain.booster.tokenFactory()).eq(sidechain.factories.tokenFactory.address);
            expect(await sidechain.booster.treasury()).eq(ZERO_ADDRESS);

            expect(await sidechain.booster.isShutdown()).eq(false);
            expect(await sidechain.booster.poolLength()).eq(0);
        });
        it("Booster Owner has correct config", async () => {
            expect(await sidechain.boosterOwner.poolManager()).eq(sidechain.poolManager.address);
            expect(await sidechain.boosterOwner.booster()).eq(sidechain.booster.address);
            expect(await sidechain.boosterOwner.stashFactory()).eq(sidechain.factories.stashFactory.address);
            expect(await sidechain.boosterOwner.rescueStash()).eq(ZERO_ADDRESS);
            expect(await sidechain.boosterOwner.owner()).eq(dao.address);
            expect(await sidechain.boosterOwner.pendingowner()).eq(ZERO_ADDRESS);
            expect(await sidechain.boosterOwner.isSealed()).eq(true);
            expect(await sidechain.boosterOwner.isForceTimerStarted()).eq(false);
            expect(await sidechain.boosterOwner.forceTimestamp()).eq(0);
        });
        it("factories have correct config", async () => {
            const {
                booster,
                factories: { rewardFactory, stashFactory, tokenFactory, proxyFactory },
            } = sidechain;

            const { extConfig } = sidechainConfig;

            expect(await rewardFactory.operator()).eq(booster.address);
            expect(await rewardFactory.crv()).eq(extConfig.token);

            expect(await stashFactory.operator()).eq(booster.address);
            expect(await stashFactory.rewardFactory()).eq(rewardFactory.address);
            expect(await stashFactory.proxyFactory()).eq(proxyFactory.address);
            expect(await stashFactory.v1Implementation()).eq(ZERO_ADDRESS);
            expect(await stashFactory.v2Implementation()).eq(ZERO_ADDRESS);

            const rewardsStashV3 = ExtraRewardStashV3__factory.connect(
                await stashFactory.v3Implementation(),
                deployer.signer,
            );
            expect(await rewardsStashV3.crv()).eq(extConfig.token);

            expect(await tokenFactory.operator()).eq(booster.address);
            expect(await tokenFactory.namePostfix()).eq(sidechainConfig.naming.tokenFactoryNamePostfix);
            expect(await tokenFactory.symbolPrefix()).eq("aura");
        });
        it("poolManager has correct config", async () => {
            const { booster, poolManager } = sidechain;
            expect(await poolManager.booster()).eq(booster.address);
            expect(await poolManager.operator()).eq(dao.address);
            expect(await poolManager.protectAddPool()).eq(true);
        });
        it("Delegates are set up", async () => {
            let owner = await impersonateAccount(await sidechain.l2Coordinator.owner());
            await sidechain.l2Coordinator
                .connect(owner.signer)
                .setBridgeDelegate(bridgeDelegate.bridgeDelegateSender.address);

            owner = await impersonateAccount(await bridgeDelegate.bridgeDelegateSender.owner());

            await bridgeDelegate.bridgeDelegateSender
                .connect(owner.signer)
                .setL2Coordinator(sidechain.l2Coordinator.address);

            expect(await sidechain.l2Coordinator.bridgeDelegate()).to.eq(bridgeDelegate.bridgeDelegateSender.address);
            expect(await bridgeDelegate.bridgeDelegateSender.l2Coordinator()).to.eq(sidechain.l2Coordinator.address);
        });
        it("add trusted remotes to layerzero endpoints", async () => {
            const owner = await impersonateAccount(await sidechain.l2Coordinator.owner());
            // L1 Stuff
            await canonical.l1Coordinator
                .connect(owner.signer)
                .setTrustedRemote(
                    L2_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [sidechain.l2Coordinator.address, canonical.l1Coordinator.address],
                    ),
                );

            await canonical.auraProxyOFT
                .connect(owner.signer)
                .setTrustedRemote(
                    L2_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [sidechain.auraOFT.address, canonical.auraProxyOFT.address],
                    ),
                );

            await canonical.auraProxyOFT
                .connect(owner.signer)
                .setTrustedRemote(
                    L2_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [sidechain.auraOFT.address, canonical.auraProxyOFT.address],
                    ),
                );

            await l1LzEndpoint.connect(owner.signer).setDestLzEndpoint(l2Coordinator.address, l2LzEndpoint.address);
            await l1LzEndpoint.connect(owner.signer).setDestLzEndpoint(auraOFT.address, l2LzEndpoint.address);

            // L2 Stuff

            await sidechain.l2Coordinator
                .connect(owner.signer)
                .setTrustedRemote(
                    L1_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [canonical.l1Coordinator.address, sidechain.l2Coordinator.address],
                    ),
                );

            await sidechain.auraOFT
                .connect(owner.signer)
                .setTrustedRemote(
                    L1_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [canonical.auraProxyOFT.address, sidechain.auraOFT.address],
                    ),
                );

            await sidechain.auraBalOFT
                .connect(owner.signer)
                .setTrustedRemote(
                    L1_CHAIN_ID,
                    ethers.utils.solidityPack(
                        ["address", "address"],
                        [canonical.auraBalProxyOFT.address, sidechain.auraBalOFT.address],
                    ),
                );

            await l2LzEndpoint
                .connect(owner.signer)
                .setDestLzEndpoint(canonical.l1Coordinator.address, l1LzEndpoint.address);
            await l2LzEndpoint
                .connect(owner.signer)
                .setDestLzEndpoint(canonical.auraProxyOFT.address, l1LzEndpoint.address);
        });
    });

    /* ---------------------------------------------------------------------
     * General Functional tests
     * --------------------------------------------------------------------- */

    describe("Booster setup", () => {
        it("add pools to the booster", async () => {
            // As this test suite is running the bridge from L1 -> L1 forked on
            // mainnet. We can just add the first 10 active existing Aura pools
            let i = 0;
            while ((await sidechain.booster.poolLength()).lt(10)) {
                const poolInfo = await phase6.booster.poolInfo(i);
                if (!poolInfo.shutdown) {
                    await sidechain.poolManager.connect(dao.signer)["addPool(address)"](poolInfo.gauge);
                }
                i++;
            }
            expect(await sidechain.booster.poolLength()).eq(10);
        });
        it("can unprotected poolManager add pool", async () => {
            const poolId = Number(await phase6.booster.poolLength()) - 2;
            const poolInfo = await phase6.booster.poolInfo(poolId);
            await sidechain.poolManager.connect(dao.signer)["addPool(address)"](poolInfo.gauge);
        });
        it("Pool stash has the correct config", async () => {
            const pool0 = await sidechain.booster.poolInfo(0);
            const stash = ExtraRewardStashV3__factory.connect(pool0.stash, deployer.signer);
            expect(await stash.pid()).eq(0);
            expect(await stash.operator()).eq(sidechain.booster.address);
            expect(await stash.staker()).eq(sidechain.voterProxy.address);
            expect(await stash.gauge()).eq(pool0.gauge);
            expect(await stash.rewardFactory()).eq(sidechain.factories.rewardFactory.address);
            expect(await stash.hasRedirected()).eq(false); //Todo: verify if this is actually meant to be true or false
            expect(await stash.hasCurveRewards()).eq(false);
            await expect(stash.tokenList(0)).to.be.reverted;
        });
        it("Pool rewards contract has the correct config", async () => {
            const poolInfo = await sidechain.booster.poolInfo(0);
            const rewardContract = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, deployer.signer);
            await expect(rewardContract.extraRewards(0)).to.be.reverted;
        });
    });

    describe("Deposit and withdraw BPT", () => {
        it("allow deposit into pool via Booster", async () => {
            const poolId = 0;
            const poolInfo = await sidechain.booster.poolInfo(poolId);
            const amount = ethers.utils.parseEther("1");
            await getBpt(aliceAddress, amount);

            const lptoken = MockERC20__factory.connect(poolInfo.lptoken, alice);
            await lptoken.approve(sidechain.booster.address, amount);
            const lptokenBalance = await lptoken.balanceOf(aliceAddress);

            const depositToken = ERC20__factory.connect(poolInfo.token, alice);
            const depositTokenBalanceBefore = await depositToken.balanceOf(aliceAddress);

            expect(lptokenBalance).gt(0);

            await sidechain.booster.connect(alice).depositAll(0, false);

            const depositTokenBalanceAfter = await depositToken.balanceOf(aliceAddress);
            expect(depositTokenBalanceAfter.sub(depositTokenBalanceBefore)).eq(lptokenBalance);
        });
        it("allows auraBPT deposits directly into the reward pool", async () => {
            const poolInfo = await sidechain.booster.poolInfo(0);

            const rewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, alice);
            const depositToken = ERC20__factory.connect(poolInfo.token, alice);
            const balance = await depositToken.balanceOf(aliceAddress);

            const rewardBalanceBefore = await rewards.balanceOf(aliceAddress);
            await depositToken.approve(rewards.address, balance);
            await rewards.stake(balance);
            const rewardBalanceAfter = await rewards.balanceOf(aliceAddress);
            expect(rewardBalanceAfter.sub(rewardBalanceBefore)).eq(balance);
        });
        it("allows BPT deposits directly into the reward pool", async () => {
            await getBpt(aliceAddress, simpleToExactAmount(10));
            const poolInfo = await sidechain.booster.poolInfo(0);

            const lpToken = ERC20__factory.connect(poolInfo.lptoken, alice);
            const baseRewardPool = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, alice);

            const lpTokenBalance = await lpToken.balanceOf(aliceAddress);

            const rewardBalanceBefore = await baseRewardPool.balanceOf(aliceAddress);

            await lpToken.approve(baseRewardPool.address, lpTokenBalance);
            await baseRewardPool.deposit(lpTokenBalance, aliceAddress);
            const rewardBalanceAfter = await baseRewardPool.balanceOf(aliceAddress);

            expect(rewardBalanceAfter.sub(rewardBalanceBefore)).eq;
        });
        it("allows withdrawals directly from the pool 4626", async () => {
            const amount = simpleToExactAmount(1);
            const poolInfo = await sidechain.booster.poolInfo(0);

            const rewards = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, alice);
            const lptoken = ERC20__factory.connect(poolInfo.lptoken, alice);
            const balanceBefore = await lptoken.balanceOf(aliceAddress);

            await rewards["withdraw(uint256,address,address)"](amount, aliceAddress, aliceAddress);

            const balanceAfter = await lptoken.balanceOf(aliceAddress);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
        });
        it("allows withdrawals directly from the pool normal", async () => {
            const amount = simpleToExactAmount(1);
            const poolInfo = await sidechain.booster.poolInfo(0);

            const rewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, alice);
            const depositToken = ERC20__factory.connect(poolInfo.token, alice);
            const balanceBefore = await depositToken.balanceOf(aliceAddress);

            await rewards.withdraw(amount, false);

            const balanceAfter = await depositToken.balanceOf(aliceAddress);
            expect(balanceAfter.sub(balanceBefore)).eq(amount);
        });
        it("allows earmarking of rewards", async () => {
            const poolInfo = await sidechain.booster.poolInfo(0);
            const crvRewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, dao.signer);
            const crv = ERC20__factory.connect(mainnetConfig.addresses.token, alice);
            const balanceBefore = await crv.balanceOf(crvRewards.address);
            await increaseTime(ONE_DAY);
            await sidechain.booster.connect(alice).earmarkRewards(0, { value: simpleToExactAmount("0.2") });
            const balanceAfter = await crv.balanceOf(crvRewards.address);
            expect(balanceAfter).gt(balanceBefore);
        });
        it("pays out a premium to the caller", async () => {
            const crv = ERC20__factory.connect(mainnetConfig.addresses.token, alice);
            const balanceBefore = await crv.balanceOf(aliceAddress);
            await increaseTime(ONE_DAY);
            await sidechain.booster.connect(alice).earmarkRewards(0, { value: simpleToExactAmount("0.2") });
            const balanceAfter = await crv.balanceOf(aliceAddress);
            expect(balanceAfter).gt(balanceBefore);
        });
        it("Can send a payload to set the mint rate", async () => {
            const endpoint = await impersonateAccount(await sidechain.l2Coordinator.lzEndpoint());
            console.log(endpoint.address);
            const payload = ethers.utils.solidityPack(
                ["bytes4", "uint8", "uint256", "uint256"],
                ["0x7a7f9946", "2", (10e18).toString(), (1e18).toString()],
            );
            await sidechain.l2Coordinator
                .connect(endpoint.signer)
                .lzReceive(L1_CHAIN_ID, await sidechain.l2Coordinator.trustedRemoteLookup(L1_CHAIN_ID), 0, payload);
            console.log(await sidechain.l2Coordinator.mintRate());
        });
        it("allows users to earn $BAl and $AURA", async () => {
            const crv = ERC20__factory.connect(mainnetConfig.addresses.token, alice);
            const poolInfo = await sidechain.booster.poolInfo(0);
            const rewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, alice);
            const cvxBalanceBefore = await sidechain.auraOFT.balanceOf(aliceAddress);
            const crvBalanceBefore = await crv.balanceOf(aliceAddress);

            //forward time and harvest
            for (let i = 0; i < 7; i++) {
                await increaseTime(ONE_DAY);
                await increaseTime(ONE_DAY);
                await sidechain.booster.connect(dao.signer).earmarkRewards(0, { value: simpleToExactAmount("0.2") });
            }

            const earned = await rewards.earned(aliceAddress);
            await rewards["getReward(address,bool)"](aliceAddress, true);
            const cvxBalanceAfter = await sidechain.auraOFT.balanceOf(aliceAddress);
            const crvBalanceAfter = await crv.balanceOf(aliceAddress);

            //console.log(await sidechain.booster.minter())
            //console.log(await sidechain.auraOFT.address)
            //console.log(await sidechain.auraOFT.mint())

            const crvBalance = crvBalanceAfter.sub(crvBalanceBefore);
            const cvxBalance = cvxBalanceAfter.sub(cvxBalanceBefore);

            //console.log(crvBalance, cvxBalance)

            console.log(await sidechain.l2Coordinator.mintRate());

            expect(crvBalance).gte(earned);
            expect(cvxBalance).gt(0);
        });
        it("allows extra rewards to be added to pool", async () => {
            const poolInfo = await sidechain.booster.poolInfo(0);
            const rewards = BaseRewardPool__factory.connect(poolInfo.crvRewards, dao.signer);
            const manager = await impersonateAccount(await rewards.rewardManager());
            await rewards.connect(manager.signer).addExtraReward(sidechain.auraBalOFT.address);
            expect(await rewards.extraRewards(0)).to.eq(sidechain.auraBalOFT.address);
            expect(await rewards.extraRewardsLength()).to.eq(1);
        });
    });

    describe("Booster admin", () => {
        it("does not allow a duplicate pool to be added", async () => {
            const poolInfo = await sidechain.booster.poolInfo(0);
            await expect(
                sidechain.poolManager.connect(dao.signer)["addPool(address)"](poolInfo.gauge),
            ).to.be.revertedWith("already registered gauge");
        });
        it("allows a pool to be shut down", async () => {
            await sidechain.poolManager.connect(dao.signer).shutdownPool(0);
            const poolInfo = await sidechain.booster.poolInfo(0);
            expect(poolInfo.shutdown).to.eq(true);
        });
        it("does not allow the system to be shut down", async () => {
            const daoMultisig = await impersonateAccount(await sidechain.boosterOwner.connect(alice).owner());
            await expect(sidechain.boosterOwner.connect(daoMultisig.signer).shutdownSystem()).to.be.revertedWith(
                "!poolMgrShutdown",
            );
        });
        it("allows boosterOwner owner to be changed", async () => {
            const accounts = await ethers.getSigners();
            const newOwner = await impersonateAccount(await accounts[2].getAddress());
            let owner = await sidechain.boosterOwner.owner();
            expect(owner).eq(dao.address);

            await sidechain.boosterOwner.connect(dao.signer).transferOwnership(newOwner.address);
            owner = await sidechain.boosterOwner.owner();
            expect(owner).eq(dao.address);
            let pendingOwner = await sidechain.boosterOwner.pendingowner();
            expect(pendingOwner).eq(newOwner.address);

            await expect(sidechain.boosterOwner.connect(dao.signer).acceptOwnership()).to.be.revertedWith(
                "!pendingowner",
            );

            await sidechain.boosterOwner.connect(newOwner.signer).acceptOwnership();
            owner = await sidechain.boosterOwner.owner();
            expect(owner).eq(newOwner.address);
            pendingOwner = await sidechain.boosterOwner.pendingowner();
            expect(pendingOwner).eq(ZERO_ADDRESS);

            await sidechain.boosterOwner.connect(newOwner.signer).transferOwnership(dao.address);
            await sidechain.boosterOwner.connect(dao.signer).acceptOwnership();
        });
        it("allows boosterOwner to call all fns on booster", async () => {
            await sidechain.boosterOwner.connect(dao.signer).setFeeManager(mainnetConfig.multisigs.treasuryMultisig);
            expect(await sidechain.booster.feeManager()).eq(mainnetConfig.multisigs.treasuryMultisig);
            await sidechain.boosterOwner.connect(dao.signer).setFeeManager(dao.address);

            await sidechain.boosterOwner.connect(dao.signer).setFactories(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS);
            expect(await sidechain.booster.stashFactory()).eq(ZERO_ADDRESS);
            expect(await sidechain.booster.tokenFactory()).not.eq(ZERO_ADDRESS);
            expect(await sidechain.booster.rewardFactory()).not.eq(ZERO_ADDRESS);
        });
    });

    describe("Shutdown", () => {
        it("allows system to be shutdown", async () => {
            const daoMultisig = await impersonateAccount(await sidechain.boosterOwner.owner());
            const poolLength = Number(await sidechain.booster.poolLength());

            for (let i = 0; i < poolLength; i++) {
                try {
                    await sidechain.poolManager.connect(daoMultisig.signer).shutdownPool(i);
                } catch (e) {
                    // console.log(e)
                }

                const poolInfo = await sidechain.booster.poolInfo(i);
                expect(poolInfo.shutdown).to.eq(true);
            }

            await sidechain.poolManager.connect(daoMultisig.signer).shutdownSystem();
            await sidechain.boosterOwner.connect(daoMultisig.signer).shutdownSystem();

            expect(await sidechain.booster.isShutdown()).to.eq(true);
            expect(await sidechain.poolManager.isShutdown()).to.eq(true);
        });
    });

    /* ---------------------------------------------------------------------
     * Protected functions
     * --------------------------------------------------------------------- */

    describe("Protected functions", () => {
        it("PoolManager protected functions", async () => {
            const owner = await impersonateAccount(await sidechain.poolManager.operator());
            await sidechain.poolManager.connect(owner.signer).setProtectPool(true);

            const accounts = await ethers.getSigners();
            const notAuthorised = await impersonateAccount(await accounts[3].getAddress());

            await expect(sidechain.poolManager.connect(notAuthorised.signer).shutdownPool(0)).to.revertedWith("!auth");
            await expect(sidechain.poolManager.connect(notAuthorised.signer).setProtectPool(true)).to.revertedWith(
                "!auth",
            );
            await expect(
                sidechain.poolManager.connect(notAuthorised.signer).setOperator(notAuthorised.address),
            ).to.revertedWith("!auth");
        });
        it("booster protected functions", async () => {
            const accounts = await ethers.getSigners();
            const notAuthorised = await impersonateAccount(await accounts[3].getAddress());

            await expect(sidechain.booster.connect(notAuthorised.signer).shutdownPool(0)).to.be.revertedWith("!auth");
            await expect(sidechain.booster.connect(notAuthorised.signer).shutdownSystem()).to.be.revertedWith("!auth");
            await expect(
                sidechain.booster.connect(notAuthorised.signer).setTreasury(notAuthorised.address),
            ).to.be.revertedWith("!auth");
            await expect(
                sidechain.booster
                    .connect(notAuthorised.signer)
                    .setFactories(notAuthorised.address, notAuthorised.address, notAuthorised.address),
            ).to.be.revertedWith("!auth");
            await expect(
                sidechain.booster.connect(notAuthorised.signer).setFeeManager(notAuthorised.address),
            ).to.be.revertedWith("!auth");
            await expect(
                sidechain.booster.connect(notAuthorised.signer).setOwner(notAuthorised.address),
            ).to.be.revertedWith("!auth");
            await expect(
                sidechain.booster.connect(notAuthorised.signer).setRewardContracts(notAuthorised.address),
            ).to.be.revertedWith("!auth");
            await expect(
                sidechain.booster.connect(notAuthorised.signer).setFees(100, 100, 100, 100),
            ).to.be.revertedWith("!auth");
            await expect(
                sidechain.booster.connect(notAuthorised.signer).setPoolManager(notAuthorised.address),
            ).to.be.revertedWith("!auth");
        });
        it("voterProxy protected functions", async () => {
            const accounts = await ethers.getSigners();
            const notAuthorised = await impersonateAccount(await accounts[3].getAddress());

            await expect(
                sidechain.voterProxy.connect(notAuthorised.signer).setOwner(notAuthorised.address),
            ).to.be.revertedWith("!auth");
            await expect(
                sidechain.voterProxy.connect(notAuthorised.signer).setOperator(notAuthorised.address),
            ).to.be.revertedWith("!auth");
            await expect(
                sidechain.voterProxy
                    .connect(notAuthorised.signer)
                    .setRewardDeposit(notAuthorised.address, notAuthorised.address),
            ).to.be.revertedWith("!auth");
            await expect(
                sidechain.voterProxy.connect(notAuthorised.signer).setStashAccess(notAuthorised.address, false),
            ).to.be.revertedWith("!auth");
            await expect(
                sidechain.voterProxy.connect(notAuthorised.signer).setSystemConfig(notAuthorised.address),
            ).to.be.revertedWith("!auth");
            await expect(
                sidechain.voterProxy.connect(notAuthorised.signer).execute(notAuthorised.address, 0, "0x00"),
            ).to.be.revertedWith("!auth");
        });

        it("boosterOwner protected functions", async () => {
            const accounts = await ethers.getSigners();
            const notAuthorised = await impersonateAccount(await accounts[3].getAddress());

            await expect(sidechain.boosterOwner.connect(notAuthorised.signer).shutdownSystem()).to.be.revertedWith(
                "!owner",
            );
            await expect(
                sidechain.boosterOwner
                    .connect(notAuthorised.signer)
                    .setStashRewardHook(notAuthorised.address, notAuthorised.address),
            ).to.be.revertedWith("!owner");
            await expect(sidechain.boosterOwner.connect(notAuthorised.signer).setBoosterOwner()).to.be.revertedWith(
                "!owner",
            );

            await expect(sidechain.boosterOwner.connect(notAuthorised.signer).sealOwnership()).to.be.revertedWith(
                "!owner",
            );
            await expect(
                sidechain.boosterOwner.connect(notAuthorised.signer).setFeeManager(notAuthorised.address),
            ).to.be.revertedWith("!owner");
            await expect(
                sidechain.boosterOwner
                    .connect(notAuthorised.signer)
                    .setFactories(notAuthorised.address, notAuthorised.address, notAuthorised.address),
            ).to.be.revertedWith("!owner");
            await expect(sidechain.boosterOwner.connect(notAuthorised.signer).queueForceShutdown()).to.be.revertedWith(
                "!owner",
            );
            await expect(
                sidechain.boosterOwner
                    .connect(notAuthorised.signer)
                    .setRescueTokenDistribution(notAuthorised.address, notAuthorised.address, notAuthorised.address),
            ).to.be.revertedWith("!owner");
            await expect(
                sidechain.boosterOwner
                    .connect(notAuthorised.signer)
                    .setStashExtraReward(notAuthorised.address, notAuthorised.address),
            ).to.be.revertedWith("!owner");
            await expect(
                sidechain.boosterOwner
                    .connect(notAuthorised.signer)
                    .setStashFactoryImplementation(notAuthorised.address, notAuthorised.address, notAuthorised.address),
            ).to.be.revertedWith("!owner");
        });
    });
});
