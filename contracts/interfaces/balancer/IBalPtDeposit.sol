// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IBalPtDeposit {
    /**
     * @dev Allows users to deposit funds to a stake address.
     * @param _amount The amount of funds to deposit.
     * @param _lock A boolean value indicating whether the funds should be locked or not.
     * @param _stakeAddress The address of the stake.
     */
    function deposit(
        uint256 _amount,
        bool _lock,
        address _stakeAddress
    ) external;
}
