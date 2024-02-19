import { MockCurveGauge__factory } from "./../../types/generated/factories/MockCurveGauge__factory";
import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { logContracts } from "../utils/deploy-utils";
import { getSigner } from "../utils";
import {
    deployCrvDepositorWrapperForwarder,
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    deployPhase6,
    deployPhase7,
    deployTempBooster,
} from "../../scripts/deploySystem";
import { config } from "./mainnet-config";
import { ONE_WEEK, ZERO_ADDRESS } from "../../test-utils/constants";
import { simpleToExactAmount } from "../../test-utils/math";
import { waitForTx, deployContract } from "../utils";
import {
    ChefForwarder,
    ChefForwarder__factory,
    SiphonToken,
    SiphonToken__factory,
    MasterChefRewardHook,
    MasterChefRewardHook__factory,
    AuraMerkleDropV2,
    AuraMerkleDropV2__factory,
} from "../../types/generated";

task("deploy:mainnet:1").setAction(async function (_: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 1 ~~~
    // ~~~~~~~~~~~~~~~
    const phase1 = await deployPhase1(hre, deployer, config.addresses, false, true, 3);
    logContracts(phase1 as unknown as { [key: string]: { address: string } });
});
task("deploy:mainnet:2").setAction(async function (_: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    const phase1 = await config.getPhase1(deployer);

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 2 ~~~
    // ~~~~~~~~~~~~~~~
    const phase2 = await deployPhase2(
        hre,
        deployer,
        phase1,
        config.distroList,
        config.multisigs,
        config.naming,
        config.addresses,
        true,
        3,
    );
    logContracts(phase2 as unknown as { [key: string]: { address: string } });
});
task("deploy:mainnet:3").setAction(async function (_: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    const phase2 = await config.getPhase2(deployer);

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 3 ~~~
    // ~~~~~~~~~~~~~~~
    const phase3 = await deployPhase3(hre, deployer, phase2, config.multisigs, config.addresses, true, 3);
    logContracts(phase3 as unknown as { [key: string]: { address: string } });
});
task("deploy:mainnet:4").setAction(async function (_: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    const phase3 = await config.getPhase3(deployer);

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 4 ~~~
    // ~~~~~~~~~~~~~~~
    const phase4 = await deployPhase4(hre, deployer, phase3, config.addresses, true, 3);
    logContracts(phase4 as unknown as { [key: string]: { address: string } });
});
task("deploy:mainnet:6").setAction(async function (_: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    const phase2 = await config.getPhase2(deployer);

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 6 ~~~
    // ~~~~~~~~~~~~~~~
    const phase6 = await deployPhase6(
        hre,
        deployer,
        phase2,
        config.multisigs,
        config.naming,
        config.addresses,
        true,
        3,
    );
    logContracts(phase6 as unknown as { [key: string]: { address: string } });
});
task("deploy:mainnet:7").setAction(async function (_: TaskArguments, hre) {
    const deployer = await getSigner(hre);

    const phase2 = await config.getPhase2(deployer);

    // ~~~~~~~~~~~~~~~
    // ~~~ PHASE 7 ~~~
    // ~~~~~~~~~~~~~~~
    const phase7 = await deployPhase7(hre, deployer, phase2, "0x7b3307af981F55C8D6cd22350b08C39Ec7Ec481B", true, 3);
    logContracts(phase7 as unknown as { [key: string]: { address: string } });
});

task("deploy:mainnet:temp-booster").setAction(async function (_: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const tempBooster = await deployTempBooster(hre, deployer, true, 3);
    logContracts({ tempBooster });
});

task("deploy:mainnet:merkledrop")
    .addParam("hash", "The root hash of merkle tree")
    .setAction(async function (taskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);

        const phase2 = await config.getPhase2(deployer);

        const hash = taskArgs.hash;
        if (hash == "" || hash == undefined) {
            throw console.error("invalid hash");
        }

        const airdrop = await deployContract<AuraMerkleDropV2>(
            hre,
            new AuraMerkleDropV2__factory(deployer),
            "AuraMerkleDropV2",
            [
                config.multisigs.treasuryMultisig,
                hash,
                phase2.cvx.address,
                phase2.cvxLocker.address,
                0,
                ONE_WEEK.mul(26),
            ],
            {},
            true,
            3,
        );

        logContracts({ airdrop });
    });

