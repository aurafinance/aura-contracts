import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { getSigner } from "../utils";
import { simpleToExactAmount } from "./../../test-utils/math";
import {
    deployForkSystem,
    deployPhase1,
    deployPhase2,
    deployPhase3,
    deployPhase4,
    ExtSystemConfig,
    SystemDeployed,
} from "../../scripts/deploySystem";
import { deployMocks, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";
import {
    AuraLocker__factory,
    AuraMinter__factory,
    AuraStakingProxy__factory,
    AuraToken__factory,
    BaseRewardPool__factory,
    BoosterOwner__factory,
    Booster__factory,
    ClaimZap__factory,
    ConvexToken__factory,
    CrvDepositor__factory,
    CurveVoterProxy__factory,
    CvxCrvToken__factory,
    ERC20__factory,
    MerkleAirdropFactory__factory,
    PoolManagerV3__factory,
    VestedEscrow__factory,
} from "../../types";

task("deploy:core").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    console.log(await deployer.getAddress());
    await deployForkSystem(hre, deployer, getMockDistro(), await getMockMultisigs(deployer, deployer, deployer), {
        cvxName: "Convex Finance",
        cvxSymbol: "CVX",
        vlCvxName: "Vote Locked Convex",
        vlCvxSymbol: "vlCVX",
        cvxCrvName: "Convex CRV",
        cvxCrvSymbol: "cvxCRV",
        tokenFactoryNamePostfix: " Convex Deposit",
    });
});

function logExtSystem(system: ExtSystemConfig) {
    const keys = Object.keys(system);
    console.log(`\n~~~~~~~~~~~~~~~~~~~~~~~~~~~`);
    console.log(`~~~~~~~ EXT  SYSTEM ~~~~~~~`);
    console.log(`~~~~~~~~~~~~~~~~~~~~~~~~~~~\n`);
    keys.map(k => {
        console.log(`${k}:\t${system[k]}`);
    });
}

function logContracts(contracts: { [key: string]: { address: string } }) {
    const keys = Object.keys(contracts);
    console.log(`\n~~~~~~~~~~~~~~~~~~~~~~~~~~~`);
    console.log(`~~~~ SYSTEM DEPLOYMENT ~~~~`);
    console.log(`~~~~~~~~~~~~~~~~~~~~~~~~~~~\n`);
    keys.map(k => {
        console.log(`${k}:\t${contracts[k].address}`);
    });
}

task("deploy:testnet").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    console.log(await deployer.getAddress());

    const mocks = await deployMocks(deployer, true);
    const multisigs = await getMockMultisigs(deployer, deployer, deployer);
    const distro = getMockDistro();

    const phase1 = await deployPhase1(deployer, mocks.addresses, true, true);
    const phase2 = await deployPhase2(
        hre,
        deployer,
        phase1,
        distro,
        multisigs,
        mocks.namingConfig,
        mocks.addresses,
        true,
    );
    const phase3 = await deployPhase3(deployer, phase2, mocks.addresses, true);
    const contracts = await deployPhase4(deployer, phase3, mocks.addresses, true);

    logExtSystem(mocks.addresses);
    logContracts(contracts as any as { [key: string]: { address: string } });
});

