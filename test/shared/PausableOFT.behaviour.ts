import { expect } from "chai";
import { loadFixture } from "ethereum-waffle";
import { Account } from "types";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { ERC20, ERC20__factory, PausableOFT, ProxyOFT } from "../../types/generated";
import { BN, simpleToExactAmount } from "../../test-utils";
import { ethers } from "ethers";
import { BytesLike, formatEther } from "ethers/lib/utils";
import { table } from "table";

const NATIVE_FEE = simpleToExactAmount("0.2");
const defaultOFTAdapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 600_000]);
const debug = false;
type OFTData = {
    oftBalanceOfFrom: BN;
    oftBalanceOfTo: BN;
    oftTotalSupply: BN;
    oftCirculatingSupply: BN;
};
type ProxyOFTData = {
    tokenBalanceOfFrom: BN;
    tokenBalanceOfTo: BN;
    proxyOftCirculatingSupply: BN;
};
type SnapshotData = OFTData & ProxyOFTData;
export interface PausableOFTBehaviourContext {
    oft: PausableOFT;
    proxyOft: ProxyOFT;
    owner: Account;
    guardian: Account;
    anotherAccount: Account;
    canonicalChainId: number;
    sideChainId: number;
    fixture: () => Promise<PausableOFTBehaviourContext>;
}

export const ERRORS = {
    ONLY_GUARDIAN: "!guardian",
    GUARDIAN_ZERO_ADDRESS: "guardian=0",
    PAUSED: "Pausable: paused",
    NOT_PAUSED: "Pausable: not paused",
    ONLY_OWNER: "Ownable: caller is not the owner",
};
export const EVENTS = {
    PAUSED: "Paused",
    UNPAUSED: "Unpaused",
    RECEIVED_FROM_CHAIN: "ReceiveFromChain",
};

function compareData(test: string, before: SnapshotData, after: SnapshotData) {
    const getDetails = (property: string) => [
        formatEther(before[property]),
        formatEther(after[property]),
        before[property].toString() === after[property].toString(),
    ];

    const testData = [
        ["L1 tokenBalanceOfFrom         ", ...getDetails("tokenBalanceOfFrom")],
        ["L1 tokenBalanceOfTo           ", ...getDetails("tokenBalanceOfTo")],
        ["L1 proxyOftCirculatingSupply  ", ...getDetails("proxyOftCirculatingSupply")],

        ["L2 oftBalanceOfFrom           ", ...getDetails("oftBalanceOfFrom")],
        ["L2 oftBalanceOfTo             ", ...getDetails("oftBalanceOfTo")],
        ["L2 oftTotalSupply             ", ...getDetails("oftTotalSupply")],
        ["L2 oftCirculatingSupply       ", ...getDetails("oftCirculatingSupply")],
    ];

    if (debug) {
        console.log(`----------------------------  ${test} ----------------------------`);
        console.log(table([["Data", "Before", "After", "Equal"], ...testData.filter(t => !t[3])]));
    }
}
async function getOFTData(ctx: PausableOFTBehaviourContext, { from, to }): Promise<OFTData> {
    const oftBalanceOfFrom = await ctx.oft.balanceOf(from);
    const oftBalanceOfTo = await ctx.oft.balanceOf(to);
    const oftTotalSupply = await ctx.oft.totalSupply();
    const oftCirculatingSupply = await ctx.oft.circulatingSupply();
    return { oftBalanceOfFrom, oftBalanceOfTo, oftTotalSupply, oftCirculatingSupply };
}

