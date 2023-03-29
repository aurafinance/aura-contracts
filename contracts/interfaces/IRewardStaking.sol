// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IRewardStaking {
    /**
     * @notice This function allows a user to claim their rewards from a contract.
     *
     * @dev This function requires an address of the user and a boolean value to determine if the user should receive extra rewards. The function will then calculate the rewards and send them to the user's address.*/
    function getReward(address _account, bool _claimExtras) external;

    /**
     * @notice This function is used to get the reward for a given account.
     * @dev This function is used to get the reward for a given account. It takes in an address as an argument and returns the reward associated with that address.*/
    function getReward(address _account) external;

    /**
     * @notice This function allows a user to get a reward from a token contract.
     *
     * @dev This function takes in two parameters, an address of the user and an address of the token contract. It then calls the token contract to get the reward for the user.
     */
    function getReward(address _account, address _token) external;

    /**
     * @notice StakeFor allows users to stake a certain amount of tokens for a given address.
     * @dev This function is used to stake tokens for a given address. It takes two parameters, an address and a uint256. The address is the address of the user to stake tokens for, and the uint256 is the amount of tokens to be staked. This function is only available to users with the appropriate permissions.*/
    function stakeFor(address, uint256) external;

    /**
     * @notice This function is used to process idle rewards for users.
     * @dev This function is triggered by the contract owner and is used to process idle rewards for users. It is important to note that this function should only be triggered by the contract owner.*/
    function processIdleRewards() external;
}
