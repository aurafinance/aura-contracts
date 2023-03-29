// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface ICrvDepositor {
    /**
     * @dev Allows users to deposit funds to a specified address.
     * @param to The address to deposit funds to.
     * @param _amount The amount of funds to deposit.
     * @param _lock A boolean value indicating whether the funds should be locked or not.
     * @param _stakeAddress The address of the stake contract.
     */
    function depositFor(
        address to,
        uint256 _amount,
        bool _lock,
        address _stakeAddress
    ) external;
}
