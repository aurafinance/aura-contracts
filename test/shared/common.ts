import { BigNumberish } from "ethers";
import { simpleToExactAmount, ZERO_ADDRESS, ZERO_BYTES } from "../../test-utils";
import { Account, ERC20, ProxyOFT } from "types";

export async function bridgeTokenFromL1ToL2(
    sender: Account,
    token: ERC20,
    proxyOFT: ProxyOFT,
    dstChainId: number,
    amount: BigNumberish,
) {
    const NATIVE_FEE = simpleToExactAmount("0.2");
    const from = sender.address;
    const to = sender.address;
    await token.connect(sender.signer).approve(proxyOFT.address, amount);
    await proxyOFT
        .connect(sender.signer)
        .sendFrom(from, dstChainId, to, amount, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_BYTES, {
            value: NATIVE_FEE,
        });
}
