// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IBalancerVault } from "../interfaces/balancer/IBalancerCore.sol";
import { ICrvDepositorWrapper } from "../interfaces/ICrvDepositorWrapper.sol";
import { BalToAuraBALSwapper } from "./BalToAuraBALSwapper.sol";
import { IRewardStaking } from "../interfaces/IRewardStaking.sol";

/**
 * @title   CrvDepositorWrapperSwapper
 * @notice  Swaps BAL -> balBPT -> auraBal
 *          Finally it forwards the swapped auraBAL to a given address.
 */
contract CrvDepositorWrapperSwapper is ICrvDepositorWrapper, BalToAuraBALSwapper {
    using SafeERC20 for IERC20;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /// @notice Explain to an end user what this does
    /// @dev Explain to a developer any extra details
    /// @param _auraBal The AURABAL token address
    /// @param _auraBalBalETHPoolId The auraBal / BAL80ETH20 pool Id
    constructor(
        // BalToAuraBALSwapper args
        IBalancerVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId,
        address _auraBal,
        bytes32 _auraBalBalETHPoolId
    ) BalToAuraBALSwapper(_balancerVault, _bal, _weth, _balETHPoolId, _auraBal, _auraBalBalETHPoolId) {
        // silence is golden
    }

    /* -------------------------------------------------------------------
       Internal 
    ------------------------------------------------------------------- */
    function setApprovals() external virtual {
        super._setApprovals();
    }

    /* -------------------------------------------------------------------
       External 
    ------------------------------------------------------------------- */
    /**
     * @dev Gets minimum output based on BPT oracle price and AuraBal BPT invariant.
     * @param _amount Units of BAL to deposit
     * @param _outputBps Multiplier where 100% == 10000, 99.5% == 9950 and 98% == 9800
     * @return minOut Units of auraBal BPT to expect as output
     */
    function getMinOut(uint256 _amount, uint256 _outputBps) external view override returns (uint256) {
        return super._getMinOut(_amount, _outputBps);
    }

    /**
     * @dev Swaps BAL for AuraBALBpt, then it swaps auraBal and transfers via stash reward distributor
     * to the PID configured.
     * @param _amount Units of BAL to deposit
     * @param _minOut Min amount of auraBal to be deposited.
     * @param _stakeAddress Hast to be zero address, to ensure AURABAL is minted only.
     */
    function deposit(
        uint256 _amount,
        uint256 _minOut,
        bool,
        address _stakeAddress
    ) external virtual {
        uint256 cvxCrvBal = _swapBalToAuraBal(_amount, _minOut);

        if (_stakeAddress != address(0)) {
            IERC20(AURABAL).safeIncreaseAllowance(_stakeAddress, cvxCrvBal);
            IRewardStaking(_stakeAddress).stakeFor(msg.sender, cvxCrvBal);
        } else {
            IERC20(AURABAL).safeTransfer(msg.sender, cvxCrvBal);
        }
    }
}
