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

    /// @notice The maximum allowed weight for a gauge
    uint256 public constant MAX_WEIGHT = 2500; // 25 basis points

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

    /// @dev Custom error for invalid weight
    error InvalidWeight(uint256 index, uint256 weight);

    /**
     * @notice  Call the gaugeVoter.voteGaugeWeight, with a maximum weight of 25 basis points
     * @dev     Only callable by a keeper
     * @param _gauge    Array of the gauges
     * @param _weight   Array of the weights
     * @return bool for success
     */
    function voteGaugeWeight(address[] calldata _gauge, uint256[] calldata _weight) external onlyKeeper returns (bool) {
        uint256 weightLen = _weight.length;
        for (uint256 i = 0; i < weightLen; i++) {
            if (_weight[i] > MAX_WEIGHT) revert InvalidWeight(i, _weight[i]);
        }
        bytes memory data = abi.encodeWithSignature("voteGaugeWeight(address[],uint256[])", _gauge, _weight);
        return _execCallFromModule(gaugeVoter, data);
    }

    /**
     * @dev Set the dst chain IDs for multiple gauges
     * @param _gauges The gauge addresses
     * @param _dstChainIds The dst chain IDS
     */
    function setDstChainId(address[] memory _gauges, uint16[] memory _dstChainIds) external onlyKeeper returns (bool) {
        uint256 gaugesLen = _gauges.length;
        require(gaugesLen == _dstChainIds.length, "!dstChainIds");
        require(gaugesLen > 0, "!gauges");

        address[] memory gauges = new address[](1);
        for (uint256 i = 0; i < gaugesLen; i++) {
            // Note: In Solidity 0.8.x, abi.encodeWithSignature can be used to encode dynamic arrays for external calls.
            // However, in earlier versions, abi.encodeWithSignature did not encode inline arrays correctly.
            gauges[0] = _gauges[i];
            bytes memory data = abi.encodeWithSignature("setDstChainId(address[],uint16)", gauges, _dstChainIds[i]);
            _execCallFromModule(gaugeVoter, data);
        }
        return true;
    }
}
