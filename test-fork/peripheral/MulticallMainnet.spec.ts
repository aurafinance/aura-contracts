import { expect } from "chai";
import hre, { network } from "hardhat";
import { CanonicalPhase1Deployed, CanonicalPhase2Deployed } from "scripts/deploySidechain";
import { Call3ValueStruct } from "types/generated/KeeperMulticall3";
import { Call3Struct } from "types/generated/Multicall3";

import { deployKeeperMulticall3 } from "../../scripts/deployPeripheral";
import { Phase2Deployed } from "../../scripts/deploySystem";
import { AuraBalVaultDeployed, config } from "../../tasks/deploy/mainnet-config";
import { lzChainIds } from "../../tasks/deploy/sidechain-constants";
import { chainIds } from "../../tasks/utils";
import { impersonateAccount, increaseTime, ONE_WEEK, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { simpleToExactAmount } from "../../test-utils/math";
import { Account } from "../../types/common";
import {
    AuraBalProxyOFT__factory,
    BridgeDelegateReceiver,
    BridgeDelegateReceiver__factory,
    Create2Factory__factory,
    KeeperMulticall3,
} from "../../types/generated";

const ALCHEMY_API_KEY = process.env.NODE_URL;

describe("KeeperMulticall3 - Mainnet", () => {
    let deployer: Account;
    let relayer: Account;
    let owner: Account;
    let sidechain: CanonicalPhase1Deployed & CanonicalPhase2Deployed;
    let compounder: AuraBalVaultDeployed;
    let phase2: Phase2Deployed;
    let keeperMulticall3: KeeperMulticall3;
    const sidechainId = 110;
    const nativeFee = simpleToExactAmount(1);
    const relayerAddress = "0xcC247CDe79624801169475C9Ba1f716dB3959B8f";

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: ALCHEMY_API_KEY,
                        blockNumber: 17669300,
                    },
                },
            ],
        });
        relayer = await impersonateAccount(relayerAddress, true);
        deployer = await impersonateAccount("0x30019eB135532bDdF2Da17659101cc000C73c8e4", true);
        phase2 = await config.getPhase2(deployer.signer);

        sidechain = config.getSidechain(deployer.signer);
        compounder = await config.getAuraBalVault(relayer.signer);

        owner = await impersonateAccount(await sidechain.auraBalProxyOFT.owner(), true);

        const create2Factory = await new Create2Factory__factory(deployer.signer).deploy();
        await create2Factory.updateDeployer(relayerAddress, true);

        ({ keeperMulticall3 } = await deployKeeperMulticall3(hre, relayer.signer, relayer.address));
    });
    it("Fund the multicall contract ", async () => {
        await relayer.signer.sendTransaction({
            to: keeperMulticall3.address,
            value: nativeFee,
        });
    });
    it("set authorised harvesters", async () => {
        await sidechain.auraBalProxyOFT
            .connect(owner.signer)
            .updateAuthorizedHarvesters(keeperMulticall3.address, true);
    });
    it("set authorised keeper", async () => {
        await keeperMulticall3.updateAuthorizedKeepers(relayer.address, true);
    });
    it("processClaimable", async () => {
        await increaseTime(ONE_WEEK);
        await compounder.vault.connect(relayer.signer)["harvest(uint256)"](1);
    });
    it("auraBalProxyOFT.harvest via multicall", async () => {
        const encodedHarvest = AuraBalProxyOFT__factory.createInterface().encodeFunctionData("harvest", [[1], 1]);
        const encodedProcessClaimable = (c: { tokenAddress: string; srcChainId: number }) =>
            AuraBalProxyOFT__factory.createInterface().encodeFunctionData("processClaimable", [
                c.tokenAddress,
                c.srcChainId,
                ZERO_ADDRESS,
            ]);

        const buildHarvestCall = () => ({
            target: sidechain.auraBalProxyOFT.address,
            allowFailure: false,
            value: 0,
            callData: encodedHarvest,
        });

        const buildProcessClaimableCall = (c: { tokenAddress: string; srcChainId: number }) => ({
            target: sidechain.auraBalProxyOFT.address,
            allowFailure: false, // Edge scenario change to true, as one token could have ZERO claimable rewards
            value: nativeFee.div(5),
            callData: encodedProcessClaimable(c),
        });

        const harvest = buildHarvestCall();
        const processClaimables: Array<Call3ValueStruct> = [
            ...[
                { tokenAddress: phase2.cvx.address, srcChainId: sidechainId },
                { tokenAddress: phase2.cvxCrv.address, srcChainId: sidechainId },
            ].map(buildProcessClaimableCall),
        ];

        // Test harvest all chains (1), process all claimable permutations (token - chain)
        const tx = await keeperMulticall3.connect(relayer.signer).aggregate3Funded([harvest, ...processClaimables]);
        await expect(tx).to.emit(sidechain.auraBalProxyOFT, "Harvest").withArgs(keeperMulticall3.address, 1);
        await expect(tx).to.emit(sidechain.auraBalProxyOFT, "SendToChain");
    });

    it("should revert when not called by keeper", async () => {
        const encodedHarvest = AuraBalProxyOFT__factory.createInterface().encodeFunctionData("harvest", [[1], 1]);
        const buildHarvestCall = () => ({
            target: sidechain.auraBalProxyOFT.address,
            allowFailure: false,
            value: 0,
            callData: encodedHarvest,
        });

        await expect(
            keeperMulticall3.connect(deployer.signer).aggregate3Funded([buildHarvestCall()]),
        ).to.be.revertedWith("!keeper");
    });
    describe("BridgeDelegateReceivers", async () => {
        let bridgeDelegateArb: BridgeDelegateReceiver;
        let bridgeDelegateOpt: BridgeDelegateReceiver;
        before("setup", async () => {
            const bridgeDelegateArbAddress = await sidechain.l1Coordinator.bridgeDelegates(
                lzChainIds[chainIds.arbitrum],
            );
            const bridgeDelegateOptAddress = await sidechain.l1Coordinator.bridgeDelegates(
                lzChainIds[chainIds.optimism],
            );
            bridgeDelegateArb = BridgeDelegateReceiver__factory.connect(bridgeDelegateArbAddress, deployer.signer);
            bridgeDelegateOpt = BridgeDelegateReceiver__factory.connect(bridgeDelegateOptAddress, deployer.signer);
        });

        it("transfer ownership to multicall", async () => {
            const bridgeDelegateArbOwner = await impersonateAccount(await bridgeDelegateArb.owner());
            const bridgeDelegateOptOwner = await impersonateAccount(await bridgeDelegateOpt.owner());

            await bridgeDelegateArb.connect(bridgeDelegateArbOwner.signer).transferOwnership(keeperMulticall3.address);
            await bridgeDelegateOpt.connect(bridgeDelegateOptOwner.signer).transferOwnership(keeperMulticall3.address);

            expect(await bridgeDelegateArb.owner(), "owner").to.be.eq(keeperMulticall3.address);
            expect(await bridgeDelegateOpt.owner(), "owner").to.be.eq(keeperMulticall3.address);
        });

        it("settleFeeDebt on multiple chains", async () => {
            const transferOwnerships: Call3Struct[] = [
                {
                    target: bridgeDelegateArb.address,
                    allowFailure: false,
                    callData: BridgeDelegateReceiver__factory.createInterface().encodeFunctionData("settleFeeDebt", [
                        ZERO,
                    ]),
                },
                {
                    target: bridgeDelegateOpt.address,
                    allowFailure: false,
                    callData: BridgeDelegateReceiver__factory.createInterface().encodeFunctionData("settleFeeDebt", [
                        ZERO,
                    ]),
                },
            ];

            const tx = await keeperMulticall3.aggregate3(transferOwnerships);

            await expect(tx).to.emit(bridgeDelegateArb, "SettleFeeDebt");
            await expect(tx).to.emit(bridgeDelegateOpt, "SettleFeeDebt");
        });

        it("transfer ownership back to an oea", async () => {
            const transferOwnerships: Call3Struct[] = [
                {
                    target: bridgeDelegateArb.address,
                    allowFailure: false,
                    callData: BridgeDelegateReceiver__factory.createInterface().encodeFunctionData(
                        "transferOwnership",
                        [relayerAddress],
                    ),
                },
                {
                    target: bridgeDelegateOpt.address,
                    allowFailure: false,
                    callData: BridgeDelegateReceiver__factory.createInterface().encodeFunctionData(
                        "transferOwnership",
                        [relayerAddress],
                    ),
                },
            ];
            await keeperMulticall3.aggregate3(transferOwnerships);

            expect(await bridgeDelegateArb.owner(), "owner").to.be.eq(relayerAddress);
            expect(await bridgeDelegateOpt.owner(), "owner").to.be.eq(relayerAddress);
        });
    });
});
