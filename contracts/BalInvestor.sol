// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
pragma abicoder v2;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IVault, IPriceOracle, IAsset } from "./Interfaces.sol";

/**
 * @title   BalInvestor
 * @notice  Deposits $BAL into a BAL/WETH BPT. Hooks into TWAP to determine minOut.
 * @dev     Abstract contract for depositing BAL -> balBPT -> auraBAL via crvDepositor
 */
abstract contract BalInvestor {
    using SafeERC20 for IERC20;

    IVault public immutable BALANCER_VAULT;
    address public immutable BAL;
    address public immutable WETH;
    address public immutable BALANCER_POOL_TOKEN;
    bytes32 public immutable BAL_ETH_POOL_ID;

    constructor(
        IVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId
    ) {
        (
            address poolAddress, /* */

        ) = _balancerVault.getPool(_balETHPoolId);
        require(poolAddress != address(0), "!poolAddress");

        BALANCER_VAULT = _balancerVault;
        BAL = _bal;
        WETH = _weth;
        BALANCER_POOL_TOKEN = poolAddress;
        BAL_ETH_POOL_ID = _balETHPoolId;
    }

    function _setApprovals() internal {
        IERC20(WETH).safeApprove(address(BALANCER_VAULT), type(uint256).max);
        IERC20(BAL).safeApprove(address(BALANCER_VAULT), type(uint256).max);
    }

    function _getBptPrice() internal view returns (uint256) {
        IPriceOracle.OracleAverageQuery[] memory queries = new IPriceOracle.OracleAverageQuery[](1);

        queries[0].variable = IPriceOracle.Variable.BPT_PRICE;
        queries[0].secs = 3600; // last hour
        queries[0].ago = 0; // now

        // Gets the balancer time weighted average price denominated in BAL
        return IPriceOracle(BALANCER_POOL_TOKEN).getTimeWeightedAverage(queries)[0];
    }

    function _getMinOut(uint256 amount, uint256 minOutBps) internal view returns (uint256) {
        // Gets the balancer time weighted average price denominated in BAL
        // e.g.  if 1 BAL == 0.4 BPT, bptOraclePrice == 2.5
        uint256 bptOraclePrice = _getBptPrice();
        // e.g. minOut = (((100e18 * 1e18) / 2.5e18) * 9980) / 10000;
        // e.g. minout = 39.92e18
        uint256 minOut = (((amount * 1e18) / bptOraclePrice) * minOutBps) / 10000;
        return minOut;
    }

    function _investBalToPool(uint256 amount, uint256 minOut) internal {
        IERC20(BAL).safeTransferFrom(msg.sender, address(this), amount);
        IAsset[] memory assets = new IAsset[](2);
        assets[0] = IAsset(BAL);
        assets[1] = IAsset(WETH);
        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = amount;
        maxAmountsIn[1] = 0;

        BALANCER_VAULT.joinPool(
            BAL_ETH_POOL_ID,
            address(this),
            address(this),
            IVault.JoinPoolRequest(
                assets,
                maxAmountsIn,
                abi.encode(IVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, maxAmountsIn, minOut),
                false // Don't use internal balances
            )
        );
    }
}
