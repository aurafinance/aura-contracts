// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { BridgeDelegateSender } from "./BridgeDelegateSender.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

/**
 * @title 	SimpleBridgeDelegateSender
 * @dev 	Only used as an example and for tests
 *  		Sends tokens to "L1" via a simple transfer
 */
contract SimpleBridgeDelegateSender is BridgeDelegateSender {
    address public immutable token;

    constructor(address _token) {
        token = _token;
    }

    function send(uint256 _amount) external override onlyOwner {
        IERC20(token).transfer(l1Receiver, _amount);
        emit Send(l1Receiver, _amount);
    }
}
