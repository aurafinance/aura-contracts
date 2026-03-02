// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";
import { KeeperRole } from "../peripheral/KeeperRole.sol";
import { IStakeDaoCampaignRemoteManager } from "../interfaces/IStakeDaoCampaignRemoteManager.sol";
import { ISafe } from "./ISafe.sol";
import { Module } from "./Module.sol";

/**
 * @author Aura Finance
 * @notice Module to create StakeDAO campaigns through a Safe
 */
contract StakeDaoCampaignModule is Module, KeeperRole, ReentrancyGuard {
    /** @notice Epoch duration used for duplicate protection per gauge. */
    uint256 public constant EPOCH_DURATION = 2 weeks;
    /** @notice Fixed destination chain id for StakeDAO remote campaign creation (Base). */
    uint256 public constant DESTINATION_CHAIN_ID = 8453;
    /** @notice Number of periods used when creating campaigns. */
    uint8 public constant NUMBER_OF_PERIODS = 2;

    /** @notice StakeDAO campaign remote manager called by the module. */
    address public immutable campaignRemoteManager;
    /** @notice Reward token used for campaign funding. */
    address public immutable rewardToken;
    /** @notice Votemarket address forwarded to StakeDAO campaign creation. */
    address public immutable votemarket;
    /** @notice Campaign manager address injected in campaign params. */
    address public campaignManager;

    /**
     * @notice Per-gauge controlled limits and metadata.
     * @param chainId Chain id where gauge exists.
     * @param maxTotalRewardAmount Maximum total reward amount allowed per call.
     */
    struct GaugeConfig {
        uint256 chainId;
        uint256 maxTotalRewardAmount;
    }

    /** @notice Configuration by gauge address. */
    mapping(address => GaugeConfig) public gaugeConfigs;
    /** @notice Last executed epoch by gauge. */
    mapping(address => uint256) public gaugeLastExecutedEpoch;

    /** @notice Emitted when campaign manager is updated. */
    event SetCampaignManager(address campaignManager);
    /** @notice Emitted when gauge config is updated. */
    event SetGaugeConfig(address indexed gauge, uint256 chainId, uint256 maxTotalRewardAmount);
    /** @notice Emitted when campaign is created through the module. */
    event CampaignCreated(uint256 indexed epoch, address indexed gauge, uint256 totalRewardAmount, uint256 value);

    /**
     * @notice Input payload for campaign creation.
     * @param gauge Target gauge.
     * @param totalRewardAmount Total reward amount for campaign.
     * @param addresses Additional addresses list forwarded to StakeDAO.
     * @param maxRewardPerVote Max reward per vote.
     * @param additionalGasLimit Additional gas limit for remote execution.
     * @param hook Hook address forwarded to StakeDAO.
     * @param isWhitelist Whether addresses should be treated as whitelist.
     */
    struct CampaignInput {
        address gauge;
        uint256 totalRewardAmount;
        address[] addresses;
        uint256 maxRewardPerVote;
        uint256 additionalGasLimit;
        address hook;
        bool isWhitelist;
    }

    constructor(
        address _owner,
        address _safeWallet,
        address _campaignRemoteManager,
        address _rewardToken,
        address _votemarket,
        address _campaignManager
    ) KeeperRole(_owner) Module(_safeWallet) {
        require(_campaignRemoteManager != address(0), "!campaignRemoteManager");
        require(_rewardToken != address(0), "!rewardToken");
        require(_votemarket != address(0), "!votemarket");
        require(_campaignManager != address(0), "!campaignManager");
        campaignRemoteManager = _campaignRemoteManager;
        rewardToken = _rewardToken;
        votemarket = _votemarket;
        campaignManager = _campaignManager;
    }

    /**
     * @notice Sets gauge configuration.
     * @param _gauge Gauge address.
     * @param _chainId Gauge chain id.
     * @param _maxTotalRewardAmount Max total campaign reward for gauge.
     */
    function setGaugeConfig(
        address _gauge,
        uint256 _chainId,
        uint256 _maxTotalRewardAmount
    ) external onlyOwner {
        require(_gauge != address(0), "!gauge");
        require(_maxTotalRewardAmount > 0, "!maxAmount");
        gaugeConfigs[_gauge] = GaugeConfig({ chainId: _chainId, maxTotalRewardAmount: _maxTotalRewardAmount });
        emit SetGaugeConfig(_gauge, _chainId, _maxTotalRewardAmount);
    }

    /**
     * @notice Updates campaign manager.
     * @param _campaignManager New campaign manager address.
     */
    function setCampaignManager(address _campaignManager) external onlyOwner {
        require(_campaignManager != address(0), "!campaignManager");
        campaignManager = _campaignManager;
        emit SetCampaignManager(_campaignManager);
    }

    /**
     * @notice Creates a StakeDAO campaign through the Safe module.
     * @dev Enforces one execution per gauge per epoch.
     * @param campaign Campaign input params.
     * @param nativeValue Native token amount sent with remote call.
     * @return True when execution succeeds.
     */
    function createCampaign(CampaignInput calldata campaign, uint256 nativeValue)
        external
        onlyKeeper
        nonReentrant
        returns (bool)
    {
        require(campaign.maxRewardPerVote > 0, "!maxRewardPerVote");
        require(campaign.additionalGasLimit > 0, "!additionalGasLimit");

        GaugeConfig memory gaugeConfig = gaugeConfigs[campaign.gauge];
        uint256 maxTotalRewardAmount = gaugeConfig.maxTotalRewardAmount;
        require(maxTotalRewardAmount > 0, "!gauge");
        require(campaign.totalRewardAmount <= maxTotalRewardAmount, "!maxAmount");

        IStakeDaoCampaignRemoteManager.CampaignCreationParams memory params = IStakeDaoCampaignRemoteManager
            .CampaignCreationParams({
                chainId: gaugeConfig.chainId,
                gauge: campaign.gauge,
                manager: campaignManager,
                rewardToken: rewardToken,
                numberOfPeriods: NUMBER_OF_PERIODS,
                maxRewardPerVote: campaign.maxRewardPerVote,
                totalRewardAmount: campaign.totalRewardAmount,
                addresses: campaign.addresses,
                hook: campaign.hook,
                isWhitelist: campaign.isWhitelist
            });

        uint256 currentEpoch = getCurrentEpoch();

        require(gaugeLastExecutedEpoch[campaign.gauge] != currentEpoch, "!epoch");
        gaugeLastExecutedEpoch[campaign.gauge] = currentEpoch;

        _safeApprove(rewardToken, campaignRemoteManager, campaign.totalRewardAmount);

        bytes memory data = abi.encodeWithSelector(
            IStakeDaoCampaignRemoteManager.createCampaign.selector,
            params,
            DESTINATION_CHAIN_ID,
            campaign.additionalGasLimit,
            votemarket
        );
        bool success = _execCallFromModuleWithValue(campaignRemoteManager, nativeValue, data);
        require(success, "!exec");

        emit CampaignCreated(currentEpoch, campaign.gauge, campaign.totalRewardAmount, nativeValue);
        return true;
    }

    /**
     * @notice Resets and sets allowance via the Safe.
     * @param token Token to approve.
     * @param spender Spender address.
     * @param amount Amount to approve.
     */
    function _safeApprove(
        address token,
        address spender,
        uint256 amount
    ) internal {
        _execCallFromModule(token, abi.encodeWithSignature("approve(address,uint256)", spender, 0));
        _execCallFromModule(token, abi.encodeWithSignature("approve(address,uint256)", spender, amount));
    }

    /**
     * @notice Executes a Safe module call with value.
     * @param to Destination contract.
     * @param value Native value to send.
     * @param data Calldata payload.
     * @return success True when Safe module execution succeeds.
     */
    function _execCallFromModuleWithValue(
        address to,
        uint256 value,
        bytes memory data
    ) internal returns (bool success) {
        ISafe safe = ISafe(payable(safeWallet));
        success = safe.execTransactionFromModule({ to: to, value: value, data: data, operation: ISafe.Operation.Call });
    }

    /**
     * @notice Returns current epoch derived from block timestamp.
     * @return Current epoch index.
     */
    function getCurrentEpoch() public view returns (uint256) {
        return block.timestamp / EPOCH_DURATION;
    }
}
