// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IRewardStaking {
    function getReward(address _account, bool _claimExtras) external returns (bool);

    function getReward(address _account) external returns (bool);

    function getReward(address _account, address _token) external;

    function stakeFor(address, uint256) external;

    function processIdleRewards() external;

    function withdraw(uint256, bool) external;

    function withdraw(address, uint256) external;

    function stakeAll() external;

    function stake(address, uint256) external;

    function rewardToken() external view returns (address);

    function queueNewRewards(uint256) external;
}
