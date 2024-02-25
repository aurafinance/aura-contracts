import { expect } from "chai";
import { BigNumber } from "ethers";
import hre from "hardhat";

import { Phase2Deployed, Phase6Deployed, Phase8Deployed } from "../../scripts/deploySystem";
import { config as arbitrumConfig } from "../../tasks/deploy/arbitrum-config";
import { config } from "../../tasks/deploy/mainnet-config";
import { lzChainIds, sidechainConfigs } from "../../tasks/deploy/sidechain-constants";
import { chainIds, getSigner } from "../../tasks/utils";
import { TestSuiteDeployment, setupForkDeployment } from "../../test-fork/sidechain/setupForkDeployments";
import {
    ONE_DAY,
    ZERO_ADDRESS,
    getTimestamp,
    impersonateAccount,
    increaseTimeTo,
    simpleToExactAmount,
} from "../../test-utils";
import {
    Account,
    Booster,
    BoosterLite,
    ChefForwarder,
    ChefForwarder__factory,
    ChildStashRewardDistro,
    ERC20,
    SiphonToken,
    SiphonToken__factory,
} from "../../types";
import { ChildGaugeVoteRewards } from "../../types/generated/ChildGaugeVoteRewards";
import { GaugeVoteRewards } from "../../types/generated/GaugeVoteRewards";
import { StashRewardDistro } from "../../types/generated/StashRewardDistro";
import { GaugeVoteRewards__factory } from "../../types/generated/factories/GaugeVoteRewards__factory";

const FORK_BLOCK = 19231660; // New contracts deployed && GaugeVoter Configured

const L1_CHAIN_ID = 101; // Ethereum
const L2_CHAIN_ID = 110; // Arbitrum

const noDepositGauges = [
    "0x1e916950a659da9813ee34479bff04c732e03deb",
    "0x956074628a64a316086f7125074a8a52d3306321",
    "0xa86e8e8cfae8c9847fa9381d4631c13c7b3466bd",
];

