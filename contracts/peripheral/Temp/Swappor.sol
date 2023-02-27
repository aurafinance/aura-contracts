// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IBalancerVault, IPriceOracle, IAsset } from "../interfaces/balancer/IBalancerCore.sol";

/*
 * SWAPOOR-MAXI
 */
contract ZapExtraRewardTokenSwaper {
    using SafeERC20 for IERC20;

    address balancerPool;
    address operator;
    address owner;
    mapping(address => mapping(address => bytes32)) poolIds;
    mapping(address => address[]) paths;

    constructor(address _balancerPool) {
        balancerPool = _balancerPool;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "only operator");
    }

    function setPoolIds(
        address token0,
        address token1,
        bytes32 _poolId
    ) public onlyOperator {
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
    ) external onlyOperator {
        for (uint256 i = 0; i < length; i++) {
            setPoolIds(token0[i], token1[i], _poolIds[i]);
        }
    }

    function setPath(address[] memory path) public onlyOperator {
        uint256 length = path.length;
        require(length > 1, "Invalid Path");
        require(path[0] != path[length - 1], "Invalid Path");

        for (uint256 i = 1; i < length; i++) {
            require(poolIds[path[i - 1]][path[i]] != bytes32(0), "No Pool");
        }

        paths[path[0]][path[length - 1]] = path;
    }

    function setMultiplePaths(address[][] memory pathList) external onlyOperator {
        for (uint256 i = 0; i < length; i++) {
            setPath(pathList[i]);
        }
    }
}
