// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IBalancerVault, IAsset } from "../../interfaces/balancer/IBalancerCore.sol";
import { IRewardHandler } from "../../interfaces/balancer/IRewardHandler.sol";

/**
 * @title   HandlerBase
 * @author  lama.airforce
 */
contract HandlerBase is IRewardHandler {
    using SafeERC20 for IERC20;
    address public owner;
    address public pendingOwner;
    address public immutable token;
    address public immutable strategy;

    address public constant WETH_TOKEN = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    address public constant BAL_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

    IBalancerVault public balVault = IBalancerVault(BAL_VAULT);

    constructor(address _token, address _strategy) {
        token = _token;
        strategy = _strategy;
        owner = msg.sender;
    }

    function setPendingOwner(address _po) external onlyOwner {
        pendingOwner = _po;
    }

    function applyPendingOwner() external onlyOwner {
        require(pendingOwner != address(0), "invalid owner");
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function rescueToken(address _token, address _to) external onlyOwner {
        require(_token != token, "not allowed");
        uint256 _balance = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(_to, _balance);
    }

    function _createSwapFunds() internal returns (IBalancerVault.FundManagement memory) {
        return
            IBalancerVault.FundManagement({
                sender: address(this),
                fromInternalBalance: false,
                recipient: payable(address(this)),
                toInternalBalance: false
            });
    }

    function sell() external virtual onlyStrategy {}

    modifier onlyOwner() {
        require((msg.sender == owner), "owner only");
        _;
    }

    modifier onlyStrategy() {
        require((msg.sender == strategy), "strategy only");
        _;
    }

    receive() external payable {}
}
