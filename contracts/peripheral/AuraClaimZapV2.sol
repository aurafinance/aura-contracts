// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { AuraMath } from "../utils/AuraMath.sol";
import { ICrvDepositorWrapper } from "../interfaces/ICrvDepositorWrapper.sol";
import { IAuraLocker } from "../interfaces/IAuraLocker.sol";
import { IRewardStaking } from "../interfaces/IRewardStaking.sol";
import { IZapRewardSwapHandler } from "../interfaces/IZapRewardSwapHandler.sol";

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
 */
contract AuraClaimZapV2 {
    using SafeERC20 for IERC20;
    using AuraMath for uint256;

    address public immutable crv;
    address public immutable cvx;
    address public immutable cvxCrv;
    address public immutable crvDepositWrapper;
    address public immutable cvxCrvRewards;
    address public immutable locker;
    address public immutable owner;
    address public immutable zapRewardSwapHandler;

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

    struct Options {
        bool claimCvxCrv;
        bool claimLockedCvx;
        bool claimLockedCvxStake;
        bool lockCrvDeposit;
        bool useAllWalletFunds;
        bool lockCvx;
    }

    /**
     * @param _crv                CRV token (0xD533a949740bb3306d119CC777fa900bA034cd52);
     * @param _cvx                CVX token (0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);
     * @param _cvxCrv             cvxCRV token (0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7);
     * @param _crvDepositWrapper  crvDepositWrapper (0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae);
     * @param _cvxCrvRewards      cvxCrvRewards (0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e);
     * @param _locker             vlCVX (0xD18140b4B819b895A3dba5442F959fA44994AF50);
     * @param _zapRewardSwapHandler zapRewardSwapHandler contract
     */
    constructor(
        address _crv,
        address _cvx,
        address _cvxCrv,
        address _crvDepositWrapper,
        address _cvxCrvRewards,
        address _locker,
        address _zapRewardSwapHandler
    ) {
        crv = _crv;
        cvx = _cvx;
        cvxCrv = _cvxCrv;
        crvDepositWrapper = _crvDepositWrapper;
        cvxCrvRewards = _cvxCrvRewards;
        locker = _locker;
        owner = msg.sender;
        zapRewardSwapHandler = _zapRewardSwapHandler;
    }

    function getName() external pure returns (string memory) {
        return "ClaimZap V2.1";
    }

    /**
     * @notice Approve spending of:
     *          crv     -> crvDepositor
     *          cvxCrv  -> cvxCrvRewards
     *          cvx     -> Locker
     */
    function setApprovals() external {
        require(msg.sender == owner, "!auth");

        IERC20(crv).safeApprove(crvDepositWrapper, 0);
        IERC20(crv).safeApprove(crvDepositWrapper, type(uint256).max);

        IERC20(cvxCrv).safeApprove(cvxCrvRewards, 0);
        IERC20(cvxCrv).safeApprove(cvxCrvRewards, type(uint256).max);

        IERC20(cvx).safeApprove(locker, 0);
        IERC20(cvx).safeApprove(locker, type(uint256).max);
    }

    /**
     * @notice Claim all the rewards
     * @param rewardContracts        Array of addresses for LP token rewards
     * @param extraRewardContracts   Array of addresses for extra rewards
     * @param tokenRewardContracts   Array of addresses for token rewards e.g vlCvxExtraRewardDistribution
     * @param tokenRewardTokens      Array of token reward addresses to use with tokenRewardContracts
     * @param amounts                Claim rewards amoutns.
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

        //Gas Optim: Reduce sload gas useage if reading balance isn't required
        uint256 crvBalance;
        uint256 cvxBalance;
        uint256 cvxCrvBalance;
        if (!options.useAllWalletFunds && _callExtras(options)) {
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

        // claim others/deposit/lock/stake
        if (_callExtras(options)) {
            _claimExtras(crvBalance, cvxBalance, cvxCrvBalance, amounts, options);
        }
    }

    function _callExtras(Options calldata options) internal view returns (bool) {
        return (options.claimCvxCrv ||
            options.claimLockedCvx ||
            options.claimLockedCvxStake ||
            options.lockCrvDeposit ||
            options.lockCrvDeposit ||
            options.lockCvx);
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
    function _claimExtras( // solhint-disable-line 
        uint256 removeCrvBalance,
        uint256 removeCvxBalance,
        uint256 removeCvxCrvBalance,          
        ClaimRewardsAmounts calldata amounts, 
        Options calldata options
    ) internal {

        //claim from cvxCrv rewards
        if (options.claimCvxCrv) {
            IRewardStaking(cvxCrvRewards).getReward(msg.sender, true);
        }

        //claim from locker
        if (options.claimLockedCvx) {
            IAuraLocker(locker).getReward(msg.sender);
            if (options.claimLockedCvxStake) {
                uint256 cvxCrvBalance = IERC20(cvxCrv).balanceOf(msg.sender).sub(removeCvxCrvBalance);
                cvxCrvBalance = AuraMath.min(cvxCrvBalance, amounts.depositCvxCrvMaxAmount);
                if (cvxCrvBalance > 0) {
                    IERC20(cvxCrv).safeTransferFrom(msg.sender, address(this), cvxCrvBalance);
                }
            }
        }

        
        //lock upto given amount of crv and stake
        if (amounts.depositCrvMaxAmount > 0) {
            uint256 crvBalance = IERC20(crv).balanceOf(msg.sender).sub(removeCrvBalance);
            crvBalance = AuraMath.min(crvBalance, amounts.depositCrvMaxAmount);

            if (crvBalance > 0) {
                //pull crv
                IERC20(crv).safeTransferFrom(msg.sender, address(this), crvBalance);
                //deposit
                ICrvDepositorWrapper(crvDepositWrapper).deposit(
                    crvBalance,
                    amounts.minAmountOut,
                    options.lockCrvDeposit,
                    address(0)
                );
            }
        }

        //Gas Optim: Reduce max calls to stakeFor to 1. We now stake once after we transfer and deposit.
        uint endCvxCrvBalance = IERC20(cvxCrv).balanceOf(address(this));
        if(endCvxCrvBalance > 0){
            IRewardStaking(cvxCrvRewards).stakeFor(msg.sender, endCvxCrvBalance);
        }

        //stake up to given amount of cvx
        if (amounts.depositCvxMaxAmount > 0 && options.lockCvx) {
            uint256 cvxBalance = IERC20(cvx).balanceOf(msg.sender).sub(removeCvxBalance);
            cvxBalance = AuraMath.min(cvxBalance, amounts.depositCvxMaxAmount);
            if (cvxBalance > 0) {
                //pull cvx
                IERC20(cvx).safeTransferFrom(msg.sender, address(this), cvxBalance);
                IAuraLocker(locker).lock(msg.sender, cvxBalance);
            }
        }
    }
}
