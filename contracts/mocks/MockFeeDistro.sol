// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

contract MockFeeDistro {
    function getTokenTimeCursor(address) external view returns (uint256) {
        return 1;
    }
}
