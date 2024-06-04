import { expect } from "chai";
import { Signer } from "ethers";
import hre, { network } from "hardhat";
import { deployCrvDepositorWrapperForwarderV2, SystemDeployed } from "../../scripts/deploySystem";
import { config } from "../../tasks/deploy/mainnet-config";
import { impersonate, impersonateAccount } from "../../test-utils";
import { AuraStakingProxy, CrvDepositorWrapperForwarderV2, ERC20, ERC20__factory } from "../../types/generated";

const debug = false;
const balWhaleAddress = "0xff052381092420b7f24cc97fded9c0c17b2cbbb9";
const keeperAddress = "0xcc247cde79624801169475c9ba1f716db3959b8f";

describe("CrvDepositorWrapperForwarderV2", () => {
    let protocolDao: Signer;
    let eoa: Signer;
    let keeper: Signer;

    let system: SystemDeployed;
    let bal: ERC20;

    let stakingProxy: AuraStakingProxy;
    let crvDepositorWrapper: CrvDepositorWrapperForwarderV2;

    before(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 19972400,
                    },
                },
            ],
        });

        await impersonateAccount(config.multisigs.daoMultisig);
        protocolDao = await impersonate(config.multisigs.daoMultisig);

        await impersonateAccount(balWhaleAddress);
        eoa = await impersonate(balWhaleAddress);

        await impersonateAccount(keeperAddress);
        keeper = await impersonate(keeperAddress);

        system = await config.getPhase4(protocolDao);
        bal = ERC20__factory.connect(config.addresses.token, eoa);
        stakingProxy = system.cvxStakingProxy.connect(keeper);
    });

    it("deploy CrvDepositorWrapperForwarderV2", async () => {
        const phase2 = await config.getPhase2(eoa);
        const { stashRewardDistro } = config.getGaugeVoteRewards(eoa);
        const pid = 100;

        ({ crvDepositorWrapperForwarderV2: crvDepositorWrapper } = await deployCrvDepositorWrapperForwarderV2(
            hre,
            eoa,
            { ...phase2, stashRewardDistro, pid },
            config.addresses,
            debug,
            0,
        ));
        await crvDepositorWrapper.setApprovals();
    });

    it("keeper - updates AuraStakingProxy", async () => {
        await system.cvxStakingProxy.setCrvDepositorWrapper(crvDepositorWrapper.address, 9950); // 9950
        await system.cvxStakingProxy.setApprovals();
    });

    it("allows calls to distribute to pass", async () => {
        const balBefore = await bal.balanceOf(stakingProxy.address);
        await stakingProxy.connect(keeper)["distribute()"]();
        const balAfter = await bal.balanceOf(stakingProxy.address);
        expect(balBefore).gt(0);
        expect(balAfter).eq(0);

        expect(await bal.balanceOf(crvDepositorWrapper.address)).eq(0);
    });
    it("keeper - resets approvals", async () => {
        await system.cvxStakingProxy.setApprovals();
    });
});
