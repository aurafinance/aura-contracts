// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IPoolManagerLite {
    function setOperator(address _operator) external;

    function addPool(address _gauge) external returns (bool);

    function shutdownPool(uint256 _pid) external returns (bool);

    function shutdownSystem() external;

    function isShutdown() external view returns (bool);
}
