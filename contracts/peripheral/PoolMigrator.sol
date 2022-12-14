// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IRewardPool4626 } from "../interfaces/IRewardPool4626.sol";
import { IBooster } from "../interfaces/IBooster.sol";

/**
 * @title   PoolMigrator
 * @author  AuraFinance
 * @notice  Migrates LP tokens from boosterV1 pool to boosterV2 pool.
 */
contract PoolMigrator {
    using SafeERC20 for IERC20;

    IBooster public immutable boosterV1;
    IBooster public immutable boosterV2;

    /**
     * @param _boosterV1      Booster.sol, e.g. 0xF403C135812408BFbE8713b5A23a04b3D48AAE31
     * @param _boosterV2      Booster.sol, e.g.
     */
    constructor(address _boosterV1, address _boosterV2) {
        boosterV1 = IBooster(_boosterV1);
        boosterV2 = IBooster(_boosterV2);
    }

    /**
     * @notice Migrates the complete liquidity position from boosterV1 pid to boosterV2 pid.
     *  if amount is 'type(uint256).max' then migrate full position.
     * @param _fromPids The boosterV1 pid
     * @param _toPids The boosterV2 pid
     * @param _amounts The amount of lp to migrate.
     */
    function migrate(
        uint256[] memory _fromPids,
        uint256[] memory _toPids,
        uint256[] memory _amounts
    ) external {
        uint256 len = _fromPids.length;

        require(len == _toPids.length && len == _amounts.length, "Invalid input");
        for (uint256 i = 0; i < len; i++) {
            _migrate(_fromPids[i], _toPids[i], _amounts[i]);
        }
    }

    /**
     * @notice Migrates the complete liquidity position from boosterV1 pid to boosterV2 pid.
     *  if amount is 'type(uint256).max' then migrate full position.
     * @param _fromPid The boosterV1 pid
     * @param _toPid The boosterV2 pid
     * @param _amount The amount to migrate
     */
    function _migrate(
        uint256 _fromPid,
        uint256 _toPid,
        uint256 _amount
    ) internal {
        IBooster.PoolInfo memory fromPool = boosterV1.poolInfo(_fromPid);
        IBooster.PoolInfo memory toPool = boosterV2.poolInfo(_toPid);

        require(fromPool.lptoken == toPool.lptoken, "Invalid lptokens");
        require(fromPool.gauge == toPool.gauge, "Invalid gauges");

        uint256 balance = IRewardPool4626(fromPool.crvRewards).balanceOf(msg.sender);

        uint256 amount = _amount == type(uint256).max ? balance : _amount;

        IRewardPool4626(fromPool.crvRewards).withdraw(amount, address(this), msg.sender);

        IERC20(fromPool.lptoken).safeIncreaseAllowance(toPool.crvRewards, amount);

        IRewardPool4626(toPool.crvRewards).deposit(amount, msg.sender);
    }
}
