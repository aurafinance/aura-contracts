// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IBasicRewards } from "../interfaces/IBasicRewards.sol";
import { IAsset, IBalancerVault } from "../interfaces/balancer/IBalancerCore.sol";

/**
 * @title   AuraBalStrategyBase
 * @author  llama.airforce -> AuraFinance
 * @notice  Changes:
 *          - remove BAL Depositor address
 */
contract AuraBalStrategyBase {
    address public immutable BBUSD_TOKEN;
    address public immutable AURA_TOKEN;
    address public immutable AURABAL_TOKEN;

    address public immutable WETH_TOKEN;
    address public immutable BAL_TOKEN;
    address public immutable BAL_ETH_POOL_TOKEN;

    bytes32 private immutable AURABAL_BAL_ETH_BPT_POOL_ID;
    bytes32 private immutable BAL_ETH_POOL_ID;

    IBasicRewards public immutable auraBalStaking;
    IBalancerVault public immutable balVault;

    constructor(
        address _balVault,
        address _auraBalStaking,
        // tokens
        address _balToken,
        address _wethToken,
        address _auraToken,
        address _auraBalToken,
        address _bbusdToken,
        // pools
        bytes32 _auraBalBalETHBptPoolId,
        bytes32 _balETHPoolId
    ) {
        (
            address balEthPoolToken, /* */

        ) = IBalancerVault(_balVault).getPool(_balETHPoolId);
        require(balEthPoolToken != address(0), "!balEthPoolToken");
        balVault = IBalancerVault(_balVault);
        auraBalStaking = IBasicRewards(_auraBalStaking);
        BAL_TOKEN = _balToken;
        WETH_TOKEN = _wethToken;
        AURA_TOKEN = _auraToken;
        AURABAL_TOKEN = _auraBalToken;
        BBUSD_TOKEN = _bbusdToken;
        BAL_ETH_POOL_TOKEN = balEthPoolToken;
        AURABAL_BAL_ETH_BPT_POOL_ID = _auraBalBalETHBptPoolId;
        BAL_ETH_POOL_ID = _balETHPoolId;
    }

    /// @notice Deposit BAL and WETH to the BAL-ETH pool
    /// @param _wethAmount - amount of wETH to deposit
    /// @param _balAmount - amount of BAL to deposit
    /// @param _minAmountOut - min amount of BPT expected
    function _depositToBalEthPool(
        uint256 _balAmount,
        uint256 _wethAmount,
        uint256 _minAmountOut
    ) internal {
        IAsset[] memory _assets = new IAsset[](2);
        _assets[0] = IAsset(BAL_TOKEN);
        _assets[1] = IAsset(WETH_TOKEN);

        uint256[] memory _amountsIn = new uint256[](2);
        _amountsIn[0] = _balAmount;
        _amountsIn[1] = _wethAmount;

        balVault.joinPool(
            BAL_ETH_POOL_ID,
            address(this),
            address(this),
            IBalancerVault.JoinPoolRequest(
                _assets,
                _amountsIn,
                abi.encode(IBalancerVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, _amountsIn, _minAmountOut),
                false
            )
        );
    }

    function _swapBptToAuraBal(uint256 _amount, uint256 _minAmountOut) internal returns (uint256) {
        IBalancerVault.SingleSwap memory _auraSwapParams = IBalancerVault.SingleSwap({
            poolId: AURABAL_BAL_ETH_BPT_POOL_ID,
            kind: IBalancerVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(BAL_ETH_POOL_TOKEN),
            assetOut: IAsset(AURABAL_TOKEN),
            amount: _amount,
            userData: new bytes(0)
        });

        return balVault.swap(_auraSwapParams, _createSwapFunds(), _minAmountOut, block.timestamp + 1);
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
}
