import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deployContract, waitForTx } from "../tasks/utils";
import { ZERO } from "../test-utils/constants";
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
    ForwarderHandler,
    ForwarderHandler__factory,
    VirtualBalanceRewardPool,
    VirtualBalanceRewardPool__factory,
    VirtualRewardFactory,
    VirtualRewardFactory__factory,
} from "../types";
import { ExtSystemConfig, MultisigConfig, Phase2Deployed, Phase6Deployed } from "./deploySystem";
import { AuraBalVaultDeployed } from "../tasks/deploy/mainnet-config";

interface VaultConfig {
    addresses: ExtSystemConfig;
    multisigs: MultisigConfig;
    getPhase2: (deployer: Signer) => Promise<Phase2Deployed>;
    getPhase6: (deployer: Signer) => Promise<Phase6Deployed>;
    getAuraBalVault?: (deployer: Signer) => Promise<AuraBalVaultDeployed>;
}
export interface VaultDeployment {
    vault: AuraBalVault;
    strategy: AuraBalStrategy;
    feeTokenHandler: BalancerSwapsHandler;
    auraRewards: VirtualBalanceRewardPool;
    virtualRewardFactory: VirtualRewardFactory;
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

export async function deployFeeTokenHandlerV4(
    config: VaultConfig,
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
) {
    const compounder = await config.getAuraBalVault(signer);
    const feeTokenHandler = await deployContract<BalancerSwapsHandler>(
        hre,
        new BalancerSwapsHandler__factory(signer),
        "USDCHandlerV1",
        [
            config.addresses.feeToken,
            compounder.strategy.address,
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
    const bbausdV3Address = "0xfeBb0bbf162E64fb9D0dfe186E517d84C395f016"; // @deprecated bbausdV3
    const forwarderHandler = await deployContract<ForwarderHandler>(
        hre,
        new ForwarderHandler__factory(signer),
        "BBUSDHandlerV4",
        [bbausdV3Address],
        {},
        debug,
        waitForBlocks,
    );
    return {
        feeTokenHandler,
        forwarderHandler,
    };
}

export async function deployVault(
    config: VaultConfig,
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    debug = false,
    waitForBlocks = 0,
): Promise<VaultDeployment> {
    const phase2 = await config.getPhase2(signer);
    const phase6 = await config.getPhase6(signer);
    const feeToken = ERC20__factory.connect(config.addresses.feeToken, signer);

    const virtualRewardFactory = await deployContract<VirtualRewardFactory>(
        hre,
        new VirtualRewardFactory__factory(signer),
        "VirtualRewardFactory",
        [],
        {},
        debug,
        waitForBlocks,
    );

    const vault = await deployContract<AuraBalVault>(
        hre,
        new AuraBalVault__factory(signer),
        "AuraBalVault",
        [phase2.cvxCrv.address, virtualRewardFactory.address],
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

    const feeTokenHandler = await deployContract<BalancerSwapsHandler>(
        hre,
        new BalancerSwapsHandler__factory(signer),
        "USDCHandlerV1",
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

    tx = await strategy.addRewardToken(config.addresses.feeToken, feeTokenHandler.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await vault.addExtraReward(phase2.cvx.address);
    await waitForTx(tx, debug, waitForBlocks);

    tx = await strategy.setApprovals();
    await waitForTx(tx, debug, waitForBlocks);

    if ((await feeToken.allowance(feeTokenHandler.address, config.addresses.balancerVault)).eq(ZERO)) {
        tx = await feeTokenHandler.setApprovals();
        await waitForTx(tx, debug, waitForBlocks);
    }

    const extraReward = await vault.extraRewards(0);
    const auraRewards = VirtualBalanceRewardPool__factory.connect(extraReward, signer);

    return {
        vault,
        strategy,
        feeTokenHandler,
        auraRewards,
        virtualRewardFactory,
    };
}
