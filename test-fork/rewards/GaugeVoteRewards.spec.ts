import { expect } from "chai";
import { BigNumber } from "ethers";
import * as fs from "fs";
import hre from "hardhat";
import * as path from "path";

import { Phase2Deployed, Phase6Deployed, Phase8Deployed } from "../../scripts/deploySystem";
import { config as arbitrumConfig } from "../../tasks/deploy/arbitrum-config";
import { config } from "../../tasks/deploy/mainnet-config";
import { getSigner } from "../../tasks/utils";
import { TestSuiteDeployment, setupForkDeployment } from "../../test-fork/sidechain/setupForkDeployments";
import { setupLocalDeployment } from "../../test-fork/sidechain/setupLocalDeployment";
import {
    ONE_DAY,
    ONE_WEEK,
    ZERO,
    ZERO_ADDRESS,
    getTimestamp,
    impersonateAccount,
    increaseTime,
    increaseTimeTo,
    simpleToExactAmount,
} from "../../test-utils";
import {
    Account,
    BaseRewardPool__factory,
    Booster,
    BoosterLite,
    ChildStashRewardDistro,
    ChildStashRewardDistro__factory,
    ERC20,
    ExtraRewardStashV3__factory,
    IStakelessGauge__factory,
} from "../../types";
import { ChildGaugeVoteRewards } from "../../types/generated/ChildGaugeVoteRewards";
import { GaugeVoteRewards } from "../../types/generated/GaugeVoteRewards";
import { StashRewardDistro } from "../../types/generated/StashRewardDistro";
import { ChildGaugeVoteRewards__factory } from "../../types/generated/factories/ChildGaugeVoteRewards__factory";
import { GaugeVoteRewards__factory } from "../../types/generated/factories/GaugeVoteRewards__factory";
import { StashRewardDistro__factory } from "../../types/generated/factories/StashRewardDistro__factory";

const L1_CHAIN_ID = 101; // Ethereum
const L2_CHAIN_ID = 110; // Arbitrum

const VERSION_STATUS = {
    // blocks
    V1_BEFORE: 17670930,
    V1_DEPLOYED: 17913543, // 18975313
    V2_BEFORE: 19062280,
};
const FORK_BLOCK = VERSION_STATUS.V2_BEFORE;

const noDepositGauges = [
    "0xb78543e00712C3ABBA10D0852f6E38FDE2AaBA4d",
    "0x56124eb16441A1eF12A4CCAeAbDD3421281b795A",
    "0x5b79494824Bc256cD663648Ee1Aad251B32693A9",
];

// Gauges and vote weights from last round based on the FORK_BLOCK
const gauges = [
    "0xBC02eF87f4E15EF78A571f3B2aDcC726Fee70d8b",
    "0xA2a9Ebd6f4dEA4802083F2C8D08066A4e695e64B",
    "0x70c6A653e273523FADfB4dF99558737906c230c6",
    "0x11Ff498C7c2A29fc4638BF45D9fF995C3297fcA5",
    "0x0052688295413b32626D226a205b95cDB337DE86",
    "0x47D7269829Ba9571D98Eb6DDc34e9C8f1A4C327f", // 137
    "0xd1c070eBc7Ec77f2134b3Ef75283b6C1fb31a157",
    "0x5aF3B93Fb82ab8691b82a09CBBae7b8D3eB5Ac11",
    "0x87012b0C3257423fD74a5986F81a0f1954C17a1d",
    "0x54BeFB03BB58687cDE09cd082Bd78410e309D8C7", // 42161
    "0xDaCD99029b4B94CD04fE364aAc370829621C1C64", // 10
    "0x47c56A900295df5224EC5e6751dC31eb900321D5",
    "0x454eb2f12242397688DbfdA241487e67ed80507a",
    "0xF17F1E67bc384E43b4acf69cc032AD086f15f262",
    "0xbf65b3fA6c208762eD74e82d4AEfCDDfd0323648",
    "0xd8191A3496a1520c2B5C81D04B26F8556Fc62d7b",
    "0xCB664132622f29943f67FA56CCfD1e24CC8B4995",
    "0xE5f24cD43f77fadF4dB33Dab44EB25774159AC66",
    "0xE879f17910E77c01952b97E4A098B0ED15B6295c",
    "0x7C777eEA1dC264e71E567Fcc9B6DdaA9064Eff51",
    "0x46804462f147fF96e9CAFB20cA35A3B2600656DF",
    "0x57AB3b673878C3fEaB7f8FF434C40Ab004408c4c",
    "0x3B6A85B5e1e6205ebF4d4eabf147D10e8e4bf0A5", // 100
    "0x39a9E78c3b9b5B47f1f6632BD74890E2430215Cf",
    "0x183D73dA7adC5011EC3C46e33BB50271e59EC976",
    "0x95201B61EF19C867dA0D093DF20021e1a559452c",
    "0xE41736b4e78be41Bd03EbAf8F86EA493C6e9EA96", // 100
    "0xcB2c2AF6c3E88b4a89aa2aae1D7C8120EEe9Ad0e", // 100
    "0xb78543e00712C3ABBA10D0852f6E38FDE2AaBA4d", // veBAL
    "0x21b2Ef3DC22B7bd4634205081c667e39742075E2", // 100
    "0x7F75ecd3cFd8cE8bf45f9639A226121ca8bBe4ff", // 100
    "0xc61e7E858b5a60122607f5C7DF223a53b01a1389", // 100
    "0x16289F675Ca54312a8fCF99341e7439982888077", // 137
    "0xcD4722B7c24C29e0413BDCd9e51404B4539D14aE",
    "0x27Fd581E9D0b2690C2f808cd40f7fe667714b575",
    "0x19A13793af96f534F0027b4b6a3eB699647368e7",
    "0xCd8bB8cEBc794842967849255C234e7b7619A518",
    "0x190AE1f6EE5c0B7bc193fA9CD9bBe9b335F69C65",
    "0x6661136537dfDCA26EEA05c8500502d7D5796E5E",
    "0x0EDF6cDd81BC3471C053341B7D8Dfd1Cb367AD93", // 42161
    "0x10a361766e64D7983a97202ac3a0F4cee06Eb717",
    "0xf8C85bd74FeE26831336B51A90587145391a27Ba", // 100
    "0x0312AA8D0BA4a1969Fddb382235870bF55f7f242",
    "0x3F29e69955E5202759208DD0C5E0BA55ff934814",
    "0x082AACfaf4db8AC0642CBED50df732D3C309E679", // 137
    "0x37eCa8DaaB052E722e3bf8ca861aa4e1C047143b",
    "0xDd3b4161D2a4c609884E20Ed71b4e85BE44572E6", // 137
    "0x2D42910D826e5500579D121596E98A6eb33C0a1b",
    "0xf7B0751Fea697cf1A541A5f57D11058a8fB794ee",
    "0xF7d515DC47d5BD57786494628ed766d6bF31cd39", // 1101
    "0x539D6eDbd16F2F069A06716416C3a6E98cC29DD0", // 137
    "0x275dF57d2B23d53e20322b4bb71Bf1dCb21D0A00",
    "0x2e79D6f631177F8E7f08Fbd5110e893e1b1D790A",
    "0x8135d6AbFd42707A87A7b94c5CFA3529f9b432AD", // 42161
    "0x1d157Cf1F1339864A3C291D1Bbe786d6Ee682434",
    "0x01A9502C11f411b494c62746D37e89d6f7078657",
    "0x5b79494824Bc256cD663648Ee1Aad251B32693A9",
    "0x25869f277f474FA9459F40F5D4cB0D6A8Ab41967", // 42161
    "0xacE0D479040231e3c6b17479cFd4444182d521d4", // 42161
    "0xDf464348c4EC2Bf0e5D6926b9f707c8e02301adf", // 42161
    "0x4532fBa326D853A03644758B8B7438374F6780dC",
    "0xc2D343E2C9498E905F53C818B88eB8064B42D036",
    "0x79eF6103A513951a3b25743DB509E267685726B7",
    "0x175407b4710b5A1cB67a37C76859F17fb2ff6672", // 42161
    "0x6F3b31296FD2457eba6Dca3BED65ec79e06c1295",
];

