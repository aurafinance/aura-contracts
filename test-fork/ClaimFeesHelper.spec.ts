import { expect } from "chai";
import { network } from "hardhat";
import {
    IFeeDistributor,
    IFeeDistributor__factory,
    ClaimFeesHelper,
    ClaimFeesHelper__factory,
    IERC20__factory,
    Booster,
    Booster__factory,
} from "../types/generated";
import { impersonate, impersonateAccount, increaseTime, ONE_DAY, ZERO } from "../test-utils";
import { Signer } from "ethers";
import { simpleToExactAmount } from "../test-utils/math";

const keeperAddress = "0xcc247cde79624801169475c9ba1f716db3959b8f";
const voterProxyAddress = "0xaf52695e1bb01a16d33d7194c28c42b10e0dbec2";
const boosterAddress = "0x7818A1DA7BD1E64c199029E86Ba244a9798eEE10";
const feeDistributorAddress = "0xD3cf852898b21fc233251427c2DC93d3d604F3BB";
const balAddress = "0xba100000625a3754423978a60c9317c58a424e3D";
const bbausdAddress = "0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2";

const balWhaleAddress = "0x3c221e16a342a5ec114f7259a37ef42b0597c251";
const bbausdWhaleAddress = "0x68d019f64a7aa97e2d4e7363aee42251d08124fb";

describe("ClaimFeesHelper", () => {
    let feeDistributor: IFeeDistributor;
    let claimFeesHelper: ClaimFeesHelper;
    let booster: Booster;
    let signer: Signer;
    let balWhale: Signer;
    let bbausdWhale: Signer;
    let deployer: Signer;
    let keeper: Signer;
    let deployerAddress: string;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15225000,
                    },
                },
            ],
        });
        deployerAddress = "0xA28ea848801da877E1844F954FF388e857d405e5";
        deployer = await impersonate(deployerAddress);
        keeper = await impersonate(keeperAddress);

        signer = keeper;
        feeDistributor = IFeeDistributor__factory.connect(feeDistributorAddress, signer);
        booster = Booster__factory.connect(boosterAddress, signer);

        balWhale = (await impersonateAccount(balWhaleAddress)).signer;
        bbausdWhale = (await impersonateAccount(bbausdWhaleAddress)).signer;
    });
    it("deploy claims fees helper", async () => {
        claimFeesHelper = await new ClaimFeesHelper__factory(deployer).deploy(
            booster.address,
            voterProxyAddress,
            feeDistributor.address,
        );
    });

    it("claimFees for both tokens", async () => {
        // deposit rewards
        const bal = IERC20__factory.connect(balAddress, balWhale);
        const bbausd = IERC20__factory.connect(bbausdAddress, bbausdWhale);

        await bal.approve(feeDistributor.address, simpleToExactAmount(50000));
        await bbausd.approve(feeDistributor.address, simpleToExactAmount(30000));

        await feeDistributor.connect(balWhale).depositToken(balAddress, simpleToExactAmount(50000));
        await feeDistributor.connect(bbausdWhale).depositToken(bbausdAddress, simpleToExactAmount(30000));

        // fast forward tomorrow
        await increaseTime(ONE_DAY);

        // check point voter proxy 3 times and claim fees
        const checkpoints = 3;
        const balFeeDistro = await booster.feeTokens(bal.address);
        const bbausdFeeDistro = await booster.feeTokens(bbausd.address);
        const balBefore = await bal.balanceOf(balFeeDistro.rewards);
        const bbausdBefore = await bbausd.balanceOf(bbausdFeeDistro.rewards);

        // Test
        await claimFeesHelper.claimFees([balAddress, bbausdAddress], checkpoints);

        const balAfter = await bal.balanceOf(balFeeDistro.rewards);
        const bbausdAfter = await bbausd.balanceOf(bbausdFeeDistro.rewards);

        expect(balAfter).to.be.gt(balBefore);
        expect(bbausdAfter).to.be.gt(bbausdBefore);
    });

    xit("validates that it cannot claim the same tokens again", async () => {
        // deposit rewards
        const bals = await feeDistributor.callStatic.claimToken(voterProxyAddress, balAddress);
        const bbusds = await feeDistributor.callStatic.claimToken(voterProxyAddress, bbausdAddress);
        expect(bals).to.be.eq(ZERO);
        expect(bbusds).to.be.eq(ZERO);
    });
});
