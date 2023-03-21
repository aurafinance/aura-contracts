// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IVirtualRewardFactory {
    function createVirtualReward(
        address,
        address,
        address
    ) external returns (address);
}

interface IVirtualRewards {
    function queueNewRewards(uint256) external;

    function rewardToken() external view returns (address);
}
