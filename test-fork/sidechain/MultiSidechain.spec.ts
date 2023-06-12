import { expect } from "chai";
import hre, { ethers, network } from "hardhat";
import { config as mainnetConfig } from "../../tasks/deploy/mainnet-config";
import { getAura, impersonateAccount, simpleToExactAmount, ZERO_ADDRESS } from "../../test-utils";
import {
    Account,
    AuraOFT,
    AuraProxyOFT,
    AuraToken,
    LZEndpointMock,
    LZEndpointMock__factory,
    SidechainConfig,
} from "../../types";
import {
    CanonicalPhase1Deployed,
    CanonicalPhase2Deployed,
    deploySidechainPhase1,
    deploySidechainPhase2,
    setTrustedRemoteCanonicalPhase1,
    SidechainPhase1Deployed,
    SidechainPhase2Deployed,
} from "../../scripts/deploySidechain";
import { Phase2Deployed } from "../../scripts/deploySystem";
import { setupLocalDeployment } from "./setupLocalDeployment";
import { BigNumber } from "ethers";

const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID__0 = 222;
const L2_CHAIN_ID__1 = 333;

const BLOCK_NUMBER = 17140000;
const CONFIG = mainnetConfig;

describe("Multi Sidechain AURA", () => {
    let deployer: Account;

    // phases
    let phase2: Phase2Deployed;

    // LayerZero endpoints
    let l1LzEndpoint: LZEndpointMock;
    let l2LzEndpoint__0: LZEndpointMock;
    let l2LzEndpoint__1: LZEndpointMock;

    // Canonical chain Contracts
    let canonical: CanonicalPhase1Deployed & CanonicalPhase2Deployed;

    // Sidechain Contracts
    let sidechain__0: SidechainPhase1Deployed & SidechainPhase2Deployed;
    let sidechainConfig__0: SidechainConfig;

    let sidechain__1: SidechainPhase1Deployed & SidechainPhase2Deployed;
    let sidechainConfig__1: SidechainConfig;

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

        const result = await setupLocalDeployment(hre, CONFIG, deployer, L1_CHAIN_ID, L2_CHAIN_ID__0);

        phase2 = result.phase2;
        l1LzEndpoint = result.l1LzEndpoint;
        l2LzEndpoint__0 = result.l2LzEndpoint;
        canonical = result.canonical;
        sidechain__0 = result.sidechain;
        sidechainConfig__0 = result.sidechainConfig;
        l2LzEndpoint__1 = await new LZEndpointMock__factory(deployer.signer).deploy(L2_CHAIN_ID__1);

        sidechainConfig__1 = {
            ...sidechainConfig__0,
            chainId: L2_CHAIN_ID__1,
            extConfig: {
                ...sidechainConfig__0.extConfig,
                canonicalChainId: L1_CHAIN_ID,
                lzEndpoint: l2LzEndpoint__1.address,
            },
            bridging: {
                l1Receiver: "0x0000000000000000000000000000000000000000",
                l2Sender: "0x0000000000000000000000000000000000000000",
                nativeBridge: "0x0000000000000000000000000000000000000000",
            },
            whales: CONFIG.whales,
        };

        const sidechainPhase1__1 = await deploySidechainPhase1(
            hre,
            deployer.signer,
            sidechainConfig__1.naming,
            sidechainConfig__1.multisigs,
            sidechainConfig__1.extConfig,
            sidechainConfig__1.bridging,
            canonical,
            L1_CHAIN_ID,
            "shenzhen",
        );
        const sidechainPhase2__1 = await deploySidechainPhase2(
            hre,
            deployer.signer,
            sidechainConfig__1.naming,
            sidechainConfig__1.multisigs,
            sidechainConfig__1.extConfig,
            canonical,
            sidechainPhase1__1,
            L1_CHAIN_ID,
            "shenzhen",
        );
        sidechain__1 = { ...sidechainPhase1__1, ...sidechainPhase2__1 };

        await getAura(phase2, CONFIG.addresses, deployer.address, simpleToExactAmount(1_000));

        // LayerZero setup
        await setTrustedRemoteCanonicalPhase1(
            canonical,
            sidechain__0,
            L2_CHAIN_ID__0,
            CONFIG.multisigs,
            sidechainConfig__0.bridging,
        );
        await setTrustedRemoteCanonicalPhase1(
            canonical,
            sidechain__1,
            L2_CHAIN_ID__1,
            CONFIG.multisigs,
            sidechainConfig__1.bridging,
        );

        // Canonical -> Sidechain
        await l1LzEndpoint.setDestLzEndpoint(sidechain__0.l2Coordinator.address, l2LzEndpoint__0.address);
        await l1LzEndpoint.setDestLzEndpoint(sidechain__0.auraOFT.address, l2LzEndpoint__0.address);
        await l1LzEndpoint.setDestLzEndpoint(sidechain__1.l2Coordinator.address, l2LzEndpoint__1.address);
        await l1LzEndpoint.setDestLzEndpoint(sidechain__1.auraOFT.address, l2LzEndpoint__1.address);

        // Sidechain -> Canonical
        await l2LzEndpoint__0.setDestLzEndpoint(canonical.l1Coordinator.address, l1LzEndpoint.address);
        await l2LzEndpoint__0.setDestLzEndpoint(canonical.auraProxyOFT.address, l1LzEndpoint.address);
        await l2LzEndpoint__1.setDestLzEndpoint(canonical.l1Coordinator.address, l1LzEndpoint.address);
        await l2LzEndpoint__1.setDestLzEndpoint(canonical.auraProxyOFT.address, l1LzEndpoint.address);

        // Sidechain -> Sidechain
        await l2LzEndpoint__0.setDestLzEndpoint(sidechain__1.auraOFT.address, l2LzEndpoint__1.address);
        await l2LzEndpoint__1.setDestLzEndpoint(sidechain__0.auraOFT.address, l2LzEndpoint__0.address);

        await sidechain__0.auraOFT
            .connect(result.dao.signer)
            .setTrustedRemote(
                L2_CHAIN_ID__1,
                ethers.utils.solidityPack(
                    ["address", "address"],
                    [sidechain__1.auraOFT.address, sidechain__0.auraOFT.address],
                ),
            );

        await sidechain__1.auraOFT
            .connect(result.dao.signer)
            .setTrustedRemote(
                L2_CHAIN_ID__0,
                ethers.utils.solidityPack(
                    ["address", "address"],
                    [sidechain__0.auraOFT.address, sidechain__1.auraOFT.address],
                ),
            );
    });

    afterEach(async () => {
        // total supply of auraOFTs == balance of auraProxyOFT
        const balanceOf__0 = await sidechain__0.auraOFT.balanceOf(deployer.address);
        const balanceOf__1 = await sidechain__1.auraOFT.balanceOf(deployer.address);
        const auraInBridge = await phase2.cvx.balanceOf(canonical.auraProxyOFT.address);

        const totalSidechain = balanceOf__0.add(balanceOf__1);
        expect(totalSidechain).eq(auraInBridge);
    });

    const bridgeAura = async (
        amount: BigNumber,
        chainId: number,
        balanceBefore: AuraOFT | AuraToken,
        balanceAfter: AuraOFT | AuraToken,
        sendFrom: AuraOFT | AuraProxyOFT,
    ) => {
        const balBefore = await balanceBefore.balanceOf(deployer.address);
        const l2BalBefore = await balanceAfter.balanceOf(deployer.address);
        expect(balBefore).gt(amount);

        await balanceBefore.connect(deployer.signer).approve(canonical.auraProxyOFT.address, amount);
        expect(await balanceBefore.allowance(deployer.address, canonical.auraProxyOFT.address)).gte(amount);

        await sendFrom
            .connect(deployer.signer)
            .sendFrom(deployer.address, chainId, deployer.address, amount, ZERO_ADDRESS, ZERO_ADDRESS, [], {
                value: NATIVE_FEE,
            });

        const balAfter = await balanceBefore.balanceOf(deployer.address);
        const l2BalAfter = await balanceAfter.balanceOf(deployer.address);
        expect(balBefore.sub(balAfter)).eq(amount);
        expect(l2BalAfter.sub(l2BalBefore)).eq(amount);
    };

    describe("sending AURA", () => {
        it("from L1 -> L2__0", async () => {
            await bridgeAura(
                simpleToExactAmount(100),
                L2_CHAIN_ID__0,
                phase2.cvx,
                sidechain__0.auraOFT,
                canonical.auraProxyOFT,
            );
        });
        it("from L1 -> L2__1", async () => {
            await bridgeAura(
                simpleToExactAmount(100),
                L2_CHAIN_ID__1,
                phase2.cvx,
                sidechain__1.auraOFT,
                canonical.auraProxyOFT,
            );
        });
        it("from L2__0 -> L2__1", async () => {
            await bridgeAura(
                simpleToExactAmount(10),
                L2_CHAIN_ID__1,
                sidechain__0.auraOFT,
                sidechain__1.auraOFT,
                sidechain__0.auraOFT,
            );
        });
        it("from L2__0 -> L1", async () => {
            await bridgeAura(
                simpleToExactAmount(10),
                L1_CHAIN_ID,
                sidechain__0.auraOFT,
                phase2.cvx,
                sidechain__0.auraOFT,
            );
        });
        it("from L2__1 -> L1", async () => {
            await bridgeAura(
                simpleToExactAmount(10),
                L1_CHAIN_ID,
                sidechain__1.auraOFT,
                phase2.cvx,
                sidechain__1.auraOFT,
            );
        });
    });
});
