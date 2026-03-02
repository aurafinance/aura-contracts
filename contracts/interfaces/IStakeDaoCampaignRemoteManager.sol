// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IStakeDaoCampaignRemoteManager {
    struct CampaignCreationParams {
        uint256 chainId;
        address gauge;
        address manager;
        address rewardToken;
        uint8 numberOfPeriods;
        uint256 maxRewardPerVote;
        uint256 totalRewardAmount;
        address[] addresses;
        address hook;
        bool isWhitelist;
    }

    function createCampaign(
        CampaignCreationParams calldata params,
        uint256 destinationChainId,
        uint256 additionalGasLimit,
        address votemarket
    ) external payable;
}
