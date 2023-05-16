import { expect } from "chai";
import { loadFixture } from "ethereum-waffle";
import { BigNumberish, ethers } from "ethers";
import { BytesLike, formatEther } from "ethers/lib/utils";
import { table } from "table";
import { Account } from "types";

import { anyValue, BN, getTimestamp, increaseTime, simpleToExactAmount } from "../../test-utils";
import { ONE_DAY, ONE_WEEK, ZERO, ZERO_ADDRESS } from "../../test-utils/constants";
import { MockERC20__factory, OFT, PausableProxyOFT } from "../../types/generated";

const NATIVE_FEE = simpleToExactAmount("0.2");
const debug = false;
type OFTData = {
    oftBalanceOf: BN;
    oftTotalSupply: BN;
    oftCirculatingSupply: BN;
};
type ProxyOFTData = {
    proxyOftOutflow: BN;
    proxyOftInflow: BN;
    proxyOftCirculatingSupply: BN;
};
type SnapshotData = OFTData & ProxyOFTData;
export interface PausableProxyOFTBehaviourContext {
    pausableProxyOFT: PausableProxyOFT;
    oft: OFT;
    owner: Account;
    guardian: Account;
    sudo: Account;
    anotherAccount: Account;
    inflowLimit: BN;
    canonicalChainId: number;
    sideChainId: number;
    fixture: () => Promise<PausableProxyOFTBehaviourContext>;
}

export const ERRORS = {
    ONLY_GUARDIAN: "!guardian",
    ONLY_SUDO: "!sudo",
    GUARDIAN_ZERO_ADDRESS: "guardian=0",
    PAUSED: "Pausable: paused",
    NOT_PAUSED: "Pausable: not paused",
    ONLY_OWNER: "Ownable: caller is not the owner",
    QUEUE_WRONG_ROOT: "!root",
    QUEUE_TIMESTAMP: "!timestamp",
};
export const EVENTS = {
    PAUSED: "Paused",
    UNPAUSED: "Unpaused",
    QUEUED_FROM_CHAIN: "QueuedFromChain",
    RECEIVED_FROM_CHAIN: "ReceiveFromChain",
};

function compareData(test: string, before: SnapshotData, after: SnapshotData) {
    const getDetails = (property: string) => [
        formatEther(before[property]),
        formatEther(after[property]),
        before[property].toString() === after[property].toString(),
    ];

    const testData = [
        ["L1 proxyOftOutflow            ", ...getDetails("proxyOftOutflow")],
        ["L1 proxyOftInflow             ", ...getDetails("proxyOftInflow")],
        ["L1 proxyOftCirculatingSupply  ", ...getDetails("proxyOftCirculatingSupply")],

        ["L2 oftBalanceOf[sender]       ", ...getDetails("oftBalanceOf")],
        ["L2 oftTotalSupply             ", ...getDetails("oftTotalSupply")],
        ["L2 oftCirculatingSupply       ", ...getDetails("oftCirculatingSupply")],
    ];

    if (debug) {
        console.log(`----------------------------  ${test} ----------------------------`);
        console.log(table([["Data", "Before", "After", "Equal"], ...testData.filter(t => !t[3])]));
    }
}

