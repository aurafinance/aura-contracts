// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { AuraMath } from "../utils/AuraMath.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IDarkQuestBoard } from "../interfaces/IDarkQuestBoard.sol";

/**
 * @title   WardQuestScheduler
 * @notice     Creates wards Quests  and withdraws incentives from Closed Quests.
 * @dev  The complete flow from quest to stash takes 4 epochs:
 *
 *  1.- Owner at epoch N creates a quest with duration of 2 epochs.
 *  2.- Owner at epoch N+3 withdraws undistributed rewards and queues them for epochs (N+3, N+4).
 *  3.- Anyone at epoch N+3 forwards queued rewards for a given stash.
 *  4.- Anyone at epoch N+4 forwards queued rewards for a given stash.
 */
contract WardQuestScheduler is Ownable {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    /** @notice Duration of each epoch  */
    uint256 public constant epochDuration = 7 days;
    /** @notice Total number of epochs for the Quest  */
    uint48 public constant duration = 2;
    /** @notice Address of the ERC20 used for rewards  */
    address public immutable cvx;
    /** @notice Address  Ward Dark Quest Board */
    address public immutable darkQuestBoard;

    /** @notice List of Quest questId => stash */
    mapping(uint256 => Quest) public quests;

    /** @notice List of queued rewards (epoch => stash => amount) */
    mapping(uint256 => mapping(address => uint256)) public rewardsQueue;

    /** @notice Struct holding the parameters of the Quest common for all periods */
    struct Quest {
        // Address of the ERC20 used for rewards
        address stash;
        // Epoch for the quest.
        uint256 epoch;
        // Total amount of rewards paid for this Quest
        uint256 totalRewardAmount;
    }

    /** @notice Event emitted when rewards are queued  */
    event QueuedRewards(address stash, uint256 epoch, uint256 rewardAmount);
    /** @notice Event emitted when rewards are queued  */
    event ForwardedRewards(address stash, uint256 epoch, uint256 rewardAmount);

    /**
     * @param _cvx  Cvx token contract
     * @param _darkQuestBoard  Dark Quest Board
     * @param _dao  Multisig address , the owner of the contract.
     */
    constructor(
        address _cvx,
        address _darkQuestBoard,
        address _dao
    ) Ownable() {
        cvx = _cvx;
        darkQuestBoard = _darkQuestBoard;
        _transferOwnership(_dao);
    }

    /**
     * @notice Creates a new Quest at a predefined duration (2 epochs).
     * @dev Creates a new Quest struct, and QuestPeriods for the Quest duration
     * @param stash Address of the Stash linked to this Quest.
     * @param gauge Address of the Gauge targeted by the Quest
     * @param objective Target bias to reach (equivalent to amount of veCRV in wei to reach)
     * @param rewardPerVote Amount of reward per veCRV (in wei)
     * @param totalRewardAmount Total amount of rewards for the whole Quest (in wei)
     * @param feeAmount Paladin platform fees amount (in wei)
     * @return questID : ID of the newly created Quest
     */
    function createQuest(
        address stash,
        address gauge,
        uint256 objective,
        uint256 rewardPerVote,
        uint256 totalRewardAmount,
        uint256 feeAmount,
        address[] calldata blacklist
    ) external returns (uint256 questID) {
        require(stash != address(0), "!stash");
        // Pull all the rewards + fee in this contract
        IERC20(cvx).safeTransferFrom(msg.sender, address(this), totalRewardAmount.add(feeAmount));

        questID = IDarkQuestBoard(darkQuestBoard).createQuest(
            gauge,
            cvx,
            duration,
            objective,
            rewardPerVote,
            totalRewardAmount,
            feeAmount,
            blacklist
        );
        quests[questID].stash = stash;
    }

    /**
     * @notice Withdraw all undistributed rewards from Closed Quest Periods and queues them to it's linked stash.
     * @param questID ID of the Quest
     */
    function withdrawAndQueueUnusedRewards(uint256 questID) external returns (uint256 amount) {
        address stash = quests[questID].stash;
        require(stash != address(0), "!questID");

        uint256 balanceBefore = IERC20(cvx).balanceOf(address(this));
        IDarkQuestBoard(darkQuestBoard).withdrawUnusedRewards(questID, address(this));
        uint256 balanceAfter = IERC20(cvx).balanceOf(address(this));
        amount = balanceAfter.sub(balanceBefore);
        require(amount > 0, "!amount");

        _queueRewards(stash, duration, amount);
    }

    /**
     * @notice Emergency withdraws all undistributed rewards from Closed Quest Periods & all rewards for Active Periods
     * @dev Emergency withdraws all undistributed rewards from Closed Quest Periods & all rewards for Active Periods
     * @param questID ID of the Quest
     */
    function emergencyWithdraw(uint256 questID) external {
        address stash = quests[questID].stash;
        require(stash != address(0), "!questID");
        IDarkQuestBoard(darkQuestBoard).emergencyWithdraw(questID, owner());
    }

    //allow arbitrary calls to any contract to allow to manage the created quest.
    function execute(
        address _to,
        uint256 _value,
        bytes memory _data
    ) external onlyOwner returns (bool, bytes memory) {
        require(_to != darkQuestBoard, "!invalid target");
        bytes4 sig;
        assembly {
            sig := mload(add(_data, 32))
        }

        require(
            sig != IDarkQuestBoard.createQuest.selector &&
                sig != IDarkQuestBoard.withdrawUnusedRewards.selector &&
                sig != IDarkQuestBoard.emergencyWithdraw.selector,
            "!allowed"
        );

        (bool success, bytes memory result) = _to.call{ value: _value }(_data);

        return (success, result);
    }

    /**
     * @dev Forward rewards available at current epoch
     * @param _stash the stash to forward its queued rewards
     */
    function forwardRewards(address _stash) external {
        uint256 epoch = _getCurrentEpoch();
        _forwardRewards(_stash, epoch);
    }

    /**
     * @dev Forward rewards available
     * @param _stash the stash to forward its queued rewards
     * @param _epoch the epoch in which the rewards were queded
     */
    function forwardQueuedRewards(address _stash, uint256 _epoch) external {
        _forwardRewards(_stash, _epoch);
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
     * @dev Queue rewards to a stash, it splits the rewards evenly by the number of epochs provided.
     * It reverts if an epoch already has some queued rewards.
     * @param _stash the extra reward stash to queue the rewards to.
     * @param _nEpochs Number of epochs to split the rewards
     * @param _amount Amount of rewards.
     */
    function _queueRewards(
        address _stash,
        uint256 _nEpochs,
        uint256 _amount
    ) internal {
        uint256 rewardAmount = _amount.div(_nEpochs);
        uint256 epoch = _getCurrentEpoch();
        for (uint256 i = 0; i < _nEpochs; i++) {
            rewardsQueue[epoch][_stash] += rewardAmount;
            emit QueuedRewards(_stash, epoch, rewardAmount);
            epoch++;
        }
    }

    function _forwardRewards(address _stash, uint256 _epoch) internal {
        require(_epoch <= _getCurrentEpoch(), "!epoch");
        uint256 amount = rewardsQueue[_epoch][_stash];
        require(amount > 0, "!amount");
        rewardsQueue[_epoch][_stash] = 0;

        IERC20(cvx).safeTransfer(_stash, amount);
        emit ForwardedRewards(_stash, _epoch, amount);
    }
}
