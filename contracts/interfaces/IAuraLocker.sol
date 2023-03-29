// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IAuraLocker {
    /**
     * @notice This function locks an amount of tokens from an account
     * @dev This function locks an amount of tokens from an account. It is used to prevent the account from transferring tokens until the lock is released.
     * @param _account The address of the account to lock tokens from
     * @param _amount The amount of tokens to lock from the account
     */
    function lock(address _account, uint256 _amount) external;

    /**
     * @notice This function is used to checkpoint the current epoch.
     * @dev This function is called by the contract owner to checkpoint the current epoch. This function is necessary to ensure that the contract is able to keep track of the current epoch.*/
    function checkpointEpoch() external;

    /**
     * @dev Returns the current epoch count.
     * @return uint256 The current epoch count.
     */
    function epochCount() external view returns (uint256);

    function balanceAtEpochOf(uint256 _epoch, address _user) external view returns (uint256 amount);

    /**
     * @dev Returns the total supply of a token at a given epoch.
     * @param _epoch The epoch to query the total supply at.
     * @return The total supply of the token at the given epoch.
     */
    function totalSupplyAtEpoch(uint256 _epoch) external view returns (uint256 supply);

    /**
     * @notice This function queues a new reward to be distributed to the rewards token contract.
     * @dev This function queues a new reward to be distributed to the rewards token contract. The reward is specified in the reward parameter.
     */
    function queueNewRewards(address _rewardsToken, uint256 reward) external;

    /**
     * @notice This function allows a user to get a reward from the contract.
     * @dev This function is used to get a reward from the contract. It takes in an address and a boolean value as parameters. The address is the account of the user who is getting the reward and the boolean value is used to determine if the user has staked or not. If the boolean value is true, the user will get the reward. If the boolean value is false, the user will not get the reward.*/
    function getReward(address _account, bool _stake) external;

    /**
     * @notice This function allows users to get their rewards from the contract.
     *
     * @dev This function is triggered when a user calls the getReward() function. It takes in an address as an argument and returns the reward associated with that address.
     */
    function getReward(address _account) external;
}
