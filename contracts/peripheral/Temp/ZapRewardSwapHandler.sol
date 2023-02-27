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
    address public immutable WETH_TOKEN;
    IBalancerVault public immutable balVault;

    mapping(address => mapping(address => bytes32)) poolIds;
    mapping(address => address[]) paths;

    constructor(address _balVault, address _wethToken) {
        owner = msg.sender;
        balVault = IBalancerVault(_balVault);
        WETH_TOKEN = _wethToken;
    }

    // Adapted from HandlerBase
    function setPendingOwner(address _pendingOwner) external onlyOwner {
        require(pendingOwner != address(0), "invalid owner");
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
        require((msg.sender == owner), "owner only");
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

    // Adapted from HandlerBase
    function setPoolIds(
        address token0,
        address token1,
        bytes32 _poolId
    ) public onlyOwner {
        require(_poolId != bytes32(0), "Invalid Pool");
        (address[] memory tokens, , ) = IBalancerVault(balancerPool).getPoolTokens(_poolId);
        bool token0Found;
        bool token1Found;

        for (var i = 0; i < tokens.length; i++) {
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
        address memory token1,
        bytes32[] memory _poolIds
    ) external onlyOwner {
        for (uint256 i = 0; i < length; i++) {
            setPoolIds(token0[i], token1[i], _poolIds[i]);
        }
    }

    function setPath(address[] memory path) public onlyOwner {
        uint256 length = path.length;
        require(length > 1, "Invalid Path");
        require(path[0] != path[length - 1], "Invalid Path");

        for (uint256 i = 1; i < length; i++) {
            require(poolIds[path[i - 1]][path[i]] != bytes32(0), "No Pool");
        }

        paths[path[0]][path[length - 1]] = path;
    }

    function setMultiplePaths(address[][] memory pathList) external onlyOwner {
        for (uint256 i = 0; i < length; i++) {
            setPath(pathList[i]);
        }
    }
}
