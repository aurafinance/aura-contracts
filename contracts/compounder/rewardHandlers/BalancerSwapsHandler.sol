// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IBalancerVault, IAsset } from "../../interfaces/balancer/IBalancerCore.sol";
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
    SwapPath internal swapPath;

    constructor(
        address _token,
        address _strategy,
        address _balVault,
        address _wethToken,
        SwapPath memory _swapPath
    ) HandlerBase(_token, _strategy, _balVault, _wethToken) {
        swapPath = _swapPath;
    }

    function getSwapPath() external view returns (SwapPath memory) {
        return swapPath;
    }

    function _swapTokenToWEth(uint256 _amount) internal {
        uint256 len = swapPath.poolIds.length;
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
    }

    function setApprovals() external {
        IERC20(token).safeApprove(address(balVault), 0);
        IERC20(token).safeApprove(address(balVault), type(uint256).max);
    }

    function sell() external override onlyStrategy {
        _swapTokenToWEth(IERC20(token).balanceOf(address(this)));
        IERC20(WETH_TOKEN).safeTransfer(strategy, IERC20(WETH_TOKEN).balanceOf(address(this)));
    }
}
