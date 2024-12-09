import { expect } from "chai";
import { Signer } from "ethers";
import hre, { network } from "hardhat";
import { deployHHRewardsClaimForwarderModule } from "../../scripts/deployPeripheral";
import { Phase3Deployed } from "../../scripts/deploySystem";
import { config } from "../../tasks/deploy/mainnet-config";
import { impersonate } from "../../test-utils";
import { HHRewardsClaimForwarderModule, ISafe, ISafe__factory, StashRewardDistro } from "../../types";

describe("HHRewardsClaimForwarderModule", () => {
    let incentivesMultisig: Signer;
    let deployer: Signer;
    let deployerAddress: string;
    let contracts: Phase3Deployed;
    let stashRewardDistro: StashRewardDistro;
    let hhRewardsClaimForwarderModule: HHRewardsClaimForwarderModule;
    let safe: ISafe;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 21335583,
                    },
                },
            ],
        });
        hre.tracer.enabled = false;
        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        deployer = await impersonate(deployerAddress, true);
        incentivesMultisig = await impersonate(config.multisigs.incentivesMultisig, true);
        contracts = await config.getPhase4(deployer);
        ({ stashRewardDistro } = config.getGaugeVoteRewards(deployer));
        safe = ISafe__factory.connect(config.multisigs.incentivesMultisig, incentivesMultisig);
    });

    it("deploys module", async () => {
        ({ hhRewardsClaimForwarderModule } = await deployHHRewardsClaimForwarderModule(
            hre,
            deployer,
            config.multisigs,
            {
                cvx: contracts.cvx,
                stashRewardDistro,
            },
        ));

        expect(await hhRewardsClaimForwarderModule.owner(), "owner").to.be.eq(config.multisigs.incentivesMultisig);
        expect(await hhRewardsClaimForwarderModule.safeWallet(), "safeWallet").to.be.eq(
            config.multisigs.incentivesMultisig,
        );
        expect(await hhRewardsClaimForwarderModule.cvx(), "safeWallet").to.be.eq(contracts.cvx.address);
    });

    it("configures the module", async () => {
        expect(await safe.isModuleEnabled(hhRewardsClaimForwarderModule.address), "isEnabled").to.be.eq(false);
        await safe.enableModule(hhRewardsClaimForwarderModule.address);
        expect(await safe.isModuleEnabled(hhRewardsClaimForwarderModule.address), "isEnabled").to.be.eq(true);
    });
    it("fails if keeper is not the caller", async () => {
        const authorizedKeepers = await hhRewardsClaimForwarderModule.authorizedKeepers(await deployer.getAddress());
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(false);
        await expect(hhRewardsClaimForwarderModule.connect(deployer).claimAndForwardRewards([])).to.be.revertedWith(
            "!keeper",
        );
    });
    it("only keeper can execute task", async () => {
        const authorizedKeepers = await hhRewardsClaimForwarderModule.authorizedKeepers(
            config.multisigs.defender.keeperMulticall3,
        );
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
        const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
        const claims = [
            {
                identifier: "0x7694349027ad3066bb3ee879dfc6401b01a4d41d9acbff595b003c287c8f1a7c",
                account: "0x21aed3a7a1c34cd88b8a39dbdae042befbf947ff",
                amount: "30650831756773673774208",
                merkleProof: [
                    "0xd421d72ed94d1487dfb6e3f04cf20f7a20363bc9a1b0b5ed3bbe9ee1962c5075",
                    "0xaa3c4ba132cf759796d4c31734b02fc5aaf754472c67dbede4cbc0190e1776f6",
                    "0xbcc4b7c72f830267346eb9ac39a78ebc6489b4356dfd22c08094e5f6fbc2816e",
                    "0x91a41ba45dce65c68941e427193dd6a31795710a59eae876766388b4085dfb2e",
                    "0xdbbdcc448ac9de796b92344b0b52dc98a65034a2227b7d497430302da5fa84b8",
                    "0x915d55a663781e37d951b73e2bff93d97fca0156a41d199b23168447c28648ca",
                    "0x4c23cb18004c40340d0156ee1799086a955782885690c976b7fa646028c4d3b8",
                ],
            },
        ];

        const tx = await hhRewardsClaimForwarderModule.connect(keeper).claimAndForwardRewards(claims);
        await tx.wait();
    });
});
