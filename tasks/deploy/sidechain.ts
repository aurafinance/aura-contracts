import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

import {
    VoterProxyLite__factory,
    Coordinator__factory,
    BoosterLite__factory,
    RewardFactory__factory,
    TokenFactory__factory,
    ProxyFactory__factory,
    StashFactoryV2__factory,
    ExtraRewardStashV3__factory,
    PoolManagerLite__factory,
    BoosterOwner__factory,
} from "../../types";
import { getSigner } from "../utils";
import { config } from "./sidechain-config";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { deployCreate2Factory } from "../../scripts/deploySidechain";
import { computeCreate2Address, logContracts } from "../utils/deploy-utils";

const debug = true;

task("deploy:sidechain:create2Factory")
    .addParam("wait", "wait for blocks")
    .setAction(async function (tskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const waitForBlocks = tskArgs.wait;

        const phase = await deployCreate2Factory(hre, deployer, debug, waitForBlocks);
        logContracts(phase as unknown as { [key: string]: { address: string } });
    });

task("sidechain:addresses").setAction(async function (_: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const { addresses, extConfig, naming } = config;

    const voterProxyAddress = await computeCreate2Address<VoterProxyLite__factory>(
        addresses.create2Factory,
        new VoterProxyLite__factory(deployer),
        "VoterProxyLite",
        [addresses.minter, addresses.token],
    );

    const coordinatorAddress = await computeCreate2Address<Coordinator__factory>(
        addresses.create2Factory,
        new Coordinator__factory(deployer),
        "Coordinator",
        [naming.coordinatorName, naming.coordinatorSymbol, addresses.lzEndpoint, extConfig.canonicalChainId],
    );

    const cvxTokenAddress = coordinatorAddress;

    const boosterAddress = await computeCreate2Address<BoosterLite__factory>(
        addresses.create2Factory,
        new BoosterLite__factory(deployer),
        "BoosterLite",
        [voterProxyAddress, cvxTokenAddress, addresses.token],
    );

    const rewardFactoryAddress = await computeCreate2Address<RewardFactory__factory>(
        addresses.create2Factory,
        new RewardFactory__factory(deployer),
        "RewardFactory",
        [boosterAddress, addresses.token],
    );

    const tokenFactoryAddress = await computeCreate2Address<TokenFactory__factory>(
        addresses.create2Factory,
        new TokenFactory__factory(deployer),
        "TokenFactory",
        [boosterAddress, naming.tokenFactoryNamePostfix, naming.coordinatorSymbol.toLowerCase()],
    );

    const proxyFactoryAddress = await computeCreate2Address<ProxyFactory__factory>(
        addresses.create2Factory,
        new ProxyFactory__factory(deployer),
        "ProxyFactory",
        [],
    );

    const stashFactoryAddress = await computeCreate2Address<StashFactoryV2__factory>(
        addresses.create2Factory,
        new StashFactoryV2__factory(deployer),
        "StashFactory",
        [boosterAddress, rewardFactoryAddress, proxyFactoryAddress],
    );

    const stashV3Address = await computeCreate2Address<ExtraRewardStashV3__factory>(
        addresses.create2Factory,
        new ExtraRewardStashV3__factory(deployer),
        "ExtraRewardStashV3",
        [addresses.token],
    );

    const poolManagerAddress = await computeCreate2Address<PoolManagerLite__factory>(
        addresses.create2Factory,
        new PoolManagerLite__factory(deployer),
        "PoolManagerLite",
        [boosterAddress, addresses.daoMultisig],
    );

    const boosterOwnerAddress = await computeCreate2Address<BoosterOwner__factory>(
        addresses.create2Factory,
        new BoosterOwner__factory(deployer),
        "BoosterOwner",
        [addresses.daoMultisig, poolManagerAddress, boosterAddress, stashFactoryAddress, ZERO_ADDRESS, true],
    );

    const deployed = {
        voterProxyAddress,
        coordinatorAddress,
        boosterAddress,
        tokenFactoryAddress,
        proxyFactoryAddress,
        stashFactoryAddress,
        stashV3Address,
        poolManagerAddress,
        boosterOwnerAddress,
    };

    Object.keys(deployed).forEach(key => {
        console.log(`${key}:`.padEnd(24, " "), deployed[key]);
    });
});
