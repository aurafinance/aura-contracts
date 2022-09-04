// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

interface IRewardPool4626 {
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external returns (uint256 shares);

    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    function asset() external view returns (address);

    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title   LPMigrator
 * @notice  Migrates LP tokens from one pool to another
 */
contract LPMigrator {
    using SafeERC20 for IERC20;

    function migrate(IRewardPool4626 _from, IRewardPool4626 _to) external {
        uint256 balance = _from.balanceOf(msg.sender);
        IERC20 asset = IERC20(_from.asset());

        _from.withdraw(balance, address(this), msg.sender);

        asset.safeApprove(address(_to), balance);
        _to.deposit(balance, msg.sender);
    }
}
