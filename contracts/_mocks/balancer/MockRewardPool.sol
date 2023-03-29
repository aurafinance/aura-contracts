// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IRewardPool {
    /**
     * @notice deposit() allows users to deposit assets to a receiver address
     * @param assets uint256 amount of assets to be deposited
     * @param receiver address of the receiver
     * @return shares uint256 amount of shares received in return
     */
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
}
