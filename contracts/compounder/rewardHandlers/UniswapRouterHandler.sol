// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IUniswapV3SwapRouter } from "../..//interfaces/IUniswapV3SwapRouter.sol";
import { HandlerBase } from "./HandlerBase.sol";

/**
 * @title   UniswapRouterHandler
 * @author  AuraFinance
 * @notice  Single swaps handler for uniswap v3 router.
 */
contract UniswapRouterHandler is HandlerBase {
    using SafeERC20 for IERC20;

    /// @dev The uniswapV3Router address
    IUniswapV3SwapRouter public immutable uniswapV3Router;

    /// @dev The uniswap pool fee tier, ie 500 = 0.05%
    uint24 public immutable poolFee;

    /**
     * @param _token The token address to be swapped
     * @param _strategy The strategy address
     * @param _wethToken The WETH address
     * @param _uniswapV3Router The Uniswap V3 swap router address
     * @param _poolFee  The uniswap pool fee tier, ie 500 = 0.05%
     */
    constructor(
        address _token,
        address _strategy,
        address _wethToken,
        address _uniswapV3Router,
        uint24 _poolFee
    ) HandlerBase(_token, _strategy, _wethToken) {
        uniswapV3Router = IUniswapV3SwapRouter(_uniswapV3Router);
        poolFee = _poolFee;
    }

    function _swapTokenToWEth(uint256 _amount) internal {
        // The strategy can set the min out or revert the tx if needed
        IUniswapV3SwapRouter.ExactInputSingleParams memory params = IUniswapV3SwapRouter.ExactInputSingleParams({
            tokenIn: token,
            tokenOut: WETH_TOKEN,
            fee: poolFee,
            recipient: address(this),
            deadline: block.timestamp + 1,
            amountIn: _amount,
            amountOutMinimum: 1,
            sqrtPriceLimitX96: 0
        });

        uniswapV3Router.exactInputSingle(params);
    }

    function setApprovals() external {
        IERC20(token).safeApprove(address(uniswapV3Router), 0);
        IERC20(token).safeApprove(address(uniswapV3Router), type(uint256).max);
    }

    function sell() external override onlyStrategy {
        _swapTokenToWEth(IERC20(token).balanceOf(address(this)));
        IERC20(WETH_TOKEN).safeTransfer(strategy, IERC20(WETH_TOKEN).balanceOf(address(this)));
    }
}