const resetGaugesV1 = [
    "0x9e3f4FB69058244066801404e50889592d33cA11",
    "0x3B6A85B5e1e6205ebF4d4eabf147D10e8e4bf0A5",
    "0x1d157Cf1F1339864A3C291D1Bbe786d6Ee682434",
    "0xcB2c2AF6c3E88b4a89aa2aae1D7C8120EEe9Ad0e",
    "0xacE0D479040231e3c6b17479cFd4444182d521d4",
    "0xCd8bB8cEBc794842967849255C234e7b7619A518",
    "0x5b79494824Bc256cD663648Ee1Aad251B32693A9",
    "0x54f220a891f468629027C3Cc8A58722D4F576402",
    "0xb7b9B9D35e7F9E324C762235FB69848175C03A19",
    "0x24E8787B4AC5325Fd082BC30b9fe7eb2F01304c7",
    "0x21b2Ef3DC22B7bd4634205081c667e39742075E2",
    "0xF7d515DC47d5BD57786494628ed766d6bF31cd39",
    "0x0312AA8D0BA4a1969Fddb382235870bF55f7f242",
    "0x4532fBa326D853A03644758B8B7438374F6780dC",
    "0x6F3b31296FD2457eba6Dca3BED65ec79e06c1295",
    "0x79eF6103A513951a3b25743DB509E267685726B7",
    "0x2e79D6f631177F8E7f08Fbd5110e893e1b1D790A",
    "0xbf65b3fA6c208762eD74e82d4AEfCDDfd0323648",
    "0x29488df9253171AcD0a0598FDdA92C5F6E767a38",
    "0x175407b4710b5A1cB67a37C76859F17fb2ff6672",
    "0x7C777eEA1dC264e71E567Fcc9B6DdaA9064Eff51",
    "0x95201B61EF19C867dA0D093DF20021e1a559452c",
    "0xCB664132622f29943f67FA56CCfD1e24CC8B4995",
    "0x454eb2f12242397688DbfdA241487e67ed80507a",
    "0x2D42910D826e5500579D121596E98A6eb33C0a1b",
    "0x6EE63656BbF5BE3fdF9Be4982BF9466F6a921b83",
    "0xDf464348c4EC2Bf0e5D6926b9f707c8e02301adf",
    "0x70892E4355d0E04A3d19264E93c64C401520f3A4",
    "0x8135d6AbFd42707A87A7b94c5CFA3529f9b432AD",
    "0x3F29e69955E5202759208DD0C5E0BA55ff934814",
    "0x27Fd581E9D0b2690C2f808cd40f7fe667714b575",
    "0x87012b0C3257423fD74a5986F81a0f1954C17a1d",
    "0x183D73dA7adC5011EC3C46e33BB50271e59EC976",
    "0x19A13793af96f534F0027b4b6a3eB699647368e7",
    "0x46804462f147fF96e9CAFB20cA35A3B2600656DF",
    "0x1b8C2C972c67f4A5B43C2EbE07E64fCB88ACee87",
    "0xf8C85bd74FeE26831336B51A90587145391a27Ba",
    "0x37eCa8DaaB052E722e3bf8ca861aa4e1C047143b",
    "0x25869f277f474FA9459F40F5D4cB0D6A8Ab41967",
    "0x6661136537dfDCA26EEA05c8500502d7D5796E5E",
    "0xc2D343E2C9498E905F53C818B88eB8064B42D036",
    "0x7F75ecd3cFd8cE8bf45f9639A226121ca8bBe4ff",
    "0x0EDF6cDd81BC3471C053341B7D8Dfd1Cb367AD93",
    "0xE5f24cD43f77fadF4dB33Dab44EB25774159AC66",
    "0x57AB3b673878C3fEaB7f8FF434C40Ab004408c4c",
    "0xE41736b4e78be41Bd03EbAf8F86EA493C6e9EA96",
    "0x190AE1f6EE5c0B7bc193fA9CD9bBe9b335F69C65",
    "0x539D6eDbd16F2F069A06716416C3a6E98cC29DD0",
    "0x5Db1Fe5A1652f095eBc3f6065E9DB3f3d492bfC2",
    "0xDaCD99029b4B94CD04fE364aAc370829621C1C64",
    "0xF17F1E67bc384E43b4acf69cc032AD086f15f262",
    "0x0A4825154bCFD493d15777184d01B93e8115215a",
    "0x16289F675Ca54312a8fCF99341e7439982888077",
    "0x730A168cF6F501cf302b803FFc57FF3040f378Bf",
    "0x10a361766e64D7983a97202ac3a0F4cee06Eb717",
    "0x175FAb9C7aB502B9E76E7fca0C9Da618387EBAdA",
    "0xf7B0751Fea697cf1A541A5f57D11058a8fB794ee",
    "0x3A7Ed8916Ebb9131966b9b3af3cd8B9adcc53559",
    "0x5669736FD1dF3572f9D519FcCf7536A750CFAc62",
    "0xc61e7E858b5a60122607f5C7DF223a53b01a1389",
    "0xcD4722B7c24C29e0413BDCd9e51404B4539D14aE",
    "0xBc771929359B1A6386801705e8D185205d8f1CBF",
    "0x90DDAa2A6D192Db2F47195d847626F94E940c7Ac",
    "0x7a4e71a8A33d3b385279079c503ca93905dd553e",
    "0x0021e01B9fAb840567a8291b864fF783894EabC6",
    "0x774D0F67DcFA5568cA435c70fbA272C64352d859",
    "0x78a54C8F4eAba82e45cBC20B9454a83CB296e09E",
];

