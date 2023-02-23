import { BN, simpleToExactAmount } from "../../test-utils/math";
import { ethers, network } from "hardhat";
import { expect } from "chai";
import { AuraMining, AuraMining__factory } from "../../types/generated";
import { impersonateAccount, ZERO_ADDRESS } from "../../test-utils";
import { Signer } from "ethers";
import { config } from "../../tasks/deploy/mainnet-config";
import { Phase2Deployed } from "scripts/deploySystem";
import { Account } from "types/common";

const EMISSIONS_MAX_SUPPLY = 50000000;
const EMISSIONS_INIT_SUPPLY = 50000000;
const ALCHEMY_API_KEY = process.env.NODE_URL;

describe("AuraMining", () => {
    let cvxMining: AuraMining;
    let signer: Signer;
    let phase2: Phase2Deployed;
    let operatorAccount: Account;
    let aliceAddress: string;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: ALCHEMY_API_KEY,
                        blockNumber: 14932390,
                    },
                },
            ],
        });
        await impersonateAccount(config.multisigs.daoMultisig);
        signer = await ethers.getSigner(config.multisigs.daoMultisig);
        cvxMining = await new AuraMining__factory(signer).deploy();
        phase2 = await config.getPhase2(signer);
        operatorAccount = await impersonateAccount(phase2.booster.address);
        aliceAddress = (await ethers.getSigners())[0].address;
    });
    const expectMint = async (crvAmount: BN, expectedCvxAmount: BN, desc: string) => {
        const cvxCalculated = await cvxMining.convertCrvToCvx(crvAmount);
        const tx = await phase2.cvx.connect(operatorAccount.signer).mint(aliceAddress, crvAmount);
        await expect(tx).to.emit(phase2.cvx, "Transfer").withArgs(ZERO_ADDRESS, aliceAddress, cvxCalculated);
        expect(cvxCalculated, `${desc} cvxCalculated`).to.be.eq(expectedCvxAmount);
    };

    describe("converts crv to cvx", async () => {
        it("calculate mints per BAL yearly schedule ", async () => {
            const beforeTotalSupply = await phase2.cvx.totalSupply();
            // Year 1 - BAL emissions
            await expectMint(simpleToExactAmount(4536428.571, 18), simpleToExactAmount(17692071.4269, 18), "Year 1"); // 17.6m

            // Year 2 - BAL emissions
            await expectMint(simpleToExactAmount(3814666.524, 18), simpleToExactAmount(11520292.90248, 18), "Year 2"); // 11.5m

            // Year 3 - BAL emissions
            await expectMint(simpleToExactAmount(3207739.405, 18), simpleToExactAmount(7826884.1482, 18), "Year 3"); // 7.8m

            // Year 4 - BAL emissions
            await expectMint(simpleToExactAmount(2697376.567, 18), simpleToExactAmount(5529621.96235, 18), "Year 4"); // 5.5m

            // Year 5 - BAL emissions
            await expectMint(simpleToExactAmount(2268214.286, 18), simpleToExactAmount(4023812.143364, 18), "Year 5"); // 4m

            // Year 6 - BAL emissions
            await expectMint(simpleToExactAmount(1907333.262, 18), simpleToExactAmount(3002142.554388, 18), "Year 6"); // 3m

            // Year 7 - BAL emissions
            await expectMint(simpleToExactAmount(1603869.703, 18), simpleToExactAmount(405174.862318, 18), "Year 7"); // 0.405m

            const afterTotalSupply = await phase2.cvx.totalSupply();

            expect(beforeTotalSupply, "total supply does change").to.lt(afterTotalSupply);
            expect(afterTotalSupply, "max supply reached").to.eq(
                simpleToExactAmount(EMISSIONS_MAX_SUPPLY + EMISSIONS_INIT_SUPPLY),
            );
        });
    });
});
