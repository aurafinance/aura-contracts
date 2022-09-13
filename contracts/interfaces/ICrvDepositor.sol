// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface ICrvDepositor {
    function depositFor(
        address to,
        uint256 _amount,
        bool _lock,
        address _stakeAddress
    ) external;
}
