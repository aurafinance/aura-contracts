// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IBalancerVault, IAsset } from "../../interfaces/balancer/IBalancerCore.sol";
import { IRewardHandler } from "../../interfaces/balancer/IRewardHandler.sol";

/**
 * @title   HandlerBase
 * @author  llama.airforce
 */
contract HandlerBase is IRewardHandler {
    using SafeERC20 for IERC20;
    address public owner;
    address public pendingOwner;
    address public immutable token;
    address public immutable strategy;

    address public immutable WETH_TOKEN;
    IBalancerVault public immutable balVault;

    constructor(
        address _token,
        address _strategy,
        address _balVault,
        address _wethToken
    ) {
        token = _token;
        strategy = _strategy;
        owner = msg.sender;
        balVault = IBalancerVault(_balVault);
        WETH_TOKEN = _wethToken;
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

    function _createSwapFunds() internal view returns (IBalancerVault.FundManagement memory) {
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
