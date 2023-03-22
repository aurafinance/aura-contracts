// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { AuraMath } from "../utils/AuraMath.sol";
import { ICrvDepositorWrapper } from "../interfaces/ICrvDepositorWrapper.sol";
import { IAuraLocker } from "../interfaces/IAuraLocker.sol";
import { IRewardStaking } from "../interfaces/IRewardStaking.sol";
import { IRewardPool4626 } from "../interfaces/IRewardPool4626.sol";

/**
 * @title   ClaimZap
 * @author  ConvexFinance -> AuraFinance
 * @notice  Claim zap to bundle various reward claims
 * @dev     Claims from all pools, and stakes cvxCrv and CVX if wanted.
 *          v2:
 *           - change exchange to use curve pool
 *           - add getReward(address,token) type
 *           - add option to lock cvx
 *           - add option use all funds in wallet
 *          v3:
 *           - add option to deposit to compounder
 *           - reduce calls to cvxcrv rewards/compounder
 *           - removed enum and option bitshifting
 *           - introduced options struct
 *           - gas optimisation on use all funds balances
 *           - helper functions to reduce code repetition
 */
contract AuraClaimZapV3 {
    using SafeERC20 for IERC20;
    using AuraMath for uint256;

    address public immutable crv;
    address public immutable cvx;
    address public immutable cvxCrv;
    address public immutable crvDepositWrapper;
    address public immutable cvxCrvRewards;
    address public immutable locker;
    address public immutable owner;
    address public immutable compounder;

    /**
     * @dev Claim rewards amounts.
     * - depositCrvMaxAmount    The max amount of CRV to deposit if converting to crvCvx
     * - minAmountOut           The min amount out for crv:cvxCrv swaps if swapping. Set this to zero if you
     *                          want to use CrvDepositor instead of balancer swap
     * - depositCvxMaxAmount    The max amount of CVX to deposit if locking CVX
     * - depositCvxCrvMaxAmount The max amount of CVXCVR to stake.
     */
    struct ClaimRewardsAmounts {
        uint256 depositCrvMaxAmount;
        uint256 minAmountOut;
        uint256 depositCvxMaxAmount;
        uint256 depositCvxCrvMaxAmount;
    }

    /**
     * @dev options.
     * - claimCvxCrv             Flag: claim from the cvxCrv rewards contract
     * - claimLockedCvx          Flag: claim from the cvx locker contract
     * - lockCvxCrv              Flag: pull users cvxCrvBalance ready for locking
     * - lockCrvDeposit          Flag: locks crv rewards as cvxCrv
     * - useAllWalletFunds       Flag: lock rewards and existing balance
     * - useCompounder           Flag: deposit cvxCrv into autocompounder
     * - lockCvx                 Flag: lock cvx rewards in locker
     */
    struct Options {
        bool claimCvxCrv;
        bool claimLockedCvx;
        bool lockCvxCrv;
        bool lockCrvDeposit;
        bool useAllWalletFunds;
        bool useCompounder;
        bool lockCvx;
    }

    /**
     * @param _crv                CRV token (0xD533a949740bb3306d119CC777fa900bA034cd52);
     * @param _cvx                CVX token (0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);
     * @param _cvxCrv             cvxCRV token (0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7);
     * @param _crvDepositWrapper  crvDepositWrapper (0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae);
     * @param _cvxCrvRewards      cvxCrvRewards (0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e);
     * @param _locker             vlCVX (0xD18140b4B819b895A3dba5442F959fA44994AF50);
     * @param _compounder         cvxCrv autocompounder vault
     */
    constructor(
        address _crv,
        address _cvx,
        address _cvxCrv,
        address _crvDepositWrapper,
        address _cvxCrvRewards,
        address _locker,
        address _compounder
    ) {
        crv = _crv;
        cvx = _cvx;
        cvxCrv = _cvxCrv;
        crvDepositWrapper = _crvDepositWrapper;
        cvxCrvRewards = _cvxCrvRewards;
        locker = _locker;
        owner = msg.sender;
        compounder = _compounder;
    }

    /**
     * @notice Returns meta data of contract.
     */
    function getName() external pure returns (string memory) {
        return "ClaimZap V3.0";
    }

    /**
     * @notice Approve spending of:
     *          crv     -> crvDepositor
     *          cvxCrv  -> cvxCrvRewards
     *          cvxCrv  -> Compounder
     *          cvx     -> Locker
     */
    function setApprovals() external {
        require(msg.sender == owner, "!auth");
        _approveToken(crv, crvDepositWrapper);
        _approveToken(cvxCrv, cvxCrvRewards);
        _approveToken(cvxCrv, compounder);
        _approveToken(cvx, locker);
    }

    /**
     * @notice Allows a spender to spend a token
     * @param _token     Token that will be spend
     * @param _spender   Address that will be spending
     */
    function _approveToken(address _token, address _spender) internal {
        IERC20(_token).safeApprove(address(_spender), 0);
        IERC20(_token).safeApprove(address(_spender), type(uint256).max);
    }

    /**
     * @notice Claim all the rewards
     * @param rewardContracts        Array of addresses for LP token rewards
     * @param extraRewardContracts   Array of addresses for extra rewards
     * @param tokenRewardContracts   Array of addresses for token rewards e.g vlCvxExtraRewardDistribution
     * @param tokenRewardTokens      Array of token reward addresses to use with tokenRewardContracts
     * @param amounts                Claim rewards amounts.
     * @param options                Claim options
     */
    function claimRewards(
        address[] calldata rewardContracts,
        address[] calldata extraRewardContracts,
        address[] calldata tokenRewardContracts,
        address[] calldata tokenRewardTokens,
        ClaimRewardsAmounts calldata amounts,
        Options calldata options
    ) external {
        require(tokenRewardContracts.length == tokenRewardTokens.length, "!parity");

        //Read balances prior to reward claims only if required
        uint256 crvBalance;
        uint256 cvxBalance;
        uint256 cvxCrvBalance;
        if (!options.useAllWalletFunds && _callRelockRewards(options)) {
            crvBalance = IERC20(crv).balanceOf(msg.sender);
            cvxBalance = IERC20(cvx).balanceOf(msg.sender);
            cvxCrvBalance = IERC20(cvxCrv).balanceOf(msg.sender);
        }

        //claim from main curve LP pools
        for (uint256 i = 0; i < rewardContracts.length; i++) {
            IRewardStaking(rewardContracts[i]).getReward(msg.sender, true);
        }
        //claim from extra rewards
        for (uint256 i = 0; i < extraRewardContracts.length; i++) {
            IRewardStaking(extraRewardContracts[i]).getReward(msg.sender);
        }
        //claim from multi reward token contract
        for (uint256 i = 0; i < tokenRewardContracts.length; i++) {
            IRewardStaking(tokenRewardContracts[i]).getReward(msg.sender, tokenRewardTokens[i]);
        }

        //claim from cvxCrv rewards
        if (options.claimCvxCrv) {
            IRewardStaking(cvxCrvRewards).getReward(msg.sender, true);
        }

        //claim from locker
        if (options.claimLockedCvx) {
            IAuraLocker(locker).getReward(msg.sender);
        }

        // deposit/lock/stake
        if (_callRelockRewards(options)) {
            _relockRewards(crvBalance, cvxBalance, cvxCrvBalance, amounts, options);
        }
    }

    /**
     * @notice returns a bool if relocking of rewards should occur
     * @param options                Claim options
     */
    function _callRelockRewards(Options calldata options) internal view returns (bool) {
        return (options.lockCvxCrv || options.lockCrvDeposit || options.useCompounder || options.lockCvx);
    }

    /**
     * @notice  Claim additional rewards from:
     *          - cvxCrvRewards
     *          - cvxLocker
     * @param removeCrvBalance       crvBalance to ignore and not redeposit (starting Crv balance)
     * @param removeCvxBalance       cvxBalance to ignore and not redeposit (starting Cvx balance)
     * @param removeCvxCrvBalance    cvxcrvBalance to ignore and not redeposit (starting CvxCrv balance)
     * @param amounts                Claim rewards amoutns.
     * @param options                see claimRewards
     */
    // prettier-ignore
    function _relockRewards( // solhint-disable-line 
        uint256 removeCrvBalance,
        uint256 removeCvxBalance,
        uint256 removeCvxCrvBalance,          
        ClaimRewardsAmounts calldata amounts, 
        Options calldata options
    ) internal {
        
        //lock upto given amount of crv as cvxCrv
        if (amounts.depositCrvMaxAmount > 0) {
            (uint256 crvBalance, bool continued) = _checkBalanceAndPullToken(
                crv,
                removeCrvBalance, 
                amounts.depositCrvMaxAmount
            );

            if (continued) {ICrvDepositorWrapper(crvDepositWrapper).deposit(
                    crvBalance,
                    amounts.minAmountOut,
                    options.lockCrvDeposit,
                    address(0)
                );}
        }

        
        //Pull cvxCrv to contract if user wants to stake
        if (options.lockCvxCrv) {
            _checkBalanceAndPullToken(cvxCrv, removeCvxCrvBalance, amounts.depositCvxCrvMaxAmount);
        }
        

        //Locks CvxCrv balance held on contract
        //deposit in the autocompounder if flag is set, or stake in rewards contract if not set
        uint cvxCrvBalanceToLock = IERC20(cvxCrv).balanceOf(address(this));
        if(cvxCrvBalanceToLock > 0){
            if(options.useCompounder) {
                IRewardPool4626(compounder).deposit(cvxCrvBalanceToLock, msg.sender);
            }
            else{
                IRewardStaking(cvxCrvRewards).stakeFor(msg.sender, cvxCrvBalanceToLock);
            }   
        }

        //stake up to given amount of cvx
        if (options.lockCvx) {
            (uint256 cvxBalance, bool continued) = _checkBalanceAndPullToken(
                cvx, 
                removeCvxBalance, 
                amounts.depositCvxMaxAmount
            );
            if(continued){IAuraLocker(locker).lock(msg.sender, cvxBalance);}
        }
    }

    /**
     * @notice  Calculates the amount of a token to pull in, if this is above 0 then pulls token
     * @param _token                 the token to evaluate and pull
     * @param _removeAmount          quantity of token to ignore and not redeposit (ie starting balance)
     * @param _maxAmount             the maximum amount of a token
     */
    // prettier-ignore
    function _checkBalanceAndPullToken(
        address _token,
        uint256 _removeAmount,
        uint256 _maxAmount
    ) internal returns (uint256 _balance, bool continued) {
        _balance = IERC20(_token).balanceOf(msg.sender).sub(_removeAmount);
        _balance = AuraMath.min(_balance, _maxAmount);
        if (_balance > 0) {
            IERC20(_token).safeTransferFrom(msg.sender, address(this), _balance);
            continued = true;
        }
    }
}
