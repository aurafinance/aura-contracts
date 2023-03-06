import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import { AuraBalStrategyBase, AuraBalStrategyBase__factory, MockBalancerVault__factory } from "../../types/generated";
import { deployContract } from "../../tasks/utils";
import { ZERO_ADDRESS } from "../../test-utils/constants";
import { deployPhase1, deployPhase2, Phase2Deployed } from "../../scripts/deploySystem";
import { DeployMocksResult, deployMocks, getMockDistro, getMockMultisigs } from "../../scripts/deployMocks";

const debug = false;

describe("AuraBalStrategyBase", () => {
    /* -- Declare shared variables -- */
    let accounts: Signer[];
    let mocks: DeployMocksResult;
    let phase2: Phase2Deployed;
    let deployer: Signer;

    // Testing contract
    let auraBalStrategyBase: AuraBalStrategyBase;

    /* -- Declare shared functions -- */

    const setup = async () => {
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        mocks = await deployMocks(hre, deployer);
        const multisigs = await getMockMultisigs(accounts[4], accounts[5], accounts[6]);
        const distro = getMockDistro();

        const phase1 = await deployPhase1(hre, deployer, mocks.addresses);
        phase2 = await deployPhase2(hre, deployer, phase1, distro, multisigs, mocks.namingConfig, mocks.addresses);

        // Deploy test contract.
        auraBalStrategyBase = await deployContract<AuraBalStrategyBase>(
            hre,
            new AuraBalStrategyBase__factory(deployer),
            "AuraBalStrategyBase",
            [
                mocks.addresses.balancerVault,
                phase2.cvxCrvRewards.address,
                mocks.addresses.token,
                mocks.addresses.weth,
                phase2.cvx.address,
                phase2.cvxCrv.address,
                mocks.addresses.feeToken,
                phase2.cvxCrvBpt.poolId,
                mocks.addresses.balancerPoolId,
            ],
            {},
            debug,
        );
    };

    before("init contract", async () => {
        await setup();
    });

    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            const poolInfo = await mocks.balancerVault.getPool(mocks.addresses.balancerPoolId);
            expect(await auraBalStrategyBase.BBUSD_TOKEN(), "BBUSD_TOKEN").to.eq(mocks.addresses.feeToken);
            expect(await auraBalStrategyBase.AURA_TOKEN(), "AURA_TOKEN").to.eq(phase2.cvx.address);
            expect(await auraBalStrategyBase.AURABAL_TOKEN(), "AURABAL_TOKEN").to.eq(phase2.cvxCrv.address);
            expect(await auraBalStrategyBase.WETH_TOKEN(), "WETH_TOKEN").to.eq(mocks.addresses.weth);
            expect(await auraBalStrategyBase.BAL_TOKEN(), "BAL_TOKEN").to.eq(mocks.addresses.token);
            expect(await auraBalStrategyBase.BAL_ETH_POOL_TOKEN(), "BAL_ETH_POOL_TOKEN").to.eq(poolInfo[0]);
            expect(await auraBalStrategyBase.auraBalStaking(), "auraBalStaking").to.eq(phase2.cvxCrvRewards.address);
            expect(await auraBalStrategyBase.balVault(), "balVault").to.eq(mocks.addresses.balancerVault);
        });
        it("fails if called with wrong arguments", async () => {
            const balancerVault = await new MockBalancerVault__factory(deployer).deploy(ZERO_ADDRESS);

            await expect(
                new AuraBalStrategyBase__factory(deployer).deploy(
                    balancerVault.address,
                    phase2.cvxCrvRewards.address,
                    mocks.addresses.token,
                    mocks.addresses.weth,
                    phase2.cvx.address,
                    phase2.cvxCrv.address,
                    mocks.addresses.feeToken,
                    phase2.cvxCrvBpt.poolId,
                    mocks.addresses.balancerPoolId,
                ),
                "wrong arguments",
            ).to.be.revertedWith("!balEthPoolToken");
        });
    });
});
