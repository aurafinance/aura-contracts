// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "./MockBalancerPoolToken.sol";
import "../../interfaces/balancer/IBalancerCore.sol";

contract MockBalancerVault {
    address public pool;

    address public poolToken;

    address public tokenA;

    address public tokenB;

    constructor(address _poolToken) {
        poolToken = _poolToken;
    }

    function setTokens(address _tokenA, address _tokenB) external {
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    function getPool(bytes32) external view returns (address, IBalancerVault.PoolSpecialization) {
        return (poolToken, IBalancerVault.PoolSpecialization.GENERAL);
    }

    function joinPool(
        bytes32, /* poolId */
        address, /* sender */
        address recipient,
        IBalancerVault.JoinPoolRequest memory request
    ) external payable {
        uint256 len = request.maxAmountsIn.length;
        uint256 amount = request.maxAmountsIn[0] > 0 ? request.maxAmountsIn[0] : request.maxAmountsIn[1];
        uint256 price = MockBalancerPoolToken(poolToken).price();
        // Pull tokens from sender
        for (uint256 i = 0; i < len; i++) {
            if (request.maxAmountsIn[i] > 0) {
                IERC20(address(request.assets[i])).transferFrom(msg.sender, address(this), request.maxAmountsIn[i]);
            }
        }

        MockBalancerPoolToken(poolToken).mint(recipient, (amount * 1e18) / price);
    }

    function exitPool(
        bytes32, /* poolId */
        address sender,
        address recipient,
        IBalancerVault.ExitPoolRequest memory /* request */
    ) external payable {
        uint256 amount = MockBalancerPoolToken(poolToken).balanceOf(msg.sender);
        uint256 price = MockBalancerPoolToken(poolToken).price();
        MockBalancerPoolToken(poolToken).burn(sender, amount);
        IERC20(tokenA).transfer(recipient, (amount * price) / 2e18);
        IERC20(tokenB).transfer(recipient, (amount * price) / 2e18);
    }

    function swap(
        IBalancerVault.SingleSwap memory singleSwap,
        IBalancerVault.FundManagement memory funds,
        uint256, /* limit */
        uint256 /* deadline */
    ) external returns (uint256 amountCalculated) {
        IERC20(address(singleSwap.assetIn)).transferFrom(funds.sender, address(this), singleSwap.amount);
        IERC20(address(singleSwap.assetOut)).transfer(funds.recipient, singleSwap.amount);

        return singleSwap.amount;
    }

    function batchSwap(
        IBalancerVault.SwapKind, /* kind */
        IBalancerVault.BatchSwapStep[] memory swaps,
        IAsset[] memory assets,
        IBalancerVault.FundManagement memory funds,
        int256[] memory, /* limit */
        uint256 /* deadline */
    ) external payable returns (int256[] memory) {
        // Dummy swap first asset in 1:1 last asset out
        uint256 len = swaps.length;
        uint256 amount = swaps[0].amount;
        address assetIn = address(assets[swaps[0].assetInIndex]);
        address assetOut = address(assets[swaps[len - 1].assetOutIndex]);

        IERC20(assetIn).transferFrom(funds.sender, address(this), amount);
        IERC20(assetOut).transfer(funds.recipient, amount);
    }

    function getPoolTokens(bytes32 poolId)
        external
        view
        returns (
            address[] memory tokens,
            uint256[] memory balances,
            uint256 lastChangeBlock
        )
    {
        tokens = new address[](2);
        balances = new uint256[](2);
        tokens[0] = tokenA;
        tokens[1] = tokenB;

        balances[0] = IERC20(tokenA).balanceOf(address(this));
        balances[1] = IERC20(tokenB).balanceOf(address(this));

        lastChangeBlock = block.timestamp;
    }
}