async function getProxyOFTData(ctx: PausableOFTBehaviourContext, { from, to }): Promise<ProxyOFTData> {
    const tokenAddress = await ctx.proxyOft.token();
    const token = ERC20__factory.connect(tokenAddress, ctx.anotherAccount.signer);
    const tokenBalanceOfFrom = await token.balanceOf(from);
    const tokenBalanceOfTo = await token.balanceOf(to);
    const proxyOftCirculatingSupply = await ctx.proxyOft.circulatingSupply();
    return { tokenBalanceOfFrom, tokenBalanceOfTo, proxyOftCirculatingSupply };
}
const snapshotData = async (ctx: PausableOFTBehaviourContext, { from, to }): Promise<SnapshotData> => {
    return {
        ...(await getOFTData(ctx, { from, to })),
        ...(await getProxyOFTData(ctx, { from, to })),
    };
};
async function expectSendFromL2toL1(
    ctx: PausableOFTBehaviourContext,
    test: string,
    sender: Account,
    receiver: Account,
    owner: Account,
    amount: BN,
) {
    const { oft, proxyOft } = ctx;
    await ctx.oft.connect(owner.signer).approve(ctx.oft.address, amount);

    const dataBefore = await snapshotData(ctx, { from: owner.address, to: receiver.address });
    // When the proxy receives tokens it flows as usual
    const oftAdapterParams: BytesLike = (await ctx.oft.useCustomAdapterParams()) ? defaultOFTAdapterParams : [];
    const tx = await oft
        .connect(sender.signer)
        .sendFrom(
            owner.address,
            ctx.canonicalChainId,
            receiver.address,
            amount,
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            oftAdapterParams,
            { value: NATIVE_FEE },
        );

    const dataAfter = await snapshotData(ctx, { from: owner.address, to: receiver.address });
    compareData(test, dataBefore, dataAfter);

    // Verify it was send from L2
    await expect(tx).to.emit(oft, "Transfer").withArgs(owner.address, ZERO_ADDRESS, amount);
    await expect(tx)
        .to.emit(oft, "SendToChain")
        .withArgs(ctx.canonicalChainId, owner.address, receiver.address.toLowerCase(), amount);

    expect(dataAfter.oftBalanceOfFrom, "oft balanceOf").to.eq(dataBefore.oftBalanceOfFrom.sub(amount));
    expect(dataAfter.oftCirculatingSupply, "oft circulatingSupply").to.eq(dataBefore.oftCirculatingSupply.sub(amount));
    expect(dataAfter.oftTotalSupply, "oft balanceOf").to.eq(dataBefore.oftTotalSupply.sub(amount));

    // Verify it was received on L1
    await expect(tx).to.emit(proxyOft, EVENTS.RECEIVED_FROM_CHAIN).withArgs(ctx.sideChainId, receiver.address, amount);
    expect(dataAfter.proxyOftCirculatingSupply, "proxyOftCirculatingSupply").to.eq(
        dataBefore.proxyOftCirculatingSupply.add(amount),
    );
    expect(dataAfter.tokenBalanceOfTo, "tokenBalanceOfTo").to.eq(dataBefore.tokenBalanceOfTo.add(amount));

    return tx;
}

