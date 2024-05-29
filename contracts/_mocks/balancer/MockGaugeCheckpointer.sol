// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { IStakelessGaugeCheckpointer } from "../../interfaces/balancer/IStakelessGaugeCheckpointer.sol";
import { IStakelessGauge } from "../../interfaces/balancer/IStakelessGauge.sol";

contract MockGaugeCheckpointer is IStakelessGaugeCheckpointer {
    mapping(address => string) public gauges;

    function getGaugeAdder() external view override returns (address) {}

    function getGaugeTypes() external view override returns (string[] memory) {}

    function addGaugesWithVerifiedType(string memory gaugeType, IStakelessGauge[] calldata _gauges) external override {}

    function addGauges(string memory gaugeType, IStakelessGauge[] calldata _gauges) external override {
        for (uint256 i = 0; i < _gauges.length; i++) {
            gauges[address(_gauges[i])] = gaugeType;
        }
    }

    function removeGauges(string memory gaugeType, IStakelessGauge[] calldata _gauges) external override {}

    function hasGauge(string memory gaugeType, address gauge) external view override returns (bool) {
        // TODO
        return bytes(gauges[gauge]).length == bytes(gaugeType).length;
    }

    function getTotalGauges(string memory gaugeType) external view override returns (uint256) {}

    function getGaugeAtIndex(string memory gaugeType, uint256 index) external view override returns (IStakelessGauge) {}

    function getRoundedDownBlockTimestamp() external view override returns (uint256) {}

    function checkpointAllGaugesAboveRelativeWeight(uint256 minRelativeWeight) external payable override {}

    function checkpointGaugesOfTypesAboveRelativeWeight(string[] memory gaugeTypes, uint256 minRelativeWeight)
        external
        payable
        override
    {}

    function checkpointSingleGauge(string memory gaugeType, IStakelessGauge gauge) external payable override {}

    function checkpointMultipleGaugesOfMatchingType(string memory gaugeType, IStakelessGauge[] memory _gauges)
        external
        payable
        override
    {}

    function checkpointMultipleGauges(string[] memory gaugeTypes, IStakelessGauge[] memory _gauges)
        external
        payable
        override
    {}

    function getTotalBridgeCost(uint256 minRelativeWeight) external view override returns (uint256) {}

    function getGaugeTypesBridgeCost(string[] memory gaugeTypes, uint256 minRelativeWeight)
        external
        view
        override
        returns (uint256 totalCost)
    {}

    function getSingleBridgeCost(string memory gaugeType, IStakelessGauge gauge)
        external
        view
        override
        returns (uint256)
    {}

    function isValidGaugeType(string memory gaugeType) external view override returns (bool) {}
}
