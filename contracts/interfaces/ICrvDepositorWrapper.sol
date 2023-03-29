// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface ICrvDepositorWrapper {
    /**
     * @notice getMinOut() is a function that takes two uint256 parameters and returns the minimum of the two.
     * @dev getMinOut() is a function that takes two uint256 parameters and returns the minimum of the two. It is an external view function, meaning that it does not modify the state of the blockchain.*/
    function getMinOut(uint256, uint256) external view returns (uint256);

    /**
     * @notice This function allows users to deposit funds to a stake address.
     * @dev This function requires four parameters: a uint256 amount, a uint256 duration, a boolean value, and an address _stakeAddress. The amount is the amount of funds to be deposited, the duration is the length of time the funds will be held, the boolean value is used to indicate whether the deposit is for a new stake or an existing stake, and the _stakeAddress is the address of the stake.
     */
    function deposit(
        uint256,
        uint256,
        bool,
        address _stakeAddress
    ) external;
}
