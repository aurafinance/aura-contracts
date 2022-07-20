import { ethers, network } from "hardhat";
import { expect } from "chai";
import {
    Booster,
    BoosterOwner,
    IERC20,
    IERC20__factory,
    IFeeDistributor,
    IFeeDistributor__factory,
    VoterProxy,
} from "../types/generated";
import { impersonateAccount, simpleToExactAmount } from "../test-utils";
import { Signer } from "ethers";
import { config } from "../tasks/deploy/mainnet-config";
import { _TypedDataEncoder } from "ethers/lib/utils";

const newFeeDistro = "0xD3cf852898b21fc233251427c2DC93d3d604F3BB";

describe("FeeDistroUpdate", () => {
    let protocolDao: Signer;
    let boosterOwner: BoosterOwner;
    let distributor: IFeeDistributor;
    let voterProxy: VoterProxy;
    let bal: IERC20;
    let feeToken: IERC20;
    let booster: Booster;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15178682,
                    },
                },
            ],
        });

        await impersonateAccount(config.multisigs.daoMultisig);
        protocolDao = await ethers.getSigner(config.multisigs.daoMultisig);

        const phase2 = await config.getPhase2(protocolDao);
        boosterOwner = phase2.boosterOwner;
        voterProxy = phase2.voterProxy;
        booster = phase2.booster;

        distributor = IFeeDistributor__factory.connect(newFeeDistro, protocolDao);
        bal = IERC20__factory.connect(config.addresses.token, protocolDao);
        feeToken = IERC20__factory.connect(config.addresses.feeToken, protocolDao);
    });

    describe("update fee distro", () => {
        it("deposit tokens into new feeDistro", async () => {
            const balWhaleAddress = "0xcEacc82ddCdB00BFE19A9D3458db3e6b8aEF542B";

            await impersonateAccount(balWhaleAddress);
            await impersonateAccount(config.addresses.feeTokenWhale);

            const balWhale = await ethers.getSigner(balWhaleAddress);
            const feeWhale = await ethers.getSigner(config.addresses.feeTokenWhale);

            const amount = simpleToExactAmount(100);

            await bal.connect(balWhale).approve(distributor.address, amount);
            await feeToken.connect(feeWhale).approve(distributor.address, amount);

            await distributor.connect(balWhale).depositToken(config.addresses.token, amount);
            await distributor.connect(feeWhale).depositToken(config.addresses.feeToken, amount);
        });
        it("update fee distro contracts", async () => {
            await boosterOwner.setFeeInfo(config.addresses.token, newFeeDistro);
            await boosterOwner.setFeeInfo(config.addresses.feeToken, newFeeDistro);
        });
        it("set hash on voter proxy for claim", async () => {
            const domain = {
                name: "FeeDistributor",
                version: "1",
                chainId: (await distributor.provider.getNetwork()).chainId,
                verifyingContract: distributor.address,
            };

            const types = {
                SetOnlyCallerCheck: [
                    { name: "user", type: "address" },
                    { name: "enabled", type: "bool" },
                    { name: "nonce", type: "uint256" },
                ],
            };

            const values = {
                user: voterProxy.address,
                enabled: true,
                nonce: (await distributor.getNextNonce(voterProxy.address)).toString(),
            };

            const voteDelegateAddress = await booster.voteDelegate();
            await impersonateAccount(voteDelegateAddress);
            const voteDelegate = await ethers.getSigner(voteDelegateAddress);

            const hash = _TypedDataEncoder.hash(domain, types, values);
            await booster.connect(voteDelegate).setVote(hash, true);

            const isValid = await voterProxy.isValidSignature(hash, "0x");
            expect(isValid).eq("0x1626ba7e");

            await distributor.setOnlyCallerCheckWithSignature(voterProxy.address, true, "0x");
        });
        xit("add rewards to fee distro and fast forward 1 week", async () => {});
        xit("only voter proxy can claim rewards", async () => {
            const resp = distributor.claimToken(voterProxy.address, config.addresses.token);
            expect(resp).to.be.revertedWith("fucked");
        });
        xit("claim rewards via earmarkRewards", async () => {});
    });
});
