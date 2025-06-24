// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Module } from "./Module.sol";
import { KeeperRole } from "../peripheral/KeeperRole.sol";
import { AuraLocker } from "../core/AuraLocker.sol";

/**
 * @title AuraLockerModule
 * @notice  This module allows a keeper to lock AURA tokens using the AuraLocker contract.
 * @author  Forked from https://github.com/onchainification/aura_locker_v2/blob/main/src/AuraLockerModule.sol
 *           - removed Chainlink Keeper integration
 */
contract AuraLockerModule is Module, KeeperRole {
    /// @notice AuraLocker contract
    AuraLocker public immutable auraLocker;

    /*//////////////////////////////////////////////////////////////////////////
                                       ERRORS
    //////////////////////////////////////////////////////////////////////////*/
    error ZeroAddress();
    error NothingToLock(uint256 timestamp);

    constructor(
        address _owner,
        address _safeWallet,
        address _auraLocker
    ) KeeperRole(_owner) Module(_safeWallet) {
        if (_owner == address(0)) revert ZeroAddress();
        if (_safeWallet == address(0)) revert ZeroAddress();
        if (_auraLocker == address(0)) revert ZeroAddress();
        auraLocker = AuraLocker(_auraLocker);
    }

    /// @notice Retrieves the details of locked balances.
    function lockedBalances()
        external
        view
        returns (
            uint256 total,
            uint256 unlockable,
            uint256 locked,
            AuraLocker.LockedBalance[] memory lockData
        )
    {
        return auraLocker.lockedBalances(address(safeWallet));
    }

    /// @notice Check if AURA holding are unlocked
    /// @return requiresLocking True if there is a need to lock AURA tokens
    function hasExpiredLocks() external view returns (bool requiresLocking) {
        (, uint256 unlockable, , ) = this.lockedBalances();
        requiresLocking = unlockable > 0;
    }

    /// @notice Re-lock expired AURA tokens
    /// @dev This function is called by the keeper
    /// @dev It will revert if there is nothing to lock
    function processExpiredLocks() external onlyKeeper {
        bool requiresLocking = this.hasExpiredLocks();
        if (!requiresLocking) revert NothingToLock(block.timestamp);
        _execCallFromModule(address(auraLocker), abi.encodeWithSelector(auraLocker.processExpiredLocks.selector, true));
    }
}