const resetGaugesV2 = [
    "0xa4c104ab9116a84714c081e0ed6d750221e4c756",
    "0x956074628a64a316086f7125074a8a52d3306321",
    "0x7fc115bf013844d6ef988837f7ae6398af153532",
    "0x2c2179abce3413e27bda6917f60ae37f96d01826",
    "0x17748aa07a6a1be2ace8bcc546919c006b40de34",
    "0xd758454bdf4df7ad85f7538dc9742648ef8e6d0a",
    "0x1b8c2c972c67f4a5b43c2ebe07e64fcb88acee87",
    "0xbc02ef87f4e15ef78a571f3b2adcc726fee70d8b",
    "0x183d73da7adc5011ec3c46e33bb50271e59ec976",
    "0x49f530b45ae792cdf5cbd5d25c5a9b9e59c6c3b8",
    "0xa1d5b81d0024809faa278ab72fe3d2fb467dd28b",
    "0xd103dd49b8051a09b399a52e9a8ab629392de2fb",
    "0x2d02bf5ea195dc09854e18e7d2857a16bf376963",
    "0x6be156504cda8ee38169be96bcf53aeab4377c1a",
    "0x15c84754c7445d0df6c613f1490ca07654347c1b",
    "0x25869f277f474fa9459f40f5d4cb0d6a8ab41967",
    "0xa9659365461380e8a6b30a50d421c1f5fcd8a8bc",
    "0xc592c33e51a764b94db0702d8baf4035ed577aed",
    "0x1e916950a659da9813ee34479bff04c732e03deb",
    "0x2d42910d826e5500579d121596e98a6eb33c0a1b",
    "0x56c0626e6e3931af90ebb679a321225180d4b32b",
    "0x6a58e7c904ecf991a3183d28fc73be90732b7a30",
    "0x82bcad0c8f51d88ec339141f0d8953bc25cc3d8c",
    "0xa5893cf81150aa61a0b33950c1b13c5251c19a10",
    "0x5622821a3b993f062ff691478bbb7d551c167321",
    "0xa86e8e8cfae8c9847fa9381d4631c13c7b3466bd",
    "0x9965713498c74aee49cef80b2195461f188f24f8",
    "0x00b9bcd17cb049739d25fd7f826caa2e23b05620",
    "0x78a54c8f4eaba82e45cbc20b9454a83cb296e09e",
    "0x4d4264aebf65bb1727bb5438e0b2aaf86186da50",
    "0x539d6edbd16f2f069a06716416c3a6e98cc29dd0",
    "0xa8d974288fe44acc329d7d7a179707d27ec4dd1c",
    "0x46804462f147ff96e9cafb20ca35a3b2600656df",
    "0x42a3290a65ca16adaf161c6ffafdbe0913a169f4",
    "0x16289f675ca54312a8fcf99341e7439982888077",
    "0x53fa0546f307317daa82371e94e8dcd5cad3345f",
    "0x70754ab20c63cc65ea12206cf28342723d731ac6",
    "0x057e7b14dc461f071958e0bbf42b5597564d4e6c",
    "0x27fd581e9d0b2690c2f808cd40f7fe667714b575",
    "0xc2d343e2c9498e905f53c818b88eb8064b42d036",
    "0x21c377cbb2beddd8534308e5cdfebe35fdf817e8",
    "0x255912af1ba318527edc69b4d56152d8c133288e",
    "0xe9b5f4d892df284a15ec90a58bd4385e57964f18",
    "0x5b006e53df539773e109dbbf392deff6e87e2781",
    "0xc4b6cc9a444337b1cb8cbbdd9de4d983f609c391",
    "0xceb17d5c8ef8556ed0424a4bebc35a5d562d96e2",
    "0x2617724db92a8dbd4eba7e24615ba369133ff684",
    "0xdacd99029b4b94cd04fe364aac370829621c1c64",
    "0x91ceeb8d46428c5b8d76debc8156992e45d2d63f",
    "0x47c56a900295df5224ec5e6751dc31eb900321d5",
    "0x2041f8a758a0266e1b9272fcd4b1f1c37b67d5da",
    "0x05266a0d5ac04e44d394b8a8a2d0935d8809692b",
    "0x64fced4684f4b065e6b900c4e99a0cbacc5e5fe1",
    "0x85d6840eab7473b60f10d1a3e2452243eb702c97",
    "0x41a8243656bcf628ac92189558f70d371dd08b4e",
    "0x3c8502e60ebd1e036e1d3906fc34e9616218b6e5",
    "0x2e6cd45581002c894cac692dce4a30632125ef99",
    "0x6661136537dfdca26eea05c8500502d7d5796e5e",
    "0x9e5b7e6b61529571e98c8f16d07794ea99a7a930",
    "0x730a168cf6f501cf302b803ffc57ff3040f378bf",
    "0x175407b4710b5a1cb67a37c76859f17fb2ff6672",
    "0x0edf6cdd81bc3471c053341b7d8dfd1cb367ad93",
    "0x20d03f9d0304744891881e6ac1d45b996e7f39b5",
    "0xf7b0751fea697cf1a541a5f57d11058a8fb794ee",
    "0x8e486dbacb74c00dd31e489da93d99bbebe36cd5",
    "0x99e2fafd901645fb611f6d56476af8ad25263ea5",
    "0xa1dde34d48868f9e0901592f2a97e20f76004059",
    "0xeff145872582721e1b33931d61c3fe9c1ca66690",
    "0xf22bbdad6b3dd9314bdf97724df32b09ff95c216",
    "0x9aaaf6757be9e115895429ef6b81e05dcb951646",
    "0xdf54d2dd06f8be3b0c4ffc157be54ec9cca91f3c",
    "0xbf65b3fa6c208762ed74e82d4aefcddfd0323648",
    "0x0312aa8d0ba4a1969fddb382235870bf55f7f242",
    "0xee01c0d9c0439c94d314a6ecae0490989750746c",
    "0x895e415ce9936c1dca0a0859b0ea92e05bc966ae",
    "0x10a361766e64d7983a97202ac3a0f4cee06eb717",
    "0x6a2c2d4502335638d2c2f40f0171253fb2c2db88",
    "0x93ae6971f03ce890fa4e9274ab441477b84dae5f",
    "0xb1af0d75aeea1c13c450ffc7e12083072daf41eb",
    "0x0021e01b9fab840567a8291b864ff783894eabc6",
    "0xbb1a15dfd849bc5a6f33c002999c8953afa626ad",
    "0x346f1d4f98f055bb0791465923e27a10f1082912",
    "0xb66e8d615f8109ca52d47d9cb65fc4edcf9c1342",
    "0xf8c85bd74fee26831336b51a90587145391a27ba",
    "0x1461c4a373d27977f0d343ba33c22870c89f9df0",
    "0xb6d101874b975083c76598542946fe047f059066",
    "0x132296d1dfd10ba55b565c4cfe49d350617a2a2b",
    "0x8135d6abfd42707a87a7b94c5cfa3529f9b432ad",
    "0x62a82fe26e21a8807599374cac8024fae342ef83",
    "0x8f44a8cfb7fe682295fa663348060533732f437c",
    "0x5c0f23a5c1be65fa710d385814a7fd1bda480b1c",
    "0x8c596e8d1b3be04a6caa1b1152b51c495f799a16",
    "0xcc6a23446f6388d78f3037bd55f2eb820352d982",
    "0x671ed21480acf63b0ab7297b901505f5bccafa9b",
    "0xc859bf9d7b8c557bbd229565124c2c09269f3aef",
    "0xb17f2f3de17d5013e7cc8ceb4ec2be02c6cc1501",
    "0x329caebb9be5144c5727347f64f8b3a3b109ec57",
    "0xf6a7ad46b00300344c7d4739c0518db70e722dc4",
    "0xf17f1e67bc384e43b4acf69cc032ad086f15f262",
    "0x79ef6103a513951a3b25743db509e267685726b7",
];

