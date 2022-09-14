// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IBaseRewardPool4626, IBooster } from "./Interfaces.sol";

/**
 * @title   GaugeMigrator
 * @notice  Migrates LP tokens from one pool to another
 */
contract GaugeMigrator {
    using SafeERC20 for IERC20;

    IBooster public immutable booster;

    /**
     * @param _booster      Booster.sol, e.g. 0xF403C135812408BFbE8713b5A23a04b3D48AAE31
     */
    constructor(address _booster) {
        booster = IBooster(_booster);
    }

    function migrate(uint256 _fromPid, uint256 _toPid) external {
        require(_fromPid != _toPid, "Invalid pids");
        IBooster.PoolInfo memory fromPool = booster.poolInfo(_fromPid);
        IBooster.PoolInfo memory toPool = booster.poolInfo(_toPid);

        require(fromPool.lptoken == toPool.lptoken, "Invalid lptokens");

        // IBaseRewardPool4626 shares:asset ratio is 1:1
        uint256 balance = IBaseRewardPool4626(fromPool.crvRewards).balanceOf(msg.sender);
        IERC20 asset = IERC20(fromPool.lptoken);
        IBaseRewardPool4626(fromPool.crvRewards).withdraw(balance, address(this), msg.sender);

        asset.safeApprove(toPool.crvRewards, balance);
        IBaseRewardPool4626(toPool.crvRewards).deposit(balance, msg.sender);
    }
}
