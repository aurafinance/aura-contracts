// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface ILiquidityGaugeFactory {
    function create(address pool) external returns (address);
}
