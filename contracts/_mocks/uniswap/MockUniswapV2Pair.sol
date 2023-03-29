// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IUniswapV2Pair {
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Function to get the balance of a given address
     * @param owner The address to get the balance of
     * @return The balance of the given address
     */
    function balanceOf(address owner) external view returns (uint256);

    /**
     * @notice This function returns the total supply of a token.
     * @dev This function is used to get the total supply of a token.
     * @return uint256 The total supply of the token.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @notice This function burns a specified amount of tokens from the contract and sends them to the specified address.
     * @dev The function takes an address as an argument and returns two uint256 values representing the amount of tokens burned.
     */
    function burn(address to) external returns (uint256 amount0, uint256 amount1);

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool);

    /**
     * @notice This function returns the address of the token0.
     * @dev This function is used to get the address of the token0.
     */
    function token0() external view returns (address);

    /**
     * @notice This function returns the address of token1.
     * @dev This function is used to get the address of token1.
     */
    function token1() external view returns (address);

    /**
     * @notice getReserves() returns the reserves of the contract, the reserve0 and reserve1, and the timestamp of the last block.
     * @dev getReserves() is an external view function that returns the reserves of the contract, the reserve0 and reserve1, and the timestamp of the last block.
     */
    function getReserves()
        external
        view
        returns (
            uint112 _reserve0,
            uint112 _reserve1,
            uint32 _blockTimestampLast
        );
}