const dstChainGauges = {
    ["101"]: [
        "0x0021e01b9fab840567a8291b864ff783894eabc6",
        "0x05266a0d5ac04e44d394b8a8a2d0935d8809692b",
        "0x10a361766e64d7983a97202ac3a0f4cee06eb717",
        "0x1249c510e066731ff14422500466a7102603da9e",
        "0x15c84754c7445d0df6c613f1490ca07654347c1b",
        "0x183d73da7adc5011ec3c46e33bb50271e59ec976",
        "0x27fd581e9d0b2690c2f808cd40f7fe667714b575",
        "0x2c2179abce3413e27bda6917f60ae37f96d01826",
        "0x2d42910d826e5500579d121596e98a6eb33c0a1b",
        "0x3c8502e60ebd1e036e1d3906fc34e9616218b6e5",
        "0x44bc38d3af025c0ea9a4729e79d6e44244d68ac6",
        "0x46804462f147ff96e9cafb20ca35a3b2600656df",
        "0x47c56a900295df5224ec5e6751dc31eb900321d5",
        "0x53fa0546f307317daa82371e94e8dcd5cad3345f",
        "0x5c0f23a5c1be65fa710d385814a7fd1bda480b1c",
        "0x6661136537dfdca26eea05c8500502d7d5796e5e",
        "0x6a58e7c904ecf991a3183d28fc73be90732b7a30",
        "0x6be156504cda8ee38169be96bcf53aeab4377c1a",
        "0x6d560cbe3cc25eca8c930835ec3d296a6c16b210",
        "0x70754ab20c63cc65ea12206cf28342723d731ac6",
        "0x78a54c8f4eaba82e45cbc20b9454a83cb296e09e",
        "0x79ef6103a513951a3b25743db509e267685726b7",
        "0x85d6840eab7473b60f10d1a3e2452243eb702c97",
        "0xa1d5b81d0024809faa278ab72fe3d2fb467dd28b",
        "0xa8b309a75f0d64ed632d45a003c68a30e59a1d8b",
        "0xbc02ef87f4e15ef78a571f3b2adcc726fee70d8b",
        "0xbf65b3fa6c208762ed74e82d4aefcddfd0323648",
        "0xc592c33e51a764b94db0702d8baf4035ed577aed",
        "0xc859bf9d7b8c557bbd229565124c2c09269f3aef",
        "0xdf54d2dd06f8be3b0c4ffc157be54ec9cca91f3c",
        "0xf17f1e67bc384e43b4acf69cc032ad086f15f262",
        "0xf22bbdad6b3dd9314bdf97724df32b09ff95c216",
        "0xf6a7ad46b00300344c7d4739c0518db70e722dc4",
        "0xf720e9137baa9c7612e6ca59149a5057ab320cfa",
    ],
    ["109"]: [
        // Polygon
        "0x16289f675ca54312a8fcf99341e7439982888077",
        "0x82bcad0c8f51d88ec339141f0d8953bc25cc3d8c",
        "0x852580e3e1c0fd35de426c5481670c1772525265",
        "0x9965713498c74aee49cef80b2195461f188f24f8",
        "0x9e5b7e6b61529571e98c8f16d07794ea99a7a930",
        "0xe9b5f4d892df284a15ec90a58bd4385e57964f18",
        "0xa4c104ab9116a84714c081e0ed6d750221e4c756",
        "0xd103dd49b8051a09b399a52e9a8ab629392de2fb",
    ],

    ["110"]: [
        // Arbitrum
        "0x00b9bcd17cb049739d25fd7f826caa2e23b05620",
        "0x0edf6cdd81bc3471c053341b7d8dfd1cb367ad93",
        "0x175407b4710b5a1cb67a37c76859f17fb2ff6672",
        "0x91ceeb8d46428c5b8d76debc8156992e45d2d63f",
        "0xa1dde34d48868f9e0901592f2a97e20f76004059",
        "0xa8d974288fe44acc329d7d7a179707d27ec4dd1c",
        "0xb66e8d615f8109ca52d47d9cb65fc4edcf9c1342",
        "0xb6d101874b975083c76598542946fe047f059066",
        "0x1461c4a373d27977f0d343ba33c22870c89f9df0",
        "0x25869f277f474fa9459f40f5d4cb0d6a8ab41967",
        "0x329caebb9be5144c5727347f64f8b3a3b109ec57",
        "0x671ed21480acf63b0ab7297b901505f5bccafa9b",
        "0x8135d6abfd42707a87a7b94c5cfa3529f9b432ad",
        "0x49f530b45ae792cdf5cbd5d25c5a9b9e59c6c3b8",
        "0x56c0626e6e3931af90ebb679a321225180d4b32b",
        "0x5b006e53df539773e109dbbf392deff6e87e2781",
        "0x62a82fe26e21a8807599374cac8024fae342ef83",
        "0x8f44a8cfb7fe682295fa663348060533732f437c",
    ],
    ["111"]: [
        // Optimism
        "0x20d03f9d0304744891881e6ac1d45b996e7f39b5",
        "0x057e7b14dc461f071958e0bbf42b5597564d4e6c",
        "0x0a2738a1eeada91da6d5375a2e6f620c85c287f3",
        "0x132296d1dfd10ba55b565c4cfe49d350617a2a2b",
        "0x2e6cd45581002c894cac692dce4a30632125ef99",
        "0x5622821a3b993f062ff691478bbb7d551c167321",
        "0xa5893cf81150aa61a0b33950c1b13c5251c19a10",
        "0xb17f2f3de17d5013e7cc8ceb4ec2be02c6cc1501",
        "0xdacd99029b4b94cd04fe364aac370829621c1c64",
        "0x6a2c2d4502335638d2c2f40f0171253fb2c2db88",
        "0x730a168cf6f501cf302b803ffc57ff3040f378bf",
        "0x8c596e8d1b3be04a6caa1b1152b51c495f799a16",
        "0x8e486dbacb74c00dd31e489da93d99bbebe36cd5",
    ],
    ["145"]: [
        // Gnosis
        "0x41a8243656bcf628ac92189558f70d371dd08b4e",
        "0x2041f8a758a0266e1b9272fcd4b1f1c37b67d5da",
        "0x346f1d4f98f055bb0791465923e27a10f1082912",
        "0x64fced4684f4b065e6b900c4e99a0cbacc5e5fe1",
        "0xceb17d5c8ef8556ed0424a4bebc35a5d562d96e2",
        "0xb1af0d75aeea1c13c450ffc7e12083072daf41eb",
        "0xa9659365461380e8a6b30a50d421c1f5fcd8a8bc",
        "0xf8c85bd74fee26831336b51a90587145391a27ba",
        "0x2617724db92a8dbd4eba7e24615ba369133ff684",
        "0x93ae6971f03ce890fa4e9274ab441477b84dae5f",
    ],
    ["158"]: [
        // zkEVM
        "0x255912af1ba318527edc69b4d56152d8c133288e",
        "0x42a3290a65ca16adaf161c6ffafdbe0913a169f4",
    ],
};

