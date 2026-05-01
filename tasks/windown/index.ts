import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

import { simpleToExactAmount } from "../../test-utils/math";
import { getSigner } from "../utils";
import { logContracts } from "../utils/deploy-utils";
import { config } from "../deploy/mainnet-config";
import { deployWindowPhase1, deployWindowPhase2, getWindownPhase1 } from "../../scripts/deployWindown";

// Configs
const debug = true;

task("deploy:windowPhase1")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const phase2 = await config.getPhase2(deployer);
        const redeemableAuraSupply = simpleToExactAmount(10_000_000);

        const result = await deployWindowPhase1(
            hre,
            deployer,
            config.multisigs,
            { cvx: phase2.cvx, cvxCrv: phase2.cvxCrv },
            { redeemableAuraSupply },
            debug,
            tskArgs.wait,
        );

        logContracts(result as unknown as { [key: string]: { address: string } });
    });

task("deploy:windowPhase2")
    .addParam("wait", "How many blocks to wait")
    .setAction(async function (tskArgs: TaskArguments, hre) {
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
