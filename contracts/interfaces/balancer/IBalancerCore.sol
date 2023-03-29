// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

interface IPriceOracle {
    struct OracleAverageQuery {
        Variable variable;
        uint256 secs;
        uint256 ago;
    }
    enum Variable {
        PAIR_PRICE,
        BPT_PRICE,
        INVARIANT
    }

    /**
     * @notice getTimeWeightedAverage() is a function that calculates the time-weighted average of a given array of OracleAverageQuery structs.
     * @dev The function takes an array of OracleAverageQuery structs as an argument and returns an array of uint256 values. The OracleAverageQuery struct contains the following fields:
     *  - uint256 timestamp
     *  - uint256 value
     *
     * The function calculates the time-weighted average of the given array of OracleAverageQuery structs by taking the sum of the product of the timestamp and value of each struct, and dividing it by the sum of the timestamps.
     */
    function getTimeWeightedAverage(OracleAverageQuery[] memory queries)
        external
        view
        returns (uint256[] memory results);
}

interface IBalancerVault {
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

    enum SwapKind {
        GIVEN_IN,
        GIVEN_OUT
    }

    struct BatchSwapStep {
        bytes32 poolId;
        uint256 assetInIndex;
        uint256 assetOutIndex;
        uint256 amount;
        bytes userData;
    }

    /**
     * @notice batchSwap is a function that allows users to perform multiple swaps in a single transaction.
     * @dev batchSwap takes in a SwapKind, an array of BatchSwapSteps, an array of IAssets, a FundManagement, an array of int256s, and a deadline. It returns an array of int256s.
     */
    function batchSwap(
        SwapKind kind,
        BatchSwapStep[] memory swaps,
        IAsset[] memory assets,
        FundManagement memory funds,
        int256[] memory limits,
        uint256 deadline
    ) external payable returns (int256[] memory);

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

    struct JoinPoolRequest {
        IAsset[] assets;
        uint256[] maxAmountsIn;
        bytes userData;
        bool fromInternalBalance;
    }

    /**
     * @notice getPool() allows users to retrieve the address and PoolSpecialization associated with a given poolId.
     *
     * @dev getPool() is a view function that takes in a bytes32 poolId and returns the address and PoolSpecialization associated with that poolId.
     */
    function getPool(bytes32 poolId) external view returns (address, PoolSpecialization);

    /**
     * @notice getPoolTokens() allows users to retrieve the list of tokens, their respective balances, and the last block in which the pool was changed.
     * @dev getPoolTokens() takes in a poolId as a bytes32 and returns an array of addresses, an array of uint256, and a uint256.
     */
    function getPoolTokens(bytes32 poolId)
        external
        view
        returns (
            address[] memory tokens,
            uint256[] memory balances,
            uint256 lastChangeBlock
        );

    /**
     * @notice This function allows a user to join a pool.
     * @dev The function takes in a poolId, sender address, recipient address, and a JoinPoolRequest memory request. The function is payable.
     */
    function joinPool(
        bytes32 poolId,
        address sender,
        address recipient,
        JoinPoolRequest memory request
    ) external payable;

    function swap(
        SingleSwap memory singleSwap,
        FundManagement memory funds,
        uint256 limit,
        uint256 deadline
    ) external returns (uint256 amountCalculated);

    /**
     * @dev Allows a sender to exit a pool with a given poolId.
     * @param poolId The ID of the pool to exit.
     * @param sender The address of the sender.
     * @param recipient The address of the recipient.
     * @param request The ExitPoolRequest memory request.
     */
    function exitPool(
        bytes32 poolId,
        address sender,
        address payable recipient,
        ExitPoolRequest memory request
    ) external;

    /**
     * @notice This function returns the internal balance of a user for a given list of tokens.
     * @dev This function is used to get the internal balance of a user for a given list of tokens. It takes in two parameters, the user address and an array of token addresses. It returns an array of uint256 values representing the internal balance of the user for each token.
     */
    function getInternalBalance(address user, address[] memory tokens) external view returns (uint256[] memory);

    /**
     * @notice This function is used to query the batch swap.
     * @dev This function is used to query the batch swap. It takes in the SwapKind, BatchSwapSteps, IAssets, and FundManagement as parameters. It returns an int256 array of asset deltas.
     */
    function queryBatchSwap(
        SwapKind kind,
        BatchSwapStep[] memory swaps,
        IAsset[] memory assets,
        FundManagement memory funds
    ) external returns (int256[] memory assetDeltas);

    struct ExitPoolRequest {
        IAsset[] assets;
        uint256[] minAmountsOut;
        bytes userData;
        bool toInternalBalance;
    }
    enum ExitKind {
        EXACT_BPT_IN_FOR_ONE_TOKEN_OUT,
        EXACT_BPT_IN_FOR_TOKENS_OUT,
        BPT_IN_FOR_EXACT_TOKENS_OUT,
        MANAGEMENT_FEE_TOKENS_OUT // for ManagedPool
    }
}

interface IAsset {
    // solhint-disable-previous-line no-empty-blocks
}

interface IBalancerPool {
    /**
     * @notice getPoolId() is a function that returns the pool ID of the contract.
     * @dev The pool ID is a unique identifier for the contract. It is used to identify the contract in external systems.
     */
    function getPoolId() external view returns (bytes32);

