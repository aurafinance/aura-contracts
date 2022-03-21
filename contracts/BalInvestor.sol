// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
pragma abicoder v2;

import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "./Interfaces.sol";

abstract contract BalInvestor {
    IVault public immutable BALANCER_VAULT;
    address public immutable BAL;
    address public immutable WETH;
    address public immutable BALANCER_POOL_TOKEN;
    bytes32 public immutable BAL_ETH_POOL_ID;

    uint256 public minOutBps;

    constructor(
        IVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId,
        uint256 _minOutBps
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
        minOutBps = _minOutBps;
    }

    function setMinOutBps(uint256 _minOutBps) external virtual;

    function approveToken() external {
        IERC20(WETH).approve(address(BALANCER_VAULT), type(uint256).max);
        IERC20(BAL).approve(address(BALANCER_VAULT), type(uint256).max);
    }

    function _getBptPrice() internal view returns (uint256) {
        IPriceOracle.OracleAverageQuery[] memory queries = new IPriceOracle.OracleAverageQuery[](1);

        queries[0].variable = IPriceOracle.Variable.BPT_PRICE;
        queries[0].secs = 3600; // last hour
        queries[0].ago = 0; // now

        // Gets the balancer time weighted average price denominated in BAL
        return IPriceOracle(BALANCER_POOL_TOKEN).getTimeWeightedAverage(queries)[0];
    }

    function _investBalToPool() internal {
        uint256 balAmount = IERC20(BAL).balanceOf(address(this));
        IAsset[] memory assets = new IAsset[](2);
        assets[0] = IAsset(BAL);
        assets[1] = IAsset(WETH);
        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = balAmount;
        maxAmountsIn[1] = 0;

        // Gets the balancer time weighted average price denominated in BAL
        uint256 bptOraclePrice = _getBptPrice();
        uint256 minOut = (((balAmount * 1e18) / bptOraclePrice) * minOutBps) / 10000;

        uint256 bptBalanceBefore = IERC20(BALANCER_POOL_TOKEN).balanceOf(address(this));

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

        uint256 bptBalanceAfter = IERC20(BALANCER_POOL_TOKEN).balanceOf(address(this));
        uint256 out = bptBalanceAfter - bptBalanceBefore;

        require(out >= minOut, "!minOut");
    }
}
