// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IChef {
    function deposit(uint256, uint256) external;

    function claim(uint256, address) external;
}