// Voting
const gauges = [
    "0x6d560cbe3cc25eca8c930835ec3d296a6c16b210",
    "0x25869f277f474fa9459f40f5d4cb0d6a8ab41967",
    "0xf17f1e67bc384e43b4acf69cc032ad086f15f262",
    "0xa9659365461380e8a6b30a50d421c1f5fcd8a8bc",
    "0xb66e8d615f8109ca52d47d9cb65fc4edcf9c1342",
    "0x16289f675ca54312a8fcf99341e7439982888077",
    "0x0021e01b9fab840567a8291b864ff783894eabc6",
    "0xa1dde34d48868f9e0901592f2a97e20f76004059",
    "0x56c0626e6e3931af90ebb679a321225180d4b32b",
    "0x1e916950a659da9813ee34479bff04c732e03deb",
    "0x93ae6971f03ce890fa4e9274ab441477b84dae5f",
    "0xdf54d2dd06f8be3b0c4ffc157be54ec9cca91f3c",
    "0x10a361766e64d7983a97202ac3a0f4cee06eb717",
    "0x91ceeb8d46428c5b8d76debc8156992e45d2d63f",
    "0x41a8243656bcf628ac92189558f70d371dd08b4e",
    "0x49f530b45ae792cdf5cbd5d25c5a9b9e59c6c3b8",
    "0x852580e3e1c0fd35de426c5481670c1772525265",
    "0x2c2179abce3413e27bda6917f60ae37f96d01826",
    "0x255912af1ba318527edc69b4d56152d8c133288e",
    "0xf6a7ad46b00300344c7d4739c0518db70e722dc4",
    "0x8c596e8d1b3be04a6caa1b1152b51c495f799a16",
    "0x5622821a3b993f062ff691478bbb7d551c167321",
    "0x8f44a8cfb7fe682295fa663348060533732f437c",
    "0xa8b309a75f0d64ed632d45a003c68a30e59a1d8b",
    "0x47c56a900295df5224ec5e6751dc31eb900321d5",
    "0x1249c510e066731ff14422500466a7102603da9e",
    "0x1461c4a373d27977f0d343ba33c22870c89f9df0",
    "0x62a82fe26e21a8807599374cac8024fae342ef83",
    "0xb17f2f3de17d5013e7cc8ceb4ec2be02c6cc1501",
    "0x2041f8a758a0266e1b9272fcd4b1f1c37b67d5da",
    "0x175407b4710b5a1cb67a37c76859f17fb2ff6672",
    "0x20d03f9d0304744891881e6ac1d45b996e7f39b5",
    "0xe9b5f4d892df284a15ec90a58bd4385e57964f18",
    "0x6661136537dfdca26eea05c8500502d7d5796e5e",
    "0x46804462f147ff96e9cafb20ca35a3b2600656df",
    "0x2d42910d826e5500579d121596e98a6eb33c0a1b",
    "0x8e486dbacb74c00dd31e489da93d99bbebe36cd5",
    "0x183d73da7adc5011ec3c46e33bb50271e59ec976",
    "0xd103dd49b8051a09b399a52e9a8ab629392de2fb",
    "0x730a168cf6f501cf302b803ffc57ff3040f378bf",
    "0xceb17d5c8ef8556ed0424a4bebc35a5d562d96e2",
    "0x8135d6abfd42707a87a7b94c5cfa3529f9b432ad",
    "0xa4c104ab9116a84714c081e0ed6d750221e4c756",
    "0x9965713498c74aee49cef80b2195461f188f24f8",
    "0x05266a0d5ac04e44d394b8a8a2d0935d8809692b",
    "0x42a3290a65ca16adaf161c6ffafdbe0913a169f4",
    "0x6a58e7c904ecf991a3183d28fc73be90732b7a30",
    "0x44bc38d3af025c0ea9a4729e79d6e44244d68ac6",
    "0x70754ab20c63cc65ea12206cf28342723d731ac6",
    "0xf22bbdad6b3dd9314bdf97724df32b09ff95c216",
    "0xa8d974288fe44acc329d7d7a179707d27ec4dd1c",
    "0xb1af0d75aeea1c13c450ffc7e12083072daf41eb",
    "0x132296d1dfd10ba55b565c4cfe49d350617a2a2b",
    "0x64fced4684f4b065e6b900c4e99a0cbacc5e5fe1",
    "0x346f1d4f98f055bb0791465923e27a10f1082912",
    "0xbc02ef87f4e15ef78a571f3b2adcc726fee70d8b",
    "0x2617724db92a8dbd4eba7e24615ba369133ff684",
    "0x6a2c2d4502335638d2c2f40f0171253fb2c2db88",
    "0x0edf6cdd81bc3471c053341b7d8dfd1cb367ad93",
    "0x0a2738a1eeada91da6d5375a2e6f620c85c287f3",
    "0xc592c33e51a764b94db0702d8baf4035ed577aed",
    "0x057e7b14dc461f071958e0bbf42b5597564d4e6c",
    "0xdacd99029b4b94cd04fe364aac370829621c1c64",
    "0x5c0f23a5c1be65fa710d385814a7fd1bda480b1c",
    "0x329caebb9be5144c5727347f64f8b3a3b109ec57",
    "0x5b006e53df539773e109dbbf392deff6e87e2781",
    "0x6be156504cda8ee38169be96bcf53aeab4377c1a",
    "0xc859bf9d7b8c557bbd229565124c2c09269f3aef",
    "0xa5893cf81150aa61a0b33950c1b13c5251c19a10",
    "0x27fd581e9d0b2690c2f808cd40f7fe667714b575",
    "0x9e5b7e6b61529571e98c8f16d07794ea99a7a930",
    "0x00b9bcd17cb049739d25fd7f826caa2e23b05620",
    "0xa1d5b81d0024809faa278ab72fe3d2fb467dd28b",
    "0xf8c85bd74fee26831336b51a90587145391a27ba",
    "0xbf65b3fa6c208762ed74e82d4aefcddfd0323648",
    "0x85d6840eab7473b60f10d1a3e2452243eb702c97",
    "0xb6d101874b975083c76598542946fe047f059066",
    "0x671ed21480acf63b0ab7297b901505f5bccafa9b",
    "0x82bcad0c8f51d88ec339141f0d8953bc25cc3d8c",
    "0x3c8502e60ebd1e036e1d3906fc34e9616218b6e5",
    "0x2e6cd45581002c894cac692dce4a30632125ef99",
    "0x956074628a64a316086f7125074a8a52d3306321",
    "0xa86e8e8cfae8c9847fa9381d4631c13c7b3466bd",
    "0x15c84754c7445d0df6c613f1490ca07654347c1b",
    "0x79ef6103a513951a3b25743db509e267685726b7",
    "0x78a54c8f4eaba82e45cbc20b9454a83cb296e09e",
    "0xf720e9137baa9c7612e6ca59149a5057ab320cfa",
    "0x53fa0546f307317daa82371e94e8dcd5cad3345f",
];

