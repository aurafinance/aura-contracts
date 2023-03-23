// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IBalGaugeController {
    function vote_for_gauge_weights(address, uint256) external;
}
