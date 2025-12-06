import { expect } from "chai";
import hre, { ethers, network } from "hardhat";
import { Account } from "types/common";
import { Call3ValueStruct } from "types/generated/KeeperMulticall3";
import { SidechainPhaseDeployed } from "types/sidechain-types";

import { deployKeeperMulticall3 } from "../../../scripts/deploySidechain";
import { config } from "../../../tasks/deploy/arbitrum-config";
import { impersonateAccount, ZERO, ZERO_ADDRESS } from "../../../test-utils";
import { simpleToExactAmount } from "../../../test-utils/math";
import {
    BoosterLite__factory,
    Create2Factory__factory,
    ERC20,
    ERC20__factory,
    KeeperMulticall3,
} from "../../../types/generated";

const RPC_URL = process.env.NODE_URL;
const relayerAddress = "0xFC3F4e28D914dA71447d94829C48b1248c7C0b46";
describe("Multichain - Sidechain", () => {
    let deployer: Account;
    let relayer: Account;
    let token: ERC20;
    let sidechain: SidechainPhaseDeployed;
    let keeperMulticall3: KeeperMulticall3;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: RPC_URL,
                        blockNumber: 103380000,
                    },
                },
            ],
        });
        relayer = await impersonateAccount(relayerAddress, true);
        deployer = await impersonateAccount("0xb07d2d6a03f2d4878dc1680f8581e871dae47494", true);
        sidechain = config.getSidechain(deployer.signer);

        const create2Factory = Create2Factory__factory.connect(config.extConfig.create2Factory, deployer.signer);
        await create2Factory.updateDeployer(relayerAddress, true);
        token = ERC20__factory.connect(config.extConfig.token, deployer.signer);

        ({ keeperMulticall3 } = await deployKeeperMulticall3(hre, relayer.signer, config.extConfig));
    });

    it("keeperMulticall3 properties", async () => {
        expect(await keeperMulticall3.owner(), "owner ").to.be.eq(relayer.address);
    });
    it("set authorised keeper", async () => {
        await keeperMulticall3.updateAuthorizedKeepers(relayer.address, true);
    });
    it("earmarkRewards via multicall", async () => {
        const nativeFee = simpleToExactAmount(1);
        await relayer.signer.sendTransaction({
            to: keeperMulticall3.address,
            value: nativeFee,
        });

        const tokenBalanceBefore = await token.balanceOf(keeperMulticall3.address);
        const balanceBefore = await ethers.provider.getBalance(keeperMulticall3.address);

        const encondeEarmarkRewards = (pid: number) =>
            BoosterLite__factory.createInterface().encodeFunctionData("earmarkRewards", [pid, ZERO_ADDRESS]);
        const buildEarmarkRewardCall = (pid: number) => ({
            target: sidechain.booster.address,
            allowFailure: false,
            value: nativeFee.div(10),
            callData: encondeEarmarkRewards(pid),
        });

        const earmarkRewards: Array<Call3ValueStruct> = [...[0, 1, 2, 3, 4, 5, 6, 7].map(buildEarmarkRewardCall)];

        // Test earmarkRewards
        await keeperMulticall3.aggregate3Funded(earmarkRewards);

        const balanceAfter = await ethers.provider.getBalance(keeperMulticall3.address);
        const tokenBalanceAfter = await token.balanceOf(keeperMulticall3.address);

        expect(balanceAfter, "eth balance").to.be.lt(balanceBefore);
        expect(tokenBalanceAfter, "token balance").to.be.gt(tokenBalanceBefore);

        // Recover all tokens from the multicall
        const tokenBalanceRelayerBefore = await token.balanceOf(relayer.address);

        await keeperMulticall3.recoverERC20(token.address, tokenBalanceAfter);
        const tokenBalanceMulticallAfter = await token.balanceOf(keeperMulticall3.address);
        const tokenBalanceRelayerAfter = await token.balanceOf(relayer.address);

        expect(tokenBalanceMulticallAfter, "eth balance").to.be.eq(ZERO);
        expect(tokenBalanceRelayerAfter, "eth balance").to.be.eq(tokenBalanceRelayerBefore.add(tokenBalanceAfter));
    });
});
