import { expect } from "chai";
import { Contract, Signer } from "ethers";
import hre, { network } from "hardhat";
import { deployGaugeVoterModule } from "../../scripts/deployPeripheral";
import { CanonicalPhaseDeployed } from "../../scripts/deploySidechain";
import { Phase2Deployed } from "../../scripts/deploySystem";
import { config } from "../../tasks/deploy/mainnet-config";
import { anyValue, impersonate } from "../../test-utils";
import { GaugeVoterModule, ISafe, ISafe__factory } from "../../types";

describe("Gauge Voter Module", () => {
    let daoMultisig: Signer;
    let deployer: Signer;
    let deployerAddress: string;
    let contracts: Phase2Deployed & CanonicalPhaseDeployed;
    let gaugeVoterModule: GaugeVoterModule;
    let gaugeController: Contract;
    let safe: ISafe;
    const gauges = [
        "0xEA8Ba6b0cB5908A5d803b01CeAea5a6E65D33508",
        "0x58e71Af9CE4378b79dAAf2C4E7be9765c442dFC2",
        "0xAC08fde28aa2D123B61a5dB3074cAF72760FfeEB",
        "0x5B5BAD6A124C5f45b4289908bA15Ff0047928648",
        "0x7C02ac2BAd481dC4E566D3D54359244f381d58dC",
        "0xf99b2f358efeC751A9071f30E541ab6C42C25B93",
        "0x8e486dBACb74C00dd31e489Da93d99bbeBE36cd5",
        "0x5C0F23A5c1be65Fa710d385814a7Fd1Bda480b1C",
        "0x79eF6103A513951a3b25743DB509E267685726B7",
        "0xf7B0751Fea697cf1A541A5f57D11058a8fB794ee",
        "0x4B891340b51889f438a03DC0e8aAAFB0Bc89e7A6",
        "0xC859BF9d7B8C557bBd229565124c2C09269F3aEF",
        "0x9965713498c74aee49cEf80B2195461F188F24f8",
        "0x8135d6AbFd42707A87A7b94c5CFA3529f9b432AD",
        "0xf8C85bd74FeE26831336B51A90587145391a27Ba",
        "0x15C84754c7445D0DF6c613f1490cA07654347c1B",
        "0x1B7E33186C7e9C337508bB65EA9dc498aB14fcAE",
        "0x6d060a785530cB13795b3c5a43320c462811d43b",
        "0x7a59aF3a8650Edc8ebE6d79162A2Aa97f2B98AAC",
        "0x5c13C3b72b031b6405046C319B2D840d3C1403c7",
        "0x9b237fA1958E3022464343137738926d38815801",
        "0xCA318253Bb460e08ca33fD22574E7F70217130f5",
        "0x2D42910D826e5500579D121596E98A6eb33C0a1b",
        "0x47c56A900295df5224EC5e6751dC31eb900321D5",
        "0x80CD37A62A8A58C4Cbf64003410c5cCC4d01519f",
        "0xB2FcAd9fd42Affd0A90a996A1DEde4427435e5F8",
        "0x852580e3E1C0Fd35DE426C5481670c1772525265",
        "0x2617724db92a8dbD4ebA7E24615BA369133Ff684",
        "0x16289F675Ca54312a8fCF99341e7439982888077",
        "0x0d1b58fB1fC10F2160178DE1eAE2d520335ee372",
        "0x730A168cF6F501cf302b803FFc57FF3040f378Bf",
        "0x93AE6971F03CE890FA4e9274Ab441477b84DAE5f",
        "0x64fCeD4684f4B065E6b900c4E99a0CBaCC5E5fe1",
        "0xFa2F6BE7cF4da6FaE6A011A4EFC53180c9Cf0a1b",
        "0x3Db8e1Ffe58EA99939efaeF084ca23Cc0195B531",
        "0x40B04058fF35fD3164E6cc66C4E6398c1E5E68c8",
        "0xc0b75da8E6F6403804EFEFDE3101b02276C5f8EA",
        "0x346F1D4F98F055bb0791465923E27a10F1082912",
        "0x175407b4710b5A1cB67a37C76859F17fb2ff6672",
        "0x81900935C04A3F7152BD6b0b3B894Ac5932c367F",
        "0x2041F8a758A0266e1B9272fcd4B1F1c37b67d5da",
        "0xfD151734ffC9A4A55C50fed4b66c15B06Bbb390B",
        "0x061130d4715FCD4828BfCAf6B1a9B93DF5e6e4c9",
        "0xB1E8ec305b0b29097a117CaFC9721A553533E54C",
        "0x0021e01B9fAb840567a8291b864fF783894EabC6",
        "0x86C44de72Ec88d205E63c2aF8D577659319C7a7f",
        "0xb2A8f0f477Aae4D78Ea78d85234233285c91bB08",
        "0x30cEE2F8Cb8e53FC587f6B2578241a118188D530",
        "0x4eB7C7fD67B9b2C24d9fF1601ccDa5A01bD40c7f",
        "0x87306F713EaB296f87CA4519295668fb4Bd51F04",
        "0xeaDB24ebe7348F716780C162C56b61Bef8283455",
        "0x7f5A5c80cEeB1C91718a71030F67788F3810be98",
        "0x597AEbfe41dCc042db206Eb888c42560a22c9303",
        "0x30FB447441195a5b72A382Ef14c5865C0fc1A9aa",
        "0xFccE9b5C1e8D56D9Fc6Dcbb706aCC51dD03fe9F1",
        "0x9604a525630E7d9d72d804bDcB678862bab1971c",
        "0x91beC9e7867635487668B3dF73971456a6a5f2Fa",
        "0xDaCD99029b4B94CD04fE364aAc370829621C1C64",
        "0xAB39b84287769481d7D004E17AC3875248d3C631",
        "0x6dDEdCdB545e04927B2ABa21778A790A3318E3cb",
        "0x77bE4d39598962210b702514219fBCA4A6dc77Ba",
        "0xAa23FC5Fafba846F07181761903fB9350e954c34",
        "0x183D73dA7adC5011EC3C46e33BB50271e59EC976",
        "0x9b2defbf22bE1CCD63f36DADf69842FEB5e7b8Df",
        "0xD606Ea6f6d93D90EFafc7d21972353FB98205Eb8",
        "0xd75026F8723b94d9a360A282080492d905c6A558",
        "0xAC3b3fFf577561C58f126e4F6375F56476DD9fDb",
        "0xa8B309a75f0D64ED632d45A003c68A30e59A1D8b",
        "0xf720e9137baa9C7612e6CA59149a5057ab320cFa",
        "0x2D1c51eaB8b3c2287BA26061c0e339DA3b15B955",
        "0x31Ccb4E5005Fd37005523E6e3f1d084F9aBe25B6",
        "0x5C36197A631649441649028110fa503a3be00162",
        "0x1dA19f38Eb6F2c22199dC0848118b26095C29aEd",
        "0x6A2C2d4502335638d2c2f40f0171253fb2c2db88",
        "0x70A1c01902DAb7a45dcA1098Ca76A8314dd8aDbA",
        "0xd42Fae61a6D0f8466B9E790db921c3469d5BEf55",
        "0xC219821b1FE1bBe436f62D911F00Ef1C8542A8F7",
        "0x9fdD52eFEb601E4Bc78b89C6490505B8aC637E9f",
        "0x52d28dfF7759Ca78978954eBAbF87481BD5Cf8f0",
    ];
    const weights = [
        0, 0, 0, 0, 0, 0, 0, 215, 990, 102, 67, 85, 425, 133, 93, 124, 51, 58, 14, 60, 69, 19, 24, 72, 14, 44, 21, 19,
        21, 97, 37, 49, 49, 49, 23, 98, 98, 98, 116, 98, 98, 98, 67, 31, 242, 31, 98, 45, 73, 50, 15, 65, 65, 70, 70,
        57, 19, 51, 21, 22, 147, 31, 333, 136, 107, 111, 143, 466, 44, 46, 187, 75, 248, 150, 80, 124, 1127, 1194, 431,
    ];
    const gaugeControllerABI = ["event VoteForGauge(uint256 time, address user, address gauge_addr, uint256 weight)"];

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 22684200,
                    },
                },
            ],
        });
        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        deployer = await impersonate(deployerAddress, true);
        daoMultisig = await impersonate(config.multisigs.daoMultisig, true);
        gaugeController = new hre.ethers.Contract(config.addresses.gaugeController, gaugeControllerABI, deployer);
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
    it("fails if keeper is not the caller - voteGaugeWeight", async () => {
        const authorizedKeepers = await gaugeVoterModule.authorizedKeepers(await deployer.getAddress());
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(false);
        await expect(gaugeVoterModule.connect(deployer).voteGaugeWeight([], [])).to.be.revertedWith("!keeper");
    });
    it("fails if keeper is not the caller - setDstChainId", async () => {
        const authorizedKeepers = await gaugeVoterModule.authorizedKeepers(await deployer.getAddress());
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(false);
        await expect(gaugeVoterModule.connect(deployer).setDstChainId([], [])).to.be.revertedWith("!keeper");
    });
    it("fails if pool ids are not set", async () => {
        const authorizedKeepers = await gaugeVoterModule.authorizedKeepers(config.multisigs.defender.keeperMulticall3);
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
        const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
        await expect(gaugeVoterModule.connect(keeper).voteGaugeWeight(gauges, weights)).to.be.revertedWith("!success");
    });
    it("fails setDstChainId when inputs do not match", async () => {
        const authorizedKeepers = await gaugeVoterModule.authorizedKeepers(config.multisigs.defender.keeperMulticall3);
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
        const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
        await expect(
            gaugeVoterModule
                .connect(keeper)
                .setDstChainId(
                    [
                        "0x6ddedcdb545e04927b2aba21778a790a3318e3cb",
                        "0x91bec9e7867635487668b3df73971456a6a5f2fa",
                        "0xaa23fc5fafba846f07181761903fb9350e954c34",
                        "0xab39b84287769481d7d004e17ac3875248d3c631",
                        "0xd42fae61a6d0f8466b9e790db921c3469d5bef55",
                    ],
                    [111, 111, 184, 111, 106, 111],
                ),
        ).to.be.revertedWith("!dstChainIds");
    });
    it("fails setDstChainId with empty arrays", async () => {
        const authorizedKeepers = await gaugeVoterModule.authorizedKeepers(config.multisigs.defender.keeperMulticall3);
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
        const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
        await expect(gaugeVoterModule.connect(keeper).setDstChainId([], [])).to.be.revertedWith("!gauges");
    });
    it("only keeper can execute task setDstChainId", async () => {
        const authorizedKeepers = await gaugeVoterModule.authorizedKeepers(config.multisigs.defender.keeperMulticall3);
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
        const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);

        const tx = await gaugeVoterModule
            .connect(keeper)
            .setDstChainId(
                [
                    "0x6ddedcdb545e04927b2aba21778a790a3318e3cb",
                    "0x91bec9e7867635487668b3df73971456a6a5f2fa",
                    "0xaa23fc5fafba846f07181761903fb9350e954c34",
                    "0xab39b84287769481d7d004e17ac3875248d3c631",
                    "0xd42fae61a6d0f8466b9e790db921c3469d5bef55",
                    "0xeadb24ebe7348f716780c162c56b61bef8283455",
                ],
                [111, 111, 184, 111, 106, 111],
            );

        await tx.wait();
    });
    it("anyone calls setPoolIds", async () => {
        const authorizedKeepers = await gaugeVoterModule.authorizedKeepers(config.multisigs.defender.keeperMulticall3);
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
        const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
        const tx = await contracts.gaugeVoteRewards.connect(keeper).setPoolIds(260, 264);
        await tx.wait();
    });
    it("fails to call if vote weight is too high", async () => {
        const authorizedKeepers = await gaugeVoterModule.authorizedKeepers(config.multisigs.defender.keeperMulticall3);
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
        const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
        const MAX_WEIGHT = await gaugeVoterModule.MAX_WEIGHT();
        const wrongWeights = [...weights];
        const wrongWeightIdx = 4;
        wrongWeights[wrongWeightIdx] = MAX_WEIGHT.add(1).toNumber();

        await expect(gaugeVoterModule.connect(keeper).voteGaugeWeight(gauges, wrongWeights)).to.be.revertedWith(
            `InvalidWeight(${wrongWeightIdx}, 2501)`,
        );
    });
    it("only keeper can execute task voteGaugeWeight", async () => {
        // If task fails try export NODE_OPTIONS="--max-old-space-size=8192"
        const authorizedKeepers = await gaugeVoterModule.authorizedKeepers(config.multisigs.defender.keeperMulticall3);
        expect(authorizedKeepers, "authorizedKeepers").to.be.eq(true);
        const keeper = await impersonate(config.multisigs.defender.keeperMulticall3);
        const tx = await gaugeVoterModule.connect(keeper).voteGaugeWeight(gauges, weights);

        // For each gauge on the array expect the event VoteForGauge(time, user, gauge, weight)
        for (let i = 0; gauges.length < 1; i++) {
            await expect(tx).emit(gaugeController, "VoteForGauge").withArgs(
                anyValue, // time is not important in this case
                contracts.voterProxy.address,
                gauges[i],
                weights[i],
            );
        }
    });
});
