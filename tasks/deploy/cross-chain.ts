import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

import { getSigner } from "tasks/utils";
import { config as mainnetConfig } from "./mainnet-config";
import { config as crossChainConfig } from "./cross-chain-config";
import { deployCrossChainL1 } from "scripts/deployCrossChain";

const DEBUG = true;

task("deploy:crosschain:l1").setAction(async function (_: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const deployer = await getSigner(hre);

    const chainId = 1; // Ethereum Mainnet

    const contracts = await mainnetConfig.getPhase4(deployer);

    // We are making the assumption that after we run this task to deploy the
    // L1 cross chain contracts we will add the siphonGauge as the next pool
    // to the booster. Therefore the PID of the siphonGauge will be pools.length
    const pid = await contracts.booster.poolLength();

    const lzConfig = crossChainConfig.lz[chainId];

    await deployCrossChainL1(
        {
            l2Coordinator: crossChainConfig.l2Coordinator,
            siphonDepositor: { pid },
            booster: contracts.booster.address,
            cvxLocker: contracts.cvxLocker.address,
            token: mainnetConfig.addresses.token,
            cvx: contracts.cvx.address,
            lzEndpoint: lzConfig.lzEndpoint,
        },
        deployer,
        hre,
        DEBUG,
        0,
    );
});

task("deploy:crosschain:l2").setAction(async function (_: TaskArguments, _hre: HardhatRuntimeEnvironment) {
    // TODO:
    // const deployer = await getSigner(hre);
    // const lzConfig = {} as any;
    // await deployCrossChainL2(
    //     {
    //         siphonDepositor: siphonDepositor.address,
    //         rAura: { symbol: "rAURA" },
    //         lzEndpoint: lzConfig.lzEndpoint,
    //         dstChainId: lzConfig.dstChainId,
    //         minter: mainnetConfig.addresses.minter,
    //         token: mainnetConfig.addresses.token,
    //         tokenBpt: mainnetConfig.addresses.tokenBpt,
    //         votingEscrow: mainnetConfig.addresses.votingEscrow,
    //         gaugeController: mainnetConfig.addresses.gaugeController,
    //         cvx: contracts.cvx.address,
    //         voteOwnership: ethers.constants.AddressZero,
    //         voteParameter: ethers.constants.AddressZero,
    //         naming: {
    //             tokenFactoryNamePostfix: mainnetConfig.naming.tokenFactoryNamePostfix,
    //             cvxSymbol: mainnetConfig.naming.cvxSymbol,
    //             cvxName: mainnetConfig.naming.cvxName,
    //         },
    //     },
    //     deployer,
    //     hre,
    //     debug,
    //     0,
    // );
});
