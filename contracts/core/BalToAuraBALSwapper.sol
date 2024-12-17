// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IBalancerVault, IAsset, IBalancerPool } from "../interfaces/balancer/IBalancerCore.sol";
import { BalInvestor } from "./BalInvestor.sol";
import "../utils/balancer/StableMath.sol";

/**
 * @title   BalToAuraBALSwapper
 * @notice  Swaps BAL -> balBPT -> auraBal
 */
abstract contract BalToAuraBALSwapper is BalInvestor {
    using SafeERC20 for IERC20;

    /// @dev AURABAL token
    address public immutable AURABAL;
    /// @dev AuraBal / BAL80ETH20  Pool Id
    bytes32 public immutable AURABAL_BAL_ETH_BPT_POOL_ID;
    /// @dev AuraBal / BAL80ETH20  Pool Address
    address public immutable AURABAL_BAL_ETH_POOL_TOKEN;

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /// @notice Explain to an end user what this does
    /// @dev Explain to a developer any extra details
    /// @param _auraBal The AURABAL token address
    /// @param _auraBalBalETHPoolId The auraBal / BAL80ETH20 pool Id
    constructor(
        // BalInvestor args
        IBalancerVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId,
        address _auraBal,
        bytes32 _auraBalBalETHPoolId
    ) BalInvestor(_balancerVault, _bal, _weth, _balETHPoolId) {
        AURABAL = _auraBal;
        AURABAL_BAL_ETH_BPT_POOL_ID = _auraBalBalETHPoolId;
        (
            address poolAddress, /* */

        ) = _balancerVault.getPool(_auraBalBalETHPoolId);
        AURABAL_BAL_ETH_POOL_TOKEN = poolAddress;
    }

    /* -------------------------------------------------------------------
       Internal 
    ------------------------------------------------------------------- */
    function _setApprovals() internal virtual override {
        super._setApprovals();
        IERC20(BALANCER_POOL_TOKEN).safeApprove(address(BALANCER_VAULT), type(uint256).max);
    }

    /// @notice Returns a FundManagement struct used for BAL swaps
    function _createSwapFunds() internal view returns (IBalancerVault.FundManagement memory) {
        return
            IBalancerVault.FundManagement({
                sender: address(this),
                fromInternalBalance: false,
                recipient: payable(address(this)),
                toInternalBalance: false
            });
    }

    /// @notice Swaps BAL80ETH20 Pool Token for AuraBal
    function _swapBptToAuraBal(uint256 _amount, uint256 _minAmountOut) internal returns (uint256) {
        IBalancerVault.SingleSwap memory _swapParams = IBalancerVault.SingleSwap({
            poolId: AURABAL_BAL_ETH_BPT_POOL_ID,
            kind: IBalancerVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(BALANCER_POOL_TOKEN),
            assetOut: IAsset(AURABAL),
            amount: _amount,
            userData: new bytes(0)
        });

        return BALANCER_VAULT.swap(_swapParams, _createSwapFunds(), _minAmountOut, block.timestamp + 1);
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
    function _getMinOut(uint256 _amount, uint256 _outputBps) internal view override returns (uint256) {
        uint256 balBptMinOut = super._getMinOut(_amount, _outputBps);

        uint256[] memory balances;
        (uint256 currentAmp, , ) = IBalancerPool(AURABAL_BAL_ETH_POOL_TOKEN).getAmplificationParameter();
        (, balances, ) = BALANCER_VAULT.getPoolTokens(AURABAL_BAL_ETH_BPT_POOL_ID);

        uint256 invariant = StableMath._calculateInvariant(currentAmp, balances);
        uint256 auraBalAmountOut = StableMath._calcOutGivenIn(
            currentAmp,
            balances,
            0, // indexIn, AURABAL_BAL_ETH_POOL_TOKEN
            1, // indexOut AURABAL ,
            balBptMinOut,
            invariant
        );
        return (auraBalAmountOut * _outputBps) / 10000;
    }

    /**
     * @notice Swaps BAL for AuraBALBpt, then it swaps auraBal.
     * @dev Caller must approve this contract to spend BAL
     * @param _amount Units of BAL to deposit
     * @param _minOut Min amount of auraBal to be deposited.
     */
    function _swapBalToAuraBal(uint256 _amount, uint256 _minOut) internal returns (uint256 cvxCrvBal) {
        // BAL to BPT
        _investBalToPool(_amount, 1);
        uint256 bptBalance = IERC20(BALANCER_POOL_TOKEN).balanceOf(address(this));

        // Swap BPT ot AuraBal
        _swapBptToAuraBal(bptBalance, _minOut);
        cvxCrvBal = IERC20(AURABAL).balanceOf(address(this));
    }
}
