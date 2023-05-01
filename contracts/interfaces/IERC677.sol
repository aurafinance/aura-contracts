// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

interface IERC677 is IERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value, bytes data);

    function transferAndCall(
        address to,
        uint256 value,
        bytes calldata data
    ) external returns (bool);
}
