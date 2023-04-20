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

    event Send(address to, uint256 amount);

    constructor(address _token) {
        token = _token;
    }

    function send(address _to, uint256 _amount) external override onlyOwner {
        IERC20(token).transfer(_to, _amount);
        emit Send(_to, _amount);
    }
}
