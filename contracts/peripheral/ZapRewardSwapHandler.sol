// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IBalancerVault, IPriceOracle, IAsset } from "../interfaces/balancer/IBalancerCore.sol";

/*
 * SWAPOOR-MAXI
 */
contract ZapRewardSwapHandler {
    using SafeERC20 for IERC20;
    address public owner;
    address public pendingOwner;
    IBalancerVault public immutable balVault;

    mapping(address => mapping(address => bytes32)) private poolIds;
    mapping(address => mapping(address => address[])) private paths;
    mapping(address => bool) public operators;
    mapping(address => bool) public tokenApproved;
    mapping(address => bool) public ignoreApproval;

    constructor(address _balVault) {
        owner = msg.sender;
        balVault = IBalancerVault(_balVault);
    }

    // Adapted from HandlerBase
    function setPendingOwner(address _pendingOwner) external onlyOwner {
        require(_pendingOwner != address(0), "invalid owner");
        pendingOwner = _pendingOwner;
    }

    // Adapted from HandlerBase
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "only pendingOwner");
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // Adapted from HandlerBase
    modifier onlyOwner() {
        require((msg.sender == owner), "only owner");
        _;
    }

    modifier onlyOperators() {
        require(operators[msg.sender], "only operators");
        _;
    }

    // Adapted from HandlerBase
    function rescueToken(address _token, address _to) external onlyOwner {
        uint256 _balance = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(_to, _balance);
    }

    // Adapted from HandlerBase
    function _createSwapFunds() internal view returns (IBalancerVault.FundManagement memory) {
        return
            IBalancerVault.FundManagement({
                sender: address(this),
                fromInternalBalance: false,
                recipient: payable(address(this)),
                toInternalBalance: false
            });
    }

    function setPoolIds(
        address token0,
        address token1,
        bytes32 _poolId
    ) public onlyOwner {
        require(_poolId != bytes32(0), "Invalid Pool");
        (address[] memory tokens, , ) = balVault.getPoolTokens(_poolId);
        bool token0Found;
        bool token1Found;

        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == token0) {
                token0Found = true;
            }
            if (tokens[i] == token1) {
                token1Found = true;
            }
        }

        require(token0Found && token1Found, "Invalid Pool");

        poolIds[token0][token1] = _poolId;
        poolIds[token1][token0] = _poolId;
    }

    function setMultiplePoolIds(
        address[] memory token0,
        address[] memory token1,
        bytes32[] memory _poolIds
    ) external onlyOwner {
        for (uint256 i = 0; i < token0.length; i++) {
            setPoolIds(token0[i], token1[i], _poolIds[i]);
        }
    }

    function addPath(address[] memory path) public onlyOwner {
        uint256 length = path.length;
        require(length > 1, "Invalid Path");
        require(path[0] != path[length - 1], "Invalid Path");

        for (uint256 i = 1; i < length; i++) {
            require(poolIds[path[i - 1]][path[i]] != bytes32(0), "No Pool");
        }

        paths[path[0]][path[length - 1]] = path;
    }

    function addMultiplePaths(address[][] memory pathList) external onlyOwner {
        for (uint256 i = 0; i < pathList.length; i++) {
            addPath(pathList[i]);
        }
    }

    function toggleIgnoredApproval(address token, bool state) external onlyOwner {
        ignoreApproval[token] = state;
    }

    function toggleOperators(address operator, bool state) external onlyOwner {
        operators[operator] = state;
    }

    function approveToken(address token) internal {
        if (!tokenApproved[token] && !ignoreApproval[token]) {
            IERC20(token).safeApprove(address(balVault), 0);
            IERC20(token).safeApprove(address(balVault), type(uint256).max);
            tokenApproved[token] = true;
        }
    }

    //Swap token 0 for token 1 using our stored paths
    function swapTokens(
        address _token0,
        address _token1,
        uint256 _amountIn,
        uint256 _amountOut
    ) external onlyOperators {
        _swapTokens(_token0, _token1, _amountIn, _amountOut);
    }

    //Swap token 0 for token 1 using our stored paths
    function _swapTokens(
        address _token0,
        address _token1,
        uint256 _amountIn,
        uint256 _amountOut
    ) internal {
        IERC20(_token0).safeTransferFrom(msg.sender, address(this), _amountIn);

        address[] memory path = paths[_token0][_token1];
        uint256 length = path.length;

        IBalancerVault.BatchSwapStep[] memory _swaps = new IBalancerVault.BatchSwapStep[](length - 1);
        IAsset[] memory _zapAssets = new IAsset[](length);
        int256[] memory _limits = new int256[](length);

        for (uint256 i = 0; i < length - 1; i++) {
            _swaps[i] = IBalancerVault.BatchSwapStep({
                poolId: poolIds[path[i]][path[i + 1]],
                assetInIndex: i,
                assetOutIndex: i + 1,
                amount: i == 0 ? _amountIn : 0,
                userData: new bytes(0)
            });
        }

        for (uint256 i = 0; i < length; i++) {
            _zapAssets[i] = IAsset(path[i]);
            _limits[i] = i == 0 ? int256(_amountIn) : type(int256).max;
        }

        approveToken(_token0);

        balVault.batchSwap(
            IBalancerVault.SwapKind.GIVEN_IN,
            _swaps,
            _zapAssets,
            _createSwapFunds(),
            _limits,
            block.timestamp
        );

        uint256 balance = IERC20(_token1).balanceOf(address(this));
        require(balance >= _amountOut, "Slippage");

        IERC20(_token1).safeTransfer(msg.sender, balance);
    }

    //HELPER FUNCTION FOR CALCULATING AMOUNTS OUT FROM ZAP-UI
    function getMinOut(
        address _token0,
        address _token1,
        uint256 _amountIn,
        uint256 _bps
    ) external onlyOperators returns (uint256 amountOut, uint256 minAmountOut) {
        uint256 start = IERC20(_token1).balanceOf(msg.sender);
        _swapTokens(_token0, _token1, _amountIn, 0);
        amountOut = IERC20(_token1).balanceOf(msg.sender) - start;
        minAmountOut = (amountOut * _bps) / 10000;
    }

    function getPath(address token0, address token1) external view returns (address[] memory path) {
        path = paths[token0][token1];
    }

    function getPoolId(address token0, address token1) external view returns (bytes32 poolId) {
        poolId = poolIds[token0][token1];
    }
}
