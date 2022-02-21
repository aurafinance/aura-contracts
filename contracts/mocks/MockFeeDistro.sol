// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

contract MockFeeDistro {
    address public token;

    constructor(address _token) {
        token = _token;
    }

    function claim() external {
        // TODO:
    }
}
