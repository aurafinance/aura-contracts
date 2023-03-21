// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IStrategy {
    function harvest() external returns (uint256 harvested);

    function harvest(uint256 _minAmountOut) external returns (uint256 harvested);

    function totalUnderlying() external view returns (uint256 total);

    function stake(uint256 _amount) external;

    function withdraw(uint256 _amount) external;

    function setApprovals() external;
}
