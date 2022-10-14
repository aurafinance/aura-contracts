// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IRewardPool4626 {
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external returns (uint256 shares);

    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    function asset() external view returns (address);

    function balanceOf(address account) external view returns (uint256);

    function processIdleRewards() external;
}
