import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import {
    BoosterOwner__factory,
    Booster__factory,
} from "../types/generated";
import { impersonateAccount } from "../test-utils";
import { Signer } from "ethers";
import { deployContract } from "../tasks/utils";

const debug = false;

const boosterOwnerAddress = "0xFa838Af70314135159b309bf27f1DbF1F954eC34";
const boosterAddress = "0x7818A1DA7BD1E64c199029E86Ba244a9798eEE10";
const zeroAddress = "0x0000000000000000000000000000000000000000";

describe("FeeDistroUpdate", () => {
    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 15135072,
                    },
                },
            ],
        });
    });

    describe("update fee distro", () => {
        it("update fee distro contracts", async () => {});
        it("set hash on voter proxy for claim", async () => {});
        it("add rewards to fee distro and fast forward 1 week", async () => {});
        it("only voter proxy can claim rewards", async () => {});
        it("claim rewards via earmarkRewards", async () => {});
    });
});
