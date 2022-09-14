// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

import { IBalancerVault, IPriceOracle, IWeightedPoolFactory } from "../interfaces/balancer/IBalancerCore.sol";
import { IBalancerPool, IAsset, IRateProvider } from "../interfaces/balancer/IBalancerCore.sol";
import { ILiquidityGaugeFactory } from "../_mocks/balancer/MockLiquidityGaugeFactory.sol";
import { IRewardPool } from "../_mocks/balancer/MockRewardPool.sol";
import { IUniswapV2Pair } from "../_mocks/uniswap/MockUniswapV2Pair.sol";
import { IUniswapV2Router02 } from "../_mocks/uniswap/MockUniswapV2Router02.sol";

/**
 * @title   UniswapMigrator
 * @notice  Migrates liquidity positions from Sushiswap or Uniswap v2
 * @dev     Given a "fromLPToken", it removes the liquidity from Sushiswap/Uniswap,
 *          then it creates or join to a balancer pool, adds liquidity to the pool.
 *          Finally if the pool already existed it stakes the liquidity in an aura reward pool.
 */
contract UniswapMigrator {
    using SafeERC20 for IERC20;
    /// @dev Balancer weighted pool factory
    IWeightedPoolFactory public immutable bWeightedPoolFactory;
    /// @dev Balancer vault
    IBalancerVault public immutable bVault;
    /// @dev Balancer liquidity gauge factory
    ILiquidityGaugeFactory public immutable bGaugeFactory;
    /// @dev Uniswap router
    IUniswapV2Router02 public immutable uniswapRouter;
    /// @dev Sushiswap router
    IUniswapV2Router02 public immutable sushiswapRouter;

    address private immutable poolOwner;

    uint256 private constant WEIGHT_50 = 500000000000000000; // 50%
    uint256 private constant GAUGE_WEIGHT_CAP = 20000000000000000; // 2%

    enum LpSource {
        UNISWAP,
        SUSHISWAP
    }
    struct JoinPoolRequest {
        LpSource source;
        address fromLpToken;
        uint256 liquidity;
        IERC20[] tokens;
        uint256[] amountsMin;
        uint256 deadline;
        address pool;
        address rewardPool;
        uint256 amountMinOut;
    }

    struct CreatePoolRequest {
        string name;
        string symbol;
        LpSource source;
        address fromLpToken;
        uint256 liquidity;
        IERC20[] tokens;
        IRateProvider[] rateProviders;
        uint256[] amountsMin;
        uint256 deadline;
        uint256 swapFeePercentage;
    }

    /**
     * @param _bWeightedPoolFactory The pool factory address
     * @param _bVault The balancer vault address
     * @param _bGaugeFactory The balancer liquidity gauge factory address
     * @param _uniswapRouter The uniswap router address
     * @param _sushiwapRouter The sushiswap router address
     * @param _poolOwner The onwer address of created poools.
     */
    constructor(
        address _bWeightedPoolFactory,
        address _bVault,
        address _bGaugeFactory,
        address _uniswapRouter,
        address _sushiwapRouter,
        address _poolOwner
    ) {
        bWeightedPoolFactory = IWeightedPoolFactory(_bWeightedPoolFactory);
        bVault = IBalancerVault(_bVault);
        bGaugeFactory = ILiquidityGaugeFactory(_bGaugeFactory);
        uniswapRouter = IUniswapV2Router02(_uniswapRouter);
        sushiswapRouter = IUniswapV2Router02(_sushiwapRouter);
        poolOwner = _poolOwner;
    }

    /// @dev Event emmited when a new balancer pool is created.
    event PoolCreated(address indexed pool, address gauge);

    /**
     * @dev Migrates a liquidity position, deploys a new `WeightedPool` and adds liquidity to the pool.
     *      The created pool has a weight of 50/50.
     *
     * @param request.name The name of the new pool
     * @param request.symbol The symbol of the new pool
     * @param request.fromLpToken The lp Token address
     * @param request.liquidity The amount of liquidity to remove (lpToken amount)
     * @param request.tokens The underlying tokens, tokens have to be sorted as expected by balancer vault.
     * @param request.rateProviders The underlying tokens rate providers
     * @param request.amountsMin The minimum amount of tokens that must be received.
     * @param request.deadline Unix timestamp after which the transaction will revert.
     * @param request.swapFeePercentage The swap fee percentage
     */
    function migrateUniswapV2AndCreatePool(CreatePoolRequest memory request)
        public
        returns (address pool, address gauge)
    {
        require(request.tokens.length == 2 && request.amountsMin.length == 2, "only token pairs");

        // 1. Remove liquidity
        (address token0, uint256 amount0, , uint256 amount1) = _removeLiquidityUniswapV2(
            request.source,
            request.fromLpToken,
            request.liquidity,
            request.tokens,
            request.amountsMin,
            request.deadline
        );

        uint256[] memory maxAmountsIn = new uint256[](2);

        // sort from uniswap order to balancer order
        (maxAmountsIn[0], maxAmountsIn[1]) = address(request.tokens[0]) == token0
            ? (amount0, amount1)
            : (amount1, amount0);

        // 2. Create balancer pool
        pool = _createBalancerPool(
            request.name,
            request.symbol,
            request.tokens,
            request.rateProviders,
            request.swapFeePercentage
        );

        // 3. Deposit to balancer pool
        _addLiquidityBalancer(pool, request.tokens, maxAmountsIn, msg.sender, 0);

        gauge = bGaugeFactory.create(pool, GAUGE_WEIGHT_CAP);

        emit PoolCreated(pool, gauge);
    }

    /**
     * @dev Migrates a liquidity position, adds liquidity to the pool, and stake the BPT
     *
     * @param request.fromLpToken The lp Token address
     * @param request.liquidity The amount of liquidity to remove (lpToken amount)
     * @param request.tokens The underlying tokens, tokens have to be sorted as expected by balancer vault.
     * @param request.amountsMin The minimum amount of tokens that must be received from uniswap.
     * @param request.deadline Unix timestamp after which the transaction will revert.
     * @param request.pool The pool address to add liquidity
     * @param request.rewardPool The aura reward pool address
     * @param request.amountMinOut The min amount of liquidity added to the balancer pool.
     */
    function migrateUniswapV2AndJoinPool(JoinPoolRequest memory request) public {
        require(request.tokens.length == 2 && request.amountsMin.length == 2, "only token pairs");
        // 1. Remove liquidity
        (address token0, uint256 amount0, , uint256 amount1) = _removeLiquidityUniswapV2(
            request.source,
            request.fromLpToken,
            request.liquidity,
            request.tokens,
            request.amountsMin,
            request.deadline
        );

        // sort amounts for balancer pool
        uint256[] memory maxAmountsIn = new uint256[](2);
        (maxAmountsIn[0], maxAmountsIn[1]) = address(request.tokens[0]) == token0
            ? (amount0, amount1)
            : (amount1, amount0);

        // 2. Deposit to balancer pool
        _addLiquidityBalancer(request.pool, request.tokens, maxAmountsIn, address(this), request.amountMinOut);

        uint256 minted = IERC20(request.pool).balanceOf(address(this));
        require(minted > 0 && request.amountMinOut > 0, "!mint");

        // 3. Deposit to reward pool
        if (request.rewardPool != address(0)) {
            IERC20(request.pool).safeIncreaseAllowance(request.rewardPool, minted);
            IRewardPool(request.rewardPool).deposit(minted, msg.sender);
        } else {
            IERC20(request.pool).safeTransfer(msg.sender, minted);
        }
    }

    // uniswap-migrator
    // gauge-migrator
    function _removeLiquidityUniswapV2(
        LpSource source,
        address fromLpToken,
        uint256 liquidity,
        IERC20[] memory tokens,
        uint256[] memory amountsMin,
        uint256 deadline
    )
        internal
        returns (
            address token0,
            uint256 amount0,
            address token1,
            uint256 amount1
        )
    {
        token0 = IUniswapV2Pair(fromLpToken).token0();
        token1 = IUniswapV2Pair(fromLpToken).token1();

        // Sort tokens and amounts for Uniswap router
        (uint256 amount0Min, uint256 amount1Min) = address(tokens[0]) == token0
            ? (amountsMin[0], amountsMin[1])
            : (amountsMin[1], amountsMin[0]);

        // Sender needs to approve uniswapRouter at least for liquidity,
        IUniswapV2Router02 router = source == LpSource.UNISWAP ? uniswapRouter : sushiswapRouter;

        require(IUniswapV2Pair(fromLpToken).transferFrom(msg.sender, address(this), liquidity), "!liquidity");
        require(IUniswapV2Pair(fromLpToken).approve(address(router), liquidity), "!approval");

        // routers reverts if min amounts are not met, no need to check the output.
        (amount0, amount1) = router.removeLiquidity(
            token0,
            token1,
            liquidity,
            amount0Min,
            amount1Min,
            address(this),
            deadline
        );
    }

    /**
     * Creates a balancer pool, it could be either a Stable Pool  or a Weighted Pool
     *
     * @param name The name of the new pool
     * @param symbol The symbol of the new pool
     * @param tokens The underlying tokens of the balancer pool, have to be sorted as expected by balancer vault.
     * @param rateProviders The underlying tokens rate providers
     * @param swapFeePercentage The swap fee percentage
     */
    function _createBalancerPool(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        IRateProvider[] memory rateProviders,
        uint256 swapFeePercentage
    ) internal returns (address pool) {
        uint256[] memory normalizedWeights = new uint256[](2);
        normalizedWeights[0] = WEIGHT_50;
        normalizedWeights[1] = WEIGHT_50;
        pool = bWeightedPoolFactory.create(
            name,
            symbol,
            tokens,
            normalizedWeights,
            rateProviders,
            swapFeePercentage,
            poolOwner
        );
    }

    function _addLiquidityBalancer(
        address pool,
        IERC20[] memory tokens,
        uint256[] memory maxAmountsIn,
        address recipient,
        uint256 amountMinOut
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
            userData = abi.encode(IBalancerVault.JoinKind.INIT, maxAmountsIn);
        } else {
            userData = abi.encode(IBalancerVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, maxAmountsIn, amountMinOut);
        }

        bVault.joinPool(
            poolId,
            address(this), //sender
            recipient, // recipient
            IBalancerVault.JoinPoolRequest(
                assets,
                maxAmountsIn,
                userData,
                false // Don't use internal balances
            )
        );
    }
}
