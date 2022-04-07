// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "./MockBalancerPoolToken.sol";

interface IAsset {
    // solhint-disable-previous-line no-empty-blocks
}

interface IBalancerVault {
    function joinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        JoinPoolRequest memory request
    ) external payable;

    struct JoinPoolRequest {
        address[] assets;
        uint256[] maxAmountsIn;
        bytes userData;
        bool fromInternalBalance;
    }
}

contract MockBalancerVault {
    enum PoolSpecialization {
        GENERAL,
        MINIMAL_SWAP_INFO,
        TWO_TOKEN
    }

    enum JoinKind {
        INIT,
        EXACT_TOKENS_IN_FOR_BPT_OUT,
        TOKEN_IN_FOR_EXACT_BPT_OUT,
        ALL_TOKENS_IN_FOR_EXACT_BPT_OUT
    }

    struct JoinPoolRequest {
        IAsset[] assets;
        uint256[] maxAmountsIn;
        bytes userData;
        bool fromInternalBalance;
    }

    enum SwapKind {
        GIVEN_IN,
        GIVEN_OUT
    }

    struct SingleSwap {
        bytes32 poolId;
        SwapKind kind;
        IAsset assetIn;
        IAsset assetOut;
        uint256 amount;
        bytes userData;
    }

    struct FundManagement {
        address sender;
        bool fromInternalBalance;
        address payable recipient;
        bool toInternalBalance;
    }

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

    function getPool(bytes32) external view returns (address, PoolSpecialization) {
        return (poolToken, PoolSpecialization.GENERAL);
    }

    function joinPool(
        bytes32, /* poolId */
        address, /* sender */
        address recipient,
        JoinPoolRequest memory request
    ) external payable {
        uint256 amount = request.maxAmountsIn[0];
        uint256 price = MockBalancerPoolToken(poolToken).price();
        MockBalancerPoolToken(poolToken).mint(recipient, (amount * 1e18) / price);
    }

    function swap(
        SingleSwap memory singleSwap,
        FundManagement memory,
        uint256, /* limit */
        uint256 /* deadline */
    ) external returns (uint256 amountCalculated) {
        require(address(singleSwap.assetOut) == tokenA || address(singleSwap.assetOut) == tokenB, "!token");

        if (address(singleSwap.assetOut) == tokenA) {
            // send tokenA
            IERC20(tokenB).transferFrom(msg.sender, address(this), singleSwap.amount);
            IERC20(tokenA).transfer(msg.sender, singleSwap.amount);
        } else if (address(singleSwap.assetOut) == tokenB) {
            // send tokenB
            IERC20(tokenA).transferFrom(msg.sender, address(this), singleSwap.amount);
            IERC20(tokenB).transfer(msg.sender, singleSwap.amount);
        }
    }
}
