// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IBalancerVault, IAsset } from "../../interfaces/balancer/IBalancerCore.sol";
import { HandlerBase } from "./HandlerBase.sol";

/**
 * @title   BBUSDHandlerv2
 * @author  llama.airforce
 */
contract BBUSDHandlerv2 is HandlerBase {
    using SafeERC20 for IERC20;

    address private constant BBUSD_TOKEN = 0xA13a9247ea42D743238089903570127DdA72fE44;
    address private constant WSTETH_TOKEN = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;

    bytes32 private constant BBUSD_WSTETH_POOL_ID = 0x25accb7943fd73dda5e23ba6329085a3c24bfb6a000200000000000000000387;
    bytes32 private constant WSTETH_WETH_POOL_ID = 0x32296969ef14eb0c6d29669c550d4a0449130230000200000000000000000080;

    constructor(
        address _token,
        address _strategy,
        address _balVault,
        address _wethToken
    ) HandlerBase(_token, _strategy, _balVault, _wethToken) {}

    /// @notice Swap bb-USD for WETH on Balancer via wstEth
    /// @param _amount - amount to swap
    function _swapBbUsdToWEth(uint256 _amount) internal {
        IBalancerVault.BatchSwapStep[] memory _swaps = new IBalancerVault.BatchSwapStep[](2);
        _swaps[0] = IBalancerVault.BatchSwapStep({
            poolId: BBUSD_WSTETH_POOL_ID,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: _amount,
            userData: new bytes(0)
        });
        _swaps[1] = IBalancerVault.BatchSwapStep({
            poolId: WSTETH_WETH_POOL_ID,
            assetInIndex: 1,
            assetOutIndex: 2,
            amount: 0,
            userData: new bytes(0)
        });

        IAsset[] memory _zapAssets = new IAsset[](3);
        int256[] memory _limits = new int256[](3);

        _zapAssets[0] = IAsset(BBUSD_TOKEN);
        _zapAssets[1] = IAsset(WSTETH_TOKEN);
        _zapAssets[2] = IAsset(WETH_TOKEN);

        _limits[0] = int256(_amount);
        _limits[1] = type(int256).max;
        _limits[2] = type(int256).max;

        balVault.batchSwap(
            IBalancerVault.SwapKind.GIVEN_IN,
            _swaps,
            _zapAssets,
            _createSwapFunds(),
            _limits,
            block.timestamp + 1
        );
    }

    function sell() external override onlyStrategy {
        _swapBbUsdToWEth(IERC20(BBUSD_TOKEN).balanceOf(address(this)));
        IERC20(WETH_TOKEN).safeTransfer(strategy, IERC20(WETH_TOKEN).balanceOf(address(this)));
    }
}
