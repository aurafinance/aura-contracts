// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { AuraMath } from "../utils/AuraMath.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { KeeperRole } from "./KeeperRole.sol";
import { IDarkQuestBoard } from "../interfaces/IDarkQuestBoard.sol";
import { IBooster } from "../interfaces/IBooster.sol";

/**
 * @title   WardenQuestScheduler
 * @author  AuraFinance
 * @notice   Creates wards Quests  and withdraws incentives from Closed Quests.
 * @dev  The complete flow from quest to stash takes 4 epochs:
 *
 *  1.- Anyone at epoch N creates a quest with duration of 2 epochs.
 *  2.- Anyone at epoch N+3 withdraws undistributed rewards and queues them for epochs (N+3, N+4).
 *  3.- Anyone at epoch N+3 forwards queued rewards for a given pid.
 *  4.- Anyone at epoch N+4 forwards queued rewards for a given pid.
 */
contract WardenQuestScheduler is KeeperRole {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    /** @notice Duration of each epoch  */
    uint256 public constant epochDuration = 7 days;
    /** @notice Total number of epochs for the Quest  */
    uint48 public constant duration = 2;
    /** @notice Address of booster */
    address public immutable booster;
    /** @notice Address of the ERC20 used for rewards  */
    address public immutable cvx;
    /** @notice Address  Ward Dark Quest Board */
    address public immutable darkQuestBoard;

    /** @notice List of Quest questId => pid */
    mapping(uint256 => uint256) public quests;

    /** @notice List of queued rewards (epoch => pid => amount) */
    mapping(uint256 => mapping(uint256 => uint256)) public rewardsQueue;

    /** @notice Event emitted when rewards are queued  */
    event QueuedRewards(uint256 epoch, uint256 pid, uint256 rewardAmount);
    /** @notice Event emitted when rewards are queued  */
    event ForwardedRewards(uint256 epoch, uint256 pid, uint256 rewardAmount);
    /** @notice Event emitted when rewards are canceled  */
    event CanceledRewards(uint256 epoch, uint256 pid, uint256 rewardAmount);

    /**
     * @param _booster Address of the booster
     * @param _cvx  Cvx token contract
     * @param _darkQuestBoard  Dark Quest Board
     * @param _owner  Multisig address , the owner of the contract.
     */
    constructor(
        address _booster,
        address _cvx,
        address _darkQuestBoard,
        address _owner
    ) KeeperRole(_owner) {
        booster = _booster;
        cvx = _cvx;
        darkQuestBoard = _darkQuestBoard;
    }

    /**
     * @notice Creates a new Quest at a predefined duration (2 epochs).
     * @dev Creates a new Quest struct, and QuestPeriods for the Quest duration
     * @param objective Target bias to reach (equivalent to amount of veCRV in wei to reach)
     * @param rewardPerVote Amount of reward per veCRV (in wei)
     * @param totalRewardAmount Total amount of rewards for the whole Quest (in wei)
     * @param feeAmount Paladin platform fees amount (in wei)
     * @return questID : ID of the newly created Quest
     */
    function createQuest(
        uint256 pid,
        uint256 objective,
        uint256 rewardPerVote,
        uint256 totalRewardAmount,
        uint256 feeAmount,
        address[] calldata blacklist
    ) external returns (uint256 questID) {
        IBooster.PoolInfo memory poolInfo = IBooster(booster).poolInfo(pid);
        require(!poolInfo.shutdown, "!shutdown");
        require(poolInfo.stash != address(0), "!stash");
        // Pull all the rewards + fee in this contract
        uint256 totalAmount = totalRewardAmount.add(feeAmount);
        IERC20(cvx).safeTransferFrom(msg.sender, address(this), totalAmount);
        IERC20(cvx).safeIncreaseAllowance(address(darkQuestBoard), totalAmount);

        questID = IDarkQuestBoard(darkQuestBoard).createQuest(
            poolInfo.gauge,
            cvx,
            duration,
            objective,
            rewardPerVote,
            totalRewardAmount,
            feeAmount,
            blacklist
        );
        quests[questID] = pid;
    }

    /**
     * @notice Withdraw all undistributed rewards from Closed Quest Periods and queues them to it's linked pid.
     * @param questID ID of the Quest
     */
    function withdrawAndQueueUnusedRewards(uint256 questID) external onlyKeeper returns (uint256 amount) {
        uint256 pid = quests[questID];
        IBooster.PoolInfo memory poolInfo = IBooster(booster).poolInfo(quests[questID]);
        require(poolInfo.stash != address(0), "!questID");

        // Validate all periods ended.
        (, , , , uint48 periodStart, ) = IDarkQuestBoard(darkQuestBoard).quests(questID);
        uint256 periodFinish = periodStart + (epochDuration * duration);

        require(block.timestamp > periodFinish, "!periodFinish");

        uint256 balanceBefore = IERC20(cvx).balanceOf(address(this));
        IDarkQuestBoard(darkQuestBoard).withdrawUnusedRewards(questID, address(this));
        uint256 balanceAfter = IERC20(cvx).balanceOf(address(this));
        amount = balanceAfter.sub(balanceBefore);
        require(amount > 0, "!amount");

        _queueRewards(pid, duration, amount);
    }

    /**
     * @notice Emergency withdraws all undistributed rewards from Closed Quest Periods & all rewards for Active Periods
     * @param questID ID of the Quest
     */
    function emergencyWithdraw(uint256 questID) external onlyOwner {
        IDarkQuestBoard(darkQuestBoard).emergencyWithdraw(questID, owner());
    }

    /**
     * @notice allow arbitrary calls to any contract to allow to manage the created quest.
     * @param _to Target address
     * @param _value Value of the call
     * @param _data call data
     */
    function execute(
        address _to,
        uint256 _value,
        bytes memory _data
    ) external onlyKeeper returns (bool, bytes memory) {
        (bool success, bytes memory result) = _to.call{ value: _value }(_data);
        require(success, "!success");

        return (success, result);
    }

    /**
     * @dev Forward rewards available at current epoch
     * @param _pid the pool id
     */
    function forwardRewards(uint256 _pid) external onlyKeeper {
        _forwardRewards(_getCurrentEpoch(), _pid);
    }

    /**
     * @dev Forward rewards available
     * @param _epoch the epoch in which the rewards were queded
     * @param _pid the pool id
     */
    function forwardQueuedRewards(uint256 _epoch, uint256 _pid) external onlyKeeper {
        _forwardRewards(_epoch, _pid);
    }

    /**
     * @dev Cancels a queued reward an retrieve the queued amount.
     * @param _epoch the epoch in which the rewards were queded
     * @param _pid the pool id
     */
    function cancelQueuedRewards(uint256 _epoch, uint256 _pid) external onlyOwner {
        uint256 amount = rewardsQueue[_epoch][_pid];
        require(amount > 0, "!amount");
        rewardsQueue[_epoch][_pid] = 0;

        IERC20(cvx).safeTransfer(owner(), amount);
        emit CanceledRewards(_epoch, _pid, amount);
    }

    /**
     * @dev Get current epoch
     */
    function getCurrentEpoch() external view returns (uint256) {
        return _getCurrentEpoch();
    }

    function _getCurrentEpoch() internal view returns (uint256) {
        return block.timestamp.div(epochDuration);
    }

    /**
     * @dev Queue rewards to a pid, it splits the rewards evenly by the number of epochs provided.
     * It reverts if an epoch already has some queued rewards.
     * @param _pid the pool id
     * @param _nEpochs Number of epochs to split the rewards
     * @param _amount Amount of rewards.
     */
    function _queueRewards(
        uint256 _pid,
        uint256 _nEpochs,
        uint256 _amount
    ) internal {
        uint256 rewardAmount = _amount.div(_nEpochs);
        uint256 epoch = _getCurrentEpoch();
        for (uint256 i = 0; i < _nEpochs; i++) {
            rewardsQueue[epoch][_pid] += rewardAmount;
            emit QueuedRewards(epoch, _pid, rewardAmount);
            epoch++;
        }
    }

    function _forwardRewards(uint256 _epoch, uint256 _pid) internal {
        require(_epoch <= _getCurrentEpoch(), "!epoch");
        uint256 amount = rewardsQueue[_epoch][_pid];
        require(amount > 0, "!amount");
        rewardsQueue[_epoch][_pid] = 0;
        IBooster.PoolInfo memory poolInfo = IBooster(booster).poolInfo(_pid);

        require(!poolInfo.shutdown, "!shutdown");
        IERC20(cvx).safeTransfer(poolInfo.stash, amount);
        emit ForwardedRewards(_epoch, _pid, amount);
    }
}
