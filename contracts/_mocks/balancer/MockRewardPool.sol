// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IRewardPool {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
}
