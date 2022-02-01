import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";
import { ISPool__factory, IERC20__factory } from "../../types";
import { impersonate } from "../../test-utils/fork";
import { simpleToExactAmount } from "../../test-utils/math";
import { HardhatRuntime } from "../utils/networkAddressFactory";

const crvMUSDDeposit = "0x803A2B40c5a9BB2B86DD630B274Fa2A9202874C2";
const musdAddress = "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5";

const tokens = [
    {
        name: "musd",
        holder: "0xe008464f754e85e37bca41cce3fbd49340950b29",
        token: musdAddress,
    },
    {
        name: "cvx",
        holder: "0x0aca67fa70b142a3b9bf2ed89a81b40ff85dacdc",
        token: "0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b",
    },
    {
        name: "crv",
        holder: "0x7a16ff8270133f063aab6c9977183d9e72835428",
        token: "0xd533a949740bb3306d119cc777fa900ba034cd52",
    },
];

task("curveTokens")
    .addParam("account", "The account's address")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntime) {
        const { ethers, network } = hre;
        console.log("chain:", network.name);

        const myAccount = taskArgs.account;
        console.log("setting up account:", myAccount);

        const myAccountSigner = await impersonate(myAccount);

        const signers = await ethers.getSigners();
        await signers[1].sendTransaction({ to: myAccount, value: simpleToExactAmount(1) });

        for (const { holder, token, name } of tokens) {
            const signer = await impersonate(holder);

            console.log(`transfering ETH to ${name} holder`);
            await signers[1].sendTransaction({ to: holder, value: simpleToExactAmount(1) });

            console.log("transfering:", name);
            const erc20 = IERC20__factory.connect(token, signer);
            const balance = await erc20.balanceOf(holder);
            const tx = await erc20.transfer(myAccount, balance);
            await tx.wait();

            const newBalance = await erc20.balanceOf(myAccount);
            console.log("new balance:", newBalance.toString());
        }

        // Approve curve for MUSD
        const musd = IERC20__factory.connect(musdAddress, myAccountSigner);
        let tx = await musd.connect(myAccountSigner).approve(crvMUSDDeposit, ethers.constants.MaxUint256);
        await tx.wait();
        console.log("approve MUSD spending");

        // Deposit MUSD in curve to get curve LP tokens
        const deposit = ISPool__factory.connect(crvMUSDDeposit, myAccountSigner);
        tx = await deposit.add_liquidity([ethers.utils.parseEther("1"), "0", "0", "0"], "0");
        await tx.wait();
        console.log("deposited MUSD");
    });
