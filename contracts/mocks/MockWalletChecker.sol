// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

contract MockWalletChecker {
    mapping(address => bool) public wallets;

    function setAddress(address wallet, bool valid) external {
        wallets[wallet] = valid;
    }

    function check(address wallet) external view returns (bool) {
        return wallets[wallet];
    }
}
