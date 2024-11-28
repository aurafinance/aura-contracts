// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { KeeperRole } from "../peripheral/KeeperRole.sol";
import { Module } from "./Module.sol";

/**
 * @author  Aura Finance
 * @notice  This module allows a keeper to interact with the GaugeVoter contract on behalf of the Safe
 */
contract GaugeVoterModule is Module, KeeperRole {
    /// @notice The address of the GaugeVoter contract
    address public immutable gaugeVoter;

    /**
     * @notice  Constructor for the GaugeVoterModule
     * @param _owner        Owner of the contract
     * @param _safeWallet   Address of the Safe
     * @param _gaugeVoter   Address of the GaugeVoter contract
     */
    constructor(
        address _owner,
        address _safeWallet,
        address _gaugeVoter
    ) KeeperRole(_owner) Module(_safeWallet) {
        gaugeVoter = _gaugeVoter;
    }

    /**
     * @notice  Call the gaugeVoter.voteGaugeWeight call to track weights for each epoch
     * @dev     Only callable by a keeper
     * @param _gauge    Array of the gauges
     * @param _weight   Array of the weights
     * @return bool for success
     */
    function voteGaugeWeight(address[] calldata _gauge, uint256[] calldata _weight) external onlyKeeper returns (bool) {
        bytes memory data = abi.encodeWithSignature("voteGaugeWeight(address[],uint256[])", _gauge, _weight);
        return _execCallFromModule(gaugeVoter, data);
    }
}
