import { expect } from "chai";
import { ethers, network } from "hardhat";
import {
    IFeeDistributor,
    IFeeDistributor__factory,
    ClaimFeesHelper,
    ClaimFeesHelper__factory,
    IERC20__factory,
    Booster,
    Booster__factory,
} from "../types/generated";
import { BN, getTimestamp, impersonateAccount, increaseTime, ONE_DAY } from "../test-utils";
import { Signer } from "ethers";
import { simpleToExactAmount } from "../test-utils/math";

const ALCHEMY_API_KEY = process.env.NODE_URL;

const keeper = "0xcc247cde79624801169475c9ba1f716db3959b8f";
const voterProxy = "0xaf52695e1bb01a16d33d7194c28c42b10e0dbec2";
const boosterAddress = "0x7818A1DA7BD1E64c199029E86Ba244a9798eEE10";
const feeDistributorAddress = "0x26743984e3357eFC59f2fd6C1aFDC310335a61c9";
const claimFeesHelperAddress = "0x999dBcE0A18F721F04E793f916C30e72A9D0f56E";
const balAddress = "0xba100000625a3754423978a60c9317c58a424e3D";
const bbausdAddress = "0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2";
const cvxCrvRewardsAddress = "0x5e5ea2048475854a5702F5B8468A51Ba1296EFcC";

const balWhaleAddress = "0x3c221e16a342a5ec114f7259a37ef42b0597c251";
const bbausdWhaleAddress = "0x68d019f64a7aa97e2d4e7363aee42251d08124fb";

