// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IBasicRewards } from "../interfaces/IBasicRewards.sol";
import { IAsset, IBalancerVault } from "../interfaces/balancer/IBalancerCore.sol";

/**
 * @title   AuraBalStrategyBase
 * @author  lama.airforce -> AuraFinance
 * @notice  Changes:
 *          - remove BAL Depositor address
 */
contract AuraBalStrategyBase {
    address public constant AURABAL_STAKING = 0x00A7BA8Ae7bca0B10A32Ea1f8e2a1Da980c6CAd2;
    address public constant BAL_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

    address public constant BBUSD_TOKEN = 0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2;
    address public constant AURA_TOKEN = 0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF;
    address public constant AURABAL_TOKEN = 0x616e8BfA43F920657B3497DBf40D6b1A02D4608d;

    address public constant WETH_TOKEN = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant BAL_TOKEN = 0xba100000625a3754423978a60c9317c58a424e3D;
    address public constant BAL_ETH_POOL_TOKEN = 0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56;

    bytes32 private constant AURABAL_BAL_ETH_BPT_POOL_ID =
        0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd000200000000000000000249;
    bytes32 private constant BAL_ETH_POOL_ID = 0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014;

    IBasicRewards public auraBalStaking = IBasicRewards(AURABAL_STAKING);
    IBalancerVault public balVault = IBalancerVault(BAL_VAULT);

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
    function _createSwapFunds() internal returns (IBalancerVault.FundManagement memory) {
        return
            IBalancerVault.FundManagement({
                sender: address(this),
                fromInternalBalance: false,
                recipient: payable(address(this)),
                toInternalBalance: false
            });
    }

    receive() external payable {}
}