export function shouldBehaveLikePausableProxyOFT(_ctx: () => PausableProxyOFTBehaviourContext): void {
    describe("PausableProxyOFT", () => {
        let pausableProxyOFT: PausableProxyOFT;
        let owner: Account;
        let guardian: Account;
        let sudo: Account;
        let anotherAccount: Account;

        let ctx: PausableProxyOFTBehaviourContext;
        const defaultOFTAdapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 600_000]);

        async function getOFTData(toAddress: string): Promise<OFTData> {
            const oftBalanceOf = await ctx.oft.balanceOf(toAddress);
            const oftTotalSupply = await ctx.oft.totalSupply();
            const oftCirculatingSupply = await ctx.oft.circulatingSupply();
            return { oftBalanceOf, oftTotalSupply, oftCirculatingSupply };
        }

        async function getProxyOFTData(epoch: BN): Promise<ProxyOFTData> {
            const proxyOftOutflow = await pausableProxyOFT.outflow(epoch);
            const proxyOftInflow = await pausableProxyOFT.inflow(epoch);
            const proxyOftCirculatingSupply = await pausableProxyOFT.circulatingSupply();
            return { proxyOftOutflow, proxyOftInflow, proxyOftCirculatingSupply };
        }
        const snapshotData = async (toAddress: string, epoch: BN): Promise<SnapshotData> => {
            return {
                ...(await getOFTData(toAddress)),
                ...(await getProxyOFTData(epoch)),
            };
        };
        const getNetInflow = (inflow: BN, outflow: BN) => (inflow.gt(outflow) ? inflow.sub(outflow) : BN.from(0));
        const getQueueRoot = (epoch: BN, srcChainId: BigNumberish, to: string, amount: BN, timestamp: BN) =>
            ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ["uint256", "uint16", "address", "uint256", "uint256"],
                    [epoch, srcChainId, to, amount, timestamp],
                ),
            );

        before("reset contracts", async () => {
            const { fixture } = _ctx();
            ctx = await loadFixture(fixture);
            ({ pausableProxyOFT, owner, anotherAccount, guardian, sudo } = ctx);
        });
        describe("store values", async () => {
            it("PausableProxyOFT - should properly store constructor arguments", async () => {
                expect(await pausableProxyOFT.guardian(), "guardian").to.eq(guardian.address);
                expect(await pausableProxyOFT.paused(), "pause").to.eq(false);

                expect(await pausableProxyOFT.epochDuration(), "epochDuration").to.eq(ONE_WEEK);
                expect(await pausableProxyOFT.sudo(), "sudo").to.eq(sudo.address);
                expect(await pausableProxyOFT.inflowLimit(), "inflowLimit").to.eq(ctx.inflowLimit);
                expect(await pausableProxyOFT.queueDelay(), "queueDelay").to.eq(ONE_WEEK);
                expect(await pausableProxyOFT.outflow(ZERO), "outflow").to.eq(ZERO);
                expect(await pausableProxyOFT.inflow(ZERO), "inflow").to.eq(ZERO);
            });
        });
        describe("pause / unpause ", async () => {
            it("fails if guardian is not the caller", async () => {
                await expect(
                    pausableProxyOFT.connect(anotherAccount.signer).pause(),
                    "onlyGuardian",
                ).to.be.revertedWith(ERRORS.ONLY_GUARDIAN);
                await expect(
                    pausableProxyOFT.connect(anotherAccount.signer).unpause(),
                    "onlyGuardian",
                ).to.be.revertedWith(ERRORS.ONLY_GUARDIAN);
            });
            it("fails when it is already paused / unpause ", async () => {
                expect(await pausableProxyOFT.paused(), "not paused").to.be.eq(false);
                await expect(pausableProxyOFT.connect(guardian.signer).unpause(), "whenPaused").to.be.revertedWith(
                    ERRORS.NOT_PAUSED,
                );

                let tx = await pausableProxyOFT.connect(guardian.signer).pause();
                await expect(tx).to.emit(pausableProxyOFT, EVENTS.PAUSED).withArgs(guardian.address);

                await expect(pausableProxyOFT.connect(guardian.signer).pause(), "whenNotPaused").to.be.revertedWith(
                    ERRORS.PAUSED,
                );

                // revet changes
                tx = await pausableProxyOFT.connect(guardian.signer).unpause();
                await expect(tx).to.emit(pausableProxyOFT, EVENTS.UNPAUSED).withArgs(guardian.address);
            });
            it("cannot call sendFrom when paused", async () => {
                await pausableProxyOFT.connect(guardian.signer).pause();

                await expect(
                    pausableProxyOFT
                        .connect(guardian.signer)
                        .sendFrom(ZERO_ADDRESS, 0, "0x", 0, ZERO_ADDRESS, ZERO_ADDRESS, "0x"),
                    "sendFrom whenPaused",
                ).to.be.revertedWith(ERRORS.PAUSED);

                await pausableProxyOFT.connect(guardian.signer).unpause();
            });
            it("cannot call processQueued when paused", async () => {
                await pausableProxyOFT.connect(guardian.signer).pause();

                await expect(
                    pausableProxyOFT.connect(anotherAccount.signer).processQueued(ZERO, ZERO, ZERO_ADDRESS, ZERO, ZERO),
                    "processQueued whenPaused",
                ).to.be.revertedWith(ERRORS.PAUSED);

                await pausableProxyOFT.connect(guardian.signer).unpause();
            });
        });
        describe("sudo", async () => {
            it("rescue fails if sudo is not the caller", async () => {
                await expect(
                    pausableProxyOFT.connect(anotherAccount.signer).rescue(ZERO_ADDRESS, ZERO_ADDRESS, ZERO),
                    "onlySudo",
                ).to.be.revertedWith(ERRORS.ONLY_SUDO);
            });
            it("rescue ERC20 token", async () => {
                const randomToken = await new MockERC20__factory(owner.signer).deploy(
                    "randomToken",
                    "randomToken",
                    18,
                    owner.address,
                    10000000,
                );
                const amount = simpleToExactAmount(10);

                await randomToken.transfer(pausableProxyOFT.address, amount);

                expect(await randomToken.balanceOf(pausableProxyOFT.address), "balance").to.be.eq(amount);

                // When rescue
                await pausableProxyOFT.connect(sudo.signer).rescue(randomToken.address, anotherAccount.address, amount);

                // Tokens are transferred out of the bridge
                expect(await randomToken.balanceOf(pausableProxyOFT.address), "balance").to.be.eq(ZERO_ADDRESS);
                expect(await randomToken.balanceOf(anotherAccount.address), "rescue amount").to.be.eq(amount);
            });
        });
        describe("owner", async () => {
            it("fails if owner is not the caller", async () => {
                await expect(
                    pausableProxyOFT.connect(anotherAccount.signer).setQueueDelay(ZERO),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
                await expect(
                    pausableProxyOFT.connect(anotherAccount.signer).setInflowLimit(ZERO),
                    "onlyOwner",
                ).to.be.revertedWith(ERRORS.ONLY_OWNER);
            });
            it("setInflowLimit", async () => {
                const inflowLimitBefore = await pausableProxyOFT.inflowLimit();
                const inflowLimit = simpleToExactAmount(1);
                await pausableProxyOFT.connect(owner.signer).setInflowLimit(inflowLimit);
                // No events
                expect(await pausableProxyOFT.inflowLimit(), "inflowLimit").to.be.eq(inflowLimit);
                // Revert changes

                await pausableProxyOFT.connect(owner.signer).setInflowLimit(inflowLimitBefore);
            });
            it("setQueueDelay", async () => {
                const queueDelay = ONE_DAY;
                const queueDelayBefore = await pausableProxyOFT.queueDelay();
                await pausableProxyOFT.connect(owner.signer).setQueueDelay(queueDelay);
                // No events
                expect(await pausableProxyOFT.queueDelay(), "inflowLimit").to.be.eq(queueDelay);

                // Revert changes
                await pausableProxyOFT.connect(owner.signer).setQueueDelay(queueDelayBefore);
            });
        });
        describe("normal flow", async () => {
            const queue = [];
            let oftAdapterParams: BytesLike = [];
            let proxyOftAdapterParams: BytesLike = [];
            beforeEach("beforeEach", async () => {
                const oftUseCustom = await ctx.oft.useCustomAdapterParams();
                const proxyOftUseCustom = await pausableProxyOFT.useCustomAdapterParams();
                oftAdapterParams = oftUseCustom ? defaultOFTAdapterParams : [];
                proxyOftAdapterParams = proxyOftUseCustom ? defaultOFTAdapterParams : [];
            });

            it("bridge tokens from L1 -> L2", async () => {
                const amount = simpleToExactAmount(5);
                const epoch = await pausableProxyOFT.getCurrentEpoch();
                const dataBefore = await snapshotData(anotherAccount.address, epoch);

                const tx = await pausableProxyOFT
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

                const dataAfter = await snapshotData(anotherAccount.address, epoch);
                compareData("bridge tokens from L1 -> L2", dataBefore, dataAfter);
                // Verify it was send from L1
                await expect(tx)
                    .to.emit(pausableProxyOFT, "SendToChain")
                    .withArgs(ctx.sideChainId, anotherAccount.address, anotherAccount.address.toLowerCase(), amount);

                expect(dataAfter.proxyOftOutflow, "outflow").to.eq(dataBefore.proxyOftOutflow.add(amount));
                expect(dataAfter.proxyOftInflow, "inflow").to.eq(dataBefore.proxyOftInflow);
                expect(dataAfter.proxyOftCirculatingSupply, "proxyOft CirculatingSupply").to.eq(
                    dataBefore.proxyOftCirculatingSupply.sub(amount),
                );

                // Verify it was received on L2
                await expect(tx)
                    .to.emit(ctx.oft, EVENTS.RECEIVED_FROM_CHAIN)
                    .withArgs(ctx.canonicalChainId, anotherAccount.address, amount);
                await expect(tx).to.emit(ctx.oft, "Transfer").withArgs(ZERO_ADDRESS, anotherAccount.address, amount);
                expect(dataAfter.oftBalanceOf, "oft balanceOf").to.eq(dataBefore.oftBalanceOf.add(amount));
                expect(dataAfter.oftCirculatingSupply, "oft circulatingSupply").to.eq(
                    dataBefore.oftCirculatingSupply.add(amount),
                );
                expect(dataAfter.oftTotalSupply, "oft balanceOf").to.eq(dataBefore.oftTotalSupply.add(amount));
            });
            it("bridge tokens from L2 -> L1 all good", async () => {
                await increaseTime(ONE_WEEK);
                const amount = simpleToExactAmount(1);
                await ctx.oft
                    .connect(anotherAccount.signer)
                    .approve(pausableProxyOFT.address, ethers.constants.MaxUint256);
                // const tokenAddress = await pausableProxyOFT.token();
                const epoch = await pausableProxyOFT.getCurrentEpoch();
                const dataBefore = await snapshotData(anotherAccount.address, epoch);

                // Given that it is not paused
                expect(await pausableProxyOFT.paused(), "paused").to.be.eq(false);
                // Given the inflow is under the limit
                const inflowLimit = await pausableProxyOFT.inflowLimit();
                const netInflow = getNetInflow(dataBefore.proxyOftInflow, dataBefore.proxyOftOutflow);
                expect(netInflow.lt(inflowLimit), "net inflow").to.be.eq(true);
                // When the proxy receives tokens it flows as usual
                const tx = await ctx.oft
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
                    );
                const dataAfter = await snapshotData(anotherAccount.address, epoch);
                compareData("bridge tokens from L2 -> L1 all good", dataBefore, dataAfter);

                // Verify it was send from L2
                await expect(tx).to.emit(ctx.oft, "Transfer").withArgs(anotherAccount.address, ZERO_ADDRESS, amount);
                await expect(tx)
                    .to.emit(ctx.oft, "SendToChain")
                    .withArgs(
                        ctx.canonicalChainId,
                        anotherAccount.address,
                        anotherAccount.address.toLowerCase(),
                        amount,
                    );
                expect(dataAfter.oftBalanceOf, "oft balanceOf").to.eq(dataBefore.oftBalanceOf.sub(amount));
                expect(dataAfter.oftCirculatingSupply, "oft circulatingSupply").to.eq(
                    dataBefore.oftCirculatingSupply.sub(amount),
                );
                expect(dataAfter.oftTotalSupply, "oft balanceOf").to.eq(dataBefore.oftTotalSupply.sub(amount));

                // Verify it was received on L1
                await expect(tx)
                    .to.emit(pausableProxyOFT, EVENTS.RECEIVED_FROM_CHAIN)
                    .withArgs(ctx.sideChainId, anotherAccount.address, amount);
                expect(dataAfter.proxyOftOutflow, "outflow").to.eq(dataBefore.proxyOftOutflow);
                expect(dataAfter.proxyOftInflow, "inflow").to.eq(dataBefore.proxyOftInflow.add(amount));
            });
            it("bridge tokens from L2 -> L1 when paused (queue)", async () => {
                const amount = simpleToExactAmount(1);
                // const tokenAddress = await pausableProxyOFT.token();
                const epoch = await pausableProxyOFT.getCurrentEpoch();
                const dataBefore = await snapshotData(anotherAccount.address, epoch);

                // Given that it is not paused
                await pausableProxyOFT.connect(guardian.signer).pause();
                expect(await pausableProxyOFT.paused(), "paused").to.be.eq(true);
                // Given the inflow is under the limit
                const inflowLimit = await pausableProxyOFT.inflowLimit();
                const netInflow = getNetInflow(dataBefore.proxyOftInflow, dataBefore.proxyOftOutflow);
                expect(netInflow.lt(inflowLimit), "net inflow").to.be.eq(true);

                // When the proxy receives tokens and queue them

                const tx = await ctx.oft
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
                    );

                const dataAfter = await snapshotData(anotherAccount.address, epoch);
                compareData("bridge tokens from L2 -> L1 when paused (queue)", dataBefore, dataAfter);

                // Verify it was send from L2
                await expect(tx).to.emit(ctx.oft, "Transfer").withArgs(anotherAccount.address, ZERO_ADDRESS, amount);
                await expect(tx)
                    .to.emit(ctx.oft, "SendToChain")
                    .withArgs(
                        ctx.canonicalChainId,
                        anotherAccount.address,
                        anotherAccount.address.toLowerCase(),
                        amount,
                    );
                expect(dataAfter.oftBalanceOf, "oft balanceOf").to.eq(dataBefore.oftBalanceOf.sub(amount));
                expect(dataAfter.oftCirculatingSupply, "oft circulatingSupply").to.eq(
                    dataBefore.oftCirculatingSupply.sub(amount),
                );
                expect(dataAfter.oftTotalSupply, "oft balanceOf").to.eq(dataBefore.oftTotalSupply.sub(amount));

                // Verify it was received on L1
                await expect(tx)
                    .to.emit(pausableProxyOFT, EVENTS.QUEUED_FROM_CHAIN)
                    .withArgs(epoch, ctx.sideChainId, anotherAccount.address, amount, anyValue);
                await expect(tx).to.not.emit(pausableProxyOFT, EVENTS.RECEIVED_FROM_CHAIN);
                const receipt = await tx.wait();

                const event = receipt.events.find(e => e.address === pausableProxyOFT.address);
                // Get the timestamp from the event rather than calculated as timestamp is not reliable on test coverage
                const timestamp = BN.from("0x" + event.data.slice(-9));
                const queueRoot = getQueueRoot(epoch, ctx.sideChainId, anotherAccount.address, amount, timestamp);

                expect(dataAfter.proxyOftOutflow, "outflow").to.eq(dataBefore.proxyOftOutflow);
                expect(dataAfter.proxyOftInflow, "inflow").to.eq(dataBefore.proxyOftInflow.add(amount));
                expect(dataAfter.proxyOftCirculatingSupply, "proxyOftCirculatingSupply does not change").to.eq(
                    dataBefore.proxyOftCirculatingSupply,
                );
                const queueStatus = await pausableProxyOFT.queue(queueRoot);
                expect(queueStatus, "queueStatus").to.be.eq(true);

                queue.push({
                    queueRoot,
                    epoch,
                    srcChainId: ctx.sideChainId,
                    toAddress: anotherAccount.address,
                    amount,
                    timestamp,
                });
            });
            it("bridge tokens from L2 -> L1 when inflowLimit is reached (queue)", async () => {
                const amount = simpleToExactAmount(1);
                // const tokenAddress = await pausableProxyOFT.token();
                const epoch = await pausableProxyOFT.getCurrentEpoch();
                const dataBefore = await snapshotData(anotherAccount.address, epoch);

                // Given that it is not paused
                await pausableProxyOFT.connect(guardian.signer).unpause();
                expect(await pausableProxyOFT.paused(), "paused").to.be.eq(false);
                // Given the inflow is under the limit
                await pausableProxyOFT.connect(owner.signer).setInflowLimit(1);
                const inflowLimit = await pausableProxyOFT.inflowLimit();
                const netInflow = getNetInflow(dataBefore.proxyOftInflow, dataBefore.proxyOftOutflow);
                expect(netInflow.lt(inflowLimit), "net inflow").to.be.eq(false);

                // When the proxy receives tokens and queue them

                const tx = await ctx.oft
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
                    );

                const dataAfter = await snapshotData(anotherAccount.address, epoch);
                compareData("bridge tokens from L2 -> L1 when inflowLimit is reached (queue)", dataBefore, dataAfter);

                // Verify it was send from L2
                await expect(tx).to.emit(ctx.oft, "Transfer").withArgs(anotherAccount.address, ZERO_ADDRESS, amount);
                await expect(tx)
                    .to.emit(ctx.oft, "SendToChain")
                    .withArgs(
                        ctx.canonicalChainId,
                        anotherAccount.address,
                        anotherAccount.address.toLowerCase(),
                        amount,
                    );
                expect(dataAfter.oftBalanceOf, "oft balanceOf").to.eq(dataBefore.oftBalanceOf.sub(amount));
                expect(dataAfter.oftCirculatingSupply, "oft circulatingSupply").to.eq(
                    dataBefore.oftCirculatingSupply.sub(amount),
                );
                expect(dataAfter.oftTotalSupply, "oft balanceOf").to.eq(dataBefore.oftTotalSupply.sub(amount));

                // Verify it was received on L1
                await expect(tx)
                    .to.emit(pausableProxyOFT, EVENTS.QUEUED_FROM_CHAIN)
                    .withArgs(epoch, ctx.sideChainId, anotherAccount.address, amount, anyValue);
                await expect(tx).to.not.emit(pausableProxyOFT, EVENTS.RECEIVED_FROM_CHAIN);
                const receipt = await tx.wait();
                const event = receipt.events.find(e => e.address === pausableProxyOFT.address);
                const timestamp = BN.from("0x" + event.data.slice(-9));
                const queueRoot = getQueueRoot(epoch, ctx.sideChainId, anotherAccount.address, amount, timestamp);

                expect(dataAfter.proxyOftOutflow, "outflow").to.eq(dataBefore.proxyOftOutflow);
                expect(dataAfter.proxyOftInflow, "inflow").to.eq(dataBefore.proxyOftInflow.add(amount));
                expect(dataAfter.proxyOftCirculatingSupply, "proxyOftCirculatingSupply does not change").to.eq(
                    dataBefore.proxyOftCirculatingSupply,
                );

                const queueStatus = await pausableProxyOFT.queue(queueRoot);
                expect(queueStatus, "queueStatus").to.be.eq(true);

                queue.push({
                    queueRoot,
                    epoch,
                    srcChainId: ctx.sideChainId,
                    toAddress: anotherAccount.address,
                    amount,
                    timestamp,
                });
            });
            it("fails to process queued with wrong queue root", async () => {
                await expect(
                    pausableProxyOFT.connect(anotherAccount.signer).processQueued(ZERO, ZERO, ZERO_ADDRESS, ZERO, ZERO),
                    "processQueued whenPaused",
                ).to.be.revertedWith(ERRORS.QUEUE_WRONG_ROOT);
            });
            it("fails to process queued when the delayed period has not passed", async () => {
                const queueDelay = await pausableProxyOFT.queueDelay();
                const now = await getTimestamp();
                expect(now, "timestamp").to.be.lt(queue[0].timestamp.add(queueDelay));
                await expect(
                    pausableProxyOFT
                        .connect(anotherAccount.signer)
                        .processQueued(
                            queue[0].epoch,
                            queue[0].srcChainId,
                            queue[0].toAddress,
                            queue[0].amount,
                            queue[0].timestamp,
                        ),
                    "processQueued timestamp",
                ).to.be.revertedWith(ERRORS.QUEUE_TIMESTAMP);
            });
            it("process queued when the delayed period has passed", async () => {
                const queueDelay = ONE_WEEK;
                await pausableProxyOFT.connect(owner.signer).setQueueDelay(queueDelay);
                await increaseTime(ONE_WEEK.add(ONE_DAY));

                const now = await getTimestamp();
                const epoch = await pausableProxyOFT.getCurrentEpoch();
                expect(now, "timestamp").to.be.gt(queue[0].timestamp.add(queueDelay));
                const dataBefore = await snapshotData(anotherAccount.address, epoch);

                const queueRootDelayedBefore = await pausableProxyOFT.queue(queue[0].queueRoot);
                expect(queueRootDelayedBefore, "queue root delayed").to.be.eq(true);

                const tx = await pausableProxyOFT
                    .connect(anotherAccount.signer)
                    .processQueued(
                        queue[0].epoch,
                        queue[0].srcChainId,
                        queue[0].toAddress,
                        queue[0].amount,
                        queue[0].timestamp,
                    );

                const dataAfter = await snapshotData(anotherAccount.address, epoch);

                await expect(tx)
                    .to.emit(pausableProxyOFT, EVENTS.RECEIVED_FROM_CHAIN)
                    .withArgs(ctx.sideChainId, anotherAccount.address, queue[0].amount);

                // L2  - No changes as it was already sent
                expect(dataAfter.oftBalanceOf, "oft balanceOf").to.eq(dataBefore.oftBalanceOf);
                expect(dataAfter.oftCirculatingSupply, "oft circulatingSupply").to.eq(dataBefore.oftCirculatingSupply);
                expect(dataAfter.oftTotalSupply, "oft balanceOf").to.eq(dataBefore.oftTotalSupply);

                // L1  - Only change on the circulating supply
                expect(dataAfter.proxyOftOutflow, "outflow").to.eq(dataBefore.proxyOftOutflow);
                expect(dataAfter.proxyOftInflow, "inflow").to.eq(dataBefore.proxyOftInflow);
                expect(dataAfter.proxyOftCirculatingSupply, "proxyOftCirculatingSupply changes").to.eq(
                    dataBefore.proxyOftCirculatingSupply.add(queue[0].amount),
                );
                const queueRootDelayedAfter = await pausableProxyOFT.queue(queue[0].queueRoot);
                compareData("process queued when the delayed period has passed", dataBefore, dataAfter);
                expect(queueRootDelayedAfter, "queue root delayed").to.be.eq(false);
            });
            it("process queued fails to process again same root", async () => {
                const queueRootDelayedBefore = await pausableProxyOFT.queue(queue[0].queueRoot);
                expect(queueRootDelayedBefore, "queue root delayed").to.be.eq(false);
                await expect(
                    pausableProxyOFT
                        .connect(anotherAccount.signer)
                        .processQueued(
                            queue[0].epoch,
                            queue[0].srcChainId,
                            queue[0].toAddress,
                            queue[0].amount,
                            queue[0].timestamp,
                        ),
                ).to.be.revertedWith(ERRORS.QUEUE_WRONG_ROOT);
            });
        });
        describe("edge cases", async () => {
            it("bridge tokens from L1 -> L2, sender is not the owner of the token", async () => {
                const amount = simpleToExactAmount(5);
                await expect(
                    pausableProxyOFT
                        .connect(anotherAccount.signer)
                        .sendFrom(
                            owner.address,
                            ctx.sideChainId,
                            anotherAccount.address,
                            amount,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            [],
                            { value: NATIVE_FEE },
                        ),
                ).to.be.revertedWith("ProxyOFT: owner is not send caller");
            });
        });
    });
}
