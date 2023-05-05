/* eslint-disable @typescript-eslint/no-unused-vars */
import { parseEther } from "@ethersproject/units";
import { expect } from "chai";
import { BigNumber, ContractTransaction, Signer } from "ethers";
import hre, { ethers } from "hardhat";
import { impersonateAccount, increaseTime, ONE_WEEK, simpleToExactAmount, ZERO, ZERO_ADDRESS } from "../../test-utils";
import { Account } from "../../types";
import { AuraBalOFT, AuraBalProxyOFT, AuraBalVault, ERC20, MockERC20__factory, ProxyOFT } from "../../types/generated";
import shouldBehaveLikeERC20, { IERC20BehaviourContext } from "../shared/ERC20.behaviour";
import { OwnableBehaviourContext, shouldBehaveLikeOwnable } from "../shared/Ownable.behaviour";
import {
    CanonicalPhaseDeployed,
    SidechainDeployed,
    sidechainTestSetup,
    SideChainTestSetup,
} from "../../test/sidechain/sidechainTestSetup";

const NATIVE_FEE = simpleToExactAmount("0.2");
const L1_CHAIN_ID = 111;
const L2_CHAIN_ID = 222;
const debug = false;
async function bridgeTokenFromL1ToL2(
    sender: Account,
    token: ERC20,
    proxyOFT: ProxyOFT,
    dstChainId: number,
    amount: BigNumber,
): Promise<ContractTransaction> {
    const from = sender.address;
    const to = sender.address;
    await token.connect(sender.signer).approve(proxyOFT.address, amount);
    const tx = await proxyOFT
        .connect(sender.signer)
        .sendFrom(from, dstChainId, to, amount, ZERO_ADDRESS, ZERO_ADDRESS, [], {
            value: NATIVE_FEE,
        });
    return tx;
}
describe("AuraBalOFT", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let deployer: Account;
    let alice: Account;
    let dao: Account;
    // L1
    let cvxCrv: ERC20;
    let cvx: ERC20;
    let auraBalProxyOFT: AuraBalProxyOFT;
    let auraBalVault: AuraBalVault;
    let canonical: CanonicalPhaseDeployed;

    // Testing contract
    let testSetup: SideChainTestSetup;
    // L2
    let auraBalOFT: AuraBalOFT;
    let sidechain: SidechainDeployed;
    const sidechainLzChainId = L2_CHAIN_ID;
    /* -- Declare shared functions -- */
    const setup = async () => {
        accounts = await ethers.getSigners();
        alice = await impersonateAccount(await accounts[1].getAddress());

        // Deploy test contract.
        testSetup = await sidechainTestSetup(hre, accounts, L1_CHAIN_ID, L2_CHAIN_ID, debug);
        deployer = testSetup.deployer;
        auraBalProxyOFT = testSetup.l1.canonical.auraBalProxyOFT;
        auraBalVault = testSetup.l1.vaultDeployment.vault;
        canonical = testSetup.l1.canonical;
        cvxCrv = testSetup.l1.phase2.cvxCrv;
        cvx = testSetup.l1.phase2.cvx;
        auraBalOFT = testSetup.l2.sidechain.auraBalOFT;
        sidechain = testSetup.l2.sidechain;

        dao = await impersonateAccount(testSetup.l2.multisigs.daoMultisig);

        // Send some balances in order to test
        // dirty trick to get some cvx balance.
        const cvxDepositorAccount = await impersonateAccount(testSetup.l1.phase2.vestedEscrows[0].address);
        const cvxConnected = cvx.connect(cvxDepositorAccount.signer);
        const cvxBalance = await cvxConnected.balanceOf(cvxDepositorAccount.address);
        await cvxConnected.transfer(deployer.address, cvxBalance);
    };
    async function forceHarvestRewards(amount = parseEther("10"), minOut = ZERO, signer = deployer.signer) {
        const { mocks, phase2 } = testSetup.l1;
        const { crv } = mocks;
        const { strategy, vault, auraRewards } = testSetup.l1.vaultDeployment;

        const feeToken = MockERC20__factory.connect(mocks.addresses.feeToken, signer);

        // ----- Send some balance to the strategy to mock the harvest ----- //
        await crv.connect(signer).transfer(strategy.address, amount);
        await phase2.cvx.connect(signer).transfer(strategy.address, amount);
        await feeToken.connect(signer).transfer(strategy.address, amount);
        // ----- Send some balance to the balancer vault to mock swaps ----- //
        await phase2.cvxCrv.transfer(mocks.balancerVault.address, amount);
        await mocks.weth.transfer(mocks.balancerVault.address, amount);
        await mocks.balancerVault.setTokens(mocks.crvBpt.address, phase2.cvxCrv.address);

        expect(await crv.balanceOf(strategy.address), " crv balance").to.be.gt(0);
        expect(await feeToken.balanceOf(strategy.address), " feeToken balance").to.be.gt(0);
        expect(await phase2.cvx.balanceOf(strategy.address), " cvx balance").to.be.gt(0);

        const tx = await vault.connect(signer)["harvest(uint256)"](minOut);
        await expect(tx).to.emit(vault, "Harvest");
        // Queue new rewards
        await expect(tx).to.emit(auraRewards, "RewardAdded");

        expect(await crv.balanceOf(strategy.address), " crv balance").to.be.eq(0);
        expect(await feeToken.balanceOf(strategy.address), " feeToken balance").to.be.eq(0);
        expect(await phase2.cvx.balanceOf(strategy.address), " cvx balance").to.be.eq(0);
        return tx;
    }
    async function snapshot(sender: Account, reason = "snapshot") {
        const auraBalBalance = await cvxCrv.balanceOf(sender.address);
        const auraBalOFTBalance = await auraBalOFT.balanceOf(sender.address);
        const auraBalOFTTotalSupply = await auraBalOFT.totalSupply();
        const auraBalOFTCirculatingSupply = await auraBalOFT.circulatingSupply();
        const proxyVaultBalance = await auraBalVault.balanceOf(auraBalProxyOFT.address);
        const auraBalVaultTotalSupply = await auraBalVault.totalSupply();
        let proxyVaultBalanceOfUnderlying = auraBalVaultTotalSupply;
        if (!auraBalVaultTotalSupply.eq(0)) {
            // If total supply is zero it reverts
            proxyVaultBalanceOfUnderlying = await auraBalVault.balanceOfUnderlying(auraBalProxyOFT.address);
        }
        // const proxyTotalClaimableAuraBal = await auraBalProxyOFT.totalClaimable(cvxCrv.address);
        // const proxyTotalClaimableAura = await auraBalProxyOFT.totalClaimable(cvx.address);

        if (debug) {
            console.log(` ----------------------------  ${reason} ----------------------------`);
            console.log(`snapshot auraBalBalance                ${auraBalBalance.toString()}`);
            console.log(`snapshot auraBalOFTBalance             ${auraBalOFTBalance.toString()}`);
            console.log(`snapshot auraBalOFTTotalSupply         ${auraBalOFTTotalSupply.toString()}`);
            console.log(`snapshot auraBalOFTCirculatingSupply   ${auraBalOFTCirculatingSupply.toString()}`);
            console.log(`snapshot proxyVaultBalance             ${proxyVaultBalance.toString()}`);
            console.log(`snapshot proxyVaultBalanceOfUnderlying ${proxyVaultBalanceOfUnderlying.toString()}`);
            console.log(`snapshot auraBalVaultTotalSupply       ${auraBalVaultTotalSupply.toString()}`);
        }
        return {
            auraBalBalance,
            auraBalOFTBalance,
            auraBalOFTTotalSupply,
            auraBalOFTCirculatingSupply,
            proxyVaultBalance,
            proxyVaultBalanceOfUnderlying,
            auraBalVaultTotalSupply,
        };
    }
    before("init contract", async () => {
        await setup();
    });

    describe("behaviors", async () => {
        describe("should behave like Ownable ", async () => {
            const ctx: Partial<OwnableBehaviourContext> = {};
            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.owner = dao;
                    ctx.anotherAccount = alice;
                    ctx.ownable = auraBalOFT;
                    return ctx as OwnableBehaviourContext;
                };
            });
            shouldBehaveLikeOwnable(() => ctx as OwnableBehaviourContext);
        });
        describe("should behave like ERC20 ", async () => {
            const ctx: Partial<IERC20BehaviourContext> = {};
            const initialSupply = simpleToExactAmount(2);

            before(async () => {
                ctx.fixture = async function fixture() {
                    await setup();
                    ctx.token = auraBalOFT;
                    ctx.initialHolder = deployer;
                    ctx.recipient = alice;
                    ctx.anotherAccount = dao;

                    // Initial supply of auraBalOFT by locking auraBal on L1 and bridge it to L2
                    await bridgeTokenFromL1ToL2(
                        deployer,
                        testSetup.l1.phase2.cvxCrv,
                        canonical.auraBalProxyOFT as unknown as ProxyOFT,
                        L2_CHAIN_ID,
                        initialSupply,
                    );
                };
                await ctx.fixture();
            });
            shouldBehaveLikeERC20(() => ctx as IERC20BehaviourContext, "ERC20", initialSupply);
        });
    });
    describe("constructor", async () => {
        before(async () => {
            await setup();
        });
        it("should properly store valid arguments", async () => {
            // oFTCore
            expect(await auraBalOFT.NO_EXTRA_GAS(), "NO_EXTRA_GAS").to.eq(0);
            expect(await auraBalOFT.PT_SEND(), "PT_SEND").to.eq(0);
            expect(await auraBalOFT.useCustomAdapterParams(), "useCustomAdapterParams").to.eq(true);
            // lzApp
            expect(await auraBalOFT.DEFAULT_PAYLOAD_SIZE_LIMIT(), "DEFAULT_PAYLOAD_SIZE_LIMIT").to.eq(10000);
            expect(await auraBalOFT.lzEndpoint(), "lzEndpoint").to.eq(testSetup.l2.mocks.addresses.lzEndpoint);
            expect(await auraBalOFT.precrime(), "precrime").to.eq(ZERO_ADDRESS);
        });
        it("should be initialized", async () => {
            expect(await auraBalOFT.totalSupply(), "totalSupply").to.eq(0);
            expect(await auraBalOFT.circulatingSupply(), "circulatingSupply").to.eq(0);
            expect(await auraBalOFT.token(), "token").to.eq(auraBalOFT.address);
            expect(await auraBalOFT.symbol(), "symbol").to.eq(testSetup.l2.mocks.namingConfig.auraBalOftSymbol);
            expect(await auraBalOFT.owner(), "owner").to.eq(dao.address);
            expect(await auraBalOFT.name(), "name").to.eq(testSetup.l2.mocks.namingConfig.auraBalOftName);
            expect(await auraBalOFT.decimals(), "decimals").to.eq(18);
            expect(await auraBalOFT.trustedRemoteLookup(L1_CHAIN_ID), "trustedRemoteLookup").to.not.be.empty;
            expect(await auraBalOFT.payloadSizeLimitLookup(L1_CHAIN_ID), "payloadSizeLimitLookup").to.eq(0);
        });
    });
    describe("Transfer to sidechain", () => {
        const bridgeAmount = simpleToExactAmount(10);
        it("can transfer auraBAL to sidechain", async () => {
            // AuraBalProxyOFT.sendFrom => AuraBalVault.deposit => AuraBalStrategy.stake => LZEndpointMock.send
            // LZEndpointMock.receivePayload => OFT.lzReceive
            const dataBefore = await snapshot(deployer, "before bridge");
            // ON L1 it stakes the token on AuraBalVault
            // On L2 it mints oft
            const tx = await bridgeTokenFromL1ToL2(
                deployer,
                cvxCrv,
                canonical.auraBalProxyOFT as unknown as ProxyOFT,
                L2_CHAIN_ID,
                bridgeAmount,
            );
            const dataAfter = await snapshot(deployer, "after bridge");

            expect(dataAfter.auraBalBalance, "token balance").to.be.eq(dataBefore.auraBalBalance.sub(bridgeAmount));
            expect(dataAfter.auraBalOFTBalance, "oft balance").to.be.eq(dataBefore.auraBalOFTBalance.add(bridgeAmount));
            expect(dataAfter.auraBalOFTTotalSupply, "oft totalSupply").to.be.eq(
                dataBefore.auraBalOFTTotalSupply.add(bridgeAmount),
            );
            expect(dataAfter.auraBalOFTCirculatingSupply, "oft CirculatingSupply").to.be.eq(
                dataBefore.auraBalOFTCirculatingSupply.add(bridgeAmount),
            );
            expect(dataAfter.proxyVaultBalance, "oft proxy vault balance").to.be.eq(
                dataBefore.proxyVaultBalance.add(bridgeAmount),
            );

            await expect(tx)
                .to.emit(cvxCrv, "Transfer")
                .withArgs(deployer.address, canonical.auraBalProxyOFT.address, bridgeAmount);
            await expect(tx)
                .to.emit(cvxCrv, "Transfer")
                .withArgs(
                    canonical.auraBalProxyOFT.address,
                    testSetup.l1.vaultDeployment.strategy.address,
                    bridgeAmount,
                );
            await expect(tx)
                .to.emit(auraBalVault, "Deposit")
                .withArgs(
                    canonical.auraBalProxyOFT.address,
                    canonical.auraBalProxyOFT.address,
                    bridgeAmount,
                    bridgeAmount,
                );
        });
        it("harvest rewards from auraBalVault as usual", async () => {
            const harvestAmount = simpleToExactAmount(1);
            const dataBefore = await snapshot(deployer, "before harvest");

            // Harvest from auraBAL vault
            await auraBalVault.connect(deployer.signer).updateAuthorizedHarvesters(deployer.address, true);

            //  AuraBalVault.harvest() => AuraBalStrategy.harvest() => BaseRewardPool.getReward()
            await forceHarvestRewards(harvestAmount);

            await increaseTime(ONE_WEEK.mul(2));

            const dataAfter = await snapshot(deployer, "after harvest");

            expect(dataAfter.proxyVaultBalance, "proxy vault balance").eq(dataBefore.proxyVaultBalance);
            expect(dataAfter.proxyVaultBalanceOfUnderlying, "proxy vault balance of underlying").gt(
                dataBefore.proxyVaultBalanceOfUnderlying,
            );
        });

        it("can harvest from auraBAL proxy OFT", async () => {
            // Harvest from auraBAL proxy OFT
            const claimableAuraBalBefore = await canonical.auraBalProxyOFT.totalClaimable(cvxCrv.address);
            const claimableAuraBefore = await canonical.auraBalProxyOFT.totalClaimable(cvx.address);

            const srcChainAuraBalClaimableBefore = await canonical.auraBalProxyOFT.claimable(
                cvxCrv.address,
                L2_CHAIN_ID,
            );
            const srcChainAuraClaimableBefore = await canonical.auraBalProxyOFT.claimable(cvx.address, L2_CHAIN_ID);

            // call harvest
            // auraBalProxyOFT => VirtualBalanceRewardPool.getReward()
            await canonical.auraBalProxyOFT.connect(dao.signer).updateAuthorizedHarvesters(deployer.address, true);
            const tx = await canonical.auraBalProxyOFT.connect(deployer.signer).harvest([L2_CHAIN_ID], [100], 100);
            // TODO - wrong params

            // AuraBalProxyOFT to 0xe1Fd27F4390DcBE165f4D60DBF821e4B9Bb02dEd
            // 0x0B05c4edaBf3624C92dC6eF7D1b453Ce8D607A0A ??
            // EVENT AuraToken.Transfer(from=0x0B05c4edaBf3624C92dC6eF7D1b453Ce8D607A0A, to=0xe1Fd27F4390DcBE165f4D60DBF821e4B9Bb02dEd, value=999999999999907200)
            // EVENT VirtualBalanceRewardPool.RewardPaid(user=0xe1Fd27F4390DcBE165f4D60DBF821e4B9Bb02dEd, reward=999999999999907200)

            const dataProxyHarvestAfter = await snapshot(deployer, "after auraBalProxyOFT harvest");

            const claimableAuraBalAfter = await canonical.auraBalProxyOFT.totalClaimable(cvxCrv.address);
            const claimableAuraAfter = await canonical.auraBalProxyOFT.totalClaimable(cvx.address);
            expect(claimableAuraBalAfter).gt(claimableAuraBalBefore);
            expect(claimableAuraAfter).gt(claimableAuraBefore);

            const srcChainAuraBalClaimableAfter = await canonical.auraBalProxyOFT.claimable(
                cvxCrv.address,
                L2_CHAIN_ID,
            );
            const srcChainAuraClaimableAfter = await canonical.auraBalProxyOFT.claimable(cvx.address, L2_CHAIN_ID);
            expect(srcChainAuraClaimableAfter).gte(srcChainAuraClaimableBefore);
            expect(srcChainAuraBalClaimableAfter).gte(srcChainAuraBalClaimableBefore);
        });
        it("harvest rewards from auraBalVault wrong srcChainIds", async () => {
            const WRONG_CHAIN_ID = 8765;
            const tx = await canonical.auraBalProxyOFT.connect(deployer.signer).harvest([WRONG_CHAIN_ID], [100], 100);
        });
        it("harvest rewards from auraBalVault partially wrong srcChainIds", async () => {
            const WRONG_CHAIN_ID = 8765;
            const tx = await canonical.auraBalProxyOFT.connect(deployer.signer).harvest([WRONG_CHAIN_ID], [100], 100);
        });
        it("harvest rewards from auraBalVault wrong parameters length ", async () => {
            //         require(srcChainIdsLen == _totalUnderlying.length, "!parity");
        });
        it("harvest rewards from auraBalVault correct chain wrong totalUnderlying", async () => {
            //         require(srcChainIdsLen == _totalUnderlying.length, "!parity");
        });
    });

    // describe("send tokens", async () => {
    //     it("fails if caller is not the owner", async () => {
    //         await expect(
    //             auraBalOFT.connect(alice.signer).send(ZERO_ADDRESS, ZERO),
    //             "!onlyOwner",
    //         ).to.be.revertedWith(ERRORS.ONLY_OWNER);
    //     });
    //     it("earmark rewards sends fees to l2Coordinator's bridgeDelegate", async () => {
    //         // BoosterLite.earmarkRewards => L2Coordinator.queueNewRewards
    //         // a) => IERC20(balToken).safeTransfer(bridgeDelegate, balance);
    //         // b) => L1Coordinator._notifyFees
    //         const pid = 0;
    //         const stake = true;
    //         const amount = simpleToExactAmount(10);

    //         const bridgeDelegateBalanceBefore = await testSetup.l2.mocks.token.balanceOf(auraBalOFT.address);
    //         await testSetup.l2.mocks.bpt.approve(sidechain.booster.address, amount);
    //         await sidechain.booster.deposit(pid, amount, stake);
    //         await increaseTime(60 * 60 * 24);

    //         // Send fees
    //         await sidechain.booster.earmarkRewards(pid, { value: NATIVE_FEE });

    //         const bridgeDelegateBalanceAfter = await testSetup.l2.mocks.token.balanceOf(auraBalOFT.address);
    //         const bridgeDelegateBalanceDelta = bridgeDelegateBalanceAfter.sub(bridgeDelegateBalanceBefore);

    //         expect(bridgeDelegateBalanceAfter, "bridgeDelegateBalance").to.be.gt(bridgeDelegateBalanceBefore);
    //         // simulate bridging tokens  L2=>L1
    //         await testSetup.l1.mocks.crv.transfer(auraBalOFT.address, bridgeDelegateBalanceDelta);
    //     });

    //     it("allows to send tokens to another account", async () => {
    //         const balanceBefore = await testSetup.l1.mocks.crv.balanceOf(auraBalOFT.address);

    //         const tx = await auraBalOFT.connect(deployer.signer).send(alice.address, balanceBefore);
    //         await expect(tx).to.emit(auraBalOFT, "Send").withArgs(alice.address, balanceBefore);

    //         const balanceAfter = await testSetup.l1.mocks.crv.balanceOf(auraBalOFT.address);
    //         const targetBalance = await testSetup.l1.mocks.crv.balanceOf(alice.address);

    //         expect(balanceAfter, "bridgeDelegateBalance").to.be.eq(ZERO);
    //         expect(targetBalance, "tokens sent to target").to.be.eq(balanceBefore);
    //     });
    // });
});
// function setConfig !! Both auraOFT and AuraBalProxyOFT
// circulatingSupply
// _creditTo
