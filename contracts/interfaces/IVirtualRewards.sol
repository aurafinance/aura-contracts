// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IVirtualRewardFactory {
    /**
     * @notice This function creates a virtual reward for the specified address.
     * @dev This function creates a virtual reward for the specified address. It takes three parameters:
     *  - address: The address of the recipient of the reward.
     *  - address: The address of the sender of the reward.
     *  - address: The address of the contract that will be used to create the reward.
     * The function returns the address of the newly created reward.
     */
    function createVirtualReward(
        address,
        address,
        address
    ) external returns (address);
}

interface IVirtualRewards {
    /**
     * @notice This function is used to queue new rewards for a given user.
     * @dev This function is called by the contract owner to queue new rewards for a given user. It takes a uint256 as an argument which is the amount of rewards to be queued.
     */
    function queueNewRewards(uint256) external;

    function rewardToken() external view returns (address);
}
