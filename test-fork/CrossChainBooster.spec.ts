import { network, ethers } from "hardhat";
import { Signer } from "ethers";

describe("Cross Chain Booster", () => {
    let deployer: Signer;
    let deployerAddress: string;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15271655,
                    },
                },
            ],
        });

        const signers = await ethers.getSigners();
        deployer = signers[0];
        deployerAddress = await deployer.getAddress();
    });

    describe("deployment", () => {
        it("deploy voter proxy");
        it("deploy booster");
        it("deploy L2 rAURA");
    });

    describe("add pool", () => {
        it("add a pool");
        it("deposit LP tokens");
        it("claim rewards");
        it("widthdraw LP tokens");
    });
});
