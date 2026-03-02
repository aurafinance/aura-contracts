// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { ISafe } from "../safe/ISafe.sol";

contract MockSafe is ISafe {
    mapping(address => bool) public modules;
    bool public forceFail;

    function setForceFail(bool _forceFail) external {
        forceFail = _forceFail;
    }

    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation
    ) external override returns (bool success) {
        require(modules[msg.sender], "!module");
        require(operation == Operation.Call, "!operation");

        if (forceFail) {
            return false;
        }

        (success, ) = to.call{ value: value }(data);
    }

    function isModuleEnabled(address module) external view override returns (bool) {
        return modules[module];
    }

    function enableModule(address module) external override {
        modules[module] = true;
    }

    function disableModule(address, address module) external override {
        modules[module] = false;
    }

    receive() external payable {}
}
