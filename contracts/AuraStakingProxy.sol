// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./interfaces/ICrvDepositor.sol";
import "@openzeppelin/contracts-0.6/utils/Address.sol";
import "@openzeppelin/contracts-0.6/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.6/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-0.6/math/SafeMath.sol";



interface IConvexRewards {
    function withdraw(uint256 _amount, bool _claim) external;

    function balanceOf(address _account) external view returns(uint256);

    function getReward(bool _stake) external;

    function stakeAll() external;
}

interface ICvxLocker {
    function notifyRewardAmount(address _rewardsToken, uint256 reward) external;
}


/**
 * @title   CvxStakingProxy
 * @author  ConvexFinance
 * @notice  Receives CRV from the Booster as overall reward, then distributes to vlCVX holders. Also
 *          acts as a depositor proxy to support deposit/withdrawals from the CVX staking contract. 
 * @dev     From CVX:
 *           - receive tokens to stake
 *           - get current staked balance
 *           - withdraw staked tokens
 *           - send rewards back to owner(cvx locker)
 *           - register token types that can be distributed
 */
contract CvxStakingProxy {
    using SafeERC20
    for IERC20;
    using Address
    for address;
    using SafeMath
    for uint256;

    //tokens
    address public immutable crv;
    address public immutable cvx;
    address public immutable cvxCrv;

    //convex addresses
    address public immutable cvxStaking;
    address public immutable cvxCrvStaking;
    address public immutable crvDeposit;
    uint256 public constant denominator = 10000;

    address public immutable rewards;

    address public owner;
    address public pendingOwner;
    uint256 public callIncentive = 25;

    event RewardsDistributed(address indexed token, uint256 amount);

    /* ========== CONSTRUCTOR ========== */

    /**
     * @param _rewards       vlCVX
     * @param _crv           CRV token
     * @param _cvx           CVX token
     * @param _cvxCrv        cvxCRV token
     * @param _cvxStaking    cvxRewardPool
     * @param _cvxCrvStaking BaseRewardPool for cvxCRV staking
     * @param _crvDeposit    crvDepositor
     */
    constructor(
        address _rewards,
        address _crv,
        address _cvx,
        address _cvxCrv,
        address _cvxStaking,
        address _cvxCrvStaking,
        address _crvDeposit
    ) public {
        rewards = _rewards;
        owner = msg.sender;
        crv = _crv;
        cvx = _cvx;
        cvxCrv = _cvxCrv;
        cvxStaking = _cvxStaking;
        cvxCrvStaking = _cvxCrvStaking;
        crvDeposit = _crvDeposit;
    }

    function setPendingOwner(address _po) external {
        require(msg.sender == owner, "!auth");
        pendingOwner = _po;
    }

    function applyPendingOwner() external {
        require(msg.sender == owner, "!auth");
        require(pendingOwner != address(0), "invalid owner");

        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function setCallIncentive(uint256 _incentive) external {
        require(msg.sender == owner, "!auth");
        require(_incentive <= 100, "too high");
        callIncentive = _incentive;
    }

    function setApprovals() external {
        IERC20(cvx).safeApprove(cvxStaking, 0);
        IERC20(cvx).safeApprove(cvxStaking, uint256(-1));

        IERC20(crv).safeApprove(crvDeposit, 0);
        IERC20(crv).safeApprove(crvDeposit, uint256(-1));

        IERC20(cvxCrv).safeApprove(rewards, 0);
        IERC20(cvxCrv).safeApprove(rewards, uint256(-1));
    }

    function rescueToken(address _token, address _to) external {
        require(msg.sender == owner, "!auth");
        require(_token != crv && _token != cvx && _token != cvxCrv, "not allowed");

        uint256 bal = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(_to, bal);
    }

    function getBalance() external view returns(uint256) {
        return IConvexRewards(cvxStaking).balanceOf(address(this));
    }

    function withdraw(uint256 _amount) external {
        require(msg.sender == rewards, "!auth");

        //unstake
        IConvexRewards(cvxStaking).withdraw(_amount, false);

        //withdraw cvx
        IERC20(cvx).safeTransfer(msg.sender, _amount);
    }


    function stake() external {
        require(msg.sender == rewards, "!auth");

        IConvexRewards(cvxStaking).stakeAll();
    }

    /**
    * @dev Collects cvxCRV rewards from cvxRewardPool, converts any CRV deposited directly from
    *      the booster, and then applies the rewards to the cvxLocker, rewarding the caller in the process.
    */
    function distribute() external {
        //claim rewards
        IConvexRewards(cvxStaking).getReward(false);

        //convert any crv that was directly added
        uint256 crvBal = IERC20(crv).balanceOf(address(this));
        if (crvBal > 0) {
            ICrvDepositor(crvDeposit).deposit(crvBal, true);
        }

        //make sure nothing is in here
        uint256 sCheck  = IConvexRewards(cvxCrvStaking).balanceOf(address(this));
        if(sCheck > 0){
            IConvexRewards(cvxCrvStaking).withdraw(sCheck,false);
        }

        //distribute cvxcrv
        uint256 cvxCrvBal = IERC20(cvxCrv).balanceOf(address(this));

        if (cvxCrvBal > 0) {
            uint256 incentiveAmount = cvxCrvBal.mul(callIncentive).div(denominator);
            cvxCrvBal = cvxCrvBal.sub(incentiveAmount);
            
            //send incentives
            IERC20(cvxCrv).safeTransfer(msg.sender,incentiveAmount);

            //update rewards
            ICvxLocker(rewards).notifyRewardAmount(cvxCrv, cvxCrvBal);

            emit RewardsDistributed(cvxCrv, cvxCrvBal);
        }
    }

    //in case a new reward is ever added, allow generic distribution
    function distributeOther(IERC20 _token) external {
        require( address(_token) != crv && address(_token) != cvxCrv, "not allowed");

        uint256 bal = _token.balanceOf(address(this));

        if (bal > 0) {
            uint256 incentiveAmount = bal.mul(callIncentive).div(denominator);
            bal = bal.sub(incentiveAmount);
            
            //send incentives
            _token.safeTransfer(msg.sender,incentiveAmount);

            //approve
            _token.safeApprove(rewards, 0);
            _token.safeApprove(rewards, uint256(-1));

            //update rewards
            ICvxLocker(rewards).notifyRewardAmount(address(_token), bal);

            emit RewardsDistributed(address(_token), bal);
        }
    }
}