// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IStrategy } from "../interfaces/IStrategy.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IVirtualRewards } from "../interfaces/IVirtualRewards.sol";
import { IGenericVault } from "../interfaces/IGenericVault.sol";

/**
 * @title   SimpleStrategy
 * @author  AuraFinance
 * @notice  Simple strategy to harvest all vault's extra rewards and queue them.
 */
contract SimpleStrategy is IStrategy {
    using SafeERC20 for IERC20;

    /// @dev The $AURABAL token address
    address public immutable auraBalToken;

    /// @dev The AuraBal compounder vault address
    address public immutable vault;

    /**
     * @dev Simple constructor
     * @param _auraBalToken The $AURABAL token address
     * @param _vault        The AuraBal compounder vault
     */
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

    /**
     * @notice Allows the Vault to withdraw a given amount of auraBal.
     * @dev Only callable by the vault.
     * @param _amount  The amount of auraBal to withdraw.
     */
    function withdraw(uint256 _amount) external onlyVault {
        IERC20(auraBalToken).safeTransfer(vault, _amount);
    }

    /**
     * @notice This function is used to process extra rewards for the vault.
     * @dev This function will loop through the extra rewards and transfer the balance of
     * the reward token to the rewards address. It will then queue the new rewards with the balance.
     */
    function harvest(uint256) public onlyVault returns (uint256 harvested) {
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
