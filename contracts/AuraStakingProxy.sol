// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

import "@openzeppelin/contracts-0.8/utils/Address.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-0.8/utils/math/SafeMath.sol";

interface ICvxLocker {
    function queueNewRewards(uint256 _rewards) external;

    function notifyRewardAmount(address _rewardsToken, uint256 reward) external;
}

interface ICrvDepositor {
    function getMinOut(uint256) external view returns (uint256);

    function deposit(
        uint256,
        uint256,
        bool
    ) external;
}

/**
 * @title   AuraStakingProxy
 * @author  ConvexFinance and Aura
 * @notice  Receives CRV from the Booster as overall reward, then distributes to vlCVX holders. Also
 *          acts as a depositor proxy to support deposit/withdrawals from the CVX staking contract.
 * @dev     From CVX:
 *           - receive tokens to stake
 *           - get current staked balance
 *           - withdraw staked tokens
 *           - send rewards back to owner(cvx locker)
 *           - register token types that can be distributed
 */
contract AuraStakingProxy {
    using SafeERC20 for IERC20;
    using Address for address;
    using SafeMath for uint256;

    //tokens
    address public immutable crv;
    address public immutable cvx;
    address public immutable cvxCrv;

    //convex addresses
    address public immutable cvxCrvStaking;
    address public crvDepositorWrapper;
    uint256 public constant denominator = 10000;

    address public rewards;

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
     * @param _cvxCrvStaking BaseRewardPool for cvxCRV staking
     * @param _crvDepositorWrapper    Wrapper that converts CRV to CRVBPT and deposits
     */
    constructor(
        address _rewards,
        address _crv,
        address _cvx,
        address _cvxCrv,
        address _cvxCrvStaking,
        address _crvDepositorWrapper
    ) {
        rewards = _rewards;
        owner = msg.sender;
        crv = _crv;
        cvx = _cvx;
        cvxCrv = _cvxCrv;
        cvxCrvStaking = _cvxCrvStaking;
        crvDepositorWrapper = _crvDepositorWrapper;
    }

    function setCrvDepositorWrapper(address _crvDepositorWrapper) external {
        require(msg.sender == owner, "!auth");
        crvDepositorWrapper = _crvDepositorWrapper;
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

    function setRewards(address _rewards) external {
        require(msg.sender == owner, "!auth");
        rewards = _rewards;
    }

    function setApprovals() external {
        IERC20(crv).safeApprove(crvDepositorWrapper, 0);
        IERC20(crv).safeApprove(crvDepositorWrapper, type(uint256).max);

        IERC20(cvxCrv).safeApprove(rewards, 0);
        IERC20(cvxCrv).safeApprove(rewards, type(uint256).max);
    }

    function rescueToken(address _token, address _to) external {
        require(msg.sender == owner, "!auth");
        require(_token != crv && _token != cvx && _token != cvxCrv, "not allowed");

        uint256 bal = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(_to, bal);
    }

    /**
     * @dev Collects cvxCRV rewards from cvxRewardPool, converts any CRV deposited directly from
     *      the booster, and then applies the rewards to the cvxLocker, rewarding the caller in the process.
     */
    function distribute() external {
        //convert crv to cvxCrv
        uint256 crvBal = IERC20(crv).balanceOf(address(this));
        if (crvBal > 0) {
            uint256 minOut = ICrvDepositor(crvDepositorWrapper).getMinOut(crvBal);
            ICrvDepositor(crvDepositorWrapper).deposit(crvBal, minOut, true);
        }

        //distribute cvxcrv
        uint256 cvxCrvBal = IERC20(cvxCrv).balanceOf(address(this));

        if (cvxCrvBal > 0) {
            uint256 incentiveAmount = cvxCrvBal.mul(callIncentive).div(denominator);
            cvxCrvBal = cvxCrvBal.sub(incentiveAmount);

            //send incentives
            IERC20(cvxCrv).safeTransfer(msg.sender, incentiveAmount);

            //update rewards
            ICvxLocker(rewards).queueNewRewards(cvxCrvBal);

            emit RewardsDistributed(cvxCrv, cvxCrvBal);
        }
    }

    //in case a new reward is ever added, allow generic distribution
    function distributeOther(IERC20 _token) external {
        require(address(_token) != crv && address(_token) != cvxCrv, "not allowed");

        uint256 bal = _token.balanceOf(address(this));

        if (bal > 0) {
            uint256 incentiveAmount = bal.mul(callIncentive).div(denominator);
            bal = bal.sub(incentiveAmount);

            //send incentives
            _token.safeTransfer(msg.sender, incentiveAmount);

            //approve
            _token.safeApprove(rewards, 0);
            _token.safeApprove(rewards, type(uint256).max);

            //update rewards
            ICvxLocker(rewards).notifyRewardAmount(address(_token), bal);

            emit RewardsDistributed(address(_token), bal);
        }
    }
}