const dstChainGauges = {
    ["109"]: [
        // Polygon
        "0x47D7269829Ba9571D98Eb6DDc34e9C8f1A4C327f",
        "0x082AACfaf4db8AC0642CBED50df732D3C309E679", // 137
        "0xDd3b4161D2a4c609884E20Ed71b4e85BE44572E6", // 137
        "0x539D6eDbd16F2F069A06716416C3a6E98cC29DD0", // 137
        "0x16289F675Ca54312a8fCF99341e7439982888077", // 137
    ],
    ["110"]: [
        // Arbitrum
        "0x54BeFB03BB58687cDE09cd082Bd78410e309D8C7", // 42161
        "0x8135d6AbFd42707A87A7b94c5CFA3529f9b432AD", // 42161
        "0x0EDF6cDd81BC3471C053341B7D8Dfd1Cb367AD93", // 42161
        "0x25869f277f474FA9459F40F5D4cB0D6A8Ab41967", // 42161
        "0xacE0D479040231e3c6b17479cFd4444182d521d4", // 42161
        "0xDf464348c4EC2Bf0e5D6926b9f707c8e02301adf", // 42161
        "0x175407b4710b5A1cB67a37C76859F17fb2ff6672", // 42161
    ],
    ["111"]: [
        // Optimism
        "0xDaCD99029b4B94CD04fE364aAc370829621C1C64", // 10
    ],
    ["145"]: [
        // Gnosis
        "0x3B6A85B5e1e6205ebF4d4eabf147D10e8e4bf0A5", // 100
        "0xE41736b4e78be41Bd03EbAf8F86EA493C6e9EA96", // 100
        "0xcB2c2AF6c3E88b4a89aa2aae1D7C8120EEe9Ad0e", // 100
        "0x21b2Ef3DC22B7bd4634205081c667e39742075E2", // 100
        "0x7F75ecd3cFd8cE8bf45f9639A226121ca8bBe4ff", // 100
        "0xc61e7E858b5a60122607f5C7DF223a53b01a1389", // 100
        "0xf8C85bd74FeE26831336B51A90587145391a27Ba", // 100
    ],
    ["158"]: [
        // zkEVM
        "0xF7d515DC47d5BD57786494628ed766d6bF31cd39", // 1101
    ],
};