task("mainnet:getgauges").setAction(async function (_: TaskArguments, hre) {
    const { ethers } = hre;

    // Connect to the network
    const provider = ethers.getDefaultProvider();

    const contract = new ethers.Contract(
        "0xC128468b7Ce63eA702C1f104D55A2566b13D3ABD",
        ["function gauges(uint256 arg) view returns (address)"],
        provider,
    );
    const gaugeAddress: string[] = [];
    // 4 to 36
    for (let i = 4; i < 36; i++) {
        const thisAddr = await contract.gauges(i);
        gaugeAddress.push(thisAddr);
    }
    console.log(gaugeAddress);
});

task("mainnet:getStashes").setAction(async function (_: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    const { addresses } = config;
    const { gauges } = addresses;

    const gaugesWithRewardTokens = [];
    for (let i = 0; i < gauges.length; i++) {
        const gauge = MockCurveGauge__factory.connect(gauges[i], deployer);
        if ((await gauge.reward_tokens(0)) != ZERO_ADDRESS) {
            gaugesWithRewardTokens.push(gauges[i]);
        }
    }
    console.log(gaugesWithRewardTokens);
});

task("mainnet:siphon").setAction(async function (_: TaskArguments, hre) {
    const debug = true;
    const waitForBlocks = 3;
    const mintAmount = simpleToExactAmount("1");

    const signer = await getSigner(hre);
    const phase2 = await config.getPhase2(signer);

    const protocolMultisig = config.multisigs.daoMultisig;
    // auraBAL reward stash address
    const stashAddress = "0xF801a238a1Accc7A63b429E8c343B198d51fbbb9";

    // deploy chef forwarded
    const chefForwarder = await deployContract<ChefForwarder>(
        hre,
        new ChefForwarder__factory(signer),
        "ChefForwarder",
        [phase2.chef.address],
        {},
        debug,
        waitForBlocks,
    );

    // deploy chef forwarded siphon token
    await deployContract<SiphonToken>(
        hre,
        new SiphonToken__factory(signer),
        "SiphonTokenBribes",
        [chefForwarder.address, mintAmount],
        {},
        debug,
        waitForBlocks,
    );

    // deploy master chef reward hook
    const masterChefRewardHook = await deployContract<MasterChefRewardHook>(
        hre,
        new MasterChefRewardHook__factory(signer),
        "MasterChefRewardHook",
        [stashAddress, phase2.chef.address, phase2.cvx.address],
        {},
        debug,
        waitForBlocks,
    );

    // deploy master chef reward hook siphon token
    await deployContract<SiphonToken>(
        hre,
        new SiphonToken__factory(signer),
        "SiphonTokenBribes",
        [masterChefRewardHook.address, mintAmount],
        {},
        debug,
        waitForBlocks,
    );

    // transfer ownership to protocolDAO
    let tx = await chefForwarder.transferOwnership(protocolMultisig);
    await waitForTx(tx, debug, waitForBlocks);
    tx = await masterChefRewardHook.transferOwnership(protocolMultisig);
    await waitForTx(tx, debug, waitForBlocks);
});

task("deploy:mainnet:crvDepositorWrapperForwarder")
    .addParam("forwardTo", "The forward to address, ie, stash address")
    .setAction(async function (taskArgs: TaskArguments, hre) {
        const deployer = await getSigner(hre);
        const phase2 = await config.getPhase2(deployer);

        const { crvDepositorWrapperForwarder } = await deployCrvDepositorWrapperForwarder(
            hre,
            deployer,
            phase2,
            config.addresses,
            taskArgs.forwardTo,
            true,
            3,
        );
        logContracts({ crvDepositorWrapperForwarder });
    });
