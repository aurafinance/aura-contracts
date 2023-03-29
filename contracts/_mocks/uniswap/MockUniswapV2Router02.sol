// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IUniswapV2Router02 {
    function factory() external pure returns (address);

    /**
     * @notice WETH()
     *
     * This function returns the address of the Wrapped Ether (WETH) contract.
     *
     * @dev WETH()
     *
     * This function returns the address of the Wrapped Ether (WETH) contract. It is a pure function, meaning that it does not modify the state of the blockchain and does not cost any gas.*/
    function WETH() external pure returns (address);

    /**
     * @notice This function adds liquidity to the pool.
     * @dev This function adds liquidity to the pool by taking two tokens, amountADesired, amountBDesired, amountAMin, amountBMin, to, and deadline as parameters. It returns the amountA, amountB, and liquidity.
     */
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    )
        external
        returns (
            uint256 amountA,
            uint256 amountB,
            uint256 liquidity
        );

    /**
     * @notice This function adds liquidity to the pool by providing ETH and a token.
     * @dev The function takes in the address of the token, the desired amount of token, the minimum amount of token, the minimum amount of ETH, the address of the recipient, and the deadline. It returns the amount of token, the amount of ETH, and the liquidity.
     */
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    )
        external
        payable
        returns (
            uint256 amountToken,
            uint256 amountETH,
            uint256 liquidity
        );

    /**
     * @notice This function allows a user to remove liquidity from a pool.
     * @dev The function takes in the addresses of two tokens, the amount of liquidity to remove, the minimum amounts of each token to be returned, the address to send the tokens to, and a deadline for the transaction. The function returns the amount of each token that will be returned to the user.
     */
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB);

    /**
     * @notice removeLiquidityETH() allows users to remove liquidity from the pool.
     * @dev removeLiquidityETH() takes in the token address, liquidity, amountTokenMin, amountETHMin, to address, and deadline as parameters. It returns the amount of token and ETH removed from the pool.
     */
    function removeLiquidityETH(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountToken, uint256 amountETH);

    /**
     * @notice removeLiquidityWithPermit allows a user to remove liquidity from a pool using a signed message.
     * @dev removeLiquidityWithPermit requires the following parameters:
     *  - tokenA: The address of the first token in the pool.
     *  - tokenB: The address of the second token in the pool.
     *  - liquidity: The amount of liquidity to be removed from the pool.
     *  - amountAMin: The minimum amount of tokenA to be returned.
     *  - amountBMin: The minimum amount of tokenB to be returned.
     *  - to: The address of the user removing the liquidity.
     *  - deadline: The deadline for the transaction to be executed.
     *  - approveMax: A boolean indicating whether the maximum amount of tokens should be approved.
     *  - v: The ECDSA signature v value.
     *  - r: The ECDSA signature r value.
     *  - s: The ECDSA signature s value.
     *
     * removeLiquidityWithPermit returns the amount of tokenA and tokenB returned to the user.
     */
    function removeLiquidityWithPermit(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 amountA, uint256 amountB);

    /**
     * @notice removeLiquidityETHWithPermit allows a user to remove liquidity from a pool using a signed ERC-20 permit.
     * @dev removeLiquidityETHWithPermit removes liquidity from a pool using a signed ERC-20 permit. The function takes in the token address, liquidity to remove, minimum amount of token to remove, minimum amount of ETH to remove, address to send the liquidity to, deadline for the permit, whether to approve the maximum amount of token, and the signature of the permit. The function returns the amount of token and ETH removed from the pool.
     */
    function removeLiquidityETHWithPermit(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 amountToken, uint256 amountETH);

    /**
     * @notice quote() function allows users to get the amount of token B they can get for a given amount of token A.
     * @dev The quote() function takes three parameters: amountA, reserveA, and reserveB. The amountA parameter is the amount of token A that the user wants to exchange. The reserveA parameter is the amount of token A that is currently held in reserve. The reserveB parameter is the amount of token B that is currently held in reserve. The function returns the amount of token B that the user can get for the given amount of token A.*/
    function quote(
        uint256 amountA,
        uint256 reserveA,
        uint256 reserveB
    ) external pure returns (uint256 amountB);

    /**
     * @notice getAmountOut() calculates the amount of tokens that will be received when exchanging from one token to another.
     * @dev getAmountOut() takes three parameters: amountIn, reserveIn, and reserveOut. The amountIn parameter is the amount of tokens being exchanged. The reserveIn parameter is the amount of tokens in the reserve of the token being exchanged from. The reserveOut parameter is the amount of tokens in the reserve of the token being exchanged to. The function returns the amount of tokens that will be received when exchanging from one token to another.
     */
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) external pure returns (uint256 amountOut);

    /**
     * @notice This function is used to calculate the amount of token in that is equivalent to the amount of token out.
     * @dev This function takes in three parameters, amountOut, reserveIn, and reserveOut, and returns the amount of token in that is equivalent to the amount of token out. The calculation is done by using the formula: amountIn = amountOut * reserveIn / reserveOut.
     */
    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) external pure returns (uint256 amountIn);

    /**
     * @notice getAmountsOut is a function that takes in an amount and a path and returns an array of amounts.
     * @dev getAmountsOut takes in an amount and a path and returns an array of amounts. The amount is the amount of tokens to be sent and the path is an array of addresses that the tokens will be sent to. The function will return an array of amounts that correspond to the addresses in the path.*/
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);

    /**
     * @notice getAmountsIn() is a function that takes in an amountOut and a path and returns an array of amounts.
     * @dev This function is used to calculate the amount of tokens that need to be sent in order to get the desired amountOut. It takes in an amountOut and a path and returns an array of amounts. The path is an array of addresses that represent the route of the tokens. The amountOut is the desired amount of tokens that need to be sent out.
     */
    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts);
}
