// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IBooster } from "../interfaces/IBooster.sol";
import { KeeperRole } from "../peripheral/KeeperRole.sol";
import { Module } from "./Module.sol";

/**
 * @author  Aura Finance
 * @notice  This module allows a keeper to add extra reward tokens to a stash
 */
contract ExtraRewardStashModule is Module, KeeperRole {
    /// @notice The owner of the Booster contract
    address public immutable boosterOwner;
    /// @notice The Booster contract
    address public immutable booster;
    // Whitelisted tokens
    mapping(address => bool) public authorizedTokens;

    /**
     * @param _owner: owner of the contract
     * @param _safeWallet: address of the SafeWallet contract
     * @param _boosterOwner: address of the BoosterOwner| BoosterOwnerSecondary contract
     * @param _booster: address of the Booster contract
     */
    constructor(
        address _owner,
        address _safeWallet,
        address _boosterOwner,
        address _booster
    ) KeeperRole(_owner) Module(_safeWallet) {
        boosterOwner = _boosterOwner;
        booster = _booster;
        _transferOwnership(_owner);
    }

    /**
     * @notice Validates the pid exists and the token is authorized
     * @param pid: pool id
     * @param _token: address of the token
     */
    function _validateParameters(uint256 pid, address _token) internal view returns (address) {
        IBooster.PoolInfo memory poolInfo = IBooster(booster).poolInfo(pid);

        require(authorizedTokens[_token], "!token");
        require(poolInfo.stash != address(0), "!stash");
        return poolInfo.stash;
    }

    /**
     * @notice Update the authorized tokens
     * @param _token: address of the token
     * @param _authorized: bool
     * @dev Only callable by the owner
     */
    function updateAuthorizedTokens(address _token, bool _authorized) external onlyOwner {
        authorizedTokens[_token] = _authorized;
    }

    /**
     * @notice Set the extra reward token for a stash
     * @param pid: pool id
     * @param _token: address of the token
     * @dev Only callable by the keeper, only if the token is authorized
     */
    function setStashExtraReward(uint256 pid, address _token) external virtual onlyKeeper {
        _validateParameters(pid, _token);

        _execCallFromModule(boosterOwner, abi.encodeWithSignature("setStashExtraReward(uint256,address)", pid, _token));
    }
}
