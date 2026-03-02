// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IStakeDaoCampaignRemoteManager } from "../interfaces/IStakeDaoCampaignRemoteManager.sol";

contract MockStakeDaoCampaignRemoteManager is IStakeDaoCampaignRemoteManager {
    CampaignCreationParams public lastParams;
    uint256 public lastDestinationChainId;
    uint256 public lastAdditionalGasLimit;
    address public lastVotemarket;
    uint256 public lastValue;
    uint256 public totalCalls;

    event CampaignCreated(
        address indexed sender,
        uint256 indexed destinationChainId,
        uint256 totalRewardAmount,
        uint256 value
    );

    function createCampaign(
        CampaignCreationParams calldata params,
        uint256 destinationChainId,
        uint256 additionalGasLimit,
        address votemarket
    ) external payable {
        if (params.totalRewardAmount > 0) {
            IERC20(params.rewardToken).transferFrom(msg.sender, address(this), params.totalRewardAmount);
        }

        lastParams = params;
        lastDestinationChainId = destinationChainId;
        lastAdditionalGasLimit = additionalGasLimit;
        lastVotemarket = votemarket;
        lastValue = msg.value;
        totalCalls += 1;

        emit CampaignCreated(msg.sender, destinationChainId, params.totalRewardAmount, msg.value);
    }
}