task("postDeploy:rinkeby").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    console.log(await deployer.getAddress());

    const sys: ExtSystemConfig = {
        token: "0x65c29b54d701DeF26000aA85193915B0c5dB9822",
        tokenWhale: "0xbE126Fd179822c5Cb72b0e6E584a6F7afeb9eaBE",
        minter: "0x44d7eb6e0fF0863f16AbC3a9fDa8D49Dab879e40",
        votingEscrow: "0x0e0837C8DA3C1931831Cc9aC2c19265AAa16cF97",
        gaugeController: "0xbce229725bc29e88f351e20176f7ad003CB7bbf7",
        feeDistribution: "",
        nativeTokenDistribution: "",
        voteOwnership: "0xbce229725bc29e88f351e20176f7ad003CB7bbf7",
        voteParameter: "0xbce229725bc29e88f351e20176f7ad003CB7bbf7",
        gauges: [
            "0x877B96Bf9ee1a365872A269482BF213910994Ac6",
            "0x156c44B88FBA5B65083758e7D1634c9fD27F0a31",
            "0x65964D0d66B9b5dbd0d548a5064a1d4601A0a168",
        ],
        balancerVault: "0x0000000000000000000000000000000000000000",
        balancerWeightedPoolFactory: "0x0000000000000000000000000000000000000000",
        weth: "0x0000000000000000000000000000000000000000",
    };
    const cvxSys: SystemDeployed = {
        voterProxy: CurveVoterProxy__factory.connect("0xF5940797f21BdEDDD2E2A884DcD7c688c1bAd13a", deployer),
        cvx: AuraToken__factory.connect("0xE6Adf2BFE209586c2b623e564194B73B14Bf2866", deployer),
        minter: AuraMinter__factory.connect("0xBeb1Dc260DA7C79264359d43A88901B080F9A30b", deployer),
        booster: Booster__factory.connect("0xF3BA38823F5bf8C315c747861539eE27081357Cb", deployer),
        boosterOwner: BoosterOwner__factory.connect("0xEC1a6e61f7c4864Cf8bfcf5BcEEFeE6259D6A2B6", deployer),
        cvxCrv: CvxCrvToken__factory.connect("0x0422a859FeCF2576e2201209AE02eFff916AfCF4", deployer),
        cvxCrvRewards: BaseRewardPool__factory.connect("0x2c9e3F6953B7e7675Eb448ED85666Ece4A109389", deployer),
        crvDepositor: CrvDepositor__factory.connect("0x9044439962dedD4dF5e032ADD45e16Eb609f72B7", deployer),
        poolManager: PoolManagerV3__factory.connect("0xF5713ba15e6B2397D86C519BF5DA83F8955f4640", deployer),
        cvxLocker: AuraLocker__factory.connect("0x2E05Cef94C259b6092E14f631Eb20094f7DDDC63", deployer),
        cvxStakingProxy: AuraStakingProxy__factory.connect("0x1DAB1cC828cfb71C379D6EE18468b02DEAe9Aa5E", deployer),
        vestedEscrows: [VestedEscrow__factory.connect("0x34f23e3577b85102dc01e3b5af1fd92d4970019e", deployer)],
        dropFactory: MerkleAirdropFactory__factory.connect("0x2d53Feee8A4a94b2FA4C72551db96BEadC3f383C", deployer),
        claimZap: ClaimZap__factory.connect("0x779688dC607607bF84FCb4B09C4474E2F2A23696", deployer),
    };

    const poolInfo = await cvxSys.booster.poolInfo(0);
    const lp = await ERC20__factory.connect(poolInfo.lptoken, deployer);

    let tx = await lp.approve(cvxSys.booster.address, simpleToExactAmount(100));
    await tx.wait();

    tx = await cvxSys.booster.deposit(0, simpleToExactAmount(100), true);
    await tx.wait();

    tx = await cvxSys.cvx.approve(cvxSys.cvxLocker.address, simpleToExactAmount(100));
    await tx.wait();

    tx = await cvxSys.cvxLocker.lock(await deployer.getAddress(), simpleToExactAmount(100));
    await tx.wait();

    tx = await cvxSys.booster.earmarkRewards(0);
    await tx.wait();

    tx = await cvxSys.cvxStakingProxy.distribute();
    await tx.wait();

    tx = await ERC20__factory.connect(sys.token, deployer).approve(
        cvxSys.crvDepositor.address,
        simpleToExactAmount(100),
    );
    await tx.wait();

    tx = await cvxSys.crvDepositor["deposit(uint256,bool,address)"](
        simpleToExactAmount(100),
        true,
        cvxSys.cvxCrvRewards.address,
    );
    await tx.wait();

    tx = await lp.approve(cvxSys.booster.address, simpleToExactAmount(100));
    await tx.wait();

    tx = await cvxSys.booster.deposit(0, simpleToExactAmount(100), true);
    await tx.wait();
});
