// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./IStakelessGauge.sol";

interface IStakelessGaugeCheckpointer {
    event GaugeAdded(IStakelessGauge indexed gauge, string indexed indexedGaugeType, string gaugeType);
    event GaugeRemoved(IStakelessGauge indexed gauge, string indexed indexedGaugeType, string gaugeType);

    function getGaugeAdder() external view returns (address);

    function getGaugeTypes() external view returns (string[] memory);

    function addGaugesWithVerifiedType(string memory gaugeType, IStakelessGauge[] calldata gauges) external;

    function addGauges(string memory gaugeType, IStakelessGauge[] calldata gauges) external;

    function removeGauges(string memory gaugeType, IStakelessGauge[] calldata gauges) external;

    /**
     * @notice Returns true if the given gauge was added for the given type; false otherwise.
     * @param gaugeType Type of the gauge.
     * @param gauge Gauge to check.
     */
    function hasGauge(string memory gaugeType, address gauge) external view returns (bool);

    function getTotalGauges(string memory gaugeType) external view returns (uint256);

    function getGaugeAtIndex(string memory gaugeType, uint256 index) external view returns (IStakelessGauge);

    function getRoundedDownBlockTimestamp() external view returns (uint256);

    function checkpointAllGaugesAboveRelativeWeight(uint256 minRelativeWeight) external payable;

    function checkpointGaugesOfTypesAboveRelativeWeight(string[] memory gaugeTypes, uint256 minRelativeWeight)
        external
        payable;

    function checkpointSingleGauge(string memory gaugeType, IStakelessGauge gauge) external payable;

    function checkpointMultipleGaugesOfMatchingType(string memory gaugeType, IStakelessGauge[] memory gauges)
        external
        payable;

    function checkpointMultipleGauges(string[] memory gaugeTypes, IStakelessGauge[] memory gauges) external payable;

    function getTotalBridgeCost(uint256 minRelativeWeight) external view returns (uint256);

    function getGaugeTypesBridgeCost(string[] memory gaugeTypes, uint256 minRelativeWeight)
        external
        view
        returns (uint256 totalCost);

    function getSingleBridgeCost(string memory gaugeType, IStakelessGauge gauge) external view returns (uint256);

    function isValidGaugeType(string memory gaugeType) external view returns (bool);
}
