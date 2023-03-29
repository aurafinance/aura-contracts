// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IExtraRewardsDistributor {
    /**
     * @notice This function adds a reward to the token contract.
     * @dev This function adds a reward to the token contract. It takes in two parameters, an address of the token contract and an amount of the reward.
     */
    function addReward(address _token, uint256 _amount) external;
}
