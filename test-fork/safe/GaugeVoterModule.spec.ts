import { expect } from "chai";
import { Signer } from "ethers";
import hre, { network } from "hardhat";
import { deployGaugeVoterModule } from "../../scripts/deployPeripheral";
import { CanonicalPhaseDeployed } from "../../scripts/deploySidechain";
import { Phase2Deployed } from "../../scripts/deploySystem";
import { config } from "../../tasks/deploy/mainnet-config";
import { impersonate } from "../../test-utils";
import { GaugeVoterModule, ISafe, ISafe__factory } from "../../types";

describe("Gauge Voter Module", () => {
    let daoMultisig: Signer;
    let deployer: Signer;
    let deployerAddress: string;
    let contracts: Phase2Deployed & CanonicalPhaseDeployed;
    let gaugeVoterModule: GaugeVoterModule;
    let safe: ISafe;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 21271390,
                    },
                },
            ],
        });

        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        deployer = await impersonate(deployerAddress, true);
        daoMultisig = await impersonate(config.multisigs.daoMultisig, true);
        contracts = { ...(await config.getPhase2(deployer)), ...(await config.getSidechain(deployer)) };
        safe = ISafe__factory.connect(config.multisigs.daoMultisig, daoMultisig);
    });

    it("deploys module", async () => {
        ({ gaugeVoterModule } = await deployGaugeVoterModule(hre, deployer, config.multisigs, {
            gaugeVoter: contracts.gaugeVoteRewards,
        }));

        expect(await gaugeVoterModule.owner(), "owner").to.be.eq(config.multisigs.daoMultisig);
        expect(await gaugeVoterModule.safeWallet(), "safeWallet").to.be.eq(config.multisigs.daoMultisig);
        expect(await gaugeVoterModule.gaugeVoter(), "gaugeVoter").to.be.eq(contracts.gaugeVoteRewards.address);
    });

    it("configures the module", async () => {
        expect(await safe.isModuleEnabled(gaugeVoterModule.address), "isEnabled").to.be.eq(false);
        await safe.enableModule(gaugeVoterModule.address);
        expect(await safe.isModuleEnabled(gaugeVoterModule.address), "isEnabled").to.be.eq(true);
    });
    it("fails if keeper is not the caller", async () => {
        const authorizedKeepers = await gaugeVoterModule.authorizedKeepers(await deployer.getAddress());
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(false);
        await expect(gaugeVoterModule.connect(deployer).voteGaugeWeight([], [])).to.be.revertedWith("!keeper");
    });
    it("only keeper can execute task", async () => {
        const authorizedKeepers = await gaugeVoterModule.authorizedKeepers(config.multisigs.defender.keeperMulticall3);
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
        const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
        const tx = await gaugeVoterModule
            .connect(keeper)
            .voteGaugeWeight(
                [
                    "0x6ee63656bbf5be3fdf9be4982bf9466f6a921b83",
                    "0x78a54c8f4eaba82e45cbc20b9454a83cb296e09e",
                    "0x259371ca8ac5e7f3163704ce58b0da58820173ed",
                    "0x2d42910d826e5500579d121596e98a6eb33c0a1b",
                    "0xcc6a23446f6388d78f3037bd55f2eb820352d982",
                    "0xcd19892916929f013930ed628547cc1f439b230e",
                    "0x93ae6971f03ce890fa4e9274ab441477b84dae5f",
                    "0xf3e9a97e5feddf961a3d431627561bbfc7cfb6cf",
                    "0xfc3f916c28f32deba1cc04b1f6011f28a691134c",
                    "0x70754ab20c63cc65ea12206cf28342723d731ac6",
                    "0x65a5c255cfddb99caccacee6f0fa63f3ab886e79",
                    "0x2e8a05f0216c6cc43bc123ee7def58901d3844d2",
                    "0x183d73da7adc5011ec3c46e33bb50271e59ec976",
                    "0xf99b2f358efec751a9071f30e541ab6c42c25b93",
                    "0xa2f8bd6b95a0cb9094206075504cd0ed1cc717be",
                    "0xf720e9137baa9c7612e6ca59149a5057ab320cfa",
                    "0x3db8e1ffe58ea99939efaef084ca23cc0195b531",
                    "0xea8ba6b0cb5908a5d803b01ceaea5a6e65d33508",
                    "0x061130d4715fcd4828bfcaf6b1a9b93df5e6e4c9",
                    "0xdacd99029b4b94cd04fe364aac370829621c1c64",
                    "0xe6a0fd593e6beca161d0d933b4fb4fecaf49d46a",
                    "0x730a168cf6f501cf302b803ffc57ff3040f378bf",
                    "0x6a2c2d4502335638d2c2f40f0171253fb2c2db88",
                    "0x0021e01b9fab840567a8291b864ff783894eabc6",
                    "0x9965713498c74aee49cef80b2195461f188f24f8",
                    "0x175407b4710b5a1cb67a37c76859f17fb2ff6672",
                    "0xac08fde28aa2d123b61a5db3074caf72760ffeeb",
                    "0xeaf1eef5814d9be44d0dbfb54c7773844339b7f8",
                    "0x27213687f92cda21f10cc09a3e860b6d817ef096",
                    "0xd75026f8723b94d9a360a282080492d905c6a558",
                    "0x58e71af9ce4378b79daaf2c4e7be9765c442dfc2",
                    "0x5f0a99997ab2acc5097dc5349adf6985761336ac",
                    "0x38f1e186cc7609d236aa2161e2ca622b5bc4ef8b",
                    "0x5b006e53df539773e109dbbf392deff6e87e2781",
                    "0xe9b5f4d892df284a15ec90a58bd4385e57964f18",
                    "0xe01347229d681c69f459176a042268cf981dfaa4",
                    "0x27fd581e9d0b2690c2f808cd40f7fe667714b575",
                    "0x852580e3e1c0fd35de426c5481670c1772525265",
                    "0xf8a95653cc7ee59afa2304dcc518c431a15c292c",
                    "0x16289f675ca54312a8fcf99341e7439982888077",
                    "0xcd41bc6dc6e9821c4c36848ff3397493e458a5d1",
                    "0x47c56a900295df5224ec5e6751dc31eb900321d5",
                    "0x64fced4684f4b065e6b900c4e99a0cbacc5e5fe1",
                    "0x7e1726d24b1cd3dfcd713f67a83cceaa6108d069",
                    "0x8c596e8d1b3be04a6caa1b1152b51c495f799a16",
                    "0x8e486dbacb74c00dd31e489da93d99bbebe36cd5",
                    "0x1e916950a659da9813ee34479bff04c732e03deb",
                    "0x7c02ac2bad481dc4e566d3d54359244f381d58dc",
                    "0x9b2defbf22be1ccd63f36dadf69842feb5e7b8df",
                    "0x6be156504cda8ee38169be96bcf53aeab4377c1a",
                    "0xf6a7ad46b00300344c7d4739c0518db70e722dc4",
                    "0x7f5a5c80ceeb1c91718a71030f67788f3810be98",
                    "0x1a8f7747ca103d229d7bdff5f89c176b95faf301",
                    "0x62a82fe26e21a8807599374cac8024fae342ef83",
                    "0x9e5b7e6b61529571e98c8f16d07794ea99a7a930",
                    "0x6b9de817875952cb23d985abf6fa9ec4b7f66ad5",
                    "0xbb034e493ebf45f874e038ae76576df9cc1137e5",
                    "0x75ba7f8733c154302cbe2e19fe3ec417e0679833",
                    "0xbdc908e5df4a95909dd8cbdd5e88c4078a85f7fc",
                    "0x87306f713eab296f87ca4519295668fb4bd51f04",
                    "0x655a2b240151b4fab06dfb2b6329ef72647f89dd",
                    "0x30cee2f8cb8e53fc587f6b2578241a118188d530",
                    "0x597aebfe41dcc042db206eb888c42560a22c9303",
                    "0x2041f8a758a0266e1b9272fcd4b1f1c37b67d5da",
                    "0xe2251f5cc98f8ccd8812be9c0aae8a9bd29500f3",
                    "0xc0b75da8e6f6403804efefde3101b02276c5f8ea",
                    "0x2617724db92a8dbd4eba7e24615ba369133ff684",
                    "0xb1af0d75aeea1c13c450ffc7e12083072daf41eb",
                    "0x5c0f23a5c1be65fa710d385814a7fd1bda480b1c",
                    "0x81900935c04a3f7152bd6b0b3b894ac5932c367f",
                    "0xf22bbdad6b3dd9314bdf97724df32b09ff95c216",
                    "0xfa2f6be7cf4da6fae6a011a4efc53180c9cf0a1b",
                    "0x5622821a3b993f062ff691478bbb7d551c167321",
                    "0x346f1d4f98f055bb0791465923e27a10f1082912",
                    "0x0b9ea598757c7d03fb1937cc16bdd2c9d416ff80",
                    "0x77be4d39598962210b702514219fbca4a6dc77ba",
                    "0xf697535848b535900c76f70f1e36ec3985d27862",
                    "0x253ed65fff980aee7e94a0dc57be304426048b35",
                    "0x2c2179abce3413e27bda6917f60ae37f96d01826",
                    "0x0ad055942640eaf282179d89eb2f3d59136959c7",
                    "0x6d060a785530cb13795b3c5a43320c462811d43b",
                    "0xfc7d964f1676831d8105506b1f0c3b3e2b55c467",
                    "0x671ed21480acf63b0ab7297b901505f5bccafa9b",
                    "0x2e6cd45581002c894cac692dce4a30632125ef99",
                    "0x001edf44d8aa79922dbe74f57c703ebce2e13b43",
                    "0x17753fc89894a5ebd8b327f7d6121038e9240437",
                    "0x84f7f5cd2218f31b750e7009bb6fd34e0b945dac",
                    "0xf8c85bd74fee26831336b51a90587145391a27ba",
                    "0xf91ba601c53f831869da4aceaaec11c479413972",
                    "0x80f129622dc60f5a7de85cbc98f7e3a99b09e57f",
                    "0xd558c611b69a223767788b638717e868d8947fd0",
                    "0xc859bf9d7b8c557bbd229565124c2c09269f3aef",
                    "0x5af3b93fb82ab8691b82a09cbbae7b8d3eb5ac11",
                    "0xd449efa0a587f2cb6be3ae577bc167a774525810",
                    "0x3aba56cec68987963566a9aa93bb7f7dd28de3f5",
                    "0xb6d101874b975083c76598542946fe047f059066",
                    "0xbf65b3fa6c208762ed74e82d4aefcddfd0323648",
                    "0x8135d6abfd42707a87a7b94c5cfa3529f9b432ad",
                    "0x0bcdb6d9b27bd62d3de605393902c7d1a2c71aab",
                    "0xdee29b7b6df3576280bfbbc088ee9ebaa767c0bd",
                    "0xa00db7d9c465e95e4aa814a9340b9a161364470a",
                    "0xa8b309a75f0d64ed632d45a003c68a30e59a1d8b",
                    "0x25869f277f474fa9459f40f5d4cb0d6a8ab41967",
                    "0xf7b0751fea697cf1a541a5f57d11058a8fb794ee",
                    "0x15c84754c7445d0df6c613f1490ca07654347c1b",
                    "0x79ef6103a513951a3b25743db509e267685726b7",
                ],
                [
                    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 75, 146, 378, 91, 89, 1457, 39, 30, 62, 92, 52, 36, 85, 105, 144, 43,
                    61, 29, 200, 129, 75, 60, 33, 18, 18, 21, 18, 14, 102, 14, 25, 168, 38, 30, 30, 34, 23, 19, 36, 19,
                    53, 27, 10, 26, 19, 20, 29, 10, 26, 19, 26, 19, 19, 47, 19, 28, 28, 123, 415, 95, 63, 123, 41, 190,
                    115, 86, 26, 114, 129, 11, 95, 13, 13, 13, 14, 14, 134, 489, 15, 15, 53, 237, 19, 19, 19, 24, 62,
                    172, 44, 48, 59, 479, 134, 358, 343, 1021,
                ],
            );
        await tx.wait();
    });
});
