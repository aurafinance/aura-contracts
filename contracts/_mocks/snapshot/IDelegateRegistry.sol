// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.11;

interface IDelegateRegistry {
    function clearDelegate(bytes32 id) external;

    function delegation(address, bytes32) external view returns (address);

    function setDelegate(bytes32 id, address delegate) external;
}
