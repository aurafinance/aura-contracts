// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IChef {
    /**
     * @notice This function allows users to deposit funds into the contract.
     * @dev The deposit function takes two parameters, the amount of funds to be deposited and the address of the user depositing the funds. The function then adds the amount to the user's balance.
     */
    function deposit(uint256, uint256) external;

    /**
     * @notice This function allows a user to claim a certain amount of tokens from a specified address.
     * @dev This function is used to transfer tokens from one address to another. It takes two parameters,
     * the amount of tokens to be transferred and the address of the recipient. The function is marked as
     * external, meaning that it can be called from outside the contract.*/
    function claim(uint256, address) external;
}
