import { ZERO_ADDRESS } from "../../test-utils/constants";
import { BigNumber as BN } from "ethers";
import { formatUnits } from "ethers/lib/utils";
import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import fs from "fs";
import {
    Booster__factory,
    Booster,
    CurveVoterProxy__factory,
    CurveVoterProxy,
    RewardFactory__factory,
    RewardFactory,
    StashFactoryV2__factory,
    StashFactoryV2,
    TokenFactory__factory,
    TokenFactory,
    ProxyFactory__factory,
    ProxyFactory,
    ConvexToken__factory,
    ConvexToken,
    CvxCrvToken__factory,
    CvxCrvToken,
    CrvDepositor__factory,
    CrvDepositor,
    PoolManagerV3__factory,
    PoolManagerV3,
    BaseRewardPool__factory,
    BaseRewardPool,
    CvxRewardPool__factory,
    CvxRewardPool,
    ArbitratorVault__factory,
    ArbitratorVault,
    ClaimZap__factory,
    ClaimZap,
    ConvexMasterChef__factory,
    ConvexMasterChef,
    VestedEscrow__factory,
    VestedEscrow,
    MerkleAirdrop__factory,
    MerkleAirdropFactory__factory,
    MerkleAirdropFactory,
    IUniswapV2Factory__factory,
    IUniswapV2Router01__factory,
    IERC20__factory,
} from "../../types/generated";
import { deployContract, getSigner } from "../utils";
import * as distroList from "./convex-distro.json";
import { simpleToExactAmount } from "../../test-utils/math";
interface PoolInfo {
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    stash: string;
    shutdown: boolean;
}

// const convexVoterProxy = "0x989AEb4d175e16225E39E87d0D97A3360524AD80";
const convexTreasury = "0x1389388d01708118b497f59521f6943Be2541bb7";

const merkleRoot = "0x632a2ad201c5b95d3f75c1332afdcf489d4e6b4b7480cf878d8eba2aa87d5f73";

const crv = "0xD533a949740bb3306d119CC777fa900bA034cd52";

const sushiswapRouter = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
const sushiswapFactory = "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac";
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

