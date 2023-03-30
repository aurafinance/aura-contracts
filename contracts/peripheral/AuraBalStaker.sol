// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IGenericVault } from "../interfaces/IGenericVault.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

/**
 * @title   AuraBalStaker
 * @author  AuraFinance
 * @notice  Compatability module for auraBAL staking
 */
contract AuraBalStaker {
    using SafeERC20 for IERC20;

    address public immutable vault;
    address public immutable auraBal;

    constructor(address _vault, address _auraBal) {
        vault = _vault;
        auraBal = _auraBal;

        IERC20(_auraBal).safeApprove(_vault, type(uint256).max);
    }

    /// @dev Stake on behalf of the `to` address
    /// @param to The address to stake for
    /// @param amount The amount of auraBAL to stake
    function stakeFor(address to, uint256 amount) external {
        IERC20(auraBal).transferFrom(msg.sender, address(this), amount);
        IGenericVault(vault).deposit(amount, to);
    }
}
