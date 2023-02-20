// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { GenericUnionVault } from "./GenericVault.sol";

interface AuraBalStrategy {
    function harvest(
        address _caller,
        uint256 _minAmountOut,
        bool _lock
    ) external returns (uint256 harvested);
}

/**
 * @title   AuraBalVault
 * @author  lama.airforce
 */
contract AuraBalVault is GenericUnionVault {
    bool public isHarvestPermissioned = false;
    mapping(address => bool) public authorizedHarvesters;

    constructor(address _token) GenericUnionVault(_token) {}

    /// @notice Sets whether only whitelisted addresses can harvest
    /// @param _status Whether or not harvests are permissioned
    function setHarvestPermissions(bool _status) external onlyOwner {
        isHarvestPermissioned = _status;
    }

    /// @notice Adds or remove an address from the harvesters' whitelist
    /// @param _harvester address of the authorized harvester
    /// @param _authorized Whether to add or remove harvester
    function updateAuthorizedHarvesters(address _harvester, bool _authorized) external onlyOwner {
        authorizedHarvesters[_harvester] = _authorized;
    }

    /// @notice Claim rewards and swaps them to auraBAL for restaking
    /// @param _minAmountOut - min amount of auraBAL to receive for harvest
    /// @param _lock - whether to lock or swap lp tokens for auraBAL
    /// @dev Can be called by whitelisted account or anyone against an auraBal incentive
    /// @dev Harvest logic in the strategy contract
    /// @dev Harvest can be called even if permissioned when last staker is
    ///      withdrawing from the vault.
    function harvest(uint256 _minAmountOut, bool _lock) public {
        require(
            !isHarvestPermissioned || authorizedHarvesters[msg.sender] || totalSupply() == 0,
            "permissioned harvest"
        );
        uint256 _harvested = AuraBalStrategy(strategy).harvest(msg.sender, _minAmountOut, _lock);
        emit Harvest(msg.sender, _harvested);
    }

    /// @notice Claim rewards and swaps them to auraBAL for restaking
    /// @param _minAmountOut - min amount of BPT to receive for harvest
    /// @dev locking for auraBAL by default
    function harvest(uint256 _minAmountOut) public {
        harvest(_minAmountOut, true);
    }

    /// @notice Claim rewards and swaps them to auraBAL for restaking
    /// @dev No slippage protection, swapping for auraBAL
    function harvest() public override {
        harvest(0);
    }
}
