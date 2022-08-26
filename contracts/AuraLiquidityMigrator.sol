// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

import { IVault, IPriceOracle, IAsset, IBalancerPool, RewardPool, IUniswapV2Pair } from "./Interfaces.sol";

interface IWeightedPoolFactory {
    /**
     * @dev Deploys a new `WeightedPool`.
     */
    function create(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256 swapFeePercentage,
        address owner
    ) external returns (address);
}

/**
 * @title   AuraLiquidityMigrator
 * @notice  Migrates liquidity positions from Sushiswap or Uniswap v2
 * @dev     Given a "fromLPToken", it removes the liquidity from Sushiswap/Uniswap,
 *          then it creates or join to a balancer pool, adds liquidity to the pool.
 *          Finally if the pool already existed it stakes the liquidity in an aura reward pool.
 */
contract AuraLiquidityMigrator {
    using SafeERC20 for IERC20;
    /// @dev Balancer pool factory
    IWeightedPoolFactory public immutable BALANCER_POOL_FACTORY; // ie 0x8E9aa87E45e92bad84D5F8DD1bff34Fb92637dE9
    /// @dev Balancer vault
    IVault public immutable BALANCER_VAULT; // ie 0xBA12222222228d8Ba445958a75a0704d566BF2C8

    /**
     * @param _weightedPoolFactory The pool factory address
     * @param _balancerVault The balancer vault address
     */
    constructor(address _weightedPoolFactory, address _balancerVault) {
        BALANCER_POOL_FACTORY = IWeightedPoolFactory(_weightedPoolFactory);
        BALANCER_VAULT = IVault(_balancerVault);
    }

    event PoolCreated(address indexed pool);

    /**
     * @dev Migrates a liquidity position, deploys a new `WeightedPool` and adds liquidity to the pool.
     *      The created pool has a weight of 50/50.
     *
     * @param fromLpToken The LP token to migrate
     * @param user The owner of the lp position
     * @param name The name of the new pool
     * @param symbol The symbol of the new pool
     * @param tokens The underlying tokens of the pool.
     * @param swapFeePercentage The swap fee percentage
     * @param owner The owner of the pool
     * @param minOut The min amount of bpt
     */
    function migrateUniswapV2AndCreatePool(
        address fromLpToken, //Uniswap LP token
        address user,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 swapFeePercentage,
        address owner,
        uint256 minOut
    ) external returns (address pool) {
        require(tokens.length == 2, "only token pairs");
        // 1. Remove liquidity
        (uint256 amount0, uint256 amount1) = _removeLiquidityUniswapV2(fromLpToken, user);

        // 2. Create balancer pool
        pool = _createBalancerPool(name, symbol, tokens, swapFeePercentage, owner);

        // 3. Deposit to balancer pool
        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = amount0;
        maxAmountsIn[1] = amount1;

        _addLiquidityBalancer(pool, tokens, maxAmountsIn, user, minOut);

        emit PoolCreated(pool);
    }

    /**
     * @dev Migrates a liquidity position, adds liquidity to the pool, and stake the BPT
     *
     * @param fromLpToken The LP token to migrate
     * @param user The owner of the lp position
     * @param tokens The underlying tokens of the pool.
     * @param minOut The min amount of bpt
     * @param pool The pool address to add liquidity
     * @param rewardPoolAddress The aura reward pool address
     */
    function migrateUniswapV2AndJoinPool(
        address fromLpToken,
        address user,
        IERC20[] memory tokens,
        uint256 minOut,
        address pool,
        address rewardPoolAddress
    ) external {
        require(tokens.length == 2, "only token pairs");

        // 1. Remove liquidity
        (uint256 amount0, uint256 amount1) = _removeLiquidityUniswapV2(fromLpToken, user);

        // 2. Deposit to balancer pool
        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = amount0;
        maxAmountsIn[1] = amount1;

        _addLiquidityBalancer(pool, tokens, maxAmountsIn, address(this), minOut);

        uint256 minted = IERC20(pool).balanceOf(address(this));
        require(minted > 0, "!mint");

        // 3. Deposit to reward pool
        IERC20(pool).safeIncreaseAllowance(rewardPoolAddress, minted);
        RewardPool(rewardPoolAddress).deposit(minted, user);
    }

    function _removeLiquidityUniswapV2(
        address lpToken, //Uniswap LP token
        address user
    ) internal returns (uint256 amount0, uint256 amount1) {
        // Remove liquidity position from IUniswapV2
        IUniswapV2Pair pair = IUniswapV2Pair(lpToken);

        uint256 liquidity = pair.balanceOf(user);
        require(pair.transferFrom(msg.sender, address(pair), liquidity), "!liquidity");

        (amount0, amount1) = pair.burn(address(this));
    }

    function _createBalancerPool(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 swapFeePercentage,
        address owner
    ) internal returns (address pool) {
        uint256[] memory weights = new uint256[](2);
        weights[0] = 500000000000000000; // 50%
        weights[1] = 500000000000000000; // 50%
        pool = IWeightedPoolFactory(BALANCER_POOL_FACTORY).create(
            name,
            symbol,
            tokens,
            weights,
            swapFeePercentage,
            owner
        );
    }

    function _addLiquidityBalancer(
        address pool,
        IERC20[] memory tokens,
        uint256[] memory maxAmountsIn,
        address recipient,
        uint256 minOut
    ) internal {
        // add liquidity to balancer pool
        bytes32 poolId = IBalancerPool(pool).getPoolId();
        IAsset[] memory assets = new IAsset[](2);
        assets[0] = IAsset(address(tokens[0]));
        assets[1] = IAsset(address(tokens[1]));

        tokens[0].safeIncreaseAllowance(address(BALANCER_VAULT), maxAmountsIn[0]);
        tokens[1].safeIncreaseAllowance(address(BALANCER_VAULT), maxAmountsIn[1]);

        bytes memory userData;
        if (IBalancerPool(pool).totalSupply() == 0) {
            // Initialise pool
            userData = abi.encode(IVault.JoinKind.INIT, maxAmountsIn);
        } else {
            userData = abi.encode(IVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, maxAmountsIn, minOut);
        }

        BALANCER_VAULT.joinPool(
            poolId,
            address(this), //sender
            recipient, // recipient
            IVault.JoinPoolRequest(
                assets,
                maxAmountsIn,
                userData,
                false // Don't use internal balances
            )
        );
    }
}
