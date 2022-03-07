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
    AuraStakingProxy__factory,
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
    const phase2 = await deployPhase2(deployer, phase1, multisigs, mocks.namingConfig, true);
    const phase3 = await deployPhase3(
        hre,
        deployer,
        phase2,
        distro,
        multisigs,
        mocks.namingConfig,
        mocks.addresses,
        true,
    );
    const contracts = await deployPhase4(deployer, phase3, mocks.addresses, true);

    logExtSystem(mocks.addresses);
    logContracts(contracts as any as { [key: string]: { address: string } });
});

task("postDeploy:rinkeby").setAction(async function (taskArguments: TaskArguments, hre) {
    const deployer = await getSigner(hre);
    console.log(await deployer.getAddress());

    const sys: ExtSystemConfig = {
        token: "0xDBC620A2465F3b4084F5964CEb73F5BDB3568225",
        tokenWhale: "0xbE126Fd179822c5Cb72b0e6E584a6F7afeb9eaBE",
        minter: "0x563789F6580139c501Fde8D58bD25c47121e0609",
        votingEscrow: "0x80bbF4Fa9D938f0eE69AE2802Af384F8fBdB24bd",
        gaugeController: "0x0C6a078Cce97D710dd00231Da6A0eCE7fCd63F2F",
        registry: "0x11D56fA64bD6B87aCe54049cD1Fb3bF25b080Ff8",
        registryID: 0,
        voteOwnership: "0x0C6a078Cce97D710dd00231Da6A0eCE7fCd63F2F",
        voteParameter: "0x0C6a078Cce97D710dd00231Da6A0eCE7fCd63F2F",
        gauges: ["0x66F5899292d0d9aaE320f2Ae5CFFB1B9c0A69E1f"],
        balancerVault: "0x0000000000000000000000000000000000000000",
        balancerWeightedPoolFactory: "0x0000000000000000000000000000000000000000",
        weth: "0x0000000000000000000000000000000000000000",
    };
    const cvxSys: SystemDeployed = {
        voterProxy: CurveVoterProxy__factory.connect("0xc7d3edd05d4ddd268b5701a9c3d17ab9ebd90121", deployer),
        cvx: ConvexToken__factory.connect("0xf40dbb882fc7c04e33d949f8dcb2b1ae0b5b3d3d", deployer),
        booster: Booster__factory.connect("0x0dacce714d0ddd2f78f406752f5abbaad1d20062", deployer),
        boosterOwner: BoosterOwner__factory.connect("0xff0972f691ab79240a160620481ad6c167f1669a", deployer),
        cvxCrv: CvxCrvToken__factory.connect("0x059f5c8a2f9315309bc4c8c69e58ce10e6df26fb", deployer),
        cvxCrvRewards: BaseRewardPool__factory.connect("0xcb2de6561093e663dcc4c622227f3465df800127", deployer),
        crvDepositor: CrvDepositor__factory.connect("0x314d35451e18417c6f5128a0ec6be5dc675546d8", deployer),
        poolManager: PoolManagerV3__factory.connect("0xb03854a7d81bf9f657c9d335d2ebcc89f651497f", deployer),
        cvxLocker: AuraLocker__factory.connect("0x9a5ba49a848e38f154e9f69ace6e8283f90af615", deployer),
        cvxStakingProxy: AuraStakingProxy__factory.connect("0x02a10e1c53976a618680f390a8a1f7da262e3f01", deployer),
        vestedEscrow: VestedEscrow__factory.connect("0x34f23e3577b85102dc01e3b5af1fd92d4970019e", deployer),
        dropFactory: MerkleAirdropFactory__factory.connect("0x6a45ce07f1d6338b7d677b9d3af97a4b54d2d43b", deployer),
        claimZap: ClaimZap__factory.connect("0xf7190cd62fdc820f4c4b6dfe93fe6c6974234576", deployer),
    };

    const poolInfo = await cvxSys.booster.poolInfo(0);
    const lp = await ERC20__factory.connect(poolInfo.lptoken, deployer);

    let tx = await lp.approve(cvxSys.booster.address, simpleToExactAmount(100));
    await tx.wait();

    tx = await cvxSys.booster.deposit(0, simpleToExactAmount(100), true);
    await tx.wait();

    tx = await cvxSys.cvx.approve(cvxSys.cvxLocker.address, simpleToExactAmount(100));
    await tx.wait();

    tx = await cvxSys.cvxLocker.lock(await deployer.getAddress(), simpleToExactAmount(100), 0);
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
