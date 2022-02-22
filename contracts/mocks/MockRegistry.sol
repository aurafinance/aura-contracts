// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

contract MockRegistry {
    mapping(uint256 => address) public addresses;

    function setAddress(uint256 id, address addr) public {
        addresses[id] = addr;
    }

    function get_address(uint256 id) external view returns (address) {
        return addresses[id];
    }
}
