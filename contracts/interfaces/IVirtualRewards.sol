// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IVirtualRewards {
    function queueNewRewards(uint256) external;

    function rewardToken() external view returns (address);
}
