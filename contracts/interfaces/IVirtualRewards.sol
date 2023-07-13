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
    function periodFinish() external view returns (uint256);

    function queuedRewards() external view returns (uint256);

    function queueNewRewards(uint256) external;

    function rewardToken() external view returns (address);

    function getReward() external;
}
