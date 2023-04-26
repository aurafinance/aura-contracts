// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IStrategy } from "../interfaces/IStrategy.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IVirtualRewards } from "../interfaces/IVirtualRewards.sol";
import { IGenericVault } from "../interfaces/IGenericVault.sol";

contract SimpleStrategy is IStrategy {
    using SafeERC20 for IERC20;

    address public immutable auraBalToken;

    address public immutable vault;

    constructor(address _auraBalToken, address _vault) {
        auraBalToken = _auraBalToken;
        vault = _vault;
    }

    function harvest() external returns (uint256) {
        // silence is golden
    }

    function setApprovals() external {
        // silence is golden
    }

    function stake(uint256 _amount) external {
        // silence is golden
    }

    function totalUnderlying() external view returns (uint256) {
        return IERC20(auraBalToken).balanceOf(address(this));
    }

    function withdraw(uint256 _amount) external onlyVault {
        IERC20(auraBalToken).safeTransfer(vault, _amount);
    }

    /// @notice Claim rewards and swaps them to FXS for restaking
    /// @dev Can be called by the vault only
    /// @param _minAmountOut -  min amount of LP tokens to receive w/o revert
    /// @return harvested - the amount harvested
    function harvest(uint256 _minAmountOut) public onlyVault returns (uint256 harvested) {
        // process extra rewards
        uint256 extraRewardCount = IGenericVault(vault).extraRewardsLength();
        for (uint256 i; i < extraRewardCount; ++i) {
            address rewards = IGenericVault(vault).extraRewards(i);
            address token = IVirtualRewards(rewards).rewardToken();
            uint256 balance = IERC20(token).balanceOf(address(this));
            if (balance > 0) {
                IERC20(token).safeTransfer(rewards, balance);
                IVirtualRewards(rewards).queueNewRewards(balance);
            }
        }

        return 0;
    }

    modifier onlyVault() {
        require(vault == msg.sender, "Vault calls only");
        _;
    }
}
