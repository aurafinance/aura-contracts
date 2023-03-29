// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IBalGaugeController {
    /**
     * @notice This function allows a user to vote for the gauge weights of a given address.
     * @dev This function is used to set the gauge weights of a given address. The address and uint256 parameters are used to set the gauge weights.
     */
    function vote_for_gauge_weights(address, uint256) external;
}
