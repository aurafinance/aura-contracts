import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
    AuraBalStrategy,
    AuraBalStrategy__factory,
    AuraBalVault,
    AuraBalVault__factory,
    BBUSDHandlerv2,
    BBUSDHandlerv2__factory,
    VirtualShareRewardPool,
    VirtualShareRewardPool__factory,
} from "../types";
import { deployContract, waitForTx } from "../tasks/utils";
import { config } from "../tasks/deploy/mainnet-config";

export async function deployVault(hre: HardhatRuntimeEnvironment, signer: Signer, debug = false, waitForBlocks = 0) {
    const phase2 = await config.getPhase2(signer);
    const phase6 = await config.getPhase6(signer);

    const vault = await deployContract<AuraBalVault>(
        hre,
        new AuraBalVault__factory(signer),
        "AuraBalVault",
        [phase2.cvxCrv.address],
        {},
        debug,
        waitForBlocks,
    );
    const strategy = await deployContract<AuraBalStrategy>(
        hre,
        new AuraBalStrategy__factory(signer),
        "AuraBalStrategy",
        [
            vault.address,
            config.addresses.balancerVault,
            phase6.cvxCrvRewards.address,
            config.addresses.token,
            config.addresses.weth,
            phase2.cvx.address,
            phase2.cvxCrv.address,
            config.addresses.feeToken,
            phase2.cvxCrvBpt.poolId,
            config.addresses.balancerPoolId,
        ],
        {},
        debug,
        waitForBlocks,
    );

    const bbusdHandler = await deployContract<BBUSDHandlerv2>(
        hre,
        new BBUSDHandlerv2__factory(signer),
        "BBUSDHandlerv2",
        [config.addresses.feeToken, strategy.address, config.addresses.balancerVault, config.addresses.weth],
        {},
        debug,
        waitForBlocks,
    );

    const auraRewards = await deployContract<VirtualShareRewardPool>(
        hre,
        new VirtualShareRewardPool__factory(signer),
        "VirtualShareRewardPool",
        [vault.address, phase2.cvx.address, strategy.address],
        {},
        debug,
        waitForBlocks,
    );

    let tx = await vault.setStrategy(strategy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await strategy.addRewardToken(config.addresses.feeToken, bbusdHandler.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await vault.addExtraReward(auraRewards.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await strategy.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);

    return {
        vault,
        strategy,
        bbusdHandler,
        auraRewards,
    };
}