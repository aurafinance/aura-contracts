import chalk from "chalk";
import { expect } from "chai";
import { BigNumber } from "ethers";
import hre, { ethers, network } from "hardhat";
import { formatEther } from "ethers/lib/utils";

import {
    Account,
    AuraOFT,
    AuraProxyOFT,
    L2Coordinator,
    L1Coordinator,
    ERC20,
    LZEndpointMock,
    MockCurveMinter,
    MockCurveMinter__factory,
    MockERC20__factory,
    SidechainConfig,
    BaseRewardPool4626__factory,
} from "../../types";
import {
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
    setTrustedRemoteCanonicalPhase1,
    SidechainPhase1Deployed,
    SidechainPhase2Deployed,
} from "../../scripts/deploySidechain";
import { deployContract } from "../../tasks/utils";
import { setupLocalDeployment } from "./setupLocalDeployment";
import { Phase2Deployed, Phase6Deployed } from "../../scripts/deploySystem";
import { config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import { fullScale, getBal, impersonateAccount, increaseTime, ONE_WEEK, simpleToExactAmount } from "../../test-utils";

const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;
const BLOCK_NUMBER = 17140000;
const CONFIG = mainnetConfig;
const mintrMintAmount = simpleToExactAmount(10);

describe("Mint rate", () => {
    let deployer: Account;
    let dao: Account;

    // phases
    let phase6: Phase6Deployed;
    let phase2: Phase2Deployed;
    let mockMintr: MockCurveMinter;

    // LayerZero endpoints
    let l1LzEndpoint: LZEndpointMock;
    let l2LzEndpoint: LZEndpointMock;

    // Canonical chain Contracts
    let canonical: CanonicalPhase1Deployed & CanonicalPhase2Deployed;
    let auraProxyOFT: AuraProxyOFT;
    let crv: ERC20;
    let l1Coordinator: L1Coordinator;

    // Sidechain Contracts
    let sidechain: SidechainPhase1Deployed & SidechainPhase2Deployed;
    let l2Coordinator: L2Coordinator;
    let auraOFT: AuraOFT;
    let sidechainConfig: SidechainConfig;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: BLOCK_NUMBER,
                    },
                },
            ],
        });

        const accounts = await ethers.getSigners();
        deployer = await impersonateAccount(await accounts[0].getAddress());

        const result = await setupLocalDeployment(hre, CONFIG, deployer, L1_CHAIN_ID, L2_CHAIN_ID);

        phase6 = result.phase6;
        phase2 = result.phase2;
        l1LzEndpoint = result.l1LzEndpoint;
        l2LzEndpoint = result.l2LzEndpoint;
        canonical = result.canonical;
        sidechain = result.sidechain;
        dao = result.dao;

        auraProxyOFT = canonical.auraProxyOFT;
        l1Coordinator = canonical.l1Coordinator;
        l2Coordinator = sidechain.l2Coordinator;
        auraOFT = sidechain.auraOFT;

        // Connect contracts to its owner signer.
        sidechain.l2Coordinator = sidechain.l2Coordinator.connect(dao.signer);
        sidechain.auraOFT = sidechain.auraOFT.connect(dao.signer);
        sidechainConfig = result.sidechainConfig;

        canonical.l1Coordinator = canonical.l1Coordinator.connect(dao.signer);
        canonical.auraProxyOFT = canonical.auraProxyOFT.connect(dao.signer);

        // Deploy mocks
        crv = MockERC20__factory.connect(mainnetConfig.addresses.token, deployer.signer);
        mockMintr = await deployContract<MockCurveMinter>(
            hre,
            new MockCurveMinter__factory(deployer.signer),
            "MockCurveMinter",
            [mainnetConfig.addresses.token, mintrMintAmount],
            {},
            false,
        );

        await l1Coordinator.connect(dao.signer).setDistributor(deployer.address, true);
        await l2Coordinator.connect(dao.signer).setBridgeDelegate(deployer.address);
        await phase6.booster.connect(dao.signer).setBridgeDelegate(l1Coordinator.address);
        // LayerZero
        await setTrustedRemoteCanonicalPhase1(canonical, sidechain, L2_CHAIN_ID);
        await l1LzEndpoint.setDestLzEndpoint(l2Coordinator.address, l2LzEndpoint.address);
        await l1LzEndpoint.setDestLzEndpoint(auraOFT.address, l2LzEndpoint.address);
        await l2LzEndpoint.setDestLzEndpoint(l1Coordinator.address, l1LzEndpoint.address);
        await l2LzEndpoint.setDestLzEndpoint(auraProxyOFT.address, l1LzEndpoint.address);
        // Add some pools
        let i = 0;
        while ((await sidechain.booster.poolLength()).lt(10)) {
            const poolInfo = await phase6.booster.poolInfo(i);
            if (!poolInfo.shutdown) {
                await sidechain.poolManager.connect(dao.signer)["addPool(address)"](poolInfo.gauge);
            }
            i++;
        }

        const floatAmount = simpleToExactAmount(10_000);
        await getBal(mainnetConfig.addresses, l1Coordinator.address, floatAmount);

        await l1Coordinator.connect(dao.signer).setL2Coordinator(L2_CHAIN_ID, l2Coordinator.address);
    });

    /* ---------------------------------------------------------------------
     * Helper Functions
     * --------------------------------------------------------------------- */

    async function withMockMinter(amount: BigNumber, fn: () => Promise<void>) {
        // Update the mintr slot of voter proxy to be our mock mintr
        await mockMintr.setRate(amount);
        const original = await hre.network.provider.send("eth_getStorageAt", [sidechain.voterProxy.address, "0x0"]);
        const newSlot = "0x" + mockMintr.address.slice(2).padStart(64, "0");
        await getBal(mainnetConfig.addresses, mockMintr.address, amount);
        expect(await crv.balanceOf(mockMintr.address)).eq(amount);

        await hre.network.provider.send("hardhat_setStorageAt", [sidechain.voterProxy.address, "0x0", newSlot]);
        await fn();
        await hre.network.provider.send("hardhat_setStorageAt", [sidechain.voterProxy.address, "0x0", original]);
    }

    const earmarkRewards = async (amount: BigNumber, pid: number) => {
        await withMockMinter(amount, async () => {
            await sidechain.booster.earmarkRewards(pid, {
                value: NATIVE_FEE,
            });
        });
    };

    const distribute = async () => {
        await l1Coordinator.connect(deployer.signer).distributeAura(L2_CHAIN_ID, [], { value: NATIVE_FEE.mul(2) });
    };

    const snapshotRate = async (i: number, pid: number, accounts: Account[]) => {
        // how much BAL is queued up as rewards
        const poolInfo = await sidechain.booster.poolInfo(pid);
        const crvBalance = await crv.balanceOf(poolInfo.crvRewards);
        const reward = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, deployer.signer);

        // how much AURA is available to "mint"
        const auraBalance = await sidechain.auraOFT.balanceOf(sidechain.l2Coordinator.address);
        const auraAcc = await sidechain.l2Coordinator.accAuraRewards();
        const balAcc = await sidechain.l2Coordinator.accBalRewards();

        const expectedRate = auraBalance.mul(fullScale).div(crvBalance);
        const actualRate = await l2Coordinator.mintRate();
        const rateDelta = expectedRate.sub(actualRate);

        const totalEarned = (
            await Promise.all(
                accounts.map(acc => {
                    return reward.earned(acc.address);
                }),
            )
        ).reduce((acc, next) => acc.add(next), BigNumber.from(0));

        const totalAuraEarned = totalEarned.mul(actualRate).div(fullScale);
        const auraDelta = auraBalance.sub(totalAuraEarned);

        const ident = <T>(v: T) => v;

        const results: [string, BigNumber, any][] = [
            ["BAL Balance", crvBalance, ident],
            ["BAL accumulated", balAcc, ident],
            ["AURA Balance", auraBalance, ident],
            ["AURA accumulated", auraAcc, ident],
            ["", undefined, undefined],
            ["Expected rate", expectedRate, ident],
            ["Actual rate", actualRate, ident],
            ["Rate delta", rateDelta, rateDelta.lt(0) ? chalk.red : chalk.green],
            ["", undefined, undefined],
            ["BAL earned", totalEarned, ident],
            ["AURA earned", totalAuraEarned, ident],
            ["AURA delta", auraDelta, auraDelta.lt(0) ? chalk.red : chalk.green],
        ];

        console.log(`\n---------- snapshot ${i.toString().padStart(3, "0")} ----------`);
        results.forEach(([str, value, color]) => {
            console.log(str.padEnd(16, " "), !!value ? color(formatEther(value)) : "");
        });
    };

    const getBpt = async (token: string, recipient: string, amount = simpleToExactAmount(250)) => {
        const whale = sidechainConfig.whales[token];
        if (!whale) throw new Error("No BPT whale found");
        const tokenWhaleSigner = await impersonateAccount(whale);
        const tokenContract = MockERC20__factory.connect(token, tokenWhaleSigner.signer);
        await tokenContract.transfer(recipient, amount);
    };

    const deposit = async (pid: number, acc: Account, amount: BigNumber) => {
        const poolInfo = await sidechain.booster.poolInfo(pid);
        const lptoken = MockERC20__factory.connect(poolInfo.lptoken, acc.signer);
        const reward = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, acc.signer);
        await getBpt(poolInfo.lptoken, acc.address, amount);
        await lptoken.connect(acc.signer).approve(sidechain.booster.address, amount);
        await sidechain.booster.connect(acc.signer).depositAll(0, true);
        expect(await reward.balanceOf(acc.address)).gt(0);
    };

    const getRewards = async (pid: number, acc: Account) => {
        const poolInfo = await sidechain.booster.poolInfo(pid);
        const reward = BaseRewardPool4626__factory.connect(poolInfo.crvRewards, acc.signer);
        await reward.connect(acc.signer)["getReward()"]();
    };

    /* ---------------------------------------------------------------------
     * Tests
     * --------------------------------------------------------------------- */

    it("l2 coordinator is never underfunded", async () => {
        const pid = 0;

        const _accounts = await ethers.getSigners();
        const accounts = await Promise.all(
            _accounts.map(async acc => await impersonateAccount(await acc.getAddress(), true)),
        );

        await network.provider.request({
            method: "hardhat_setBalance",
            params: [deployer.address, "0x84595161401484A000000"],
        });

        await deposit(pid, accounts[0], simpleToExactAmount(1));
        await earmarkRewards(simpleToExactAmount(10), pid);
        await distribute();
        await increaseTime(ONE_WEEK.mul(2));
        await getRewards(pid, accounts[0]);
        await snapshotRate(1, pid, accounts);

        // Increate the total supply of AURA by update the storage slot this
        // will reduce the rate of AURA minting
        const ts = await phase2.cvx.totalSupply();
        await hre.network.provider.send("hardhat_setStorageAt", [
            phase2.cvx.address,
            "0x2",
            "0x" + ts.add(ts.div(2)).toHexString().slice(2).padStart(64, "0"),
        ]);

        await deposit(pid, accounts[1], simpleToExactAmount(1));
        await earmarkRewards(simpleToExactAmount(10), pid);
        await distribute();
        await increaseTime(ONE_WEEK.mul(2));
        await snapshotRate(2, pid, accounts);

        await getRewards(pid, accounts[0]);
        await getRewards(pid, accounts[1]);
        await snapshotRate(3, pid, accounts);
    });
});