task("deploy:Convex").setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers } = hre;
    const deployer = await getSigner(hre);
    const deployerAddress = await deployer.getAddress();
    const multisigAddress = deployerAddress;

    // -----------------------------
    // 1. Fetch distribution amounts
    // && Setup global vars for tracking
    // -----------------------------

    let premine = BN.from(distroList.lpincentives)
        .add(BN.from(distroList.vecrv))
        .add(BN.from(distroList.teamcvxLpSeed));
    const vestedAddresses = distroList.vested.team.addresses.concat(
        distroList.vested.investor.addresses,
        distroList.vested.treasury.addresses,
    );
    const vestedAmounts = distroList.vested.team.amounts.concat(
        distroList.vested.investor.amounts,
        distroList.vested.treasury.amounts,
    );
    const totalVested = vestedAmounts.reduce((p, c) => p.add(c), BN.from(0));
    console.log("Total vested: ", formatUnits(totalVested));

    premine = premine.add(totalVested);

    console.log("Total cvx premine: " + premine.toString());
    const totalDistro = BN.from(premine).add(distroList.miningRewards);
    console.log("total cvx: " + totalDistro.toString());

    const rewardsStart = Math.floor(Date.now() / 1000) + 3600;
    const rewardsEnd = rewardsStart + 1 * 364 * 86400;

    const contractList: { [key: string]: { [key: string]: string } } = {};
    const systemContracts: { [key: string]: string } = {};
    const poolsContracts: { [key: string]: string } = {};
    const poolNames: string[] = [];
    contractList["system"] = systemContracts;
    contractList["pools"] = poolsContracts;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addContract = function (group: "system" | "pools", name: string, value: any) {
        contractList[group][name] = value;
        const contractListOutput = JSON.stringify(contractList, null, 4);
        fs.writeFileSync("contracts.json", contractListOutput);
    };

    // TODO - Contains hardcoded values
    // TODO - Requires pre-deployment and subsequent whitelisting by Balancer
    // TODO - Ensure owner is 'deployer'
    // const voterProxy = await CurveVoterProxy__factory.connect(convexVoterProxy, deployer);
    const voterProxy = await deployContract<CurveVoterProxy>(
        new CurveVoterProxy__factory(deployer),
        "CurveVoterProxy",
        [],
    );
    addContract("system", "voteProxy", voterProxy.address);
    addContract("system", "treasury", convexTreasury);

    // -----------------------------
    // 2. Core deployment
    // -----------------------------

    // TODO - Contains hardcoded values
    const convexToken = await deployContract<ConvexToken>(new ConvexToken__factory(deployer), "ConvexToken", [
        voterProxy.address,
    ]);
    addContract("system", "cvx", convexToken.address);

    // TODO - Contains hardcoded values
    const booster = await deployContract<Booster>(new Booster__factory(deployer), "Booster", [
        voterProxy.address,
        convexToken.address,
    ]);
    addContract("system", "booster", booster.address);

    let tx = await voterProxy.setOperator(booster.address);
    await tx.wait();

    tx = await convexToken.mint(deployerAddress, premine.toString());
    await tx.wait();

    // TODO - Contains hardcoded values
    const rewardFactory = await deployContract<RewardFactory>(new RewardFactory__factory(deployer), "RewardFactory", [
        booster.address,
    ]);
    addContract("system", "rFactory", rewardFactory.address);

    // TODO - Dependency (DepositToken.sol) contains hardcoded values
    const tokenFactory = await deployContract<TokenFactory>(new TokenFactory__factory(deployer), "TokenFactory", [
        booster.address,
    ]);
    addContract("system", "tFactory", tokenFactory.address);

    // TODO - This contains references to various versions of reward contracts.. should be straightened out or new v found
    const proxyFactory = await deployContract<ProxyFactory>(new ProxyFactory__factory(deployer), "ProxyFactory");
    const stashFactory = await deployContract<StashFactoryV2>(new StashFactoryV2__factory(deployer), "StashFactory", [
        booster.address,
        rewardFactory.address,
        proxyFactory.address,
    ]);
    addContract("system", "sFactory", stashFactory.address);

    // TODO - Contains hardcoded values
    const cvxCrv = await deployContract<CvxCrvToken>(new CvxCrvToken__factory(deployer), "CvxCrv");
    addContract("system", "cvxCrv", cvxCrv.address);

    // TODO - Contains hardcoded values
    const crvDepositor = await deployContract<CrvDepositor>(new CrvDepositor__factory(deployer), "CrvDepositor", [
        voterProxy.address,
        cvxCrv.address,
    ]);
    addContract("system", "crvDepositor", crvDepositor.address);

    tx = await cvxCrv.setOperator(crvDepositor.address);
    await tx.wait();
    tx = await voterProxy.setDepositor(crvDepositor.address);
    await tx.wait();
    // TODO - depositor needs whitelisted in veCRV
    // tx = await crvDepositor.initialLock();
    // await tx.wait();
    tx = await booster.setTreasury(crvDepositor.address);
    await tx.wait();

    // TODO - This code needs to be compared against live RewardPool instances - it looks odd
    const cvxCrvRewards = await deployContract<BaseRewardPool>(
        new BaseRewardPool__factory(deployer),
        "BaseRewardPool",
        [0, cvxCrv.address, crv, booster.address, rewardFactory.address],
    );
    addContract("system", "cvxCrvRewards", cvxCrvRewards.address);

    // TODO - Check that last arg (manager) is trusted as this can add new rewards
    // TODO - Something funky going on with the QueueRewards fn
    const cvxRewards = await deployContract<CvxRewardPool>(new CvxRewardPool__factory(deployer), "CvxRewardPool", [
        convexToken.address,
        crv,
        crvDepositor.address,
        cvxCrvRewards.address,
        cvxCrv.address,
        booster.address,
        deployerAddress,
    ]);
    addContract("system", "cvxRewards", cvxRewards.address);

    tx = await booster.setRewardContracts(cvxCrvRewards.address, cvxRewards.address);
    await tx.wait();

    // TODO - Contains hardcoded values & is an upgraded version
    const poolManager = await deployContract<PoolManagerV3>(new PoolManagerV3__factory(deployer), "PoolManagerV3", [
        booster.address,
    ]);
    addContract("system", "poolManager", poolManager.address);

    tx = await booster.setPoolManager(poolManager.address);
    await tx.wait();
    tx = await booster.setFactories(rewardFactory.address, stashFactory.address, tokenFactory.address);
    await tx.wait();
    // TODO - which is the real value?
    tx = await booster.setFeeInfo("0x0000000000000000000000000000000000000000");
    await tx.wait();

    // TODO - set auth to be non EOA
    const arbitratorVault = await deployContract<ArbitratorVault>(
        new ArbitratorVault__factory(deployer),
        "ArbitratorVault",
        [booster.address],
    );
    addContract("system", "arbitratorVault", arbitratorVault.address);

    tx = await booster.setArbitrator(arbitratorVault.address);
    await tx.wait();

    const block = await ethers.provider.getBlockNumber();
    const chefCvx = BN.from(distroList.lpincentives);
    const numberOfBlocks = BN.from(6000 * 365 * 4);
    const rewardPerBlock = BN.from(chefCvx).div(numberOfBlocks);
    console.log("chef rewards per block: " + rewardPerBlock.toString());
    const startblock = Number(block) + 500; //start with small delay
    const endbonusblock = Number(startblock) + 2 * 7 * 6400; //about 2 weeks
    console.log("current block: " + block);
    console.log("chef rewards start on: " + startblock);
    console.log("chef reward bonus end on: " + endbonusblock);

    // TODO - Everything looks good here surprisingly
    const chef = await deployContract<ConvexMasterChef>(new ConvexMasterChef__factory(deployer), "ConvexMasterChef", [
        convexToken.address,
        rewardPerBlock,
        startblock,
        endbonusblock,
    ]);
    addContract("system", "chef", chef.address);
    tx = await convexToken.transfer(chef.address, distroList.lpincentives);
    await tx.wait();

    const chefBalance = await convexToken.balanceOf(chef.address);
    console.log("cvx on chef: " + chefBalance);

    // TODO - Hardcoded values
    const claimZap = await deployContract<ClaimZap>(new ClaimZap__factory(deployer), "ClaimZap", []);
    addContract("system", "claimZap", claimZap.address);
    tx = await claimZap.setApprovals();
    await tx.wait();

    // TODO - Looks good, just need to set the admin addr to multisig
    const vestedEscrow = await deployContract<VestedEscrow>(new VestedEscrow__factory(deployer), "VestedEscrow", [
        convexToken.address,
        rewardsStart,
        rewardsEnd,
        cvxRewards.address,
        multisigAddress,
    ]);
    addContract("system", "vestedEscrow", vestedEscrow.address);

    tx = await convexToken.approve(vestedEscrow.address, distroList.vested.total);
    await tx.wait();
    tx = await vestedEscrow.addTokens(distroList.vested.total);
    await tx.wait();
    tx = await vestedEscrow.fund(vestedAddresses, vestedAmounts);
    await tx.wait();

    const unallocated = await vestedEscrow.unallocatedSupply();
    console.log("vesting unallocatedSupply: " + unallocated.toString());

    const initialLocked = await vestedEscrow.initialLockedSupply();
    console.log("vesting initialLockedSupply: " + initialLocked.toString());

    const dropFactory = await deployContract<MerkleAirdropFactory>(
        new MerkleAirdropFactory__factory(deployer),
        "MerkleAirdropFactory",
    );
    addContract("system", "dropFactory", dropFactory.address);

    // TODO - Ensure owner of MerkleDrop is valid (multisig?)
    tx = await dropFactory.CreateMerkleAirdrop();
    const txReceipt = await tx.wait();
    const merkleDropAddr = txReceipt.events[0].args[0];
    console.log("factory return: " + merkleDropAddr);

    const airdrop = MerkleAirdrop__factory.connect(merkleDropAddr, deployer);
    addContract("system", "airdrop", airdrop.address);
    tx = await airdrop.setRewardToken(convexToken.address);
    await tx.wait();

    tx = await convexToken.transfer(airdrop.address, distroList.vecrv);
    await tx.wait();

    tx = await airdrop.setRoot(merkleRoot);
    await tx.wait();

    // *************************************
    // *************************************
    // *************************************
    //
    // ALL TX's DOWN TO HERE HAVE BEEN ADDED
    //
    // *************************************
    // *************************************
    // *************************************

    // 2.2. CVX SUSHI POOLS
    // TODO - change to balancer
    const sushiRouter = IUniswapV2Router01__factory.connect(sushiswapRouter, deployer);
    const sushiFactory = IUniswapV2Factory__factory.connect(sushiswapFactory, deployer);
    console.log("sushiRouter: " + sushiRouter.address);
    console.log("sushiFactory: " + sushiFactory.address);

    tx = await convexToken.approve(sushiRouter.address, distroList.teamcvxLpSeed);
    await tx.wait();

    tx = await sushiRouter.addLiquidityETH(
        convexToken.address,
        distroList.teamcvxLpSeed,
        distroList.teamcvxLpSeed,
        simpleToExactAmount(1),
        deployerAddress, // TODO - update recipient
        Math.floor(Date.now() / 1000) + 3000,
        { value: simpleToExactAmount(1) },
    );
    await tx.wait();

    let pair = await sushiFactory.getPair(convexToken.address, weth);
    console.log("cvxEthSLP Address: " + pair);
    addContract("system", "cvxEthSLP", pair);
    let slpToken = IERC20__factory.connect(pair, deployer);
    const balance = await slpToken.balanceOf(multisigAddress);
    console.log("cvxEth pair balance: " + balance.toString());

    //Create cvxCRV sushi pool
    const crvToken = IERC20__factory.connect(crv, deployer);
    console.log("swap eth for crv");
    tx = await sushiRouter.swapExactETHForTokens(
        0,
        [weth, crv],
        deployerAddress, // TODO - update recipient
        Math.floor(Date.now() / 1000) + 3000,
        {
            value: simpleToExactAmount(1),
        },
    );
    await tx.wait();

    let crvBalance = await crvToken.balanceOf(deployerAddress);
    console.log("swapped for crv: " + crvBalance.toString());
    const crvDepositAmt = BN.from(crvBalance.toString()).div(2);
    console.log("depositing for cvxcrv: " + crvDepositAmt.toString());
    tx = await crvToken.approve(crvDepositor.address, crvDepositAmt.toString());
    await tx.wait();

    // Mints cvxCrv but doesn't stake
    tx = await crvDepositor["deposit(uint256,bool,address)"](crvDepositAmt, false, ZERO_ADDRESS);
    await tx.wait();

    crvBalance = await crvToken.balanceOf(deployerAddress);
    console.log("crv bal: " + crvBalance.toString());

    const cvxCrvBalance = await cvxCrv.balanceOf(deployerAddress);
    console.log("cvxCrv bal: " + cvxCrvBalance.toString());

    tx = await crvToken.approve(sushiRouter.address, crvBalance);
    await tx.wait();

    tx = await cvxCrv.approve(sushiRouter.address, cvxCrvBalance);
    await tx.wait();

    tx = await sushiRouter.addLiquidity(
        crv,
        cvxCrv.address,
        crvBalance,
        cvxCrvBalance,
        0,
        0,
        deployerAddress, // TODO - update recipient
        Math.floor(Date.now() / 1000) + 3000,
    );
    await tx.wait();

    pair = await sushiFactory.getPair(cvxCrv.address, crv);
    console.log("cvxCrvCRV SLP Address: " + pair);
    addContract("system", "cvxCrvCrvSLP", pair);
    slpToken = IERC20__factory.connect(pair, deployer);

    console.log("cvxCrv pair balance: ", (await slpToken.balanceOf(deployerAddress)).toString());

    const crvOnSushi = await crvToken.balanceOf(systemContracts["cvxCrvCrvSLP"]);
    console.log("crv on sushi: " + crvOnSushi.toString());
    const cvxCrvOnSushi = await cvxCrv.balanceOf(systemContracts["cvxCrvCrvSLP"]);
    console.log("cvxCrv on sushi: " + cvxCrvOnSushi.toString());

    //Add sushi pools to chef
    tx = await chef.add(12000, systemContracts["cvxCrvCrvSLP"], ZERO_ADDRESS, false);
    await tx.wait();

    tx = await chef.add(8000, systemContracts["cvxEthSLP"], ZERO_ADDRESS, false);
    await tx.wait();

    //Create convex pools
    poolNames.push("compound");
    console.log("adding pool " + poolNames[poolNames.length - 1]);
    tx = await poolManager["addPool(address)"]("0x7ca5b0a2910B33e9759DC7dDB0413949071D7575");
    await tx.wait();

    const len = await booster.poolLength();
    const pList = [];
    for (let i = 0; i < len.toNumber(); i++) {
        pList.push(booster.poolInfo(i));
    }
    const poolInfo: Array<PoolInfo> = await Promise.all(pList);
    for (let i = 0; i < poolInfo.length; i++) {
        addContract("pools", poolNames[i], {
            ...poolInfo,
            rewards: [{ rToken: crv, rAddress: poolInfo[i]["crvRewards"] }],
            name: poolNames[i],
            id: i,
        });
    }

    const contractListOutput = JSON.stringify(contractList, null, 4);
    console.log(contractListOutput);
});
