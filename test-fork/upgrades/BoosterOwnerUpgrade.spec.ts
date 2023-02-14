import hre, { network } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";

import { Account, BoosterOwnerSecondary, BoosterOwnerSecondary__factory, IERC20__factory } from "../../types";
import { impersonateAccount, increaseTime, ZERO_ADDRESS } from "../../test-utils";

import { config } from "../../tasks/deploy/mainnet-config";
import { Phase6Deployed } from "../../scripts/deploySystem";
import { deployContract } from "../../tasks/utils";

describe("Booster Owner Upgrade", () => {
    let protocolDao: Account;
    let deployer: Signer;
    let phase6: Phase6Deployed;

    let boosterOwnerSecondary: BoosterOwnerSecondary;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 16177700,
                    },
                },
            ],
        });

        const signers = await hre.ethers.getSigners();
        deployer = signers[0];

        protocolDao = await impersonateAccount(config.multisigs.daoMultisig);
        phase6 = await config.getPhase6(protocolDao.signer);
    });

    it("deploy booster owner secondary", async () => {
        boosterOwnerSecondary = await deployContract(
            hre,
            new BoosterOwnerSecondary__factory(deployer),
            "BoosterOwnerSecondary",
            [config.multisigs.daoMultisig, phase6.boosterOwner.address, phase6.booster.address],
            {},
            false,
        );

        const poolLength = await phase6.booster.poolLength();
        expect(await boosterOwnerSecondary.oldPidCheckpoint()).eq(poolLength.sub(1));
        expect(await boosterOwnerSecondary.booster()).eq(phase6.booster.address);
        expect(await boosterOwnerSecondary.boosterOwner()).eq(phase6.boosterOwner.address);
    });
    it("Transfer ownership to BoosterOwnerSecondary", async () => {
        await phase6.boosterOwner.transferOwnership(boosterOwnerSecondary.address);
        expect(await phase6.boosterOwner.pendingowner()).eq(boosterOwnerSecondary.address);
        await boosterOwnerSecondary.acceptOwnershipBoosterOwner();
        expect(await phase6.boosterOwner.owner()).eq(boosterOwnerSecondary.address);
    });
    it("can force shutdown system", async () => {
        await phase6.poolManagerSecondaryProxy.connect(protocolDao.signer).shutdownSystem();
        await boosterOwnerSecondary.connect(protocolDao.signer).queueForceShutdown();
        await increaseTime(await phase6.boosterOwner.FORCE_DELAY());
        await increaseTime(1);
        await boosterOwnerSecondary.connect(protocolDao.signer).forceShutdownSystem();
        expect(await phase6.booster.isShutdown()).eq(true);
    });
});
