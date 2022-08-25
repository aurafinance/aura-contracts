// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IVault, IPriceOracle, IAsset } from "./Interfaces.sol";

// Balancer Interfaces
interface IBalancerPool {
    function getPoolId() external view returns (bytes32);
}

// @dev Interface of https://github.com/balancer-labs/balancer-v2-monorepo/blob/weighted-deployment/contracts/pools/weighted/WeightedPoolFactory.sol
interface IWeightedPoolFactory {
    // 0x8E9aa87E45e92bad84D5F8DD1bff34Fb92637dE9
    //  exampl https://etherscan.io/tx/0x76ef3741298aec99c8cc88d5b773e601e8bc3ef75e6705eef6f1276b216084fa
    // created 0xBF8418344C046FCf87FeF3c15a8526Ada6A0a116
    // 0xBA12222222228d8Ba445958a75a0704d566BF2C8
    // Balancer: Vault joinPool(bytes32, address, address, (address[],uint256[],bytes,bool))
    // example https://etherscan.io/tx/0xa6c1f248860542cfe2c3a9db52cdb5ca043eb05024139dbf9e75549901da3e30
    /**
     * @dev Deploys a new `WeightedPool`.
     */
    function create(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens, // 200000000000000000 , 800000000000000000
        uint256[] memory weights,
        uint256 swapFeePercentage, // 3000000000000000
        address owner
    ) external returns (address);
}

// Uniswap/Sushi Interfaces

/// @title Non-fungible token for positions
/// @notice Wraps Uniswap V3 positions in a non-fungible token interface which allows for them to be transferred
interface INonfungiblePositionManager {
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
}

interface IUniswapV2Pair {
    function balanceOf(address owner) external view returns (uint256);

    function burn(address to) external returns (uint256 amount0, uint256 amount1);

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool);
}

contract AuraLiquidityMigrator {
    IWeightedPoolFactory public immutable BALANCER_POOL_FACTORY; // 0x8E9aa87E45e92bad84D5F8DD1bff34Fb92637dE9
    INonfungiblePositionManager public immutable UNISWAP_V3_POSITION_MANAGER; // 0xC36442b4a4522E871399CD717aBDD847Ab11FE88 Uniswap V3: Positions NFT
    IVault public immutable BALANCER_VAULT; //0xBA12222222228d8Ba445958a75a0704d566BF2C8

    constructor(
        address _weightedPoolFactory,
        address _nonFungiblePositionManager,
        address _balancerVault
    ) {
        BALANCER_POOL_FACTORY = IWeightedPoolFactory(_weightedPoolFactory);
        UNISWAP_V3_POSITION_MANAGER = INonfungiblePositionManager(_nonFungiblePositionManager);
        BALANCER_VAULT = IVault(_balancerVault);
    }

    event PoolCreated(address indexed pool);

    function migrateUniswapV3PositionAndCreatePool(
        uint256 tokenId,
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256 swapFeePercentage,
        address owner,
        uint256 minOut
    ) external returns (address pool) {
        require(weights.length == 2 && tokens.length == 2, "only token pairs");

        (uint256 amount0, uint256 amount1) = _removeLiquidityUniswapV3(tokenId);

        // create pool
        pool = _createBalancerPool(name, symbol, tokens, weights, swapFeePercentage, owner);

        // add liquidity to balancer pool
        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = amount0;
        maxAmountsIn[1] = amount1;

        _addLiquidityBalancer(pool, tokens, maxAmountsIn, owner, minOut);

        emit PoolCreated(pool);
    }

    function migrateUniswapV2PositionAndCreatePool(
        address lpToken, //Uniswap LP token
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256 swapFeePercentage,
        address owner,
        uint256 minOut
    ) external returns (address pool) {
        require(weights.length == 2 && tokens.length == 2, "only token pairs");
        // Remove liquidity position from Uniswap
        (uint256 amount0, uint256 amount1) = _removeLiquidityUniswapV2(lpToken, owner);

        // create pool
        pool = _createBalancerPool(name, symbol, tokens, weights, swapFeePercentage, owner);

        // deposit liquidity to balancer pool
        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = amount0;
        maxAmountsIn[1] = amount1;

        _addLiquidityBalancer(pool, tokens, maxAmountsIn, owner, minOut);
        emit PoolCreated(pool);
    }

    function migrateUniswapV2PositionAndJoinPool(
        address lpToken, //Uniswap LP token
        IERC20[] memory tokens,
        uint256[] memory weights,
        address owner,
        uint256 minOut,
        address pool
    ) external {
        require(weights.length == 2 && tokens.length == 2, "only token pairs");

        (uint256 amount0, uint256 amount1) = _removeLiquidityUniswapV2(lpToken, owner);

        // deposit liquidity to balancer pool
        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = amount0;
        maxAmountsIn[1] = amount1;

        _addLiquidityBalancer(pool, tokens, maxAmountsIn, owner, minOut);
    }

    function migrateUniswapV3PositionAndJoinPool(
        uint256 tokenId,
        IERC20[] memory tokens,
        uint256[] memory weights,
        address owner,
        uint256 minOut,
        address pool
    ) external {
        require(weights.length == 2 && tokens.length == 2, "only token pairs");

        (uint256 amount0, uint256 amount1) = _removeLiquidityUniswapV3(tokenId);

        // add liquidity to balancer pool

        uint256[] memory maxAmountsIn = new uint256[](2);
        maxAmountsIn[0] = amount0;
        maxAmountsIn[1] = amount1;

        _addLiquidityBalancer(pool, tokens, maxAmountsIn, owner, minOut);

        emit PoolCreated(pool);
    }

    function _removeLiquidityUniswapV3(uint256 tokenId) internal returns (uint256 amount0, uint256 amount1) {
        // Remove liquidity position from Uniswap
        INonfungiblePositionManager.CollectParams memory collectParams = INonfungiblePositionManager.CollectParams({
            tokenId: tokenId,
            recipient: address(this),
            amount0Max: type(uint128).max,
            amount1Max: type(uint128).max
        });
        (amount0, amount1) = INonfungiblePositionManager(UNISWAP_V3_POSITION_MANAGER).collect(collectParams);
    }

    function _removeLiquidityUniswapV2(
        address lpToken, //Uniswap LP token
        address owner
    ) internal returns (uint256 amount0, uint256 amount1) {
        // Remove liquidity position from IUniswapV2
        IUniswapV2Pair pair = IUniswapV2Pair(lpToken);
        uint256 liquidity = pair.balanceOf(owner);
        require(pair.transferFrom(msg.sender, address(this), liquidity));

        (amount0, amount1) = pair.burn(address(this));
    }

    function _createBalancerPool(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256 swapFeePercentage,
        address owner
    ) internal returns (address pool) {
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
        address owner,
        uint256 minOut
    ) internal {
        // add liquidity to balancer pool
        bytes32 poolId = IBalancerPool(pool).getPoolId();
        IAsset[] memory assets = new IAsset[](2);
        assets[0] = IAsset(address(tokens[0]));
        assets[1] = IAsset(address(tokens[1]));

        BALANCER_VAULT.joinPool(
            poolId,
            address(this), //sender
            owner, // recipient
            IVault.JoinPoolRequest(
                assets,
                maxAmountsIn,
                abi.encode(IVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, maxAmountsIn, minOut),
                false // Don't use internal balances
            )
        );
    }
}
