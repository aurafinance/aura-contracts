// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { AuraMath } from "../utils/AuraMath.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

// prettier-ignore
interface IRewards {
    function stake(address, uint256) external;
    function stakeFor(address, uint256) external;
    function withdraw(address, uint256) external;
    function exit(address) external;
    function getReward(address) external;
    function queueNewRewards(uint256) external;
    function notifyRewardAmount(uint256) external;
    function addExtraReward(address) external;
    function extraRewardsLength() external view returns (uint256);
    function stakingToken() external view returns (address);
    function rewardToken() external view returns(address);
    function earned(address account) external view returns (uint256);
}

// prettier-ignore
interface IDeposit {
    function isShutdown() external view returns(bool);
    function balanceOf(address _account) external view returns(uint256);
    function totalSupply() external view returns(uint256);
    function poolInfo(uint256) external view returns(address,address,address,address,address, bool);
    function rewardClaimed(uint256,address,uint256) external;
    function withdrawTo(uint256,uint256,address) external;
    function claimRewards(uint256,address) external returns(bool);
    function rewardArbitrator() external returns(address);
    function setGaugeRedirect(uint256 _pid) external returns(bool);
    function owner() external returns(address);
    function deposit(uint256 _pid, uint256 _amount, bool _stake) external returns(bool);
}

/**
 * @title   BaseRewardPool
 * @author  Synthetix -> ConvexFinance -> AuraFinance
 * @notice  Unipool rewards contract that is re-deployed from rFactory for each staking pool.
 * @dev     Changes made here by ConvexFinance are to do with the delayed reward allocation. Curve is queued for
 *          rewards and the distribution only begins once the new rewards are sufficiently large, or the epoch
 *          has ended. Additionally, enables hooks for `extraRewards` that can be enabled at any point to
 *          distribute a child reward token (i.e. a secondary one from Curve, or a seperate one).
 */
// Avoid formatting this file so we can diff it against the
// original: convex-platform/contracts/contracts/BaseRewardPool.sol
// prettier-ignore
abstract contract AuraHeadlessRewardPool {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public immutable rewardToken;
    IERC20 public immutable stakingToken;
    uint256 public constant duration = 7 days;

    address public immutable operator;
    address public immutable rewardManager;

    uint256 public periodFinish = 0;
    uint256 public rewardRate = 0;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public queuedRewards = 0;
    uint256 public currentRewards = 0;
    uint256 public historicalRewards = 0;
    uint256 public constant newRewardRatio = 830;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    address[] public extraRewards;

    event RewardAdded(uint256 reward);
    event RewardPaid(address indexed user, uint256 reward);
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev This is called directly from RewardFactory
     * @param stakingToken_  Pool LP token
     * @param rewardToken_   Crv
     * @param operator_      Booster
     * @param rewardManager_ RewardFactory
     */
    constructor(
        address stakingToken_,
        address rewardToken_,
        address operator_,
        address rewardManager_
    ) {
        stakingToken = IERC20(stakingToken_);
        rewardToken = IERC20(rewardToken_);
        operator = operator_;
        rewardManager = rewardManager_;
    }

    function extraRewardsLength() external view returns (uint256) {
        return extraRewards.length;
    }

    function addExtraReward(address _reward) external returns(bool){
        require(msg.sender == rewardManager, "!authorized");
        require(_reward != address(0),"!reward setting");
        
        if(extraRewards.length >= 12){
            return false;
        }
        
        extraRewards.push(_reward);
        return true;
    }

    function clearExtraRewards() external{
        require(msg.sender == rewardManager, "!authorized");
        delete extraRewards;
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
                lastTimeRewardApplicable()
                    .sub(lastUpdateTime)
                    .mul(rewardRate)
                    .mul(1e18)
                    .div(totalSupply())
            );
    }

    function earned(address account) public view returns (uint256) {
        return
            balanceOf(account)
                .mul(rewardPerToken().sub(userRewardPerTokenPaid[account]))
                .div(1e18)
                .add(rewards[account]);
    }

    /**
     * @dev Gives a staker their rewards, with the option of claiming extra rewards
     * @param _account     Account for which to claim
     * @param _claimExtras Get the child rewards too?
     */
    function getReward(address _account, bool _claimExtras) public updateReward(_account) returns(bool){
        uint256 reward = earned(_account);
        if (reward > 0) {
            rewards[_account] = 0;
            rewardToken.safeTransfer(_account, reward);
            emit RewardPaid(_account, reward);
        }

        //also get rewards from linked rewards
        if(_claimExtras){
            for(uint i=0; i < extraRewards.length; i++){
                IRewards(extraRewards[i]).getReward(_account);
            }
        }

        _claimRewardHook(_account);
        return true;
    }

    /**
     * @dev Called by a staker to get their allocated rewards
     */
    function getReward() external returns(bool){
        getReward(msg.sender,true);
        return true;
    }

    /**
     * @dev Processes queued rewards in isolation, providing the period has finished.
     *      This allows a cheaper way to trigger rewards on low value pools.
     */
    function processIdleRewards() external {
        if (block.timestamp >= periodFinish && queuedRewards > 0) {
            notifyRewardAmount(queuedRewards);
            queuedRewards = 0;
        }
    }

    /**
     * @dev Called by the booster to allocate new Crv rewards to this pool
     *      Curve is queued for rewards and the distribution only begins once the new rewards are sufficiently
     *      large, or the epoch has ended.
     */
    function queueNewRewards(uint256 _rewards) external returns(bool){
        require(msg.sender == operator, "!authorized");
        return _queueNewRewards(_rewards);
    }
  
    /**
     * @dev See queueNewRewards
     */
    function _queueNewRewards(uint256 _rewards) internal returns(bool) {
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
        if(queuedRatio < newRewardRatio){
            notifyRewardAmount(_rewards);
            queuedRewards = 0;
        }else{
            queuedRewards = _rewards;
        }
        return true;
    }

    function notifyRewardAmount(uint256 reward)
        internal
        updateReward(address(0))
    {
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

    // ---------------------------------------------------------
    // Abstract
    // ---------------------------------------------------------

    function stake(uint256 _amount) public virtual returns(bool);

    function stakeAll() external virtual returns(bool);

    function stakeFor(address _for, uint256 _amount) public virtual returns(bool);

    function withdraw(uint256 amount, bool claim) public virtual returns(bool);

    function totalSupply() public view virtual returns (uint256);

    function balanceOf(address account) public view virtual returns (uint256);

    function _claimRewardHook(address account) internal virtual;
}
