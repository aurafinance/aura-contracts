// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

import "./AuraMath.sol";
import "@openzeppelin/contracts-0.8/utils/math/SafeMath.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.8/utils/Address.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
// TODO - replace this with modified v
import "./AuraLocker.sol";

/**
 * @title   AuraBalRewardPool
 * @author  Synthetix -> ConvexFinance -> Aura
 * @notice
 * @dev
 */
contract AuraBalRewardPool {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public immutable rewardToken;
    IERC20 public immutable stakingToken;
    uint256 public constant duration = 14 days;

    address public immutable rewardManager;
    AuraLocker public immutable auraLocker;
    address public immutable penaltyForwarder;

    uint256 public periodFinish = 0;
    uint256 public rewardRate = 0;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public queuedRewards = 0;
    uint256 public currentRewards = 0;
    uint256 public historicalRewards = 0;
    uint256 public constant newRewardRatio = 830;
    uint256 private _totalSupply;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) private _balances;

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    /**
     * @dev
     * @param _stakingToken  Pool LP token
     * @param _rewardToken   Crv
     * @param _rewardManager Depositor
     */
    constructor(
        address _stakingToken,
        address _rewardToken,
        address _rewardManager,
        address _auraLocker,
        address _penaltyForwarder
    ) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardManager = _rewardManager;
        // TODO - add auralocker etc
    }

    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return AuraMath.min(block.timestamp, periodFinish);
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply() == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored.add(
                lastTimeRewardApplicable().sub(lastUpdateTime).mul(rewardRate).mul(1e18).div(totalSupply())
            );
    }

    function earned(address account) public view returns (uint256) {
        return
            balanceOf(account).mul(rewardPerToken().sub(userRewardPerTokenPaid[account])).div(1e18).add(
                rewards[account]
            );
    }

    function stake(uint256 _amount) public updateReward(msg.sender) returns (bool) {
        require(_amount > 0, "RewardPool : Cannot stake 0");

        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit Staked(msg.sender, _amount);

        _totalSupply = _totalSupply.add(_amount);
        _balances[msg.sender] = _balances[msg.sender].add(_amount);

        return true;
    }

    function stakeAll() external returns (bool) {
        uint256 balance = stakingToken.balanceOf(msg.sender);
        stake(balance);
        return true;
    }

    function stakeFor(address _for, uint256 _amount) public updateReward(_for) returns (bool) {
        require(_amount > 0, "RewardPool : Cannot stake 0");

        //take away from sender
        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit Staked(_for, _amount);

        //give to _for
        _totalSupply = _totalSupply.add(_amount);
        _balances[_for] = _balances[_for].add(_amount);

        return true;
    }

    function withdraw(uint256 amount, bool claim) public updateReward(msg.sender) returns (bool) {
        require(amount > 0, "RewardPool : Cannot withdraw 0");

        _totalSupply = _totalSupply.sub(amount);
        _balances[msg.sender] = _balances[msg.sender].sub(amount);

        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);

        if (claim) {
            getReward(msg.sender);
        }

        return true;
    }

    function withdrawAll(bool claim) external {
        withdraw(_balances[msg.sender], claim);
    }

    // TODO - can't claim on behalf of other
    /**
     * @dev Gives a staker their rewards
     * @param _account     Account for which to claim
     */
    function getReward(address _account) public updateReward(_account) returns (bool) {
        uint256 reward = earned(_account);
        // TODO - add penalty
        if (reward > 0) {
            rewards[_account] = 0;
            rewardToken.safeTransfer(_account, reward);
            emit RewardPaid(_account, reward);
        }
        return true;
    }

    /**
     * @dev Called by a staker to get their allocated rewards
     */
    function getReward() external returns (bool) {
        getReward(msg.sender);
        return true;
    }

    /**
     * @dev Called by the booster to allocate new Crv rewards to this pool
     *      Curve is queued for rewards and the distribution only begins once the new rewards are sufficiently
     *      large, or the epoch has ended.
     */
    function queueNewRewards(uint256 _rewards) external returns (bool) {
        require(msg.sender == rewardManager, "!authorized");
        // TODO - make one time only
        _rewards = _rewards.add(queuedRewards);

        if (block.timestamp >= periodFinish) {
            notifyRewardAmount(_rewards);
            queuedRewards = 0;
            return true;
        }

        //et = now - (finish-duration)
        uint256 elapsedTime = block.timestamp.sub(periodFinish.sub(duration));
        //current at now: rewardRate * elapsedTime
        uint256 currentAtNow = rewardRate * elapsedTime;
        uint256 queuedRatio = currentAtNow.mul(1000).div(_rewards);

        //uint256 queuedRatio = currentRewards.mul(1000).div(_rewards);
        if (queuedRatio < newRewardRatio) {
            notifyRewardAmount(_rewards);
            queuedRewards = 0;
        } else {
            queuedRewards = _rewards;
        }
        return true;
    }

    function notifyRewardAmount(uint256 reward) internal updateReward(address(0)) {
        historicalRewards = historicalRewards.add(reward);
        if (block.timestamp >= periodFinish) {
            rewardRate = reward.div(duration);
        } else {
            uint256 remaining = periodFinish.sub(block.timestamp);
            uint256 leftover = remaining.mul(rewardRate);
            reward = reward.add(leftover);
            rewardRate = reward.div(duration);
        }
        currentRewards = reward;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp.add(duration);
        emit RewardAdded(reward);
    }
}
