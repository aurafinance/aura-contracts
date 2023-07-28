// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

contract MockStakelessGauge {
    address private _recipient;

    constructor(address recipient) {
        _recipient = recipient;
    }

    function getRecipient() external view returns (address) {
        return _recipient;
    }
}
