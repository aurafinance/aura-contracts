import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

import { simpleToExactAmount } from "../../test-utils/math";
import { getSigner } from "../utils";
import { logContracts } from "../utils/deploy-utils";
import { config } from "../deploy/mainnet-config";
import "./claimRewards";

// Configs
const debug = true;
const DEFAULT_REDEEMABLE_AURA_SUPPLY = simpleToExactAmount(10_000_000);

task("deploy:windowPhase1")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const { deployWindowPhase1 } = await import("../../scripts/deployWindown");
        const deployer = await getSigner(hre);
        const phase2 = await config.getPhase2(deployer);

        const result = await deployWindowPhase1(
            hre,
            deployer,
            config.multisigs,
            { cvx: phase2.cvx, cvxCrv: phase2.cvxCrv },
            { redeemableAuraSupply: DEFAULT_REDEEMABLE_AURA_SUPPLY },
            debug,
            tskArgs.wait,
        );

        logContracts(result as unknown as { [key: string]: { address: string } });
    });

task("deploy:windowPhase2")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const { deployWindowPhase2, getWindownPhase1 } = await import("../../scripts/deployWindown");
        const deployer = await getSigner(hre);
        const phase2 = await config.getPhase2(deployer);
        const { auraRedemption, rAuraRedemption, auraBalRedemption } = await getWindownPhase1(deployer);

        const result = await deployWindowPhase2(
            hre,
            deployer,
            config.addresses,
            config.multisigs,
            { auraRedemption, rAuraRedemption, auraBalRedemption, voterProxy: phase2.voterProxy },
            debug,
            tskArgs.wait,
        );

        logContracts(result as unknown as { [key: string]: { address: string } });
    });

// Atomic deploy of all four wind-down contracts (3 redemptions + coordinator).
// The owner-only handoff (fund + finalize AuraRedemption, transfer redemption
// ownership to the coordinator) is intentionally NOT scripted here — those run
// from the DAO multisig as a separate Safe tx batch.
task("deploy:windown")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const phase2 = await config.getPhase2(deployer);

        const phase1 = await deployWindowPhase1(
            hre,
            deployer,
            config.multisigs,
            { cvx: phase2.cvx, cvxCrv: phase2.cvxCrv },
            { redeemableAuraSupply: DEFAULT_REDEEMABLE_AURA_SUPPLY },
            debug,
            tskArgs.wait,
        );

        const phase2Result = await deployWindowPhase2(
            hre,
            deployer,
            config.addresses,
            config.multisigs,
            { ...phase1, voterProxy: phase2.voterProxy },
            debug,
            tskArgs.wait,
        );

        logContracts({ ...phase1, ...phase2Result } as unknown as { [key: string]: { address: string } });
    });
