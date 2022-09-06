import { network, ethers } from "hardhat";
import { Signer } from "ethers";
import {
    VoterProxy,
    VoterProxy__factory,
    MockERC20,
    Booster__factory,
    Booster,
    MockERC20__factory,
    RewardFactory__factory,
    RewardFactory,
    TokenFactory__factory,
    TokenFactory,
    ProxyFactory__factory,
    StashFactoryV2__factory,
    ExtraRewardStashV3__factory,
    ProxyFactory,
    ExtraRewardStashV3,
    StashFactoryV2,
    PoolManagerProxy__factory,
    PoolManagerSecondaryProxy__factory,
    PoolManagerV3__factory,
    PoolManagerSecondaryProxy,
    PoolManagerV3,
    PoolManagerProxy,
} from "../types/generated";
import { simpleToExactAmount } from "test-utils";

const config = {
    token: "0x040d1edc9569d4bab2d15287dc5a4f10f56a56b8",
    tokenBpt: "0xb286b923A4Ed32eF1Eae425e2b2753F07A517708",
    votingEscrow: ethers.constants.AddressZero,
    gaugeController: ethers.constants.AddressZero,
    voteOwnership: ethers.constants.AddressZero,
    voteParameter: ethers.constants.AddressZero,
};

describe("Cross Chain Booster", () => {
    let deployer: Signer;
    let deployerAddress: string;

    let voterProxy: VoterProxy;
    let rAura: MockERC20;
    let booster: Booster;
    let rewardFactory: RewardFactory;
    let tokenFactory: TokenFactory;
    let proxyFactory: ProxyFactory;
    let stashFactory: StashFactoryV2;
    let stash: ExtraRewardStashV3;
    let poolManagerProxy: PoolManagerProxy;
    let poolManagerSecondaryProxy: PoolManagerSecondaryProxy;
    let poolManagerV3: PoolManagerV3;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15271655,
                    },
                },
            ],
        });

        const signers = await ethers.getSigners();
        deployer = signers[0];
        deployerAddress = await deployer.getAddress();
    });

    describe("deployment", () => {
        it("deploy L2 rAURA", async () => {
            rAura = await new MockERC20__factory(deployer).deploy(
                "name",
                "symbol",
                18,
                deployerAddress,
                simpleToExactAmount(1_000_000),
            );
        });
        it("deploy voter proxy", async () => {
            voterProxy = await new VoterProxy__factory(deployer).deploy(
                ethers.constants.AddressZero,
                rAura.address,
                config.tokenBpt,
                config.votingEscrow,
                config.gaugeController,
            );
        });
        it("deploy booster", async () => {
            booster = await new Booster__factory(deployer).deploy(
                voterProxy.address,
                rAura.address,
                config.token,
                config.voteOwnership,
                config.voteParameter,
            );
        });
        it("deploy factories", async () => {
            // RewardFactory
            rewardFactory = await new RewardFactory__factory(deployer).deploy(booster.address, config.token);
            // TokenFactory
            tokenFactory = await new TokenFactory__factory(deployer).deploy(booster.address, "postFix", "rAURA");
            // ProxyFactory
            proxyFactory = await new ProxyFactory__factory(deployer).deploy();
            // StashFactory
            stashFactory = await new StashFactoryV2__factory(deployer).deploy(
                booster.address,
                rewardFactory.address,
                proxyFactory.address,
            );
            // StashV3
            stash = await new ExtraRewardStashV3__factory(deployer).deploy(config.token);
        });
        it("deploy pool managers", async () => {
            // PoolManagerProxy
            poolManagerProxy = await new PoolManagerProxy__factory(deployer).deploy(booster.address, deployerAddress);
            // PoolManagerSecondaryProxy
            poolManagerSecondaryProxy = await new PoolManagerSecondaryProxy__factory(deployer).deploy(
                config.gaugeController,
                poolManagerProxy.address,
                booster.address,
                deployerAddress,
            );
            // PoolManagerV3
            poolManagerV3 = await new PoolManagerV3__factory(deployer).deploy(
                poolManagerSecondaryProxy.address,
                config.gaugeController,
                deployerAddress,
            );
        });
    });

    describe("add pool", () => {
        it("add a pool");
        it("deposit LP tokens");
        it("claim rewards");
        it("widthdraw LP tokens");
    });
});
