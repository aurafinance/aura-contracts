import { expect } from "chai";
import hre, { ethers, network } from "hardhat";
import { Account } from "types/common";
import { Call3ValueStruct } from "types/generated/PayableMulticall";
import { SidechainPhaseDeployed } from "types/sidechain-types";

import { deployPayableMulticall } from "../../../scripts/deployPeripheral";
import { config } from "../../../tasks/deploy/base-config";
import { impersonateAccount, ZERO, ZERO_ADDRESS } from "../../../test-utils";
import { simpleToExactAmount } from "../../../test-utils/math";
import {
    BoosterLite__factory,
    Create2Factory__factory,
    ERC20,
    ERC20__factory,
    L2Coordinator__factory,
    PayableMulticall,
} from "../../../types/generated";

const ALCHEMY_API_KEY = process.env.NODE_URL;
const relayerAddress = "0x64Cf0ad5e089488cDD0cab98b545f890b0939479"; //base defender
describe("Multichain - Sidechain", () => {
    let deployer: Account;
    let relayer: Account;
    let token: ERC20;
    let sidechain: SidechainPhaseDeployed;
    let payableMulticall: PayableMulticall;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: ALCHEMY_API_KEY,
                        blockNumber: 7541000, // BASE - Block
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

        ({ payableMulticall } = await deployPayableMulticall(hre, relayer.signer, config.extConfig));
    });

    it("earmarkRewards via multicall", async () => {
        const nativeFee = simpleToExactAmount(1);

        const tokenBalanceBefore = await token.balanceOf(payableMulticall.address);
        const balanceBefore = await ethers.provider.getBalance(payableMulticall.address);

        const encodeEarmarkRewards = (pid: number) =>
            BoosterLite__factory.createInterface().encodeFunctionData("earmarkRewards", [pid, ZERO_ADDRESS]);
        const buildEarmarkRewardCall = (pid: number) => ({
            target: sidechain.booster.address,
            allowFailure: false,
            value: ZERO,
            callData: encodeEarmarkRewards(pid),
        });

        const notifyFeesCall: Call3ValueStruct = {
            target: sidechain.l2Coordinator.address,
            allowFailure: false,
            value: nativeFee.div(10),
            callData: L2Coordinator__factory.createInterface().encodeFunctionData("notifyFees", [ZERO_ADDRESS]),
        };

        const earmarkRewards: Array<Call3ValueStruct> = [...[0, 1, 2].map(buildEarmarkRewardCall)];

        // Test earmarkRewards
        await payableMulticall.aggregate3Value([...earmarkRewards, notifyFeesCall], { value: nativeFee.div(10) });

        const balanceAfter = await ethers.provider.getBalance(payableMulticall.address);
        const tokenBalanceAfter = await token.balanceOf(payableMulticall.address);

        expect(balanceAfter, "eth balance").to.be.gt(balanceBefore);
        expect(tokenBalanceAfter, "token balance").to.be.gt(tokenBalanceBefore);

        // Recover all tokens from the multicall
        const tokenBalanceRelayerBefore = await token.balanceOf(relayer.address);
        const balanceRelayerBefore = await ethers.provider.getBalance(relayer.address);

        await payableMulticall.recoverERC20(token.address, relayer.address);
        const tokenBalanceMulticallAfter = await token.balanceOf(payableMulticall.address);
        const tokenBalanceRelayerAfter = await token.balanceOf(relayer.address);

        expect(tokenBalanceMulticallAfter, "token balance").to.be.eq(ZERO);
        expect(tokenBalanceRelayerAfter, "token balance").to.be.eq(tokenBalanceRelayerBefore.add(tokenBalanceAfter));

        // Recover all eth from the multicall
        await payableMulticall.recoverEthBalance(relayer.address);
        const balanceMulticallAfter = await ethers.provider.getBalance(payableMulticall.address);
        const balanceRelayerAfter = await ethers.provider.getBalance(relayer.address);

        expect(balanceMulticallAfter, "eth balance").to.be.eq(ZERO);
        expect(balanceRelayerAfter, "eth balance").to.be.gt(balanceRelayerBefore);
    });
});