const notMainnetGauges = Object.values(dstChainGauges).reduce((acc, arr) => [...acc, ...arr], []);
// Ethereum (101)
dstChainGauges[L1_CHAIN_ID] = gauges.filter(gauge => !notMainnetGauges.includes(gauge));

const weights = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 108, 268, 138, 77, 104, 98, 38, 70, 48, 81, 105, 21, 140, 70, 70, 70, 35, 35,
    35, 35, 69, 188, 25, 106, 63, 34, 23, 54, 211, 245, 106, 244, 36, 95, 98, 85, 136, 22, 23, 129, 668, 118, 49, 54,
    58, 62, 62, 104, 869, 235, 2027, 229, 1827,
];

const hasGaugeWeight = (g: string) => {
    if (noDepositGauges.includes(g)) return false;
    const idx = gauges.indexOf(g);
    const weight = weights[idx];
    return weight > 0;
};
const l1GaugesWithVotes = dstChainGauges[L1_CHAIN_ID].filter(hasGaugeWeight);

const l2GaugesWithVotes = dstChainGauges[L2_CHAIN_ID].filter(hasGaugeWeight);

// @deprecate
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const itBeforeV1Deployment = FORK_BLOCK === VERSION_STATUS.V1_BEFORE ? it : it.skip;
const itAfterV1Deployment = FORK_BLOCK === VERSION_STATUS.V1_DEPLOYED ? it : it.skip;
const itBeforeV2Deployment = FORK_BLOCK === VERSION_STATUS.V2_BEFORE ? it : it.skip;

// @deprecate
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const describeBeforeV1Deployment = FORK_BLOCK === VERSION_STATUS.V1_BEFORE ? describe : describe.skip;
const describeBeforeV2Deployment = FORK_BLOCK === VERSION_STATUS.V2_BEFORE ? describe : describe.skip;

