// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

import { IRewardHandler } from "../../interfaces/balancer/IRewardHandler.sol";

/**
 * @title   Forwarder Handler
 * @author  Aura Finance
 * @dev
 * It allows to forward tokens to a specific address, this is speacially usefull on edge
 * scenarios like bbausd v3 where it is not possible to swap it and requires multipe steps to  unwrap
 * see https://snapshot.org/#/balancer.eth/proposal/0xeb1a639b7aa92ee03204c5521d7e69c8b180a55a696a88ca45aa24001c7a2ffd
 */
contract ForwarderHandler is IRewardHandler {
    using SafeERC20 for IERC20;
    address public owner;
    address public pendingOwner;
    address public immutable token;

    constructor(address _token) {
        token = _token;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require((msg.sender == owner), "owner only");
        _;
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
        uint256 _balance = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(_to, _balance);
    }

    function sell() external override {
        IERC20(token).safeTransfer(owner, IERC20(token).balanceOf(address(this)));
    }
}
