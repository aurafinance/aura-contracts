// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IBalancerVault, IAsset } from "../../interfaces/balancer/IBalancerCore.sol";
import { IRewardHandler } from "../../interfaces/balancer/IRewardHandler.sol";
import { HandlerBase } from "./HandlerBase.sol";

contract BalancerSwapsHandler is HandlerBase {
    using SafeERC20 for IERC20;

    // ----------------------------------------------------------------
    // Types
    // ----------------------------------------------------------------

    struct SwapPath {
        bytes32[] poolIds;
        address[] assetsIn;
    }
    address public immutable AURA_TOKEN;
    address public immutable AURABAL_TOKEN;
    SwapPath internal swapPath;

    constructor(
        address _token,
        address _strategy,
        address _balancerVault,
        address _weth,
        address _aura,
        address _auraBal,
        SwapPath memory _swapPath
    ) HandlerBase(_token, _strategy, _balancerVault, _weth) {
        AURA_TOKEN = _aura;
        AURABAL_TOKEN = _auraBal;
        _validateSwapPath(_swapPath, _token, _aura, _auraBal);
        swapPath = _swapPath;
    }

    function _validateSwapPath(
        SwapPath memory _swapPath,
        address _token,
        address _aura,
        address _auraBal
    ) internal view returns (bool) {
        address[] memory assetsIn = _swapPath.assetsIn;
        uint256 assetsInLength = assetsIn.length;

        require(assetsInLength > 0, "!poolIds");
        require(_swapPath.poolIds.length == assetsIn.length, "parity");
        require(_token != AURA_TOKEN, "token=AURA");
        require(_token == assetsIn[0], "!swap path");
        require(_token != AURABAL_TOKEN, "token=AURABAL");

        for (uint256 i = 0; i < assetsInLength; i++) {
            require(assetsIn[i] != AURABAL_TOKEN, "token=AURABAL");
        }
    }

    function getSwapPath() external view returns (SwapPath memory) {
        return swapPath;
    }

    function _swapTokenToWEth(uint256 _amount) internal {
        uint256 len = swapPath.poolIds.length;
        // uint256 wethBalBefore = IERC20(WETH_TOKEN).balanceOf(address(this));

        IBalancerVault.BatchSwapStep[] memory swaps = new IBalancerVault.BatchSwapStep[](len);
        IAsset[] memory zapAssets = new IAsset[](len + 1);
        int256[] memory limits = new int256[](len + 1);

        for (uint256 i = 0; i < len; i++) {
            swaps[i] = IBalancerVault.BatchSwapStep({
                poolId: swapPath.poolIds[i],
                assetInIndex: i,
                assetOutIndex: i + 1,
                amount: i == 0 ? _amount : 0,
                userData: new bytes(0)
            });

            zapAssets[i] = IAsset(swapPath.assetsIn[i]);
            limits[i] = int256(i == 0 ? _amount : 0);
        }

        // Last asset can only be WETH
        zapAssets[len] = IAsset(WETH_TOKEN);
        limits[len] = type(int256).max;

        balVault.batchSwap(
            IBalancerVault.SwapKind.GIVEN_IN,
            swaps,
            zapAssets,
            _createSwapFunds(),
            limits,
            block.timestamp + 1
        );

        // uint256 wethBalAfter = IERC20(WETH_TOKEN).balanceOf(address(this));
        // uint256 _minAmountOut = 0; // TODO
        // require(_minAmountOut < (wethBalAfter - wethBalBefore), "!minAmountOut");
    }

    function sell() external override onlyStrategy {
        _swapTokenToWEth(IERC20(token).balanceOf(address(this)));
        IERC20(WETH_TOKEN).safeTransfer(strategy, IERC20(WETH_TOKEN).balanceOf(address(this)));
    }
}
