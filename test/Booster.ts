import { ethers } from "hardhat";
import { expect } from "chai";
import deployBooster from "../scripts/deployBooster";
import deployMocks, { DeployMocksResult } from "../scripts/deployMocks";
import { Booster, PoolManagerV3 } from "types";
import { Signers } from "./types";
import { Signer } from "ethers";

type Pool = {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    stash: string;
    shutdown: boolean;
};

const erc20ContractName = "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol:IERC20";

describe("PoolManagerV3", () => {
    let accounts: Signer[];
    let booster: Booster;
    let poolManager: PoolManagerV3;
    let mocks: DeployMocksResult;
    let pool: Pool;

    before(async () => {
        accounts = await ethers.getSigners();

        const deployer = accounts[0];
        const deployerAddress = await deployer.getAddress();

        mocks = await deployMocks(accounts[0]);

        const contracts = await deployBooster(accounts[0], {
            crv: mocks.crv.address,
            crvMinter: mocks.crv.address,
            votingEscrow: mocks.votingEscrow.address,
            gaugeController: mocks.voting.address,
            crvRegistry: mocks.registry.address,
            voteOwnership: mocks.voting.address,
            voteParameter: mocks.voting.address,
            feeDistro: mocks.feeDistro.address,
        });

        booster = contracts.booster;
        poolManager = contracts.poolManager;

        // add mock gauge to the booster
        const gauge = mocks.gauge;
        const tx = await poolManager["addPool(address)"](gauge.address);
        await tx.wait();

        pool = await booster.poolInfo("0");

        // transfer LP tokens to accounts
        const balance = await mocks.lptoken.balanceOf(deployerAddress);
        for (const account of accounts) {
            const accountAddress = await account.getAddress();
            const share = balance.div(accounts.length.toString());
            const tx = await mocks.lptoken.transfer(accountAddress, share);
            await tx.wait();
        }
    });

    it("@method deposit", async () => {
        const alice = accounts[1];
        const aliceAddress = await alice.getAddress();

        const stake = false;
        const amount = ethers.utils.parseEther("10");
        let tx = await mocks.lptoken.connect(alice).approve(booster.address, amount);
        await tx.wait();

        tx = await booster.connect(alice).deposit("0", amount, stake);
        await tx.wait();

        const depositToken = await ethers.getContractAt(erc20ContractName, pool.token);
        const balance = await depositToken.balanceOf(aliceAddress);

        expect(balance.toString()).to.equal(amount.toString());
    });
});