const weights = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1847, 188, 56, 29, 38, 287, 16, 21, 24, 70, 119, 110, 96, 18,
    26, 16, 12, 33, 55, 357, 33, 118, 27, 146, 95, 78, 28, 16, 28, 11, 15, 17, 15, 64, 244, 27, 210, 350, 27, 253, 95,
    47, 295, 29, 53, 261, 133, 26, 24, 105, 182, 26, 47, 28, 407, 103, 182, 87, 48, 93, 24, 34, 13, 154, 32, 36, 1735,
    205, 242, 34,
];

const hasGaugeWeight = (g: string) => {
    if (noDepositGauges.includes(g)) return false;
    const idx = gauges.indexOf(g);
    const weight = weights[idx];
    return weight > 0;
};

const l1GaugesWithVotes = dstChainGauges[L1_CHAIN_ID].filter(hasGaugeWeight);

const l2GaugesWithVotes = dstChainGauges[L2_CHAIN_ID].filter(hasGaugeWeight);

describe("AIP-63", () => {
    let deployer: Account;

    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    let phase8: Phase8Deployed;
    let ctx: TestSuiteDeployment;

    let gaugeVoteRewards: GaugeVoteRewards;
    let stashRewardDistro: StashRewardDistro;
    let gaugeVoteRewardsOld: GaugeVoteRewards;

    let siphonToken: SiphonToken;
    let chefForwarder: ChefForwarder;
    const pid = 6; // New Siphone token pid

    before(async () => {
        await hre.network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: FORK_BLOCK,
                    },
                },
            ],
        });

        deployer = await impersonateAccount(await (await getSigner(hre)).getAddress());

        phase2 = await config.getPhase2(deployer.signer);
        phase6 = await config.getPhase6(deployer.signer);
        phase8 = await config.getPhase8(deployer.signer);

        ctx = await setupForkDeployment(hre, config, arbitrumConfig, deployer, lzChainIds[chainIds.arbitrum]);

        const voteRewards = config.getGaugeVoteRewards(deployer.signer);

        gaugeVoteRewards = voteRewards.gaugeVoteRewards;
        stashRewardDistro = voteRewards.stashRewardDistro;

        gaugeVoteRewardsOld = GaugeVoteRewards__factory.connect(
            "0x54231C588b698dc9B91303C95c85F050DA35189B",
            deployer.signer,
        );

        // AIP-63
        siphonToken = SiphonToken__factory.connect("0xFEDa1CdA61C7F066d19B774599a2DE6e516129E8", deployer.signer);
        chefForwarder = ChefForwarder__factory.connect("0x7253584f04fC34C9979C570a170dc70D00A0ccF8", deployer.signer);
    });
    /**
     * Advance to the next epoch which starts on
     * Thursday, making the assumption that we are
     * currently on tuesday as that is the day FORK_BLOCK
     * is because the vote is on tuesday
     */
    async function advanceToThursday() {
        const getCurrentEpoch = () => stashRewardDistro.getCurrentEpoch();

        const epoch0 = await getCurrentEpoch();
        const ts = await getTimestamp();
        const d = new Date(ts.mul(1000).toNumber());
        const day = d.getDay();
        // If day is past thursday (4) then count amount of days to get back round
        // If the day lest than thursday then just count amount of days to thursday
        const advanceDays = day < 4 ? 4 - day : 7 - day + 4;
        d.setTime(ts.add(ONE_DAY.mul(advanceDays)).mul(1000).toNumber());
        const newTs = d.getTime() / 1000;
        await increaseTimeTo(newTs);
        const epoch1 = await getCurrentEpoch();
        expect(epoch1).eq(epoch0.add(1));
    }
    async function expectAuraToBeQueuedOnStash(
        gauge: string,
        distro: StashRewardDistro | ChildStashRewardDistro,
        voteRewards: GaugeVoteRewards | ChildGaugeVoteRewards,
        booster: Booster | BoosterLite,
        cvx: ERC20,
    ) {
        const epoch = await distro.getCurrentEpoch();
        const pid = await voteRewards.getPoolId(gauge);
        expect(pid.isSet, "PID not set").eq(true);

        const poolInfo = await booster.poolInfo(pid.value);

        const getFunds = () => distro.getFunds(epoch, pid.value, cvx.address);
        const getStashAuraBalance = () => cvx.balanceOf(poolInfo.stash);

        const funds0 = await getFunds();
        const stashAuraBalance0 = await getStashAuraBalance();

        await distro.functions["queueRewards(uint256,address)"](pid.value.toString(), cvx.address);

        const funds1 = await getFunds();
        const stashAuraBalance1 = await getStashAuraBalance();

        expect(stashAuraBalance1.sub(stashAuraBalance0)).gte(funds0);
        expect(funds1).eq(0);
    }

    describe("New Contracts setup", () => {
        async function expectSidechainConfiguration(chainId: number) {
            const lzChainId = lzChainIds[chainId];
            const sidechainConfig = sidechainConfigs[chainId];
            const childGaugeVoteRewardsAddress = sidechainConfig.getSidechain(deployer.signer).childGaugeVoteRewards
                .address;
            expect((await gaugeVoteRewards.getTrustedRemoteAddress(lzChainId)).toLowerCase()).eq(
                childGaugeVoteRewardsAddress.toLowerCase(),
            );
            expect((await gaugeVoteRewards.getChildGaugeVoteRewards(lzChainId)).toLowerCase()).eq(
                childGaugeVoteRewardsAddress.toLowerCase(),
            );
        }

        it("GaugeVoteRewards has correct config", async () => {
            expect(await gaugeVoteRewards.aura()).eq(phase2.cvx.address);
            expect(await gaugeVoteRewards.auraOFT()).eq(ctx.canonical.auraProxyOFT.address);
            expect(await gaugeVoteRewards.booster()).eq(phase6.booster.address);
            expect(await gaugeVoteRewards.stashRewardDistro()).eq(stashRewardDistro.address);
            expect(await gaugeVoteRewards.lzChainId()).eq(lzChainIds[chainIds.mainnet]);
            expect(await gaugeVoteRewards.lzEndpoint()).eq(ctx.l1LzEndpoint.address);
            expect(await gaugeVoteRewards.distributor()).eq("0x817F426B5a79599464488eCCf82c3F54b9330E15"); // KeeperMulticall

            // Multichain configuration
            await expectSidechainConfiguration(chainIds.arbitrum);
            await expectSidechainConfiguration(chainIds.optimism);
            await expectSidechainConfiguration(chainIds.base);
            await expectSidechainConfiguration(chainIds.gnosis);
            await expectSidechainConfiguration(chainIds.polygon);
            await expectSidechainConfiguration(chainIds.zkevm);
        });
        it("GaugeVoteRewards has correct owner", async () => {
            const ownerAddress = await gaugeVoteRewards.owner();
            if (ownerAddress.toLowerCase() !== ctx.dao.address) {
                console.warn("!!!Do not forget to transferOwnership to DAO");
                await gaugeVoteRewards.transferOwnership(ctx.dao.address);
            }
            expect(ownerAddress).to.not.be.eq(ZERO_ADDRESS);
        });
        it("GaugeVoteRewards has correct rewardPerEpoch", async () => {
            const rewardPerEpoch = await gaugeVoteRewards.rewardPerEpoch();
            expect(rewardPerEpoch).to.be.eq(simpleToExactAmount(76_500));
        });
        it("SiphonToken has correct config", async () => {
            expect(await siphonToken.name()).to.be.eq("ChefSiphon");
            expect(await siphonToken.symbol()).to.be.eq("ChefSiphon");
            expect(await siphonToken.totalSupply()).to.be.eq(simpleToExactAmount(1));
        });
        it("ChefForwarder has correct config", async () => {
            expect(await chefForwarder.owner()).to.be.eq(ctx.dao.address);
            expect(await chefForwarder.chef()).to.be.eq(phase2.chef.address);
            // This has to be configured later on
            expect(await chefForwarder.pid()).to.be.eq(0);
            expect(await chefForwarder.briber()).to.be.eq(ZERO_ADDRESS);
        });
    });
    describe("[DAO] setup", () => {
        describe("MasterChef", async () => {
            it("add chef forwarder", async () => {
                const allocPoints = 20;
                const totalAllocationPoinsBefore = await phase2.chef.totalAllocPoint();
                const poolLengthBefore = await phase2.chef.poolLength();

                // Add
                await phase2.chef.connect(ctx.dao.signer).add(allocPoints, siphonToken.address, ZERO_ADDRESS);

                const poolInfo = await phase2.chef.poolInfo(poolLengthBefore);

                // Verify
                expect(await phase2.chef.isAddedPool(siphonToken.address)).to.be.eq(true);
                expect(await phase2.chef.totalAllocPoint()).to.be.eq(totalAllocationPoinsBefore.add(allocPoints));
                expect(await phase2.chef.poolLength()).to.be.eq(poolLengthBefore.add(1));
                expect(poolInfo.lpToken).to.be.eq(siphonToken.address);
                expect(poolInfo.allocPoint).to.be.eq(allocPoints);
                expect(poolInfo.rewarder).to.be.eq(ZERO_ADDRESS);
            });
        });

        describe("ChefForwarder", async () => {
            it("setup ", async () => {
                await chefForwarder.connect(ctx.dao.signer).setBriber(config.multisigs.treasuryMultisig);
                await chefForwarder.connect(ctx.dao.signer).setPid(pid);

                expect(await chefForwarder.pid()).to.be.eq(pid);
                expect(await chefForwarder.briber()).to.be.eq(config.multisigs.treasuryMultisig);
            });
            it("only treasury can claim", async () => {
                const errorMsg = "!briber";
                await expect(chefForwarder.claim(ZERO_ADDRESS)).to.be.revertedWith(errorMsg);
            });
            it("deposit siphon token", async () => {
                await chefForwarder.connect(ctx.dao.signer).deposit(siphonToken.address);

                expect(await siphonToken.balanceOf(phase2.chef.address)).to.be.eq(simpleToExactAmount(1));
            });
        });

        describe("BoosterOwnerSecondary", async () => {
            it("sets new delegate voter", async () => {
                await phase8.boosterOwnerSecondary.connect(ctx.dao.signer).setVoteDelegate(gaugeVoteRewards.address);

                expect(await phase6.booster.voteDelegate()).to.be.eq(gaugeVoteRewards.address);
            });
            it("recover aura from old gauge voter", async () => {
                const balance = await phase2.cvx.balanceOf(gaugeVoteRewardsOld.address);

                await gaugeVoteRewardsOld
                    .connect(ctx.dao.signer)
                    .transferERC20(phase2.cvx.address, gaugeVoteRewards.address, balance);

                expect(await phase2.cvx.balanceOf(gaugeVoteRewards.address)).to.be.eq(balance);
            });
        });
    });
    describe("Voting", () => {
        // Setup Gauge Voter
        before(advanceToThursday);
        it("sets no deposit gauges", async () => {
            // Currently deployer is the owner
            for (const idx in noDepositGauges) {
                const gauge = noDepositGauges[idx];
                await gaugeVoteRewards.connect(ctx.dao.signer).setIsNoDepositGauge(gauge, true);
                expect(await gaugeVoteRewards.isNoDepositGauge(gauge)).to.be.eq(true);
            }
        });

        it("set dst chain IDs", async () => {
            for (const dstChainId in dstChainGauges) {
                if (dstChainId === "101") continue;
                // const dstChainId = dstChainGauges[idx]
                // Owner currently is deployer .connect(ctx.dao.signer)
                await gaugeVoteRewards.connect(ctx.dao.signer).setDstChainId(dstChainGauges[dstChainId], dstChainId);
                for (const gauge of dstChainGauges[dstChainId]) {
                    expect((await gaugeVoteRewards.getDstChainId(gauge)).toString()).eq(dstChainId);
                }
            }
        });
        it("can vote for underlying gauges", async () => {
            const tx = await gaugeVoteRewards.connect(ctx.dao.signer).voteGaugeWeight(gauges, weights);
            const resp = await tx.wait();

            console.log("Gas used:", resp.cumulativeGasUsed.toString());

            const epoch = await gaugeVoteRewards.getCurrentEpoch();

            let sumOfDepositWeights = BigNumber.from(0);

            for (let i = 0; i < weights.length; i++) {
                const weight = weights[i];
                const gauge = gauges[i];
                const isNoDepositGauge = await gaugeVoteRewards.isNoDepositGauge(gauge);
                if (!isNoDepositGauge) {
                    sumOfDepositWeights = BigNumber.from(weight).add(sumOfDepositWeights);
                    expect(await gaugeVoteRewards.getWeightByEpoch(epoch, gauge)).eq(weight);
                }
            }

            expect(await gaugeVoteRewards.getTotalWeight(epoch)).eq(sumOfDepositWeights);
        });
    });
    describe("Process rewards", () => {
        it("can process rewards mainnet", async () => {
            const voteRewardBalance = async () => phase2.cvx.balanceOf(gaugeVoteRewards.address);
            const stashDistroBalance = async () => phase2.cvx.balanceOf(stashRewardDistro.address);

            const epoch = await gaugeVoteRewards.getCurrentEpoch();

            const voteRewardBalance0 = await voteRewardBalance();
            const stashDistroBalance0 = await stashDistroBalance();
            // To facilitate change the distributor
            await gaugeVoteRewards.connect(ctx.dao.signer).setDistributor(ctx.dao.address);

            await gaugeVoteRewards.connect(ctx.dao.signer).processGaugeRewards(epoch, l1GaugesWithVotes);
            const voteRewardBalance1 = await voteRewardBalance();
            const stashDistroBalance1 = await stashDistroBalance();

            expect(voteRewardBalance0.sub(voteRewardBalance1)).gt(0);
            expect(stashDistroBalance1.sub(stashDistroBalance0)).gt(0);

            for (const gauge of l1GaugesWithVotes) {
                const currentEpoch = await stashRewardDistro.getCurrentEpoch();
                const pid = await gaugeVoteRewards.getPoolId(gauge);
                const funds = await stashRewardDistro.getFunds(currentEpoch.add(1), pid.value, phase2.cvx.address);
                expect(funds).gt(0);
            }
        });
        it("can process rewards sidechain", async () => {
            const auraOftBalance = () => phase2.cvx.balanceOf(ctx.canonical.auraProxyOFT.address);
            const voteRewardBalance = async () => phase2.cvx.balanceOf(gaugeVoteRewards.address);

            const epoch = await gaugeVoteRewards.getCurrentEpoch();

            const auraOftBalance0 = await auraOftBalance();
            const voteRewardBalance0 = await voteRewardBalance();
            await gaugeVoteRewards
                .connect(ctx.dao.signer)
                .processSidechainGaugeRewards(
                    l2GaugesWithVotes,
                    epoch,
                    L2_CHAIN_ID,
                    ZERO_ADDRESS,
                    ZERO_ADDRESS,
                    [],
                    [],
                    { value: simpleToExactAmount(0.2) },
                );
            const auraOftBalance1 = await auraOftBalance();
            const voteRewardBalance1 = await voteRewardBalance();
            const auraDelta = auraOftBalance1.sub(auraOftBalance0);

            expect(auraOftBalance1.sub(auraOftBalance0)).gt(0);
            expect(voteRewardBalance0.sub(voteRewardBalance1)).eq(auraDelta);
        });
        describe("first epoch", () => {
            before(advanceToThursday);
            describe("queue rewards for mainnet", async () => {
                for (let i = 0; i < l1GaugesWithVotes.length; i++) {
                    const gauge = l1GaugesWithVotes[i];
                    it(`(${i.toString().padStart(3, "0")}) gauge: ${gauge}`, async () => {
                        await expectAuraToBeQueuedOnStash(
                            gauge,
                            stashRewardDistro,
                            gaugeVoteRewards,
                            phase6.booster,
                            phase2.cvx,
                        );
                    });
                }
            });
        });
        describe("second epoch", () => {
            before(advanceToThursday);
            describe("queue rewards for mainnet", async () => {
                for (let i = 0; i < l1GaugesWithVotes.length; i++) {
                    const gauge = l1GaugesWithVotes[i];
                    it(`(${i.toString().padStart(3, "0")}) gauge: ${gauge}`, async () => {
                        await expectAuraToBeQueuedOnStash(
                            gauge,
                            stashRewardDistro,
                            gaugeVoteRewards,
                            phase6.booster,
                            phase2.cvx,
                        );
                    });
                }
            });
        });
    });
    describe("Claim from chef forwarder", async () => {
        it("treasury claims cvx from master chef", async () => {
            const treasuryMultisig = await impersonateAccount(config.multisigs.treasuryMultisig);
            const balanceBefore = await phase2.cvx.balanceOf(treasuryMultisig.address);

            await chefForwarder.connect(treasuryMultisig.signer).claim(phase2.cvx.address);

            const balanceAfter = await phase2.cvx.balanceOf(treasuryMultisig.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
            // EVENT AuraToken.Transfer(from=0x7253584f04fC34C9979C570a170dc70D00A0ccF8, to=0xfc78f8e1Af80A3bF5A1783BB59eD2d1b10f78cA9, value=6849315068493000000)
        });
    });
});
