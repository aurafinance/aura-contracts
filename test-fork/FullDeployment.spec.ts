import { simpleToExactAmount } from "../test-utils/math";
import hre, { network } from "hardhat";
import { expect } from "chai";
import { ICurveVoteEscrow__factory, MockERC20__factory, MockWalletChecker__factory } from "../types/generated";
import { getSigner, waitForTx } from "../tasks/utils";
import { impersonate, impersonateAccount } from "../test-utils";
import { Signer } from "ethers";
import { deployPhase1, deployPhase2, Phase1Deployed, Phase2Deployed } from "../scripts/deploySystem";
import { config } from "../tasks/deploy/mainnet-config";

describe("Full Deployment", () => {
    let deployer: Signer;
    let deployerAddress: string;

    let phase1: Phase1Deployed;
    let phase2: Phase2Deployed;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 14533290,
                    },
                },
            ],
        });

        deployer = await getSigner(hre);
        deployerAddress = await deployer.getAddress();

        await setupBalances();
    });

    const setupBalances = async () => {
        // crvBPT for initialLock && cvxCrv/crvBPT pair
        const tokenWhaleSigner = await impersonateAccount(config.addresses.tokenWhale);
        const crvBpt = MockERC20__factory.connect(config.addresses.tokenBpt, tokenWhaleSigner.signer);
        let tx = await crvBpt.transfer(deployerAddress, simpleToExactAmount(250));
        await waitForTx(tx, true);

        // weth for LBP creation
        const wethWhaleSigner = await impersonateAccount(config.addresses.wethWhale);
        const weth = await MockERC20__factory.connect(config.addresses.weth, wethWhaleSigner.signer);
        tx = await weth.transfer(deployerAddress, simpleToExactAmount(100));
        await waitForTx(tx, true);
    };

    describe("Phase 1", () => {
        before(async () => {
            // PHASE 1
            phase1 = await deployPhase1(hre, deployer, config.addresses, false, true);

            // POST-PHASE-1
            // Whitelist the VoterProxy in the Curve system
            const checker = await new MockWalletChecker__factory(deployer).deploy();
            await checker.approveWallet(phase1.voterProxy.address);
            const admin = await impersonate("0x8f42adbba1b16eaae3bb5754915e0d06059add75");
            const ve = ICurveVoteEscrow__factory.connect(config.addresses.votingEscrow, admin);
            await ve.commit_smart_wallet_checker(checker.address);
            await ve.apply_smart_wallet_checker();
        });
        it("has correct config");
    });

    describe("Phase 2", () => {
        before(async () => {
            // PHASE 2
            phase2 = await deployPhase2(
                hre,
                deployer,
                phase1,
                config.distroList,
                config.multisigs,
                config.naming,
                config.addresses,
                true,
            );
        });
        it("has correct config", async () => {
            expect(await phase2.cvx.totalSupply()).eq(simpleToExactAmount(50000000));
        });
    });
});
