// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/** @title Warden Dark Quest Board  */
/// @author Paladin
/*
    Version of Warden Quest Board allowing to blacklist veToken voters
    And not account their Bias for rewards distribution
*/
interface IDarkQuestBoard {
    // Main functions
    function createQuest(
        address gauge,
        address rewardToken,
        uint48 duration,
        uint256 objective,
        uint256 rewardPerVote,
        uint256 totalRewardAmount,
        uint256 feeAmount,
        address[] calldata blacklist
    ) external returns (uint256);

    function withdrawUnusedRewards(uint256 questID, address recipient) external;

    // Manage quest functions
    function increaseQuestDuration(
        uint256 questID,
        uint48 addedDuration,
        uint256 addedRewardAmount,
        uint256 feeAmount
    ) external;

    function increaseQuestReward(
        uint256 questID,
        uint256 newRewardPerVote,
        uint256 addedRewardAmount,
        uint256 feeAmount
    ) external;

    function increaseQuestObjective(
        uint256 questID,
        uint256 newObjective,
        uint256 addedRewardAmount,
        uint256 feeAmount
    ) external;

    function emergencyWithdraw(uint256 questID, address recipient) external;

    function addToBlacklist(uint256 questID, address account) external;

    function addMultipleToBlacklist(uint256 questID, address[] calldata accounts) external;

    function removeFromBlacklist(uint256 questID, address account) external;
}
