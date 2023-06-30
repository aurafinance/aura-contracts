import { expect } from "chai";
import { BigNumber } from "ethers";
import hre, { ethers } from "hardhat";

import { Account, TokenDrip } from "../../types";
import { ONE_DAY } from "../../test-utils/constants";
import { config } from "../../tasks/deploy/mainnet-config";
import { Phase2Deployed } from "../../scripts/deploySystem";
import { getTimestamp, impersonateAccount, simpleToExactAmount } from "../../test-utils";
import { CanonicalPhase1Deployed, CanonicalPhase2Deployed, deployTokenDrip } from "../../scripts/deploySidechain";

describe("TokenDrip", () => {
    let deployer: Account;

    let tokenDrip: TokenDrip;
    let canonical: CanonicalPhase1Deployed & CanonicalPhase2Deployed;
    let phase2: Phase2Deployed;

    let initialLastUpdated: BigNumber;
    const initialTarget = simpleToExactAmount(10_000);
    const initialRate = simpleToExactAmount(2_000).div(ONE_DAY.mul(30)); // 2,000 every 30 days

    before(async () => {
        await hre.network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 17592164,
                    },
                },
            ],
        });

        await impersonateAccount(config.multisigs.daoMultisig);
        const signers = await ethers.getSigners();
        deployer = await impersonateAccount(await signers[0].getAddress());

        phase2 = await config.getPhase2(deployer.signer);
        canonical = config.getSidechain(deployer.signer);

        initialLastUpdated = await getTimestamp();
        const result = await deployTokenDrip(phase2, config.multisigs, canonical, hre, deployer.signer);
        tokenDrip = result.tokenDrip;
    });

    describe("setup", () => {
        it("has the correct config", async () => {
            // Immutables
            expect(await tokenDrip.token()).eq(phase2.cvx.address);
            expect(await tokenDrip.to()).eq(canonical.l1Coordinator.address);
            // Mutables
            expect(await tokenDrip.lastUpdated()).gte(initialLastUpdated);
            expect(await tokenDrip.current()).eq(0);
            expect(await tokenDrip.target()).eq(initialTarget);
            expect(await tokenDrip.rate()).eq(initialRate);
            expect(await tokenDrip.owner()).eq(config.multisigs.daoMultisig);
        });
    });
});
