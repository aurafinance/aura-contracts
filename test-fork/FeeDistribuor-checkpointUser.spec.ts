import { ethers, network } from "hardhat";
import {
    IFeeDistributor,
    IFeeDistributor__factory,
    ClaimFeesHelper,
    ClaimFeesHelper__factory,
} from "../types/generated";
import { impersonateAccount } from "../test-utils";
import { Signer } from "ethers";

const ALCHEMY_API_KEY = process.env.NODE_URL;

const keeper = "0xcc247cde79624801169475c9ba1f716db3959b8f";
const voterProxy = "0xaf52695e1bb01a16d33d7194c28c42b10e0dbec2";
const feeDistributorAddress = "0x26743984e3357eFC59f2fd6C1aFDC310335a61c9";
const claimFeesHelperAddress = "0x999dBcE0A18F721F04E793f916C30e72A9D0f56E";
const balAddress = "0xba100000625a3754423978a60c9317c58a424e3D";
const bbausdAddress = "0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2";

describe("feeDistributor", () => {
    let feeDistributor: IFeeDistributor;
    let claimFeesHelper: ClaimFeesHelper;
    let signer: Signer;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: ALCHEMY_API_KEY,
                        blockNumber: 15050466,
                    },
                },
            ],
        });

        await impersonateAccount(keeper);

        signer = await ethers.getSigner(keeper);
        feeDistributor = IFeeDistributor__factory.connect(feeDistributorAddress, signer);
        claimFeesHelper = ClaimFeesHelper__factory.connect(claimFeesHelperAddress, signer);
    });

    it("checkpointUser", async () => {
        let calls = 1;
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
            if (calls > 20) break;
        }
    });

    it.skip("claimFees", async () => {
        await claimFeesHelper.claimFees(balAddress);
        await claimFeesHelper.claimFees(bbausdAddress);
    });
});
