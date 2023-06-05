import { expect } from "chai";
import { BigNumber, BigNumberish, ethers } from "ethers";
import hre, { network } from "hardhat";

import {
    Account,
    AuraArbBalGrant,
    AuraArbBalGrant__factory,
    IBalancerPool,
    IBalancerPool__factory,
    IBalancerVault__factory,
    IERC20,
    IERC20__factory,
    IWeightedPoolFactoryV2__factory,
} from "../../../types";
import { config } from "../../../tasks/deploy/mainnet-config";
import { getPoolAddress, Phase2Deployed } from "../../../scripts/deploySystem";
import { impersonateAccount, ZERO_ADDRESS, simpleToExactAmount, getTimestamp, increaseTime } from "../../../test-utils";
import { AssetHelpers } from "@balancer-labs/balancer-js";

const FORK_BLOCK = 17274000;
const ARB_TOKEN = "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1";

interface DeployedPool {
    address: string;
    poolTokens: [string, string, string];
    weights: [BigNumber, BigNumber, BigNumber];
    tokenOrder: [number, number, number];
}

describe("AuraArbBalGrant", () => {
    let grant: AuraArbBalGrant;
    let balToken: IERC20;
    let phase2: Phase2Deployed;

    let deployer: Account;
    let balancer: Account;
    let project: Account;
    let random: Account;

    let pool: IBalancerPool;
    let deployedPool: DeployedPool;

    const deployPool = async (): Promise<DeployedPool> => {
        const balHelper = new AssetHelpers(config.addresses.weth);

        const poolFactory = IWeightedPoolFactoryV2__factory.connect(
            config.addresses.balancerPoolFactories.weightedPool,
            deployer.signer,
        );

        const tokens = [ARB_TOKEN, phase2.cvx.address, config.addresses.token];

        const [poolTokens, weights] = balHelper.sortTokens(tokens, [
            simpleToExactAmount(34, 16),
            simpleToExactAmount(33, 16),
            simpleToExactAmount(33, 16),
        ]);

        const tx = await poolFactory.create(
            "weightedPool",
            "weightedPool",
            poolTokens,
            weights as BigNumber[],
            simpleToExactAmount(6, 15),
            deployer.address,
        );

        const receipt = await tx.wait();
        const address = getPoolAddress(ethers.utils, receipt);

        const tokenOrder = tokens.map(token => poolTokens.indexOf(token));

        return {
            address,
            poolTokens: poolTokens as [string, string, string],
            weights: weights as [BigNumber, BigNumber, BigNumber],
            tokenOrder: tokenOrder as [number, number, number],
        };
    };

    async function getBal(to: string, amount: BigNumberish) {
        const addr = config.addresses.balancerVault;
        const whale = await impersonateAccount(addr, true);
        await IERC20__factory.connect(config.addresses.token, whale.signer).transfer(to, amount);
    }

    async function getAura(to: string, amount: BigNumberish) {
        const addr = config.addresses.balancerVault;
        const whale = await impersonateAccount(addr, true);
        await IERC20__factory.connect(phase2.cvx.address, whale.signer).transfer(to, amount);
    }

    async function getArb(to: string, amount: BigNumberish) {
        const addr = "0x0D0707963952f2fBA59dD06f2b425ace40b492Fe";
        const whale = await impersonateAccount(addr, true);
        await IERC20__factory.connect(ARB_TOKEN, whale.signer).transfer(to, amount);
    }

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: FORK_BLOCK,
                    },
                },
            ],
        });

        const signers = await hre.ethers.getSigners();

        deployer = await impersonateAccount(await signers[0].getAddress(), true);
        balancer = await impersonateAccount(await signers[1].getAddress(), true);
        project = await impersonateAccount(await signers[2].getAddress(), true);
        random = await impersonateAccount(await signers[3].getAddress(), true);

        balToken = IERC20__factory.connect(config.addresses.token, deployer.signer);
        phase2 = await config.getPhase2(deployer.signer);

        deployedPool = await deployPool();
        pool = IBalancerPool__factory.connect(deployedPool.address, deployer.signer);

        const fgrant = new AuraArbBalGrant__factory(deployer.signer);
        grant = await fgrant.deploy(
            ARB_TOKEN,
            balToken.address,
            project.address,
            balancer.address,
            config.addresses.balancerVault,
        );
    });

    describe("constructor", () => {
        it("has the correct config", async () => {
            expect(await grant.ARB()).eq(ARB_TOKEN);
            expect(await grant.BAL()).eq(config.addresses.token);
            expect(await grant.BALANCER_VAULT()).eq(config.addresses.balancerVault);
            expect(await grant.PROJECT()).eq(project.address);
            expect(await grant.BALANCER()).eq(balancer.address);
        });
    });
    describe("init", () => {
        it("cannot be initialized by non auth", async () => {
            await expect(
                grant
                    .connect(random.signer)
                    .init(ZERO_ADDRESS, "0x0000000000000000000000000000000000000000000000000000000000000000"),
            ).to.be.revertedWith("!auth");
        });
        it("can be initialized", async () => {
            const poolId = await pool.getPoolId();
            await grant.connect(project.signer).init(phase2.cvx.address, poolId);
            expect(await grant.AURA()).eq(phase2.cvx.address);
            expect(await grant.POOL_ID()).eq(poolId);
        });
        it("can not be initialized a second time", async () => {
            await expect(
                grant
                    .connect(project.signer)
                    .init(ZERO_ADDRESS, "0x0000000000000000000000000000000000000000000000000000000000000000"),
            ).to.be.revertedWith("already initialized");
        });
    });
    describe("join", () => {
        it("init pool", async () => {
            const initialBalances = [simpleToExactAmount(1), simpleToExactAmount(1), simpleToExactAmount(1)];
            const joinPoolRequest = {
                assets: deployedPool.poolTokens,
                maxAmountsIn: initialBalances,
                userData: ethers.utils.defaultAbiCoder.encode(["uint256", "uint256[]"], [0, initialBalances]),
                fromInternalBalance: false,
            };

            await getArb(deployer.address, simpleToExactAmount(1));
            await getBal(deployer.address, simpleToExactAmount(1));
            await getAura(deployer.address, simpleToExactAmount(1));

            const balancerVault = IBalancerVault__factory.connect(config.addresses.balancerVault, deployer.signer);

            await IERC20__factory.connect(phase2.cvx.address, deployer.signer).approve(
                balancerVault.address,
                ethers.constants.MaxUint256,
            );
            await IERC20__factory.connect(config.addresses.token, deployer.signer).approve(
                balancerVault.address,
                ethers.constants.MaxUint256,
            );
            await IERC20__factory.connect(ARB_TOKEN, deployer.signer).approve(
                balancerVault.address,
                ethers.constants.MaxUint256,
            );

            await balancerVault.joinPool(await pool.getPoolId(), deployer.address, deployer.address, joinPoolRequest);
        });
        it("cannot join as not auth", async () => {
            await expect(grant.connect(random.signer).join(0)).to.be.revertedWith("!auth");
        });
        it("can join the balance pool", async () => {
            // fund the grant contract
            await getArb(grant.address, simpleToExactAmount(10));
            await getBal(grant.address, simpleToExactAmount(10));
            await getAura(grant.address, simpleToExactAmount(10));

            const bptBalanceBefore = await pool.balanceOf(grant.address);
            await grant.connect(project.signer).join(0);
            const bptBalanceAfter = await pool.balanceOf(grant.address);
            expect(bptBalanceAfter.sub(bptBalanceBefore)).gt(0);
        });
    });
    describe("start cooldown", () => {
        it("cannot start cooldown as non auth", async () => {
            await expect(grant.connect(random.signer).startCooldown()).to.be.revertedWith("!auth");
        });
        it("cannot exit while active", async () => {
            expect(await grant.cooldownStart()).eq(0);
            await expect(grant.connect(balancer.signer).exit([0, 0, 0])).to.be.revertedWith("active");
        });
        it("cannot withdraw while active", async () => {
            expect(await grant.cooldownStart()).eq(0);
            await expect(grant.connect(balancer.signer).withdrawBalances()).to.be.revertedWith("active");
        });
        it("can start cooldown", async () => {
            const ts = await getTimestamp();
            await grant.connect(balancer.signer).startCooldown();
            expect(await grant.cooldownStart()).not.eq(0);
            expect(await grant.cooldownStart()).gte(ts);
        });
        it("cannot start cooldown again", async () => {
            await expect(grant.connect(balancer.signer).startCooldown()).to.be.revertedWith("!active");
        });
        it("cannot exit before cooldown period", async () => {
            expect(await grant.cooldownStart()).not.eq(0);
            const cooldownStart = await grant.cooldownStart();
            const cooldownPeriod = await grant.COOLDOWN_PERIOD();
            expect(await getTimestamp()).lt(cooldownStart.add(cooldownPeriod));
            await expect(grant.connect(balancer.signer).exit([0, 0, 0])).to.be.revertedWith("active");
        });
        it("cannot withdrawBalances before cooldown period", async () => {
            expect(await grant.cooldownStart()).not.eq(0);
            const cooldownStart = await grant.cooldownStart();
            const cooldownPeriod = await grant.COOLDOWN_PERIOD();
            expect(await getTimestamp()).lt(cooldownStart.add(cooldownPeriod));
            await expect(grant.connect(balancer.signer).withdrawBalances()).to.be.revertedWith("active");
        });
        it("cannot join while inactive", async () => {
            expect(await grant.cooldownStart()).not.eq(0);
            await expect(grant.connect(project.signer).join(0)).to.be.revertedWith("!active");
        });
        it("increase time", async () => {
            const cooldownStart = await grant.cooldownStart();
            const cooldownPeriod = await grant.COOLDOWN_PERIOD();
            await increaseTime(cooldownStart.add(cooldownPeriod).add(1));
        });
    });
    describe("exit", () => {
        it("cannot exit as not auth", async () => {
            await expect(grant.connect(random.signer).exit([0, 0, 0])).to.be.revertedWith("!balancer");
        });
        it("can exit the pool", async () => {
            const bptBalanceBefore = await pool.balanceOf(grant.address);
            expect(bptBalanceBefore).gt(0);
            await grant.connect(balancer.signer).exit([0, 0, 0]);
            const bptBalanceAfter = await pool.balanceOf(grant.address);
            expect(bptBalanceAfter).eq(0);
        });
    });
    describe("withdrawBalances", () => {
        it("cannot withdraw as not auth", async () => {
            await expect(grant.connect(random.signer).withdrawBalances()).to.be.revertedWith("!auth");
        });
        it("withdraw balances", async () => {
            await grant.connect(balancer.signer).withdrawBalances();
        });
    });
});