describe("feeDistributor", () => {
    let feeDistributor: IFeeDistributor;
    let claimFeesHelper: ClaimFeesHelper;
    let booster: Booster;
    let signer: Signer;
    let balWhale: Signer;
    let bbausdWhale: Signer;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: ALCHEMY_API_KEY,
                        blockNumber: 15089726,
                    },
                },
            ],
        });

        await impersonateAccount(keeper);

        signer = await ethers.getSigner(keeper);
        feeDistributor = IFeeDistributor__factory.connect(feeDistributorAddress, signer);
        claimFeesHelper = ClaimFeesHelper__factory.connect(claimFeesHelperAddress, signer);
        booster = Booster__factory.connect(boosterAddress, signer);

        balWhale = (await impersonateAccount(balWhaleAddress)).signer;
        bbausdWhale = (await impersonateAccount(bbausdWhaleAddress)).signer;
    });

    it.skip("checkpointUser", async () => {
        let calls = 1;
        console.log(
            "checkpointUser calls counter ",
            0,
            "getUserTimeCursor",
            (await feeDistributor.getUserTimeCursor(voterProxy)).toString(),
            "getTimeCursor",
            (await feeDistributor.getTimeCursor()).toString(),
        );
        // checkpointUser calls counter  0 getUserTimeCursor 1656547200 getTimeCursor 1657152000
        // checkpointUser calls counter  1 getUserTimeCursor 1656547200 getTimeCursor 1657152000
        // checkpointUser calls counter  2 getUserTimeCursor 1656547200 getTimeCursor 1657152000
        // checkpointUser calls counter  3 getUserTimeCursor 1656547200 getTimeCursor 1657152000
        // checkpointUser calls counter  4 getUserTimeCursor 1656547200 getTimeCursor 1657152000
        // checkpointUser calls counter  5 getUserTimeCursor 1656547200 getTimeCursor 1657152000
        while ((await feeDistributor.getUserTimeCursor(voterProxy)).lt(await feeDistributor.getTimeCursor())) {
            await feeDistributor.checkpointUser(voterProxy);
            console.log(
                "checkpointUser calls counter ",
                calls,
                "getUserTimeCursor",
                (await feeDistributor.getUserTimeCursor(voterProxy)).toString(),
                "getTimeCursor",
                (await feeDistributor.getTimeCursor()).toString(),
            );
            calls = calls + 1;
            if (calls > 5) break;
        }
    });

    it.skip("claimFees", async () => {
        // await claimFeesHelper.claimFees(balAddress);
        await claimFeesHelper.claimFees(bbausdAddress);
    });

    it.skip("claimFees-bbausd", async () => {
        // await claimFeesHelper.claimFees(balAddress);
        const bbausd = IERC20__factory.connect(bbausdAddress, signer);
        await feeDistributor.checkpointUser(voterProxy);
        await feeDistributor.checkpointUser(voterProxy);
        const tx = claimFeesHelper.claimFees(bbausdAddress);
        //    const receipt=  await (await tx).wait();
        //    const event  = receipt.events.find(e=> e.event="Transfer")
        //    console.log("arg",event)
        //    console.log("arg",event.args)
        //    console.log("arg",event.args[0])
        //    console.log("arg",event.args[1])
        //    console.log("arg",event.args[2])
        //    console.log("arg",event.args[3])
        //    console.log(receipt.events.find(e=> e.event="Transfer"))

        const { events } = await (await tx).wait();
        const transferEvent = events.find(e => (e.event = "Transfer"));
        console.log(transferEvent);
        //    expect(swappedEvent.args[0]).to.eq(sender.address)
        //    expect(swappedEvent.args[1]).to.eq(inputBasset.address)
        //    expect(swappedEvent.args[2]).to.eq(outputAsset.address)
        //    expect(swappedEvent.args[3]).to.eq(expectedOutputValue)
        //    const scaledFee = swappedEvent.args[4]
        //    expect(swappedEvent.args[5]).to.eq(recipient)

        await expect(tx)
            .to.emit(bbausd, "Transfer")
            .withArgs(feeDistributor.address, voterProxy, BN.from("0x39ca751c2a3bc8d95d3")); // 17056848155793572074963
    });
    it.skip("claimFees-bal", async () => {
        await claimFeesHelper.claimFees(balAddress);
    });
    it("test future", async () => {
        // could also run a fork test depositing rewards, fast forwarding to tomorrow, and then claiming, to confirm it works
        console.log("checkpoint");
        await feeDistributor.checkpointUser(voterProxy);
        await feeDistributor.checkpointUser(voterProxy);

        // deposit rewards
        console.log("deposit rewards");
        const bal = IERC20__factory.connect(balAddress, balWhale);
        const bbausd = IERC20__factory.connect(bbausdAddress, bbausdWhale);

        await bal.approve(feeDistributor.address, simpleToExactAmount(50000));
        await bbausd.approve(feeDistributor.address, simpleToExactAmount(30000));

        await feeDistributor.connect(balWhale).depositToken(balAddress, simpleToExactAmount(50000));
        await feeDistributor.connect(bbausdWhale).depositToken(bbausdAddress, simpleToExactAmount(30000));

        console.log("checkpoint");

        // fast forward tomorrow
        console.log("fast forward tomorrow");
        await increaseTime(ONE_DAY);

        console.log(await getTimestamp());
        // claim
        console.log("claim");
        // Note: Requires 3 checkpoints
        await feeDistributor.checkpointUser(voterProxy);
        await feeDistributor.checkpointUser(voterProxy);
        await feeDistributor.checkpointUser(voterProxy);

        const bals = await feeDistributor.callStatic.claimToken(voterProxy, balAddress);
        console.log("🚀 ~ file: FeeDistribuor-checkpointUser.spec.ts ~ line 161 ~ it ~ bals", bals);
        const bbusds = await feeDistributor.callStatic.claimToken(voterProxy, bbausdAddress);
        console.log("🚀 ~ file: FeeDistribuor-checkpointUser.spec.ts ~ line 163 ~ it ~ bbusds", bbusds);

        const feeDistro = await booster.feeTokens(bal.address);
        const balbefore = await bal.balanceOf(feeDistro.rewards);
        await booster.earmarkFees(bal.address);
        const balafter = await bal.balanceOf(feeDistro.rewards);

        console.log(
            "🚀 ~ file: FeeDistribuor-checkpointUser.spec.ts ~ line 176 ~ it ~ feeDistro.distro",
            feeDistro.rewards,
            cvxCrvRewardsAddress,
        );
        console.log("🚀 ~ file: FeeDistribuor-checkpointUser.spec.ts ~ line 175 ~ it ~ balbefore", balbefore);

        console.log("🚀 ~ file: FeeDistribuor-checkpointUser.spec.ts ~ line 178 ~ it ~ balafter", balafter);

        // expect(balafter).eq(balbefore.add(simpleToExactAmount(1)));

        // console.log("claim bbausdAddress");
        // const tx =  await claimFeesHelper.claimFees(bbausdAddress);
        // const { events } = await (await tx).wait()
        // const transferEvent = events.find((e) => e.event = "Transfer")
        // console.log("bbausdAddress", transferEvent);

        // console.log("claim balAddress");
        // const tx2 =  await claimFeesHelper.claimFees(balAddress);
        // const { events:events2 } = await (await tx2).wait()
        // const transferEvent2 = events2.find((e) => e.event = "Transfer")
        // console.log("balAddress", transferEvent2);
    });
});
