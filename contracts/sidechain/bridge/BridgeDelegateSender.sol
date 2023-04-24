// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

/**
 * @title BridgeDelegateSender
 * @dev Sends tokens to L1 via a bridge
 */
abstract contract BridgeDelegateSender is Ownable {
    function send(address _to, uint256 _amount) external virtual;
}