describe("GaugeVoteRewards", () => {
    let deployer: Account;
    let owner: Account;

    let phase2: Phase2Deployed;
    let phase6: Phase6Deployed;
    let phase8: Phase8Deployed;
    let ctx: TestSuiteDeployment;

    let gaugeVoteRewards: GaugeVoteRewards;
    let childGaugeVoteRewards: ChildGaugeVoteRewards;
    let stashRewardDistro: StashRewardDistro;
    let childStashRewardDistro: StashRewardDistro;

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

        if (FORK_BLOCK === VERSION_STATUS.V1_DEPLOYED) {
            ctx = await setupForkDeployment(hre, config, arbitrumConfig, deployer, L2_CHAIN_ID);

            const voteRewards = config.getGaugeVoteRewards(deployer.signer);

            gaugeVoteRewards = voteRewards.gaugeVoteRewards;
            stashRewardDistro = voteRewards.stashRewardDistro;
        } else {
            ctx = await setupLocalDeployment(hre, config, deployer, L1_CHAIN_ID, L2_CHAIN_ID);

            stashRewardDistro = await new StashRewardDistro__factory(deployer.signer).deploy(phase6.booster.address);

            gaugeVoteRewards = await new GaugeVoteRewards__factory(deployer.signer).deploy(
                phase2.cvx.address,
                ctx.canonical.auraProxyOFT.address,
                phase6.booster.address,
                stashRewardDistro.address,
                L1_CHAIN_ID,
                ctx.l1LzEndpoint.address,
            );

            childStashRewardDistro = await new ChildStashRewardDistro__factory(deployer.signer).deploy(
                ctx.sidechain.booster.address,
            );

            childGaugeVoteRewards = await new ChildGaugeVoteRewards__factory(deployer.signer).deploy(
                ctx.sidechain.auraOFT.address,
                ctx.sidechain.booster.address,
                childStashRewardDistro.address,
            );

            await childGaugeVoteRewards.initialize(ctx.l2LzEndpoint.address);

            await ctx.l1LzEndpoint.setDestLzEndpoint(childGaugeVoteRewards.address, ctx.l2LzEndpoint.address);
            await gaugeVoteRewards.setTrustedRemoteAddress(L2_CHAIN_ID, childGaugeVoteRewards.address);
            await childGaugeVoteRewards.setTrustedRemoteAddress(L1_CHAIN_ID, gaugeVoteRewards.address);
        }

        // Make sure dao is the owner
        const gaugeVoterRewardsOwner = await gaugeVoteRewards.owner();
        if (gaugeVoterRewardsOwner !== ctx.dao.address) {
            console.log("Owner is not ms protocol", gaugeVoterRewardsOwner);
            owner = await impersonateAccount(gaugeVoterRewardsOwner);
            await gaugeVoteRewards.connect(owner.signer).transferOwnership(ctx.dao.address);
        }
    });

    describe("config", () => {
        it("GaugeVoteRewards has correct config", async () => {
            expect(await gaugeVoteRewards.aura()).eq(phase2.cvx.address);
            expect(await gaugeVoteRewards.auraOFT()).eq(ctx.canonical.auraProxyOFT.address);
            expect(await gaugeVoteRewards.booster()).eq(phase6.booster.address);
            expect(await gaugeVoteRewards.stashRewardDistro()).eq(stashRewardDistro.address);
            expect(await gaugeVoteRewards.lzChainId()).eq(L1_CHAIN_ID);
            expect(await gaugeVoteRewards.lzEndpoint()).eq(ctx.l1LzEndpoint.address);
        });
        itBeforeV2Deployment("ChildGaugeVoteRewards has correct config", async () => {
            expect(await childGaugeVoteRewards.aura()).eq(ctx.sidechain.auraOFT.address);
            expect(await childGaugeVoteRewards.booster()).eq(ctx.sidechain.booster.address);
            expect(await childGaugeVoteRewards.stashRewardDistro()).eq(childStashRewardDistro.address);
            expect(await childGaugeVoteRewards.lzEndpoint()).eq(ctx.l2LzEndpoint.address);
        });
    });

    describe("protected functions", () => {
        it("cannot call protected functions as non owner", async () => {
            const errorMsg = "Ownable: caller is not the owner";
            const signer = (await hre.ethers.getSigners()).pop();

            const g = gaugeVoteRewards.connect(signer);
            await expect(g.setDistributor(deployer.address)).to.be.revertedWith(errorMsg);
            await expect(g.setRewardPerEpoch(0)).to.be.revertedWith(errorMsg);
            await expect(g.voteGaugeWeight([], [])).to.be.revertedWith(errorMsg);
        });
        itBeforeV2Deployment("child cannot call protected functions as non owner", async () => {
            const errorMsg = "Ownable: caller is not the owner";
            const signer = (await hre.ethers.getSigners()).pop();

            const c = childGaugeVoteRewards.connect(signer);
            await expect(c.setDistributor(deployer.address)).to.be.revertedWith(errorMsg);
        });
    });

    describe("setup", () => {
        it("set distributor", async () => {
            // Always set the distributor
            await gaugeVoteRewards.connect(ctx.dao.signer).setDistributor(ctx.dao.address);
            expect(await gaugeVoteRewards.distributor()).eq(ctx.dao.address);
        });
        itBeforeV2Deployment("1. set rewards per epoch", async () => {
            const amount = simpleToExactAmount(180_000);
            await gaugeVoteRewards.connect(ctx.dao.signer).setRewardPerEpoch(amount);
            expect(await gaugeVoteRewards.rewardPerEpoch()).eq(amount);
        });
        itBeforeV2Deployment("2. set pool IDs", async () => {
            const nGauges = await phase6.booster.poolLength();
            await gaugeVoteRewards.setPoolIds(0, nGauges);

            // Some gauges will appear twice so loop through all the gauges and build
            // a map of gauge to pid to use later to look up the latest pid for a gauge
            const uniqGaugeMap = {};
            for (let i = 0; i < nGauges.toNumber(); i++) {
                const poolInfo = await phase6.booster.poolInfo(i);
                uniqGaugeMap[poolInfo.gauge] = i;
            }

            for (let i = 0; i < Object.keys(uniqGaugeMap).length; i++) {
                const poolInfo = await phase6.booster.poolInfo(i);
                const expectedPid = uniqGaugeMap[poolInfo.gauge];
                const pid = await gaugeVoteRewards.getPoolId(poolInfo.gauge);
                expect(pid.isSet).eq(true);
                expect(pid.value).eq(expectedPid);
                expect(await gaugeVoteRewards.getDstChainId(poolInfo.gauge)).eq(L1_CHAIN_ID);
            }
        });
        itBeforeV2Deployment("3. set no deposit gauges", async () => {
            for (const gauge of noDepositGauges) {
                await gaugeVoteRewards.connect(ctx.dao.signer).setIsNoDepositGauge(gauge, true);
                expect(await gaugeVoteRewards.isNoDepositGauge(gauge)).eq(true);
            }
        });
        it("4. set dst chain IDs", async () => {
            for (const dstChainId in dstChainGauges) {
                if (dstChainId === L1_CHAIN_ID.toString()) continue;
                await gaugeVoteRewards.connect(ctx.dao.signer).setDstChainId(dstChainGauges[dstChainId], dstChainId);
                for (const gauge of dstChainGauges[dstChainId]) {
                    expect((await gaugeVoteRewards.getDstChainId(gauge)).toString()).eq(dstChainId);
                }
            }
        });
        itBeforeV2Deployment("5. set child gauge vote rewards", async () => {
            await gaugeVoteRewards
                .connect(ctx.dao.signer)
                .setChildGaugeVoteRewards(L2_CHAIN_ID, childGaugeVoteRewards.address);
            expect(await gaugeVoteRewards.getChildGaugeVoteRewards(L2_CHAIN_ID)).eq(childGaugeVoteRewards.address);
        });
        it("6. add aura as extra reward", async () => {
            for (let i = 0; i < l1GaugesWithVotes.length; i++) {
                const gauge = l1GaugesWithVotes[i];
                const pid = await gaugeVoteRewards.getPoolId(gauge);
                if (!pid.isSet) continue;
                await phase8.boosterOwnerSecondary
                    .connect(ctx.dao.signer)
                    .setStashExtraReward(pid.value, phase2.cvx.address);
            }
        });
        it.skip("7. claim rewards for existing LPs", async () => {
            const p = path.resolve(__dirname, "../../data/account-rewards-earned-1690290158.json");
            const f = fs.readFileSync(p, "utf8");
            const data = JSON.parse(f);

            const minBal = simpleToExactAmount(5);

            const accountsWithMinBal = [];

            for (const pid in data.pools) {
                const { accounts } = data.pools[pid];
                for (const acc in accounts) {
                    const account = accounts[acc];
                    if (simpleToExactAmount(account.bal).gt(minBal)) {
                        accountsWithMinBal.push({ ...account, pid, address: acc });
                    }
                }
            }

            await Promise.all(
                accountsWithMinBal.map(async acc => {
                    const poolInfo = await phase6.booster.poolInfo(acc.pid);
                    const pool = BaseRewardPool__factory.connect(poolInfo.crvRewards, deployer.signer);
                    const tx = await pool["getReward(address,bool)"](acc.address, true);
                    const r = await tx.wait();
                    return {
                        cumulativeGasUsed: r.cumulativeGasUsed,
                    };
                }),
            );
        });
        itAfterV1Deployment("8. update all booster pool reward rate to 0.4", async () => {
            const nGauges = await phase6.booster.poolLength();

            for (let i = 0; i < nGauges.toNumber(); i++) {
                const poolInfo = await phase6.booster.poolInfo(i);
                // Set the reward multiplier to 50%
                await phase6.booster.connect(ctx.dao.signer).setRewardMultiplier(poolInfo.crvRewards, 4000);
                expect(await phase6.booster.getRewardMultipliers(poolInfo.crvRewards)).eq(4000);
            }
        });
        it("9. set L1Coordinator reward rate to 0.4", async () => {
            await ctx.canonical.l1Coordinator.connect(ctx.dao.signer).setRewardMultiplier(4000);
            expect(await ctx.canonical.l1Coordinator.rewardMultiplier()).eq(4000);
        });
    });

    describeBeforeV2Deployment("setup child", () => {
        it("set distributor", async () => {
            await childGaugeVoteRewards.setDistributor(deployer.address);
            expect(await childGaugeVoteRewards.distributor()).eq(deployer.address);
        });
        it("add pools", async () => {
            // Because we are trying to test this cross chain but are only
            // running the fork test on a single chain because we can have
            // LZ relayers in our fork test.
            //
            // So we force add some pools to the sidechain booster so when
            // we call getPoolIds on the childGaugeVoteReward it still works
            // as expected
            for (const g of dstChainGauges[L2_CHAIN_ID]) {
                const stakelessGauge = IStakelessGauge__factory.connect(g, deployer.signer);
                const poolManager = await impersonateAccount(await ctx.sidechain.booster.poolManager(), true);
                await ctx.sidechain.booster
                    .connect(poolManager.signer)
                    .addPool("0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1", await stakelessGauge.getRecipient(), 3);
            }
        });
        it("1. set pool IDs", async () => {
            const nGauges = await ctx.sidechain.booster.poolLength();
            await childGaugeVoteRewards.setPoolIds(0, nGauges);

            // Some gauges will appear twice so loop through all the gauges and build
            // a map of gauge to pid to use later to look up the latest pid for a gauge
            const uniqGaugeMap = {};
            for (let i = 0; i < nGauges.toNumber(); i++) {
                const poolInfo = await ctx.sidechain.booster.poolInfo(i);
                uniqGaugeMap[poolInfo.gauge] = i;
            }

            for (let i = 0; i < Object.keys(uniqGaugeMap).length; i++) {
                const poolInfo = await ctx.sidechain.booster.poolInfo(i);
                const expectedPid = uniqGaugeMap[poolInfo.gauge];
                const pid = await childGaugeVoteRewards.getPoolId(poolInfo.gauge);
                expect(pid.isSet).eq(true);
                expect(pid.value).eq(expectedPid);
            }
        });
    });

    describe("[DAO] setup", () => {
        it("set GaugeVoteRewards as voteManager", async () => {
            const dao = await impersonateAccount(config.multisigs.daoMultisig);
            await phase8.boosterOwnerSecondary.connect(dao.signer).setVoteDelegate(gaugeVoteRewards.address);
            expect(await phase6.booster.voteDelegate()).eq(gaugeVoteRewards.address);
        });
    });

    describe("[TREASURY] funding", () => {
        itBeforeV2Deployment("recover funding from V1", async () => {
            const voteRewardsV1 = config.getGaugeVoteRewards(deployer.signer);
            const balanceBefore = await phase2.cvx.balanceOf(voteRewardsV1.gaugeVoteRewards.address);
            const treasuryBalanceBefore = await phase2.cvx.balanceOf(config.multisigs.treasuryMultisig);
            expect(balanceBefore).gte(ZERO);
            await voteRewardsV1.gaugeVoteRewards
                .connect(ctx.dao.signer)
                .transferERC20(phase2.cvx.address, config.multisigs.treasuryMultisig, balanceBefore);

            const balanceAfter = await phase2.cvx.balanceOf(voteRewardsV1.gaugeVoteRewards.address);
            const treasuryBalanceAfter = await phase2.cvx.balanceOf(config.multisigs.treasuryMultisig);
            expect(balanceAfter).eq(ZERO);
            expect(treasuryBalanceAfter.sub(treasuryBalanceBefore)).eq(balanceBefore);
        });
        it("treasury funds 2 epochs", async () => {
            const treasury = await impersonateAccount(config.multisigs.treasuryMultisig);
            const rewardPerEpoch = await gaugeVoteRewards.rewardPerEpoch();
            await phase2.cvx.connect(treasury.signer).transfer(gaugeVoteRewards.address, rewardPerEpoch.mul(2));
            expect(await phase2.cvx.balanceOf(gaugeVoteRewards.address)).gte(rewardPerEpoch.mul(2));
        });
    });

    describe("voting", () => {
        it("can vote for underlying gauges", async () => {
            if (FORK_BLOCK >= VERSION_STATUS.V1_DEPLOYED) {
                const resetGauges = FORK_BLOCK === VERSION_STATUS.V1_DEPLOYED ? resetGaugesV1 : resetGaugesV2;
                // Move along so we can cast a vote without getting the
                // voting too often error from the gauge controller
                // Resetting the previous gauge votes so we don't run into
                // the too much power error too
                await phase8.boosterOwnerSecondary.connect(ctx.dao.signer).setVoteDelegate(ctx.dao.address);
                await increaseTime(ONE_WEEK.mul(2));
                await phase6.booster
                    .connect(ctx.dao.signer)
                    .voteGaugeWeight(resetGauges, Array(resetGauges.length).fill(0));
                await increaseTime(ONE_WEEK.mul(2));
                await phase8.boosterOwnerSecondary.connect(ctx.dao.signer).setVoteDelegate(gaugeVoteRewards.address);
            }

            const noDepositGaugesInVote = gauges.find(g => noDepositGauges.includes(g));
            expect(noDepositGaugesInVote.length, "No noDepositGauges in vote").gt(0);

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

    describe("process rewards mainnet", () => {
        it("can process rewards", async () => {
            const voteRewardBalance = async () => phase2.cvx.balanceOf(gaugeVoteRewards.address);
            const stashDistroBalance = async () => phase2.cvx.balanceOf(stashRewardDistro.address);

            const epoch = await gaugeVoteRewards.getCurrentEpoch();

            const voteRewardBalance0 = await voteRewardBalance();
            const stashDistroBalance0 = await stashDistroBalance();
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
    });

    describeBeforeV2Deployment("process sidechain rewards", () => {
        it("can process sidechain rewards", async () => {
            const auraOftBalance = () => phase2.cvx.balanceOf(ctx.canonical.auraProxyOFT.address);
            const voteRewardBalance = async () => phase2.cvx.balanceOf(gaugeVoteRewards.address);
            const childRewardsBalance = async () => ctx.sidechain.auraOFT.balanceOf(childGaugeVoteRewards.address);

            const epoch = await gaugeVoteRewards.getCurrentEpoch();

            const auraOftBalance0 = await auraOftBalance();
            const voteRewardBalance0 = await voteRewardBalance();
            const childRewardsBalance0 = await childRewardsBalance();
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
            const childRewardsBalance1 = await childRewardsBalance();

            expect(auraOftBalance1.sub(auraOftBalance0)).gt(0);
            expect(voteRewardBalance0.sub(voteRewardBalance1)).gt(0);
            expect(childRewardsBalance1.sub(childRewardsBalance0)).gt(0);
        });
        it("can process rewards from child rewards", async () => {
            const childVoteRewardBalance = async () => ctx.sidechain.auraOFT.balanceOf(childGaugeVoteRewards.address);
            const childStashDistroBalance = async () => ctx.sidechain.auraOFT.balanceOf(childStashRewardDistro.address);

            const epoch = await gaugeVoteRewards.getCurrentEpoch();
            const l2GaugesWithVotesRecipients = await Promise.all(
                l2GaugesWithVotes.map(async g => {
                    const stakelessGauge = IStakelessGauge__factory.connect(g, deployer.signer);
                    return stakelessGauge.getRecipient();
                }),
            );

            const voteRewardBalance0 = await childVoteRewardBalance();
            const stashDistroBalance0 = await childStashDistroBalance();
            await childGaugeVoteRewards.processGaugeRewards(epoch, l2GaugesWithVotesRecipients);
            const voteRewardBalance1 = await childVoteRewardBalance();
            const stashDistroBalance1 = await childStashDistroBalance();

            expect(voteRewardBalance0.sub(voteRewardBalance1)).gt(0);
            expect(stashDistroBalance1.sub(stashDistroBalance0)).gt(0);

            for (const gauge of l2GaugesWithVotesRecipients) {
                const currentEpoch = await childStashRewardDistro.getCurrentEpoch();
                const pid = await childGaugeVoteRewards.getPoolId(gauge);
                const funds = await childStashRewardDistro.getFunds(
                    currentEpoch.add(1),
                    pid.value,
                    ctx.sidechain.auraOFT.address,
                );
                expect(funds).gt(0);
            }
        });
    });

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
        const stash = ExtraRewardStashV3__factory.connect(poolInfo.stash, deployer.signer);
        const tokenInfo = await stash.tokenInfo(cvx.address);

        const getFunds = () => distro.getFunds(epoch, pid.value, cvx.address);
        const getStashAuraBalance = () =>
            FORK_BLOCK === VERSION_STATUS.V1_DEPLOYED
                ? cvx.balanceOf(tokenInfo.stashToken)
                : cvx.balanceOf(poolInfo.stash);

        const funds0 = await getFunds();
        const stashAuraBalance0 = await getStashAuraBalance();

        await distro.functions["queueRewards(uint256,address)"](pid.value.toString(), cvx.address);

        const funds1 = await getFunds();
        const stashAuraBalance1 = await getStashAuraBalance();

        expect(stashAuraBalance1.sub(stashAuraBalance0)).gte(funds0);
        expect(funds1).eq(0);
    }

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