export function shouldBehaveLikePausableOFT(_ctx: () => PausableOFTBehaviourContext): void {
    describe("PausableOFT", () => {
        let oft: PausableOFT;
        let owner: Account;
        let guardian: Account;
        let anotherAccount: Account;
        let token: ERC20;
        let ctx: PausableOFTBehaviourContext;

        before("reset contracts", async () => {
            const { fixture } = _ctx();
            ctx = await loadFixture(fixture);
            ({ oft, owner, anotherAccount, guardian } = ctx);
            const tokenAddress = await ctx.proxyOft.token();
            token = ERC20__factory.connect(tokenAddress, anotherAccount.signer);
        });
        describe("store values", async () => {
            it("PausableOFT - should properly store constructor arguments", async () => {
                expect(await oft.guardian(), "guardian").to.eq(guardian.address);
                expect(await oft.paused(), "pause").to.eq(false);
            });
        });
        describe("pause / unpause ", async () => {
            it("fails if guardian is not the caller", async () => {
                await expect(oft.connect(anotherAccount.signer).pause(), "onlyGuardian").to.be.revertedWith(
                    ERRORS.ONLY_GUARDIAN,
                );
                await expect(oft.connect(anotherAccount.signer).unpause(), "onlyGuardian").to.be.revertedWith(
                    ERRORS.ONLY_GUARDIAN,
                );
            });
            it("fails when it is already paused / unpause ", async () => {
                expect(await oft.paused(), "not paused").to.be.eq(false);
                await expect(oft.connect(guardian.signer).unpause(), "whenPaused").to.be.revertedWith(
                    ERRORS.NOT_PAUSED,
                );

                let tx = await oft.connect(guardian.signer).pause();
                await expect(tx).to.emit(oft, EVENTS.PAUSED).withArgs(guardian.address);

                await expect(oft.connect(guardian.signer).pause(), "whenNotPaused").to.be.revertedWith(ERRORS.PAUSED);
                // revet changes
                tx = await oft.connect(guardian.signer).unpause();
                await expect(tx).to.emit(oft, EVENTS.UNPAUSED).withArgs(guardian.address);
            });
            it("cannot call sendFrom when paused", async () => {
                await oft.connect(guardian.signer).pause();

                await expect(
                    oft.connect(guardian.signer).sendFrom(ZERO_ADDRESS, 0, "0x", 0, ZERO_ADDRESS, ZERO_ADDRESS, "0x"),
                    "sendFrom whenPaused",
                ).to.be.revertedWith(ERRORS.PAUSED);

                await oft.connect(guardian.signer).unpause();
            });
        });
        describe("normal flow", async () => {
            let proxyOftAdapterParams: BytesLike = [];
            beforeEach("beforeEach", async () => {
                const proxyOftUseCustom = await ctx.proxyOft.useCustomAdapterParams();
                proxyOftAdapterParams = proxyOftUseCustom ? defaultOFTAdapterParams : [];
            });

            it("bridge tokens from L1 -> L2", async () => {
                const amount = simpleToExactAmount(5);
                const dataBefore = await snapshotData(ctx, {
                    from: anotherAccount.address,
                    to: anotherAccount.address,
                });
                await token.approve(ctx.proxyOft.address, amount);
                const tx = await ctx.proxyOft
                    .connect(anotherAccount.signer)
                    .sendFrom(
                        anotherAccount.address,
                        ctx.sideChainId,
                        anotherAccount.address,
                        amount,
                        ZERO_ADDRESS,
                        ZERO_ADDRESS,
                        proxyOftAdapterParams,
                        { value: NATIVE_FEE },
                    );

                const dataAfter = await snapshotData(ctx, { from: anotherAccount.address, to: anotherAccount.address });
                compareData("bridge tokens from L1 -> L2", dataBefore, dataAfter);
                // Verify it was send from L1
                await expect(tx)
                    .to.emit(ctx.proxyOft, "SendToChain")
                    .withArgs(ctx.sideChainId, anotherAccount.address, anotherAccount.address.toLowerCase(), amount);

                expect(dataAfter.proxyOftCirculatingSupply, "proxyOft CirculatingSupply").to.eq(
                    dataBefore.proxyOftCirculatingSupply.sub(amount),
                );

                // Verify it was received on L2
                await expect(tx)
                    .to.emit(oft, EVENTS.RECEIVED_FROM_CHAIN)
                    .withArgs(ctx.canonicalChainId, anotherAccount.address, amount);
                await expect(tx).to.emit(oft, "Transfer").withArgs(ZERO_ADDRESS, anotherAccount.address, amount);
                expect(dataAfter.oftBalanceOfFrom, "oft balanceOf").to.eq(dataBefore.oftBalanceOfFrom.add(amount));
                expect(dataAfter.oftCirculatingSupply, "oft circulatingSupply").to.eq(
                    dataBefore.oftCirculatingSupply.add(amount),
                );
                expect(dataAfter.oftTotalSupply, "oft balanceOf").to.eq(dataBefore.oftTotalSupply.add(amount));
            });
            it("bridge tokens from L2 -> L1", async () => {
                const amount = simpleToExactAmount(1);
                // Sender, Receiver, Owner all the same
                await expectSendFromL2toL1(
                    ctx,
                    "bridge tokens from L2 -> L1",
                    anotherAccount,
                    anotherAccount,
                    anotherAccount,
                    amount,
                );
            });
            it("bridge tokens from L2 -> L1 to different account", async () => {
                const amount = simpleToExactAmount(1);
                // "anotherAccount" bridges to "guardian" when the  "anotherAccount" is the owner of the OFT
                await expectSendFromL2toL1(
                    ctx,
                    "L2 -> L1 to different account",
                    anotherAccount,
                    guardian,
                    anotherAccount,
                    amount,
                );
            });
            it("bridge tokens from L2 -> L1  sender != owner and receiver != sender", async () => {
                const amount = simpleToExactAmount(1);
                await oft.connect(anotherAccount.signer).approve(owner.address, amount);
                await expectSendFromL2toL1(
                    ctx,
                    "L2 -> L1  sender != owner and receiver != sender",
                    owner,
                    guardian,
                    anotherAccount,
                    amount,
                );
            });
        });
        describe("edge cases", async () => {
            let oftAdapterParams: BytesLike = [];
            beforeEach("beforeEach", async () => {
                const oftUseCustom = await oft.useCustomAdapterParams();
                oftAdapterParams = oftUseCustom ? defaultOFTAdapterParams : [];
            });
            it("bridge tokens from L2 -> L1, sender is not the owner of the token", async () => {
                const amount = simpleToExactAmount(1);
                await oft.connect(anotherAccount.signer).approve(owner.address, 0);

                await expect(
                    oft
                        .connect(anotherAccount.signer)
                        .sendFrom(
                            owner.address,
                            ctx.canonicalChainId,
                            anotherAccount.address,
                            amount,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            oftAdapterParams,
                            { value: NATIVE_FEE },
                        ),
                ).to.be.revertedWith("ERC20: insufficient allowance");
            });
            it("bridge tokens from L2 -> L1 when it is paused", async () => {
                const amount = simpleToExactAmount(1);

                await oft.connect(guardian.signer).pause();

                // Given that it is not paused
                expect(await oft.paused(), "paused").to.be.eq(true);
                // When the proxy receives tokens it flows as usual
                await expect(
                    oft
                        .connect(anotherAccount.signer)
                        .sendFrom(
                            anotherAccount.address,
                            ctx.canonicalChainId,
                            anotherAccount.address,
                            amount,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            oftAdapterParams,
                            { value: NATIVE_FEE },
                        ),
                ).to.be.revertedWith(ERRORS.PAUSED);
            });
        });
    });
}
