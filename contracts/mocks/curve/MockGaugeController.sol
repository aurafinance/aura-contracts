// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

contract MockGaugeController {
    function get_gauge_weight(address) external view returns (uint256) {
        return 1;
    }
}
