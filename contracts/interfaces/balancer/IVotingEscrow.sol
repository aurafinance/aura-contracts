// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IVotingEscrow {
    /**
     * @notice create_lock() is a function that creates a lock on a given amount of tokens for a given duration.
     * @dev create_lock() takes two parameters, the amount of tokens to be locked and the duration of the lock. The function will create a lock on the given amount of tokens for the given duration. The lock will be released after the duration has expired.*/
    function create_lock(uint256, uint256) external;

    /**
     * @notice This function increases the amount of a given uint256.
     * @dev This function is used to increase the amount of a given uint256. It is important to note that this function is only available to external users.
     */
    function increase_amount(uint256) external;

    /**
     * @notice This function increases the unlock time of a contract.
     * @dev This function increases the unlock time of a contract by a specified amount. It takes in a uint256 as an argument.
     */
    function increase_unlock_time(uint256) external;

    function withdraw() external;

    /**
     * @notice locked__end() is a function that returns the end time of a locked contract.
     * @dev locked__end() takes an address as an argument and returns the end time of the locked contract associated with that address.
     */
    function locked__end(address) external view returns (uint256);

    function balanceOf(address) external view returns (uint256);
}
