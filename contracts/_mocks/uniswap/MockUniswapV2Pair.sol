// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IUniswapV2Pair {
    function approve(address spender, uint256 value) external returns (bool);

    function balanceOf(address owner) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function burn(address to) external returns (uint256 amount0, uint256 amount1);

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool);

    function token0() external view returns (address);

    function token1() external view returns (address);

    function getReserves()
        external
        view
        returns (
            uint112 _reserve0,
            uint112 _reserve1,
            uint32 _blockTimestampLast
        );
}
