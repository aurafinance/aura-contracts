// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IExtraRewardsDistributor {
    function addReward(address _token, uint256 _amount) external;
}
