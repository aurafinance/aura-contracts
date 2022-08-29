// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

import { IVault, IPriceOracle, IAsset } from "./Interfaces.sol";
import { IWeightedPool2TokensFactory } from "../contracts/mocks/balancer/MockWeightedPool2TokensFactory.sol";
import { IBalancerPool } from "../contracts/mocks/balancer/MockBalancerPool.sol";
import { IRewardPool } from "../contracts/mocks/balancer/MockRewardPool.sol";
import { IUniswapV2Pair } from "../contracts/mocks/uniswap/MockUniswapV2Pair.sol";

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
    IWeightedPool2TokensFactory public immutable bWeightedPool2PoolFactory; // ie 0xA5bf2ddF098bb0Ef6d120C98217dD6B141c74EE0
    /// @dev Balancer vault
    IVault public immutable bVault; // ie 0xBA12222222228d8Ba445958a75a0704d566BF2C8

    struct JoinPoolRequest {
        address fromLpToken;
        uint256 minOut;
        address pool;
        address rewardPool;
    }

    struct CreatePoolRequest {
        address fromLpToken;
        string name;
        string symbol;
        uint256 swapFeePercentage;
        bool oracleEnabled;
        address owner;
        uint256 minOut;
    }

    /**
     * @param _bWeightedPool2PoolFactory The pool factory address
     * @param _bVault The balancer vault address
     */
    constructor(address _bWeightedPool2PoolFactory, address _bVault) {
        bWeightedPool2PoolFactory = IWeightedPool2TokensFactory(_bWeightedPool2PoolFactory);
        bVault = IVault(_bVault);
    }

    /// @dev Event emmited when a new balancer pool is created.
    event PoolCreated(address indexed pool);

    /**
     * @dev Migrates a liquidity position, deploys a new `WeightedPool` and adds liquidity to the pool.
     *      The created pool has a weight of 50/50.
     *
     * @param fromLpToken The LP token to migrate
     * @param name The name of the new pool
     * @param symbol The symbol of the new pool
     * @param swapFeePercentage The swap fee percentage
     * @param oracleEnabled Indcates if the pool should be enabled to be an oracle source.
     * @param owner The owner of the pool
     * @param minOut The min amount of bpt
     */
    function migrateUniswapV2AndCreatePool(
        address fromLpToken, //Uniswap LP token
        string memory name,
        string memory symbol,
        uint256 swapFeePercentage,
        bool oracleEnabled,
        address owner,
        uint256 minOut
    ) public returns (address pool) {
        // 1. Remove liquidity
        (address token0, uint256 amount0, address token1, uint256 amount1) = _removeLiquidityUniswapV2(fromLpToken);
        IERC20[] memory tokens = new IERC20[](2);
        tokens[0] = IERC20(token0);
        tokens[1] = IERC20(token1);
        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = amount0;
        maxAmountsIn[1] = amount1;

        // 2. Create balancer pool
        pool = _createBalancerPool(name, symbol, tokens, swapFeePercentage, oracleEnabled, owner);

        // 3. Deposit to balancer pool
        _addLiquidityBalancer(pool, tokens, maxAmountsIn, msg.sender, minOut);

        emit PoolCreated(pool);
    }

    /**
     * @dev Migrates a liquidity position, adds liquidity to the pool, and stake the BPT
     *
     * @param fromLpToken The LP token to migrate
     * @param minOut The min amount of bpt
     * @param pool The pool address to add liquidity
     * @param rewardPool The aura reward pool address
     */
    function migrateUniswapV2AndJoinPool(
        address fromLpToken,
        uint256 minOut,
        address pool,
        address rewardPool
    ) public {
        // 1. Remove liquidity
        (address token0, uint256 amount0, address token1, uint256 amount1) = _removeLiquidityUniswapV2(fromLpToken);
        IERC20[] memory tokens = new IERC20[](2);
        tokens[0] = IERC20(token0);
        tokens[1] = IERC20(token1);
        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = amount0;
        maxAmountsIn[1] = amount1;

        // 2. Deposit to balancer pool
        _addLiquidityBalancer(pool, tokens, maxAmountsIn, address(this), minOut);

        uint256 minted = IERC20(pool).balanceOf(address(this));
        require(minted > 0, "!mint");

        // 3. Deposit to reward pool
        IERC20(pool).safeIncreaseAllowance(rewardPool, minted);
        IRewardPool(rewardPool).deposit(minted, msg.sender);
    }

    /**
     * @dev Migrates multiple liquidity position, adds liquidity to the pool, and stake the BPT
     *
     * @param createPoolRequests Array of creation of pools requests
     * @param joinPoolRequests Array of join pools requests.
     */
    function migrateUniswapV2MultiCall(
        CreatePoolRequest[] memory createPoolRequests,
        JoinPoolRequest[] memory joinPoolRequests
    ) external returns (address[] memory createdPools) {
        // Creations
        uint256 creationsLen = createPoolRequests.length;
        uint256 joinsLen = joinPoolRequests.length;
        require(creationsLen > 0 || joinsLen > 0, "!Input");

        createdPools = new address[](creationsLen);
        for (uint256 i = 0; i < creationsLen; i++) {
            CreatePoolRequest memory request = createPoolRequests[i];
            createdPools[0] = migrateUniswapV2AndCreatePool(
                request.fromLpToken,
                request.name,
                request.symbol,
                request.swapFeePercentage,
                request.oracleEnabled,
                request.owner,
                request.minOut
            );
        }
        // Joins
        for (uint256 i = 0; i < creationsLen; i++) {
            JoinPoolRequest memory request = joinPoolRequests[i];
            migrateUniswapV2AndJoinPool(request.fromLpToken, request.minOut, request.pool, request.rewardPool);
        }
    }

    function _removeLiquidityUniswapV2(address lpToken)
        internal
        returns (
            address token0,
            uint256 amount0,
            address token1,
            uint256 amount1
        )
    {
        // Remove liquidity position from IUniswapV2
        IUniswapV2Pair pair = IUniswapV2Pair(lpToken);

        uint256 liquidity = pair.balanceOf(msg.sender);
        require(pair.transferFrom(msg.sender, address(pair), liquidity), "!liquidity");
        token0 = pair.token0();
        token1 = pair.token1();
        (amount0, amount1) = pair.burn(address(this));
    }

    function _createBalancerPool(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 swapFeePercentage,
        bool oracleEnabled,
        address owner
    ) internal returns (address pool) {
        uint256[] memory weights = new uint256[](2);
        weights[0] = 500000000000000000; // 50%
        weights[1] = 500000000000000000; // 50%
        pool = IWeightedPool2TokensFactory(bWeightedPool2PoolFactory).create(
            name,
            symbol,
            tokens,
            weights,
            swapFeePercentage,
            oracleEnabled,
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

        tokens[0].safeIncreaseAllowance(address(bVault), maxAmountsIn[0]);
        tokens[1].safeIncreaseAllowance(address(bVault), maxAmountsIn[1]);

        bytes memory userData;
        if (IBalancerPool(pool).totalSupply() == 0) {
            // Initialise pool
            userData = abi.encode(IVault.JoinKind.INIT, maxAmountsIn);
        } else {
            userData = abi.encode(IVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, maxAmountsIn, minOut);
        }

        bVault.joinPool(
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
