// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { AuraMath } from "../utils/AuraMath.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { Address } from "@openzeppelin/contracts-0.8/utils/Address.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IRewardStaking } from "../interfaces/IRewardStaking.sol";

/**
 * @title AuraBaseRewardPool
 */
contract AuraBaseRewardPool {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    // ----------------------------------------------------------------
    // Storage
    // ----------------------------------------------------------------

    IERC20 public immutable rewardToken;
    IERC20 public immutable stakingToken;
    uint256 public constant duration = 7 days;

    address public immutable rewardManager;

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

    address[] public extraRewards;

    // ----------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event Transfer(address indexed from, address indexed to, uint256 value);

    // ----------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // ----------------------------------------------------------------
    // Constructor
    // ----------------------------------------------------------------

    /**
     * @dev This is called directly from RewardFactory
     * @param stakingToken_  Pool LP token
     * @param rewardToken_   Crv
     * @param rewardManager_ RewardFactory
     */
    constructor(
        address stakingToken_,
        address rewardToken_,
        address rewardManager_
    ) public {
        stakingToken = IERC20(stakingToken_);
        rewardToken = IERC20(rewardToken_);
        rewardManager = rewardManager_;
    }

    // ----------------------------------------------------------------
    // Internals
    // ----------------------------------------------------------------

    function totalSupply() public view virtual returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view virtual returns (uint256) {
        return _balances[account];
    }

    function extraRewardsLength() external view returns (uint256) {
        return extraRewards.length;
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

    // ----------------------------------------------------------------
    // Extra Rewards
    // ----------------------------------------------------------------

    function addExtraReward(address _reward) external returns (bool) {
        require(msg.sender == rewardManager, "!authorized");
        require(_reward != address(0), "!reward setting");

        if (extraRewards.length >= 12) {
            return false;
        }

        extraRewards.push(_reward);
        return true;
    }

    function clearExtraRewards() external {
        require(msg.sender == rewardManager, "!authorized");
        delete extraRewards;
    }

    // ----------------------------------------------------------------
    // Mutate
    // ----------------------------------------------------------------

    function stake(uint256 _amount) public returns (bool) {
        require(_amount > 0, "RewardPool : Cannot stake 0");

        //also stake to linked rewards
        for (uint256 i = 0; i < extraRewards.length; i++) {
            IRewardStaking(extraRewards[i]).stake(msg.sender, _amount);
        }

        _totalSupply = _totalSupply.add(_amount);
        _balances[msg.sender] = _balances[msg.sender].add(_amount);

        emit Transfer(address(0), msg.sender, _amount);

        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);
        _afterTransferStake(msg.sender, _amount);

        emit Staked(msg.sender, _amount);

        return true;
    }

    function stakeAll() external returns (bool) {
        uint256 balance = stakingToken.balanceOf(msg.sender);
        stake(balance);
        return true;
    }

    function withdraw(uint256 amount, bool claim) public updateReward(msg.sender) returns (bool) {
        require(amount > 0, "RewardPool : Cannot withdraw 0");

        //also withdraw from linked rewards
        for (uint256 i = 0; i < extraRewards.length; i++) {
            IRewardStaking(extraRewards[i]).withdraw(msg.sender, amount);
        }

        _totalSupply = _totalSupply.sub(amount);
        _balances[msg.sender] = _balances[msg.sender].sub(amount);

        _beforeTransferWithdraw(msg.sender, amount);
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);

        if (claim) {
            getReward(msg.sender, true);
        }

        emit Transfer(msg.sender, address(0), amount);

        return true;
    }

    function withdrawAll(bool claim) external {
        withdraw(_balances[msg.sender], claim);
    }

    /**
     * @dev Gives a staker their rewards, with the option of claiming extra rewards
     * @param _account     Account for which to claim
     * @param _claimExtras Get the child rewards too?
     */
    function getReward(address _account, bool _claimExtras) public updateReward(_account) returns (bool) {
        uint256 reward = earned(_account);
        if (reward > 0) {
            rewards[_account] = 0;
            _beforeTransferRewards(_account, reward);
            rewardToken.safeTransfer(_account, reward);
            emit RewardPaid(_account, reward);
        }

        //also get rewards from linked rewards
        if (_claimExtras) {
            for (uint256 i = 0; i < extraRewards.length; i++) {
                IRewardStaking(extraRewards[i]).getReward(_account);
            }
        }
        return true;
    }

    /**
     * @dev Called by a staker to get their allocated rewards
     */
    function getReward() external returns (bool) {
        getReward(msg.sender, true);
        return true;
    }

    /**
     * @dev Processes queued rewards in isolation, providing the period has finished.
     *      This allows a cheaper way to trigger rewards on low value pools.
     */
    function processIdleRewards() external {
        if (block.timestamp >= periodFinish && queuedRewards > 0) {
            _notifyRewardAmount(queuedRewards);
            queuedRewards = 0;
        }
    }

    // ----------------------------------------------------------------
    // Internals
    // ----------------------------------------------------------------

    /**
     * @dev Called by the booster to allocate new Crv rewards to this pool
     *      Curve is queued for rewards and the distribution only begins once the new rewards are sufficiently
     *      large, or the epoch has ended.
     */
    function _queueNewRewards(uint256 _rewards) internal returns (bool) {
        _rewards = _rewards.add(queuedRewards);

        if (block.timestamp >= periodFinish) {
            _notifyRewardAmount(_rewards);
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
            _notifyRewardAmount(_rewards);
            queuedRewards = 0;
        } else {
            queuedRewards = _rewards;
        }
        return true;
    }

    function _notifyRewardAmount(uint256 reward) internal updateReward(address(0)) {
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

    function _beforeTransferRewards(address to, uint256 amount) internal virtual {}

    function _beforeTransferWithdraw(address to, uint256 amount) internal virtual {}

    function _afterTransferStake(address from, uint256 amount) internal virtual {}
}