    /**
     * @notice getNormalizedWeights() returns an array of uint256 values representing the normalized weights of the weights array.
     * @dev This function is used to normalize the weights array to a sum of 1.
     */
    function getNormalizedWeights() external view returns (uint256[] memory);

    /**
     * @dev Returns a boolean value that indicates whether the swap feature is enabled or not.
     * @return bool - true if the swap feature is enabled, false otherwise.
     */
    function getSwapEnabled() external view returns (bool);

    /**
     * @notice This function returns the address of the owner of the contract.
     * @dev This function is used to get the address of the owner of the contract. It is an external view function, meaning that it does not modify the state of the contract and can be called from outside the contract.
     */
    function getOwner() external view returns (address);

    /**
     * @dev Returns the total supply of a token.
     * @return uint256 The total supply of the token.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @notice This function returns the balance of the given account.
     * @dev This function is used to get the balance of the given account. It is an external view function and returns a uint256 value.
     */
    function balanceOf(address account) external view returns (uint256);
}

interface ILBPFactory {
    /**
     * @notice Creates a new UniswapV2Router02 instance.
     * @dev This function creates a new UniswapV2Router02 instance with the given parameters.
     * @param name The name of the UniswapV2Router02 instance.
     * @param symbol The symbol of the UniswapV2Router02 instance.
     * @param tokens An array of IERC20 tokens to be used in the UniswapV2Router02 instance.
     * @param weights An array of weights corresponding to the tokens array.
     * @param swapFeePercentage The swap fee percentage for the UniswapV2Router02 instance.
     * @param owner The owner of the UniswapV2Router02 instance.
     * @param swapEnabledOnStart Whether the UniswapV2Router02 instance is enabled on start.
     * @return The address of the newly created UniswapV2Router02 instance.
     */
    function create(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256 swapFeePercentage,
        address owner,
        bool swapEnabledOnStart
    ) external returns (address);
}

interface ILBP {
    /**
     * @notice This function sets the swapEnabled boolean to true or false.
     * @dev This function is used to enable or disable the swap functionality.
     */
    function setSwapEnabled(bool swapEnabled) external;

    /**
     * @notice updateWeightsGradually() is a function that allows the user to gradually update the weights of a contract over a period of time.
     * @dev The function takes three parameters: startTime, endTime, and endWeights. startTime is the time at which the weight update should begin, endTime is the time at which the weight update should end, and endWeights is an array of weights that should be applied at the end of the update period. The function will gradually update the weights of the contract between startTime and endTime.*/
    function updateWeightsGradually(
        uint256 startTime,
        uint256 endTime,
        uint256[] memory endWeights
    ) external;

    /**
     * @notice getGradualWeightUpdateParams() returns the startTime, endTime, and endWeights of a gradual weight update.
     * @dev getGradualWeightUpdateParams() is a view function that returns the startTime, endTime, and endWeights of a gradual weight update. The startTime is the timestamp when the gradual weight update begins, the endTime is the timestamp when the gradual weight update ends, and the endWeights is an array of weights that correspond to the endTime.*/
    function getGradualWeightUpdateParams()
        external
        view
        returns (
            uint256 startTime,
            uint256 endTime,
            uint256[] memory endWeights
        );
}

interface IStablePoolFactory {
    /**
     * @notice Creates a new Natpsec contract.
     * @dev This function creates a new Natpsec contract with the given parameters.
     * @param name The name of the Natpsec contract.
     * @param symbol The symbol of the Natpsec contract.
     * @param tokens An array of IERC20 tokens to be used in the Natpsec contract.
     * @param amplificationParameter The amplification parameter for the Natpsec contract.
     * @param swapFeePercentage The swap fee percentage for the Natpsec contract.
     * @param owner The address of the owner of the Natpsec contract.
     * @return The address of the newly created Natpsec contract.
     */
    function create(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256 amplificationParameter,
        uint256 swapFeePercentage,
        address owner
    ) external returns (address);
}

interface IWeightedPool2TokensFactory {
    /**
     * @notice Creates a new UniswapV2Router02 instance.
     * @dev This function creates a new UniswapV2Router02 instance with the given parameters.
     * @param name The name of the UniswapV2Router02 instance.
     * @param symbol The symbol of the UniswapV2Router02 instance.
     * @param tokens An array of IERC20 tokens to be used in the UniswapV2Router02 instance.
     * @param weights An array of weights corresponding to the tokens array.
     * @param swapFeePercentage The swap fee percentage for the UniswapV2Router02 instance.
     * @param oracleEnabled A boolean indicating whether or not the oracle is enabled for the UniswapV2Router02 instance.
     * @param owner The address of the owner of the UniswapV2Router02 instance.
     * @return The address of the newly created UniswapV2Router02 instance.
     */
    function create(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory weights,
        uint256 swapFeePercentage,
        bool oracleEnabled,
        address owner
    ) external returns (address);
}

interface IRateProvider {
    function getRate() external view returns (uint256);
}

interface IWeightedPoolFactory {
    /**
     * @dev Deploys a new `WeightedPool`.
     */
    function create(
        string memory name,
        string memory symbol,
        IERC20[] memory tokens,
        uint256[] memory normalizedWeights,
        IRateProvider[] memory rateProviders,
        uint256 swapFeePercentage,
        address owner
    ) external returns (address);
}
