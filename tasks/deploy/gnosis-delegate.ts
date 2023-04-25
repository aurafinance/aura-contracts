import { assert } from "chai";
import { ethers } from "ethers";
import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";
import { Account, ERC20, MockERC20__factory, GnosisBridgeSender, GnosisBridgeSender__factory } from "../../types";
import { getSigner } from "../utils";
import { chainIds } from "../../hardhat.config";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { deployGnosisBridgeSender } from "../../scripts/deployBridgeDelegates";
import { waitForTx } from "../../tasks/utils";
import { logContracts } from "../utils/deploy-utils";

const debug = true;
let waitForBlocks = 3;

task("deploy:gnosis:sender").setAction(async function (tskArgs: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const waitForBlocks = tskArgs.wait;
    const balOnGno: string = "0x7eF541E2a22058048904fE5744f9c7E4C57AF717";
    const bridge: string = "0xf6A78083ca3e2a662D6dd1703c939c8aCE2e268d";
    let delegate = await deployGnosisBridgeSender(hre, deployer, bridge, balOnGno);
    console.log(delegate.address);
});

task("deploy:gnosis:setL1ReceiverAndForwardBal").setAction(async function (tskArgs: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const waitForBlocks = tskArgs.wait;
    const balOnGno: string = "0x7eF541E2a22058048904fE5744f9c7E4C57AF717";
    const dao: string = "0x5feA4413E3Cc5Cf3A29a49dB41ac0c24850417a0";
    const delegate: string = "0x2F70BF8d130aace466abBcbd21d34BB1A6a12c5d";
    let crv = MockERC20__factory.connect(balOnGno, deployer);
    let delegateSC = GnosisBridgeSender__factory.connect(delegate, deployer);

    let tx = await delegateSC.setL1Receiver(dao);
    await tx.wait();

    tx = await delegateSC.send(dao, await crv.balanceOf(delegateSC.address));
    await tx.wait();
});
