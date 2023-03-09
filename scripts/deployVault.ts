import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
    AuraBalStrategy,
    AuraBalStrategy__factory,
    AuraBalVault,
    AuraBalVault__factory,
    BalancerSwapsHandler,
    BalancerSwapsHandler__factory,
    ERC20__factory,
    FeeForwarder,
    FeeForwarder__factory,
    VirtualBalanceRewardPool__factory,
} from "../types";
import { deployContract, waitForTx } from "../tasks/utils";
import { ExtSystemConfig, MultisigConfig, Phase2Deployed, Phase6Deployed } from "./deploySystem";
import { ZERO } from "../test-utils";

interface VaultConfig {
    addresses: ExtSystemConfig;
    multisigs: MultisigConfig;
    getPhase2: (deployer: Signer) => Promise<Phase2Deployed>;
    getPhase6: (deployer: Signer) => Promise<Phase6Deployed>;
}

export async function deployFeeForwarder(
    config: VaultConfig,
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
) {
    const feeForwarder = await deployContract<FeeForwarder>(
        hre,
        new FeeForwarder__factory(signer),
        "FeeForwarder",
        [config.multisigs.daoMultisig],
        {},
        debug,
        waitForBlocks,
    );

    return { feeForwarder };
}

export async function deployVault(
    config: VaultConfig,
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
) {
    const phase2 = await config.getPhase2(signer);
    const phase6 = await config.getPhase6(signer);
    const feeToken = ERC20__factory.connect(config.addresses.feeToken, signer);

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

    const bbusdHandler = await deployContract<BalancerSwapsHandler>(
        hre,
        new BalancerSwapsHandler__factory(signer),
        "BBUSDHandlerv3",
        [
            config.addresses.feeToken,
            strategy.address,
            config.addresses.balancerVault,
            config.addresses.weth,
            {
                poolIds: config.addresses.feeTokenHandlerPath.poolIds,
                assetsIn: config.addresses.feeTokenHandlerPath.assetsIn,
            },
        ],
        {},
        debug,
        waitForBlocks,
    );

    let tx = await vault.setStrategy(strategy.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await strategy.addRewardToken(config.addresses.feeToken, bbusdHandler.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await vault.addExtraReward(phase2.cvx.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await strategy.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);

    if ((await feeToken.allowance(bbusdHandler.address, config.addresses.balancerVault)).eq(ZERO)) {
        tx = await bbusdHandler.setApprovals();
        await waitForTx(tx, debug, waitForBlocks);
    }

    const extraReward = await vault.extraRewards(0);
    const auraRewards = VirtualBalanceRewardPool__factory.connect(extraReward, signer);

    return {
        vault,
        strategy,
        bbusdHandler,
        auraRewards,
    };
}
