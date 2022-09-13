// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

contract MockGaugeController {
    function get_gauge_weight(address) external view returns (uint256) {
        return 1;
    }

    function checkpoint_gauge(address) external {
        // solhint-disable-previous-line no-empty-blocks
    }

    function voting_escrow() external returns (address escrow) {
        escrow = 0xC128a9954e6c874eA3d62ce62B468bA073093F25;
    }

    function gauge_relative_weight(address, uint256) external view returns (uint256) {
        return 1;
    }
}
