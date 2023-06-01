// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IBooster } from "../interfaces/IBooster.sol";
import { IRewardStaking } from "../interfaces/IRewardStaking.sol";

/**
 * @title   BoosterHelper
 * @author  AuraFinance
 * @notice  Invokes booster.earmarkRewards for multiple pools.
 * @dev     Allows anyone to call `earmarkRewards`  via the booster.
 */
contract BoosterHelper {
    using SafeERC20 for IERC20;

    IBooster public immutable booster;

    /**
     * @param _booster      Booster.sol
     */
    constructor(address _booster) {
        booster = IBooster(_booster);
    }

    /**
     * @notice Invoke earmarkRewards for each pool id.
     * @param crv  crv address token (caller incentive)
     * @param _pids Array of pool ids
     */
    function earmarkRewards(address crv, uint256[] memory _pids) external returns (uint256) {
        uint256 len = _pids.length;
        require(len > 0, "!pids");

        for (uint256 i = 0; i < len; i++) {
            require(booster.earmarkRewards(_pids[i]), "!earmark reward");
        }
        // Return all incentives to the sender
        uint256 crvBal = IERC20(crv).balanceOf(address(this));
        IERC20(crv).safeTransfer(msg.sender, crvBal);
        return crvBal;
    }

    /**
     * @notice Invoke processIdleRewards for each pool id.
     * @param _pids Array of pool ids
     */
    function processIdleRewards(uint256[] memory _pids) external {
        uint256 len = _pids.length;
        require(len > 0, "!pids");

        for (uint256 i = 0; i < len; i++) {
            IBooster.PoolInfo memory poolInfo = booster.poolInfo(_pids[i]);
            IRewardStaking baseRewardPool = IRewardStaking(poolInfo.crvRewards);
            baseRewardPool.processIdleRewards();
        }
    }
}
